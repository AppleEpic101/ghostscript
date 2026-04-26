import { AutoModelForCausalLM, AutoTokenizer, Tensor } from "@huggingface/transformers";
import { DEFAULT_TRANSPORT_CONFIG_ID, type LLMEncodingConfig } from "@ghostscript/shared";
import { loadCausalLmContext } from "./modelRuntime";

const DEFAULT_ENCODING_CONFIG: LLMEncodingConfig = {
  configId: DEFAULT_TRANSPORT_CONFIG_ID,
  provider: "ghostscript-bridge",
  modelId: "xenova-distilgpt2-v1",
  tokenizerId: "gpt2-tokenizer-v1",
  transportBackend: "local-gpt2-top4-v1",
  bitsPerStep: 2,
  excludedTokenSet: ["<|endoftext|>", "<s>", "</s>"],
  fallbackStrategy: "reduce-bits",
  tieBreakRule: "token-id-ascending",
  payloadTerminationStrategy: "length-header",
  contextTruncationStrategy: "tail",
  maxContextTokens: 512,
};

const MODEL_ID = "Xenova/distilgpt2";
const MERGE_SAFETY_SCAN_MULTIPLIER = 4;

interface CandidateToken {
  id: number;
  logit: number;
}

interface TransportMetadata {
  mode: "rank-local";
  backend: string;
  modelId: string;
  tokenizerId: string;
}

interface LocalGpt2Context {
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
  model: Awaited<ReturnType<typeof AutoModelForCausalLM.from_pretrained>>;
  bosTokenId: number;
  device: string;
}

let contextPromise: Promise<LocalGpt2Context> | null = null;
const mergeSafeTokenCache = new Map<string, Promise<boolean>>();

export function resolveEncodingConfig(config: LLMEncodingConfig | undefined): LLMEncodingConfig {
  if (!config) {
    return DEFAULT_ENCODING_CONFIG;
  }

  return {
    ...DEFAULT_ENCODING_CONFIG,
    ...config,
    transportBackend: config.transportBackend?.trim() || DEFAULT_ENCODING_CONFIG.transportBackend,
    maxContextTokens:
      Number.isFinite(config.maxContextTokens) && config.maxContextTokens > 0
        ? Math.floor(config.maxContextTokens)
        : DEFAULT_ENCODING_CONFIG.maxContextTokens,
  };
}

export function getTransportMetadata(config: LLMEncodingConfig | undefined): TransportMetadata {
  const resolvedConfig = resolveEncodingConfig(config);

  return {
    mode: "rank-local",
    backend: resolvedConfig.transportBackend,
    modelId: resolvedConfig.modelId,
    tokenizerId: resolvedConfig.tokenizerId,
  };
}

export async function encodeBitstringAsRankedText(params: {
  prompt: string;
  bitstring: string;
  wordTarget: number;
  config?: LLMEncodingConfig;
}) {
  const config = resolveEncodingConfig(params.config);
  const transport = await createTransport(params.prompt, config);
  const outputTokenIds: number[] = [];
  let bitCursor = 0;
  let guard = 0;
  const maxSteps = Math.max(256, params.bitstring.length * 8);

  while (bitCursor < params.bitstring.length) {
    if (guard >= maxSteps) {
      throw new Error("Rank-selection encoding exceeded the maximum token budget for this payload.");
    }

    const pool = await transport.buildCandidatePool(outputTokenIds);
    if (pool.length === 0) {
      throw new Error("Rank-selection encoding could not construct a non-empty candidate pool.");
    }

    const encodedWidth = getStepBitWidth(pool.length, config.bitsPerStep);
    const consumedWidth = Math.min(encodedWidth, params.bitstring.length - bitCursor);
    if (consumedWidth === 0) {
      throw new Error("Rank-selection encoding could not find enough merge-safe candidates to encode more bits.");
    }
    const nextToken = selectTokenForStep(pool, params.bitstring, bitCursor, consumedWidth, encodedWidth);
    outputTokenIds.push(nextToken);
    bitCursor += consumedWidth;
    guard += 1;
  }

  return transport.detokenize(outputTokenIds);
}

export async function decodeRankedTextToBitstring(params: {
  prompt: string;
  visibleText: string;
  config?: LLMEncodingConfig;
}) {
  const config = resolveEncodingConfig(params.config);
  const transport = await createTransport(params.prompt, config);
  const outputTokenIds = await transport.tokenizeOutput(params.visibleText);

  let recoveredBits = "";
  let targetBitLength: number | null = null;

  for (let index = 0; index < outputTokenIds.length; index += 1) {
    const prefix = outputTokenIds.slice(0, index);
    const tokenId = outputTokenIds[index];
    const pool = await transport.buildCandidatePool(prefix);
    if (pool.length === 0) {
      return null;
    }

    const rank = pool.findIndex((candidate) => candidate.id === tokenId);
    if (rank === -1) {
      return null;
    }

    const stepWidth = getStepBitWidth(pool.length, config.bitsPerStep);
    if (stepWidth > 0) {
      recoveredBits += rank.toString(2).padStart(stepWidth, "0");
      if (targetBitLength === null && recoveredBits.length >= 32) {
        const payloadBitLength = Number.parseInt(recoveredBits.slice(0, 32), 2);
        if (!Number.isFinite(payloadBitLength) || payloadBitLength < 0 || payloadBitLength > 1_000_000) {
          return null;
        }

        targetBitLength = 32 + payloadBitLength;
      }

      if (targetBitLength !== null && recoveredBits.length >= targetBitLength) {
        return recoveredBits.slice(0, targetBitLength);
      }
    }
  }

  return null;
}

export async function __internal_createTransport(
  prompt: string,
  config?: LLMEncodingConfig,
) {
  return createTransport(prompt, resolveEncodingConfig(config));
}

function selectTokenForStep(
  pool: CandidateToken[],
  bitstring: string,
  bitCursor: number,
  consumedWidth: number,
  encodedWidth: number,
) {
  if (encodedWidth === 0) {
    return pool[0]?.id ?? fail("Rank-selection encoding could not find a deterministic fallback token.");
  }

  const chunk = bitstring.slice(bitCursor, bitCursor + consumedWidth).padEnd(encodedWidth, "0");
  const rank = Number.parseInt(chunk, 2);
  const token = pool[rank];

  if (!token) {
    throw new Error("Rank-selection encoding selected a candidate rank that is out of range.");
  }

  return token.id;
}

function getStepBitWidth(poolSize: number, requestedBitsPerStep: number) {
  if (poolSize < 2) {
    return 0;
  }

  return Math.min(Math.floor(Math.log2(poolSize)), requestedBitsPerStep);
}

async function createTransport(prompt: string, config: LLMEncodingConfig) {
  assertConfigCompatibility(config);
  const context = await getContext();
  const promptTokenIds = await tokenizeText(context, prompt);

  return {
    async buildCandidatePool(outputTokenIds: number[]) {
      const contextTokenIds = truncateContext([...promptTokenIds, ...outputTokenIds], config.maxContextTokens);
      const modelInput = contextTokenIds.length > 0 ? contextTokenIds : [context.bosTokenId];
      const logits = await getNextTokenLogits(context, modelInput);
      const rankedCandidates: CandidateToken[] = [];

      for (let tokenId = 0; tokenId < logits.length; tokenId += 1) {
        const tokenText = decodeToken(context, tokenId);
        if (config.excludedTokenSet.includes(tokenText)) {
          continue;
        }

        rankedCandidates.push({
          id: tokenId,
          logit: logits[tokenId],
        });
      }

      rankedCandidates.sort((left, right) => {
        if (right.logit !== left.logit) {
          return right.logit - left.logit;
        }

        return left.id - right.id;
      });

      const minimumPoolSize = Math.max(2 ** config.bitsPerStep, 1);
      const scanLimit = Math.min(
        rankedCandidates.length,
        Math.max(minimumPoolSize * MERGE_SAFETY_SCAN_MULTIPLIER, minimumPoolSize),
      );
      const safeCandidates: CandidateToken[] = [];

      for (const candidate of rankedCandidates.slice(0, scanLimit)) {
        const previousTokenId = outputTokenIds[outputTokenIds.length - 1] ?? null;
        if (await isMergeSafeAppend(context, previousTokenId, candidate.id)) {
          safeCandidates.push(candidate);
        }

        if (safeCandidates.length >= minimumPoolSize) {
          break;
        }
      }

      return safeCandidates;
    },
    async tokenizeOutput(visibleText: string) {
      return tokenizeText(context, visibleText);
    },
    detokenize(outputTokenIds: number[]) {
      return context.tokenizer.decode(outputTokenIds, { skip_special_tokens: false });
    },
  };
}

async function getContext(): Promise<LocalGpt2Context> {
  contextPromise ??= (async () => {
    const { tokenizer, model, device } = await loadCausalLmContext(MODEL_ID);
    const bosTokenId = (tokenizer as { bos_token_id?: number }).bos_token_id ?? 50256;

    return {
      tokenizer,
      model,
      bosTokenId,
      device,
    };
  })();

  return contextPromise;
}

function assertConfigCompatibility(config: LLMEncodingConfig) {
  if (
    config.configId !== DEFAULT_ENCODING_CONFIG.configId ||
    config.modelId !== DEFAULT_ENCODING_CONFIG.modelId ||
    config.tokenizerId !== DEFAULT_ENCODING_CONFIG.tokenizerId ||
    config.transportBackend !== DEFAULT_ENCODING_CONFIG.transportBackend
  ) {
    throw new Error("Ghostscript transport config is incompatible with the pinned local runtime.");
  }
}

async function tokenizeText(context: LocalGpt2Context, text: string) {
  const encoded = await context.tokenizer(text, { add_special_tokens: false });
  return Array.from(
    ((encoded.input_ids as unknown as { ort_tensor: { cpuData: BigInt64Array } }).ort_tensor.cpuData),
    (value) => Number(value),
  );
}

async function getNextTokenLogits(context: LocalGpt2Context, tokenIds: number[]) {
  const outputs = await context.model({
    input_ids: new Tensor("int64", BigInt64Array.from(tokenIds.map((value) => BigInt(value))), [1, tokenIds.length]),
    attention_mask: new Tensor(
      "int64",
      BigInt64Array.from(tokenIds.map(() => 1n)),
      [1, tokenIds.length],
    ),
  });

  const [, sequenceLength, vocabSize] = outputs.logits.dims;
  const rowOffset = (sequenceLength - 1) * vocabSize;
  const logits = outputs.logits.data as Float32Array;
  return logits.slice(rowOffset, rowOffset + vocabSize);
}

function decodeToken(context: LocalGpt2Context, tokenId: number) {
  return context.tokenizer.decode([tokenId], { skip_special_tokens: false });
}

async function isMergeSafeAppend(context: LocalGpt2Context, previousTokenId: number | null, tokenId: number) {
  const cacheKey = previousTokenId === null ? `start:${tokenId}` : `${previousTokenId}:${tokenId}`;
  let result = mergeSafeTokenCache.get(cacheKey);
  if (!result) {
    result = (async () => {
      const candidateSequence = previousTokenId === null ? [tokenId] : [previousTokenId, tokenId];
      const decoded = context.tokenizer.decode(candidateSequence, { skip_special_tokens: false });
      const retokenized = await tokenizeText(context, decoded);
      return (
        retokenized.length === candidateSequence.length &&
        retokenized.every((value, index) => value === candidateSequence[index])
      );
    })();
    mergeSafeTokenCache.set(cacheKey, result);
  }

  return result;
}

function truncateContext(tokenIds: number[], maxContextTokens: number) {
  if (tokenIds.length <= maxContextTokens) {
    return tokenIds;
  }

  return tokenIds.slice(tokenIds.length - maxContextTokens);
}

function fail(message: string): never {
  throw new Error(message);
}
