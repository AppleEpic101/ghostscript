import { AutoModelForCausalLM, AutoTokenizer, Tensor } from "@huggingface/transformers";
import { loadCausalLmContext } from "./modelRuntime";

const MODEL_ID = "Xenova/distilgpt2";
const SHORT_RANK_LIMIT = 8;
const MEDIUM_RANK_LIMIT = 128;

export interface RealModelCompressionStats {
  tokenCount: number;
  compressedBitLength: number;
  fixedWidthBitLength: number;
  utf8BitLength: number;
  compressedToFixedWidthRatio: number;
  compressedToUtf8Ratio: number;
  shortRankCount: number;
  mediumRankCount: number;
  literalCount: number;
}

export interface RealModelCompressionTraceStep {
  index: number;
  tokenId: number;
  tokenText: string;
  rank: number;
  mode: "short-rank" | "medium-rank" | "literal-token-id";
  encodedBits: string;
  usedLiteralFallback: boolean;
}

export interface RealModelCompressionResult {
  bitstring: string;
  tokenIds: number[];
  trace: RealModelCompressionTraceStep[];
  stats: RealModelCompressionStats;
}

interface RankCodecContext {
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
  model: Awaited<ReturnType<typeof AutoModelForCausalLM.from_pretrained>>;
  bosTokenId: number;
  vocabSize: number;
  device: string;
}

let contextPromise: Promise<RankCodecContext> | null = null;

export async function compressPlaintextWithRealModelRanks(plaintext: string): Promise<RealModelCompressionResult> {
  const context = await getContext();
  const tokenIds = await tokenizeText(context, plaintext);
  const trace: RealModelCompressionTraceStep[] = [];
  let shortRankCount = 0;
  let mediumRankCount = 0;
  let literalCount = 0;

  for (let index = 0; index < tokenIds.length; index += 1) {
    const prefix = tokenIds.slice(0, index);
    const tokenId = tokenIds[index];
    const rank = await rankToken(context, prefix, tokenId);

    if (rank < SHORT_RANK_LIMIT) {
      trace.push({
        index,
        tokenId,
        tokenText: decodeToken(context, tokenId),
        rank,
        mode: "short-rank",
        encodedBits: `0${rank.toString(2).padStart(3, "0")}`,
        usedLiteralFallback: false,
      });
      shortRankCount += 1;
      continue;
    }

    if (rank < MEDIUM_RANK_LIMIT) {
      trace.push({
        index,
        tokenId,
        tokenText: decodeToken(context, tokenId),
        rank,
        mode: "medium-rank",
        encodedBits: `10${rank.toString(2).padStart(7, "0")}`,
        usedLiteralFallback: false,
      });
      mediumRankCount += 1;
      continue;
    }

    trace.push({
      index,
      tokenId,
      tokenText: decodeToken(context, tokenId),
      rank,
      mode: "literal-token-id",
      encodedBits: `11${encodeVarintToBitstring(tokenId)}`,
      usedLiteralFallback: true,
    });
    literalCount += 1;
  }

  const bitstring = trace.map((step) => step.encodedBits).join("");
  const fixedWidthBitsPerToken = Math.max(1, Math.ceil(Math.log2(context.vocabSize)));
  const fixedWidthBitLength = fixedWidthBitsPerToken * tokenIds.length;
  const utf8BitLength = new TextEncoder().encode(plaintext).length * 8;

  return {
    bitstring,
    tokenIds,
    trace,
    stats: {
      tokenCount: tokenIds.length,
      compressedBitLength: bitstring.length,
      fixedWidthBitLength,
      utf8BitLength,
      compressedToFixedWidthRatio: bitstring.length / Math.max(1, fixedWidthBitLength),
      compressedToUtf8Ratio: bitstring.length / Math.max(1, utf8BitLength),
      shortRankCount,
      mediumRankCount,
      literalCount,
    },
  };
}

export async function tracePlaintextWithRealModelRanks(plaintext: string) {
  return compressPlaintextWithRealModelRanks(plaintext);
}

async function getContext(): Promise<RankCodecContext> {
  contextPromise ??= (async () => {
    const { tokenizer, model, device } = await loadCausalLmContext(MODEL_ID);
    const bosTokenId = (tokenizer as { bos_token_id?: number }).bos_token_id ?? 50256;
    const vocabSize = (model.config as { vocab_size?: number }).vocab_size ?? 50_257;

    return {
      tokenizer,
      model,
      bosTokenId,
      vocabSize,
      device,
    };
  })();

  return contextPromise;
}

async function tokenizeText(context: RankCodecContext, plaintext: string) {
  const encoded = await context.tokenizer(plaintext, { add_special_tokens: false });
  return Array.from(((encoded.input_ids as unknown as { ort_tensor: { cpuData: BigInt64Array } }).ort_tensor.cpuData), (value) => Number(value));
}

async function rankToken(context: RankCodecContext, prefixTokenIds: number[], tokenId: number) {
  const inputIds = prefixTokenIds.length > 0 ? prefixTokenIds : [context.bosTokenId];
  const attentionMask = new Array(inputIds.length).fill(1);
  const outputs = await context.model({
    input_ids: new Tensor("int64", BigInt64Array.from(inputIds.map((value) => BigInt(value))), [1, inputIds.length]),
    attention_mask: new Tensor(
      "int64",
      BigInt64Array.from(attentionMask.map((value) => BigInt(value))),
      [1, attentionMask.length],
    ),
  });

  const [, sequenceLength, vocabSize] = outputs.logits.dims;
  const rowOffset = (sequenceLength - 1) * vocabSize;
  const logits = outputs.logits.data as Float32Array;
  const targetLogit = logits[rowOffset + tokenId];
  let rank = 0;

  for (let candidateId = 0; candidateId < vocabSize; candidateId += 1) {
    if (candidateId === tokenId) {
      continue;
    }

    const candidateLogit = logits[rowOffset + candidateId];
    if (candidateLogit > targetLogit || (candidateLogit === targetLogit && candidateId < tokenId)) {
      rank += 1;
    }
  }

  return rank;
}

function decodeToken(context: RankCodecContext, tokenId: number) {
  return context.tokenizer.decode([tokenId], { skip_special_tokens: false });
}

function encodeVarintToBitstring(value: number) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Varint values must be non-negative integers.");
  }

  let remaining = value;
  let bits = "";
  while (remaining >= 0x80) {
    bits += (0x80 | (remaining & 0x7f)).toString(2).padStart(8, "0");
    remaining >>>= 7;
  }

  bits += remaining.toString(2).padStart(8, "0");
  return bits;
}
