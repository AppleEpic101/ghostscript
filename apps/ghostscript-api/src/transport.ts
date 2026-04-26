import OpenAI from "openai";
import { getEncoding, type Tiktoken } from "js-tiktoken";
import { DEFAULT_TRANSPORT_CONFIG_ID, type LLMEncodingConfig } from "@ghostscript/shared";

const DEFAULT_MODEL_ID = process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim() || "";
const DEFAULT_ENCODING_CONFIG: LLMEncodingConfig = {
  configId: DEFAULT_TRANSPORT_CONFIG_ID,
  provider: "ghostscript-bridge",
  modelId: DEFAULT_MODEL_ID,
  tokenizerId: "o200k_base-v1",
  transportBackend: "openai-chat-toplogprobs-o200k-v1",
  bitsPerStep: 2,
  excludedTokenSet: ["<|endoftext|>", "<s>", "</s>"],
  fallbackStrategy: "reduce-bits",
  tieBreakRule: "token-id-ascending",
  payloadTerminationStrategy: "length-header",
  contextTruncationStrategy: "tail",
  maxContextTokens: 512,
};
const OPENAI_TOP_LOGPROBS = 5;
const OPENAI_REQUEST_TIMEOUT_MS = 60_000;
const OPENAI_DETERMINISTIC_SEED = 0;
const TRANSPORT_TRACE_ENABLED = process.env.GHOSTSCRIPT_TRANSPORT_TRACE?.trim() === "1";
const TRANSPORT_TRACE_POOLS_ENABLED = process.env.GHOSTSCRIPT_TRANSPORT_TRACE_POOLS?.trim() === "1";
const SYSTEM_PROMPT = [
  "You generate the next token of an ordinary-looking Discord message.",
  "Continue the assistant message naturally and stay on topic.",
  "Do not add explanations, labels, or metadata.",
].join(" ");

interface CandidateToken {
  id: number;
  logit: number;
  canonicalText: string;
}

interface RawStepCandidate {
  token: string;
  logprob: number;
  bytes: number[] | null;
}

interface StepResult {
  candidates: RawStepCandidate[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

interface TransportMetadata {
  mode: "rank-openai";
  backend: string;
  modelId: string;
  tokenizerId: string;
}

export interface TransportRunMetrics {
  stepCount: number;
  apiCallCount: number;
  totalCandidatePoolSize: number;
  averageCandidatePoolSize: number;
  billedPromptTokens: number;
  billedCompletionTokens: number;
  billedTotalTokens: number;
}

interface TransportDeps {
  stepFetcher?: StepFetcher;
  tokenizer?: TokenizerLike;
}

interface TokenizerLike {
  encode(text: string): number[];
  decode(tokenIds: number[]): string;
}

type StepFetcher = (params: {
  prompt: string;
  prefix: string;
  model: string;
  topLogprobs: number;
}) => Promise<StepResult>;

const tokenizerCache = new Map<string, Tiktoken>();
let openaiClient: OpenAI | null = null;

export function resolveEncodingConfig(config: LLMEncodingConfig | undefined): LLMEncodingConfig {
  if (!config) {
    return DEFAULT_ENCODING_CONFIG;
  }

  return {
    ...DEFAULT_ENCODING_CONFIG,
    ...config,
    modelId: config.modelId?.trim() || DEFAULT_ENCODING_CONFIG.modelId,
    tokenizerId: config.tokenizerId?.trim() || DEFAULT_ENCODING_CONFIG.tokenizerId,
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
    mode: "rank-openai",
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
  const result = await encodeBitstringAsRankedTextDetailed(params);
  return result.visibleText;
}

export async function encodeBitstringAsRankedTextDetailed(params: {
  prompt: string;
  bitstring: string;
  wordTarget: number;
  config?: LLMEncodingConfig;
}) {
  return __internal_encodeBitstringAsRankedTextDetailed(params);
}

export async function __internal_encodeBitstringAsRankedTextDetailed(params: {
  prompt: string;
  bitstring: string;
  wordTarget: number;
  config?: LLMEncodingConfig;
  deps?: TransportDeps;
}) {
  const config = resolveEncodingConfig(params.config);
  const transport = await createTransport(params.prompt, config, params.deps);
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
    if (TRANSPORT_TRACE_ENABLED) {
      traceTransportStep("encode-step", {
        stepIndex: guard,
        tokenId: nextToken,
        tokenText: transport.detokenize([nextToken]),
        poolSize: pool.length,
        consumedWidth,
        encodedWidth,
        bitCursor,
      });
    }
    outputTokenIds.push(nextToken);
    bitCursor += consumedWidth;
    guard += 1;
  }

  return {
    visibleText: transport.detokenize(outputTokenIds),
    metrics: transport.getMetrics(),
  };
}

export async function decodeRankedTextToBitstring(params: {
  prompt: string;
  visibleText: string;
  config?: LLMEncodingConfig;
}) {
  const result = await decodeRankedTextToBitstringDetailed(params);
  return result.bitstring;
}

export async function decodeRankedTextToBitstringDetailed(params: {
  prompt: string;
  visibleText: string;
  config?: LLMEncodingConfig;
}) {
  return __internal_decodeRankedTextToBitstringDetailed(params);
}

export async function __internal_decodeRankedTextToBitstringDetailed(params: {
  prompt: string;
  visibleText: string;
  config?: LLMEncodingConfig;
  deps?: TransportDeps;
}) {
  const config = resolveEncodingConfig(params.config);
  const transport = await createTransport(params.prompt, config, params.deps);
  const outputTokenIds = await transport.tokenizeOutput(params.visibleText);

  let recoveredBits = "";
  let targetBitLength: number | null = null;

  for (let index = 0; index < outputTokenIds.length; index += 1) {
    const prefix = outputTokenIds.slice(0, index);
    const tokenId = outputTokenIds[index];
    const pool = await transport.buildCandidatePool(prefix);
    if (pool.length === 0) {
      return { bitstring: null, metrics: transport.getMetrics() };
    }

    const tokenCanonicalText = normalizeCandidateTokenText(transport.detokenize([tokenId]));
    const rank = pool.findIndex((candidate) => candidate.canonicalText === tokenCanonicalText);
    if (rank === -1) {
      return { bitstring: null, metrics: transport.getMetrics() };
    }

    const stepWidth = getStepBitWidth(pool.length, config.bitsPerStep);
    if (TRANSPORT_TRACE_ENABLED) {
      traceTransportStep("decode-step", {
        stepIndex: index,
        tokenId,
        tokenText: transport.detokenize([tokenId]),
        poolSize: pool.length,
        rank,
        stepWidth,
      });
    }
    if (stepWidth === 0) {
      continue;
    }

    recoveredBits += rank.toString(2).padStart(stepWidth, "0");
    if (targetBitLength === null && recoveredBits.length >= 32) {
      const payloadBitLength = Number.parseInt(recoveredBits.slice(0, 32), 2);
      if (!Number.isFinite(payloadBitLength) || payloadBitLength < 0 || payloadBitLength > 1_000_000) {
        return { bitstring: null, metrics: transport.getMetrics() };
      }

      targetBitLength = 32 + payloadBitLength;
    }

    if (targetBitLength !== null && recoveredBits.length >= targetBitLength) {
      return {
        bitstring: recoveredBits.slice(0, targetBitLength),
        metrics: transport.getMetrics(),
      };
    }
  }

  return {
    bitstring: null,
    metrics: transport.getMetrics(),
  };
}

export async function __internal_createTransport(
  prompt: string,
  config?: LLMEncodingConfig,
  deps?: TransportDeps,
) {
  return createTransport(prompt, resolveEncodingConfig(config), deps);
}

export async function __internal_collectTopMergeSafeCandidates(params: {
  rankedCandidates: CandidateToken[];
  minimumPoolSize: number;
  isMergeSafe: (candidate: CandidateToken) => Promise<boolean>;
}) {
  const safeCandidates: CandidateToken[] = [];

  for (const candidate of params.rankedCandidates) {
    if (await params.isMergeSafe(candidate)) {
      safeCandidates.push(candidate);
    }

    if (safeCandidates.length >= params.minimumPoolSize) {
      break;
    }
  }

  return safeCandidates;
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

async function createTransport(prompt: string, config: LLMEncodingConfig, deps?: TransportDeps) {
  assertConfigCompatibility(config);
  const tokenizer = deps?.tokenizer ?? getTokenizer(config.tokenizerId);
  const stepFetcher = deps?.stepFetcher ?? createOpenAiStepFetcher();
  const metrics: TransportRunMetrics = {
    stepCount: 0,
    apiCallCount: 0,
    totalCandidatePoolSize: 0,
    averageCandidatePoolSize: 0,
    billedPromptTokens: 0,
    billedCompletionTokens: 0,
    billedTotalTokens: 0,
  };

  return {
    async buildCandidatePool(outputTokenIds: number[]) {
      const prefixText = tokenizer.decode(outputTokenIds);
      const stepResult = await stepFetcher({
        prompt,
        prefix: prefixText,
        model: config.modelId,
        topLogprobs: OPENAI_TOP_LOGPROBS,
      });

      metrics.apiCallCount += 1;
      metrics.billedPromptTokens += stepResult.usage.promptTokens;
      metrics.billedCompletionTokens += stepResult.usage.completionTokens;
      metrics.billedTotalTokens += stepResult.usage.totalTokens;

      const rankedCandidates = mapStepCandidatesToLocalTokenIds(stepResult.candidates, tokenizer, config);
      const minimumPoolSize = Math.max(2 ** config.bitsPerStep, 1);
      const previousTokenId = outputTokenIds[outputTokenIds.length - 1] ?? null;
      const safeCandidates = await __internal_collectTopMergeSafeCandidates({
        rankedCandidates,
        minimumPoolSize,
        isMergeSafe: async (candidate) => isMergeSafeAppend(tokenizer, previousTokenId, candidate.id),
      });

      if (TRANSPORT_TRACE_POOLS_ENABLED) {
        traceTransportStep("candidate-pool", {
          prefixText,
          previousTokenId,
          rankedCandidates: rankedCandidates.map((candidate) => ({
            tokenId: candidate.id,
            tokenText: tokenizer.decode([candidate.id]),
            logit: candidate.logit,
          })),
          safeCandidates: safeCandidates.map((candidate) => ({
            tokenId: candidate.id,
            tokenText: tokenizer.decode([candidate.id]),
            logit: candidate.logit,
          })),
        });
      }

      if (safeCandidates.length === 0) {
        throw new Error(
          "OpenAI returned no merge-safe candidate tokens after filtering.",
        );
      }

      safeCandidates.sort((left, right) => left.id - right.id);

      metrics.stepCount += 1;
      metrics.totalCandidatePoolSize += safeCandidates.length;
      metrics.averageCandidatePoolSize = metrics.totalCandidatePoolSize / metrics.stepCount;

      return safeCandidates;
    },
    async tokenizeOutput(visibleText: string) {
      return tokenizer.encode(visibleText);
    },
    detokenize(outputTokenIds: number[]) {
      return tokenizer.decode(outputTokenIds);
    },
    getMetrics() {
      return { ...metrics };
    },
  };
}

function assertConfigCompatibility(config: LLMEncodingConfig) {
  if (config.configId !== DEFAULT_ENCODING_CONFIG.configId) {
    throw new Error(`Unsupported Ghostscript transport config: ${config.configId}`);
  }

  if (config.transportBackend !== DEFAULT_ENCODING_CONFIG.transportBackend) {
    throw new Error("Ghostscript transport backend is incompatible with the pinned OpenAI runtime.");
  }

  if (config.tokenizerId !== DEFAULT_ENCODING_CONFIG.tokenizerId) {
    throw new Error("Ghostscript tokenizer is incompatible with the pinned OpenAI runtime.");
  }

  if (config.bitsPerStep < 1 || config.bitsPerStep > 4) {
    throw new Error("Ghostscript bitsPerStep must be between 1 and 4 for the OpenAI transport.");
  }
}

function getTokenizer(tokenizerId: string): TokenizerLike {
  const encodingName = resolveTokenizerEncodingName(tokenizerId);
  let tokenizer = tokenizerCache.get(encodingName);
  if (!tokenizer) {
    tokenizer = getEncoding(encodingName);
    tokenizerCache.set(encodingName, tokenizer);
  }

  return {
    encode(text: string) {
      return tokenizer.encode(text);
    },
    decode(tokenIds: number[]) {
      return tokenizer.decode(tokenIds);
    },
  };
}

function resolveTokenizerEncodingName(tokenizerId: string) {
  if (tokenizerId === "o200k_base-v1") {
    return "o200k_base" as const;
  }

  throw new Error(`Unsupported Ghostscript tokenizerId: ${tokenizerId}`);
}

function createOpenAiStepFetcher(): StepFetcher {
  const client = getOpenAiClient();

  return async ({ prompt, prefix, model, topLogprobs }) => {
    const response = await client.chat.completions.create({
      model,
      messages: buildChatMessages(prompt, prefix),
      temperature: 0,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      seed: OPENAI_DETERMINISTIC_SEED,
      logprobs: true,
      top_logprobs: topLogprobs,
      max_completion_tokens: 1,
      store: false,
    }, {
      timeout: OPENAI_REQUEST_TIMEOUT_MS,
    });

    const firstContent = response.choices?.[0]?.logprobs?.content?.[0];
    const candidates = dedupeRawCandidates([
      ...(firstContent?.top_logprobs?.map((entry) => ({
        token: entry.token,
        logprob: entry.logprob,
        bytes: entry.bytes ?? null,
      })) ?? []),
      ...(firstContent?.token
        ? [{
            token: firstContent.token,
            logprob: firstContent.logprob ?? Number.NEGATIVE_INFINITY,
            bytes: firstContent.bytes ?? null,
          }]
        : []),
    ]);

    return {
      candidates,
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
    };
  };
}

function getOpenAiClient() {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for the OpenAI rank transport.");
  }

  openaiClient ??= new OpenAI({ apiKey: OPENAI_API_KEY });
  return openaiClient;
}

function buildChatMessages(prompt: string, prefix: string) {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];

  if (prefix.length > 0) {
    messages.push({ role: "assistant", content: prefix });
  }

  return messages;
}

function dedupeRawCandidates(candidates: RawStepCandidate[]) {
  const seen = new Set<string>();
  const deduped: RawStepCandidate[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.token}\u0000${candidate.logprob}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

function mapStepCandidatesToLocalTokenIds(
  candidates: RawStepCandidate[],
  tokenizer: TokenizerLike,
  config: LLMEncodingConfig,
) {
  const localCandidatesByCanonicalText = new Map<string, CandidateToken>();

  for (const candidate of candidates) {
    const decodedBytes = decodeCandidateBytes(candidate.bytes);
    if (decodedBytes !== null && decodedBytes !== candidate.token) {
      continue;
    }

    const localTokenIds = tokenizer.encode(candidate.token);
    if (localTokenIds.length !== 1) {
      continue;
    }

    const localTokenId = localTokenIds[0];
    const localTokenText = tokenizer.decode([localTokenId]);
    if (localTokenText !== candidate.token) {
      continue;
    }

    if (config.excludedTokenSet.includes(localTokenText)) {
      continue;
    }

    const canonicalText = normalizeCandidateTokenText(localTokenText);
    const nextCandidate: CandidateToken = {
      id: localTokenId,
      logit: candidate.logprob,
      canonicalText,
    };
    const existingCandidate = localCandidatesByCanonicalText.get(canonicalText);
    if (!existingCandidate) {
      localCandidatesByCanonicalText.set(canonicalText, nextCandidate);
      continue;
    }

    if (
      nextCandidate.logit > existingCandidate.logit ||
      (nextCandidate.logit === existingCandidate.logit && nextCandidate.id < existingCandidate.id)
    ) {
      localCandidatesByCanonicalText.set(canonicalText, nextCandidate);
    }
  }

  const localCandidates = Array.from(localCandidatesByCanonicalText.values());
  localCandidates.sort((left, right) => {
    if (right.logit !== left.logit) {
      return right.logit - left.logit;
    }

    return left.id - right.id;
  });

  return localCandidates;
}

function decodeCandidateBytes(bytes: number[] | null) {
  if (!bytes || bytes.length === 0) {
    return null;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return null;
  }
}

function normalizeCandidateTokenText(tokenText: string) {
  return tokenText.toLowerCase();
}

async function isMergeSafeAppend(tokenizer: TokenizerLike, previousTokenId: number | null, tokenId: number) {
  const previousTokenText = previousTokenId === null ? "" : tokenizer.decode([previousTokenId]);
  const candidateTokenText = tokenizer.decode([tokenId]);
  const retokenized = tokenizer.encode(`${previousTokenText}${candidateTokenText}`);
  const expectedSequence = previousTokenId === null ? [tokenId] : [previousTokenId, tokenId];

  return retokenized.length === expectedSequence.length &&
    retokenized.every((value, index) => value === expectedSequence[index]);
}

function fail(message: string): never {
  throw new Error(message);
}

function traceTransportStep(event: string, details: Record<string, unknown>) {
  console.info(
    "[Ghostscript Transport]",
    JSON.stringify({
      ts: new Date().toISOString(),
      event,
      details,
    }),
  );
}
