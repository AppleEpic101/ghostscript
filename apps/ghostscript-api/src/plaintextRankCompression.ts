const TOKEN_PATTERN = /[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?|[.,!?;:]/g;

const TRAINING_CORPUS = [
  "i think that sounds pretty good.",
  "that makes sense to me.",
  "i can do that later tonight.",
  "we should keep it simple for now.",
  "maybe we can circle back after dinner.",
  "i was just thinking about that.",
  "it feels like the timing finally works.",
  "honestly that is a fair point.",
  "the weather has been weird all week.",
  "i would rather keep the plan flexible.",
  "it might be easier after the weekend.",
  "i still need to finish a few things first.",
  "that actually sounds kind of fun.",
  "i am fine with either option.",
  "we could keep the message short and casual.",
  "the whole thing seems more relaxed today.",
  "i just want a normal conversation for once.",
  "it was quieter than i expected.",
  "the coffee place near the station is still open.",
  "we can meet there if that helps.",
  "i liked the last version better.",
  "this one feels a little cleaner to me.",
  "we should probably avoid making it too formal.",
  "i do not mind talking about that for a bit.",
  "it ended up being a longer day than i planned.",
  "i can send a quick update in a minute.",
  "there is still time to change it.",
  "the idea is good but the wording feels off.",
  "maybe use something lighter and more direct.",
  "that part is easy enough.",
  "i was reading about that earlier today.",
  "the route by the park is usually nicer.",
  "we can keep the topic broad if you want.",
  "it is mostly the same as before.",
  "i forgot how loud that place gets.",
  "the new setup is working better now.",
  "i would not overthink it too much.",
  "a short reply is probably fine.",
  "the details can wait until later.",
  "it should be easy to explain in person.",
  "we can talk about food if the room gets awkward.",
  "the hike looked easier on the map.",
  "i still want to hear how that went.",
  "that movie was better than i expected.",
  "the playlist actually fit the mood.",
  "i am still deciding between the two options.",
  "the whole server has been unusually calm today.",
  "it reads more naturally when the sentence stays loose.",
  "i guess that depends on how late everyone is staying.",
  "the small changes help more than you would think.",
];

const SHORT_RANK_LIMIT = 8;
const MEDIUM_RANK_LIMIT = 128;
const BYTE_VOCAB_SIZE = 256;

export interface PlaintextRankCompressionStats {
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

export interface PlaintextRankCompressionTraceStep {
  index: number;
  tokenId: number;
  tokenText: string;
  rank: number;
  mode: "short-rank" | "medium-rank" | "literal-token-id";
  encodedBits: string;
  usedLiteralFallback: boolean;
}

export interface PlaintextRankCompressionResult {
  bitstring: string;
  tokenIds: number[];
  stats: PlaintextRankCompressionStats;
}

export interface LayeredPlaintextRankCompressionResult extends PlaintextRankCompressionResult {
  traditionalCompression: {
    format: "raw" | "deflate";
    bytes: Uint8Array;
    base64: string;
    framedBitLength: number;
    ratioVsRankBitstring: number;
  };
}

interface VocabularyToken {
  id: number;
  bytes: Uint8Array;
}

interface TokenCandidate {
  id: number;
  score: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function compressPlaintextToRankBitstring(plaintext: string): PlaintextRankCompressionResult {
  const tokenIds = model.tokenize(plaintext);
  const writer = new BitWriter();
  let shortRankCount = 0;
  let mediumRankCount = 0;
  let literalCount = 0;

  for (let index = 0; index < tokenIds.length; index += 1) {
    const prefix = tokenIds.slice(0, index);
    const tokenId = tokenIds[index];
    const rank = model.rankToken(prefix, tokenId);

    if (rank < SHORT_RANK_LIMIT) {
      writer.writeBits(0, 1);
      writer.writeBits(rank, 3);
      shortRankCount += 1;
      continue;
    }

    if (rank < MEDIUM_RANK_LIMIT) {
      writer.writeBits(0b10, 2);
      writer.writeBits(rank, 7);
      mediumRankCount += 1;
      continue;
    }

    writer.writeBits(0b11, 2);
    writeVarint(writer, tokenId);
    literalCount += 1;
  }

  const compressedBitLength = writer.length;
  const fixedWidthBitsPerToken = Math.max(1, Math.ceil(Math.log2(model.vocabularySize)));
  const fixedWidthBitLength = fixedWidthBitsPerToken * tokenIds.length;
  const utf8BitLength = encoder.encode(plaintext).length * 8;

  return {
    bitstring: writer.toBitstring(),
    tokenIds,
    stats: {
      tokenCount: tokenIds.length,
      compressedBitLength,
      fixedWidthBitLength,
      utf8BitLength,
      compressedToFixedWidthRatio: compressedBitLength / Math.max(1, fixedWidthBitLength),
      compressedToUtf8Ratio: compressedBitLength / Math.max(1, utf8BitLength),
      shortRankCount,
      mediumRankCount,
      literalCount,
    },
  };
}

export function decompressPlaintextFromRankBitstring(bitstring: string): string {
  const reader = new BitReader(bitstring);
  const tokenIds: number[] = [];

  while (!reader.isExhausted()) {
    const firstPrefixBit = reader.readBits(1);
    if (firstPrefixBit === 0) {
      const rank = reader.readBits(3);
      tokenIds.push(model.tokenIdAtRank(tokenIds, rank));
      continue;
    }

    const secondPrefixBit = reader.readBits(1);
    if (secondPrefixBit === 0) {
      const rank = reader.readBits(7);
      if (rank < SHORT_RANK_LIMIT) {
        throw new Error("Medium-rank form used a value reserved for the short-rank form.");
      }

      tokenIds.push(model.tokenIdAtRank(tokenIds, rank));
      continue;
    }

    const tokenId = readVarint(reader);
    model.assertValidTokenId(tokenId);
    tokenIds.push(tokenId);
  }

  return model.detokenize(tokenIds);
}

export function analyzePlaintextRankCompression(plaintext: string) {
  return compressPlaintextToRankBitstring(plaintext).stats;
}

export function tracePlaintextRankCompression(plaintext: string) {
  const tokenIds = model.tokenize(plaintext);
  const steps: PlaintextRankCompressionTraceStep[] = [];

  for (let index = 0; index < tokenIds.length; index += 1) {
    const prefix = tokenIds.slice(0, index);
    const tokenId = tokenIds[index];
    const rank = model.rankToken(prefix, tokenId);

    if (rank < SHORT_RANK_LIMIT) {
      steps.push({
        index,
        tokenId,
        tokenText: model.tokenText(tokenId),
        rank,
        mode: "short-rank",
        encodedBits: `0${rank.toString(2).padStart(3, "0")}`,
        usedLiteralFallback: false,
      });
      continue;
    }

    if (rank < MEDIUM_RANK_LIMIT) {
      steps.push({
        index,
        tokenId,
        tokenText: model.tokenText(tokenId),
        rank,
        mode: "medium-rank",
        encodedBits: `10${rank.toString(2).padStart(7, "0")}`,
        usedLiteralFallback: false,
      });
      continue;
    }

    const literalBits = encodeVarintToBitstring(tokenId);
    steps.push({
      index,
      tokenId,
      tokenText: model.tokenText(tokenId),
      rank,
      mode: "literal-token-id",
      encodedBits: `11${literalBits}`,
      usedLiteralFallback: true,
    });
  }

  return {
    plaintext,
    tokenIds,
    steps,
    bitstring: steps.map((step) => step.encodedBits).join(""),
  };
}

export function compressPlaintextToLayeredRankBitstring(plaintext: string): LayeredPlaintextRankCompressionResult {
  const rankCompressed = compressPlaintextToRankBitstring(plaintext);
  const traditionalCompression = compressBitstringToBase64(rankCompressed.bitstring);

  return {
    ...rankCompressed,
    traditionalCompression: {
      format: traditionalCompression.format,
      bytes: traditionalCompression.bytes,
      base64: traditionalCompression.base64,
      framedBitLength: traditionalCompression.bytes.length * 8,
      ratioVsRankBitstring: (traditionalCompression.bytes.length * 8) / Math.max(1, rankCompressed.bitstring.length),
    },
  };
}

export function decompressPlaintextFromLayeredRankBitstring(base64: string) {
  const bitstring = decompressBitstringFromBase64(base64);
  return decompressPlaintextFromRankBitstring(bitstring);
}

export function recompressRankBitstringWithTraditionalCompression(bitstring: string) {
  return compressBitstring(bitstring);
}

export function decompressTraditionallyCompressedRankBitstring(bytes: Uint8Array) {
  return decompressBitstring(bytes);
}

function writeVarint(writer: BitWriter, value: number) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Varint values must be non-negative integers.");
  }

  let remaining = value;
  while (remaining >= 0x80) {
    writer.writeBits(0x80 | (remaining & 0x7f), 8);
    remaining >>>= 7;
  }

  writer.writeBits(remaining, 8);
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

function readVarint(reader: BitReader) {
  let value = 0;
  let shift = 0;

  while (true) {
    const group = reader.readBits(8);
    value |= (group & 0x7f) << shift;
    if ((group & 0x80) === 0) {
      return value;
    }

    shift += 7;
    if (shift > 28) {
      throw new Error("Varint is too large to decode safely.");
    }
  }
}

class PlaintextRankModel {
  private readonly vocabulary: VocabularyToken[];
  private readonly tokensByFirstByte = new Map<number, VocabularyToken[]>();
  private readonly unigramCounts = new Map<number, number>();
  private readonly bigramCounts = new Map<string, number>();
  private readonly trigramCounts = new Map<string, number>();
  private readonly bigramTotals = new Map<string, number>();
  private readonly trigramTotals = new Map<string, number>();
  private totalTokens = 0;

  constructor(corpus: string[]) {
    const byteTokens = Array.from({ length: BYTE_VOCAB_SIZE }, (_, id) => ({
      id,
      bytes: Uint8Array.from([id]),
    }));

    const corpusTokens = new Set<string>();
    for (const line of corpus) {
      for (const token of line.match(TOKEN_PATTERN) ?? []) {
        corpusTokens.add(token.toLowerCase());
      }
    }

    const wordTokens = Array.from(corpusTokens)
      .sort((left, right) => left.localeCompare(right))
      .map((token, index) => ({
        id: BYTE_VOCAB_SIZE + index,
        bytes: encoder.encode(token),
      }));

    this.vocabulary = [...byteTokens, ...wordTokens];

    for (const token of this.vocabulary) {
      const firstByte = token.bytes[0];
      const bucket = this.tokensByFirstByte.get(firstByte) ?? [];
      bucket.push(token);
      this.tokensByFirstByte.set(firstByte, bucket);
    }

    for (const bucket of this.tokensByFirstByte.values()) {
      bucket.sort((left, right) => {
        if (right.bytes.length !== left.bytes.length) {
          return right.bytes.length - left.bytes.length;
        }

        return left.id - right.id;
      });
    }

    for (const line of corpus) {
      this.observe(this.tokenize(line));
    }
  }

  get vocabularySize() {
    return this.vocabulary.length;
  }

  tokenize(plaintext: string) {
    const bytes = encoder.encode(plaintext);
    const tokenIds: number[] = [];
    let index = 0;

    while (index < bytes.length) {
      const candidates = this.tokensByFirstByte.get(bytes[index]) ?? [];
      let matched: VocabularyToken | null = null;

      for (const candidate of candidates) {
        if (candidate.id < BYTE_VOCAB_SIZE) {
          continue;
        }

        if (matchesAt(bytes, index, candidate.bytes)) {
          matched = candidate;
          break;
        }
      }

      if (matched) {
        tokenIds.push(matched.id);
        index += matched.bytes.length;
        continue;
      }

      tokenIds.push(bytes[index]);
      index += 1;
    }

    return tokenIds;
  }

  detokenize(tokenIds: number[]) {
    const parts = tokenIds.map((tokenId) => this.vocabulary[tokenId]?.bytes ?? fail("Unknown token id during detokenization."));
    const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(totalLength);
    let offset = 0;

    for (const part of parts) {
      output.set(part, offset);
      offset += part.length;
    }

    return decoder.decode(output);
  }

  rankToken(prefix: number[], tokenId: number) {
    const ranking = this.buildRanking(prefix);
    const rank = ranking.findIndex((candidate) => candidate.id === tokenId);
    if (rank === -1) {
      throw new Error("Token id was not present in the model vocabulary.");
    }

    return rank;
  }

  tokenIdAtRank(prefix: number[], rank: number) {
    const ranking = this.buildRanking(prefix);
    const candidate = ranking[rank];
    if (!candidate) {
      throw new Error("Requested rank is outside the model vocabulary.");
    }

    return candidate.id;
  }

  assertValidTokenId(tokenId: number) {
    if (!Number.isInteger(tokenId) || tokenId < 0 || tokenId >= this.vocabulary.length) {
      throw new Error("Literal token id was outside the model vocabulary.");
    }
  }

  tokenText(tokenId: number) {
    const token = this.vocabulary[tokenId];
    if (!token) {
      throw new Error("Unknown token id.");
    }

    return decoder.decode(token.bytes);
  }

  private observe(tokenIds: number[]) {
    for (let index = 0; index < tokenIds.length; index += 1) {
      const tokenId = tokenIds[index];
      this.totalTokens += 1;
      this.unigramCounts.set(tokenId, (this.unigramCounts.get(tokenId) ?? 0) + 1);

      if (index >= 1) {
        const bigramKey = `${tokenIds[index - 1]}:${tokenId}`;
        const bigramPrefix = `${tokenIds[index - 1]}`;
        this.bigramCounts.set(bigramKey, (this.bigramCounts.get(bigramKey) ?? 0) + 1);
        this.bigramTotals.set(bigramPrefix, (this.bigramTotals.get(bigramPrefix) ?? 0) + 1);
      }

      if (index >= 2) {
        const trigramKey = `${tokenIds[index - 2]}:${tokenIds[index - 1]}:${tokenId}`;
        const trigramPrefix = `${tokenIds[index - 2]}:${tokenIds[index - 1]}`;
        this.trigramCounts.set(trigramKey, (this.trigramCounts.get(trigramKey) ?? 0) + 1);
        this.trigramTotals.set(trigramPrefix, (this.trigramTotals.get(trigramPrefix) ?? 0) + 1);
      }
    }
  }

  private buildRanking(prefix: number[]) {
    const candidates: TokenCandidate[] = [];
    for (const token of this.vocabulary) {
      candidates.push({
        id: token.id,
        score: this.scoreToken(prefix, token.id),
      });
    }

    candidates.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.id - right.id;
    });

    return candidates;
  }

  private scoreToken(prefix: number[], tokenId: number) {
    const unigram = (this.unigramCounts.get(tokenId) ?? 0) + 1;
    let score = Math.log(unigram / (this.totalTokens + this.vocabulary.length));

    if (prefix.length >= 1) {
      const prev = prefix[prefix.length - 1];
      const bigramPrefix = `${prev}`;
      const bigramKey = `${prev}:${tokenId}`;
      const total = (this.bigramTotals.get(bigramPrefix) ?? 0) + this.vocabulary.length;
      const count = (this.bigramCounts.get(bigramKey) ?? 0) + 1;
      score += 1.75 * Math.log(count / total);
    }

    if (prefix.length >= 2) {
      const prev2 = prefix[prefix.length - 2];
      const prev1 = prefix[prefix.length - 1];
      const trigramPrefix = `${prev2}:${prev1}`;
      const trigramKey = `${prev2}:${prev1}:${tokenId}`;
      const total = (this.trigramTotals.get(trigramPrefix) ?? 0) + this.vocabulary.length;
      const count = (this.trigramCounts.get(trigramKey) ?? 0) + 1;
      score += 2.5 * Math.log(count / total);
    }

    return score;
  }
}

class BitWriter {
  private bits = "";

  get length() {
    return this.bits.length;
  }

  writeBits(value: number, width: number) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error("BitWriter only accepts non-negative integers.");
    }

    this.bits += value.toString(2).padStart(width, "0");
  }

  toBitstring() {
    return this.bits;
  }
}

class BitReader {
  private cursor = 0;

  constructor(private readonly bitstring: string) {
    if (!/^[01]*$/.test(bitstring)) {
      throw new Error("BitReader requires a bitstring containing only 0 and 1.");
    }
  }

  isExhausted() {
    return this.cursor >= this.bitstring.length;
  }

  readBits(width: number) {
    if (this.cursor + width > this.bitstring.length) {
      throw new Error("Unexpected end of bitstream.");
    }

    const value = Number.parseInt(this.bitstring.slice(this.cursor, this.cursor + width), 2);
    this.cursor += width;
    return value;
  }
}

function matchesAt(source: Uint8Array, start: number, candidate: Uint8Array) {
  if (start + candidate.length > source.length) {
    return false;
  }

  for (let index = 0; index < candidate.length; index += 1) {
    if (source[start + index] !== candidate[index]) {
      return false;
    }
  }

  return true;
}

function fail(message: string): never {
  throw new Error(message);
}

const model = new PlaintextRankModel(TRAINING_CORPUS);
import {
  compressBitstring,
  compressBitstringToBase64,
  decompressBitstring,
  decompressBitstringFromBase64,
} from "./bitCompression";
