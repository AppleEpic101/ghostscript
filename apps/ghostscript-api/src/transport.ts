import { DEFAULT_TRANSPORT_CONFIG_ID, type LLMEncodingConfig } from "@ghostscript/shared";

const TOKEN_PATTERN = /[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?|[.,!?;:]/g;
const PUNCTUATION_TOKENS = new Set([".", ",", "!", "?", ";", ":"]);
const SENTENCE_END_TOKENS = new Set([".", "!", "?"]);
const DEFAULT_ENCODING_CONFIG: LLMEncodingConfig = {
  configId: DEFAULT_TRANSPORT_CONFIG_ID,
  provider: "ghostscript-bridge",
  modelId: "ghostscript-rank-lm-v1",
  tokenizerId: "ghostscript-word-tokenizer-v1",
  transportBackend: "rank-local-v1",
  temperature: 1,
  pMin: 0.001,
  bitsPerStep: 3,
  excludedTokenSet: ["<|endoftext|>", "<s>", "</s>"],
  fallbackStrategy: "reduce-bits",
  tieBreakRule: "token-id-ascending",
  payloadTerminationStrategy: "length-header",
  contextTruncationStrategy: "tail",
  maxContextTokens: 512,
};

const BASE_CORPUS = [
  "i think that sounds pretty good .",
  "that makes sense to me .",
  "i can do that later tonight .",
  "we should keep it simple for now .",
  "maybe we can circle back after dinner .",
  "i was just thinking about that .",
  "it feels like the timing finally works .",
  "honestly that is a fair point .",
  "the weather has been weird all week .",
  "i would rather keep the plan flexible .",
  "it might be easier after the weekend .",
  "i still need to finish a few things first .",
  "that actually sounds kind of fun .",
  "i am fine with either option .",
  "we could keep the message short and casual .",
  "the whole thing seems more relaxed today .",
  "i just want a normal conversation for once .",
  "it was quieter than i expected .",
  "the coffee place near the station is still open .",
  "we can meet there if that helps .",
  "i liked the last version better .",
  "this one feels a little cleaner to me .",
  "we should probably avoid making it too formal .",
  "i do not mind talking about that for a bit .",
  "it ended up being a longer day than i planned .",
  "i can send a quick update in a minute .",
  "there is still time to change it .",
  "the idea is good but the wording feels off .",
  "maybe use something lighter and more direct .",
  "that part is easy enough .",
  "i was reading about that earlier today .",
  "the route by the park is usually nicer .",
  "we can keep the topic broad if you want .",
  "it is mostly the same as before .",
  "i forgot how loud that place gets .",
  "the new setup is working better now .",
  "i would not overthink it too much .",
  "a short reply is probably fine .",
  "the details can wait until later .",
  "it should be easy to explain in person .",
  "we can talk about food if the room gets awkward .",
  "the hike looked easier on the map .",
  "i still want to hear how that went .",
  "that movie was better than i expected .",
  "the playlist actually fit the mood .",
  "i am still deciding between the two options .",
  "the whole server has been unusually calm today .",
  "it reads more naturally when the sentence stays loose .",
  "i guess that depends on how late everyone is staying .",
  "the small changes help more than you would think .",
];

const STOP_WORDS = new Set([
  "a",
  "about",
  "after",
  "all",
  "am",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "can",
  "do",
  "for",
  "from",
  "has",
  "have",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "just",
  "me",
  "more",
  "my",
  "not",
  "of",
  "on",
  "or",
  "our",
  "so",
  "that",
  "the",
  "their",
  "them",
  "there",
  "they",
  "this",
  "to",
  "too",
  "was",
  "we",
  "what",
  "when",
  "with",
  "would",
  "you",
  "your",
]);

interface CandidateToken {
  id: number;
  probability: number;
}

interface TransportMetadata {
  mode: "rank-local";
  backend: string;
  modelId: string;
  tokenizerId: string;
}

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

export function encodeBitstringAsRankedText(params: {
  prompt: string;
  bitstring: string;
  wordTarget: number;
  config?: LLMEncodingConfig;
}) {
  const config = resolveEncodingConfig(params.config);
  const adapter = new PromptConditionedLocalTransportAdapter(params.prompt, params.wordTarget, config);
  const outputTokenIds: number[] = [];
  let bitCursor = 0;
  let guard = 0;
  const maxSteps = Math.max(256, params.bitstring.length * 4);

  while (bitCursor < params.bitstring.length) {
    if (guard >= maxSteps) {
      throw new Error("Rank-selection encoding exceeded the maximum token budget for this payload.");
    }

    const pool = adapter.buildCandidatePool(outputTokenIds);
    if (pool.length === 0) {
      throw new Error("Rank-selection encoding could not construct a non-empty candidate pool.");
    }

    const encodedWidth = getStepBitWidth(pool.length, config.bitsPerStep);
    const consumedWidth = Math.min(encodedWidth, params.bitstring.length - bitCursor);
    const nextToken = selectTokenForStep(pool, params.bitstring, bitCursor, consumedWidth, encodedWidth);
    outputTokenIds.push(nextToken);
    bitCursor += consumedWidth;
    guard += 1;
  }

  return adapter.detokenize(outputTokenIds);
}

export function decodeRankedTextToBitstring(params: {
  prompt: string;
  visibleText: string;
  config?: LLMEncodingConfig;
}) {
  const config = resolveEncodingConfig(params.config);
  const adapter = new PromptConditionedLocalTransportAdapter(params.prompt, undefined, config);
  const outputTokenIds = adapter.tokenizeOutput(params.visibleText);

  if (!outputTokenIds) {
    return null;
  }

  let recoveredBits = "";
  let targetBitLength: number | null = null;

  for (let index = 0; index < outputTokenIds.length; index += 1) {
    const prefix = outputTokenIds.slice(0, index);
    const tokenId = outputTokenIds[index];
    const pool = adapter.buildCandidatePool(prefix);
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
        if (index !== outputTokenIds.length - 1) {
          return null;
        }

        return recoveredBits.slice(0, targetBitLength);
      }
    }
  }

  return null;
}

export function __internal_createAdapter(
  prompt: string,
  wordTarget: number | undefined,
  config?: LLMEncodingConfig,
) {
  return new PromptConditionedLocalTransportAdapter(prompt, wordTarget, resolveEncodingConfig(config));
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

function fail(message: string): never {
  throw new Error(message);
}

class PromptConditionedLocalTransportAdapter {
  private readonly promptTokenIds: number[];
  private readonly config: LLMEncodingConfig;
  private readonly vocabulary: string[];
  private readonly tokenToId = new Map<string, number>();
  private readonly topicTokenIds = new Set<number>();
  private readonly unigramCounts = new Map<number, number>();
  private readonly bigramCounts = new Map<string, number>();
  private readonly trigramCounts = new Map<string, number>();
  private readonly bigramTotals = new Map<string, number>();
  private readonly trigramTotals = new Map<string, number>();
  private totalObservedTokens = 0;

  constructor(prompt: string, _wordTarget: number | undefined, config: LLMEncodingConfig) {
    this.config = config;

    const promptTokens = extractRawTokens(prompt);
    const baseVocabulary = Array.from(new Set([...extractRawTokens(BASE_CORPUS.join(" ")), ...PUNCTUATION_TOKENS]));
    const dynamicVocabulary = Array.from(new Set(promptTokens)).sort((left, right) => left.localeCompare(right));
    this.vocabulary = Array.from(new Set([...baseVocabulary, ...dynamicVocabulary]));

    for (const token of this.vocabulary) {
      this.tokenToId.set(token, this.tokenToId.size);
    }

    this.promptTokenIds = this.mapTokensToIdsRequired(promptTokens);
    for (const topicToken of extractTopicTokens(promptTokens)) {
      const tokenId = this.tokenToId.get(topicToken);
      if (tokenId !== undefined) {
        this.topicTokenIds.add(tokenId);
      }
    }

    this.seedCounts(prompt);
  }

  buildCandidatePool(outputTokenIds: number[]) {
    const context = this.truncateContext([...this.promptTokenIds, ...outputTokenIds]);
    const candidates: Array<{ id: number; logit: number }> = [];

    for (const tokenId of this.iterAllowedTokenIds(context, outputTokenIds)) {
      candidates.push({
        id: tokenId,
        logit: this.scoreToken(context, outputTokenIds, tokenId),
      });
    }

    const probabilities = softmax(candidates, this.config.temperature);
    const filtered = probabilities
      .filter((candidate) => candidate.probability >= this.config.pMin)
      .filter((candidate) => !this.config.excludedTokenSet.includes(this.vocabulary[candidate.id] ?? ""))
      .filter((candidate) => this.isSafeAppend(outputTokenIds, candidate.id))
      .sort((left, right) => {
        if (right.probability !== left.probability) {
          return right.probability - left.probability;
        }

        return left.id - right.id;
      });

    if (filtered.length > 0) {
      return filtered;
    }

    return probabilities
      .filter((candidate) => this.isSafeAppend(outputTokenIds, candidate.id))
      .sort((left, right) => {
        if (right.probability !== left.probability) {
          return right.probability - left.probability;
        }

        return left.id - right.id;
      });
  }

  detokenize(tokenIds: number[]) {
    let output = "";
    let capitalizeNextWord = true;

    for (const tokenId of tokenIds) {
      const token = this.vocabulary[tokenId];
      if (!token) {
        continue;
      }

      if (PUNCTUATION_TOKENS.has(token)) {
        output = output.replace(/\s+$/, "");
        output += token;
        capitalizeNextWord = SENTENCE_END_TOKENS.has(token);
        continue;
      }

      const surface = capitalizeNextWord ? capitalize(token) : token;
      output += output ? ` ${surface}` : surface;
      capitalizeNextWord = false;
    }

    return output.trim();
  }

  tokenizeOutput(text: string) {
    const rawTokens = extractRawTokens(text);
    if (rawTokens.length === 0) {
      return null;
    }

    const tokenIds = this.mapTokensToIds(rawTokens, false);
    if (!tokenIds) {
      return null;
    }

    return this.detokenize(tokenIds) === text.trim() ? tokenIds : null;
  }

  private iterAllowedTokenIds(context: number[], outputTokenIds: number[]) {
    const previousTokenId = context[context.length - 1];
    const previousToken = previousTokenId === undefined ? null : this.vocabulary[previousTokenId] ?? null;
    const wordCount = countWords(outputTokenIds.map((tokenId) => this.vocabulary[tokenId] ?? ""));
    const isStart = outputTokenIds.length === 0;
    const ids: number[] = [];

    for (const [token, tokenId] of this.tokenToId.entries()) {
      if (PUNCTUATION_TOKENS.has(token)) {
        if (isStart) {
          continue;
        }

        if (previousToken && PUNCTUATION_TOKENS.has(previousToken)) {
          continue;
        }

        if (wordCount < 3 && SENTENCE_END_TOKENS.has(token)) {
          continue;
        }
      } else if (previousToken && previousToken === ":") {
        // Keep the text moving after a colon.
      }

      ids.push(tokenId);
    }

    return ids;
  }

  private scoreToken(context: number[], outputTokenIds: number[], candidateId: number) {
    const V = this.vocabulary.length;
    const prev1 = context[context.length - 1] ?? -1;
    const prev2 = context[context.length - 2] ?? -2;
    const trigramKey = `${prev2}|${prev1}|${candidateId}`;
    const bigramKey = `${prev1}|${candidateId}`;
    const trigramContextKey = `${prev2}|${prev1}`;
    const bigramContextKey = `${prev1}`;
    const trigramCount = this.trigramCounts.get(trigramKey) ?? 0;
    const bigramCount = this.bigramCounts.get(bigramKey) ?? 0;
    const unigramCount = this.unigramCounts.get(candidateId) ?? 0;
    const trigramTotal = this.trigramTotals.get(trigramContextKey) ?? 0;
    const bigramTotal = this.bigramTotals.get(bigramContextKey) ?? 0;

    let score =
      2.6 * Math.log((trigramCount + 1) / (trigramTotal + V)) +
      1.6 * Math.log((bigramCount + 1) / (bigramTotal + V)) +
      0.8 * Math.log((unigramCount + 1) / (this.totalObservedTokens + V));

    const candidate = this.vocabulary[candidateId] ?? "";
    const previousToken = prev1 >= 0 ? this.vocabulary[prev1] ?? null : null;
    const wordsGenerated = countWords(outputTokenIds.map((tokenId) => this.vocabulary[tokenId] ?? ""));
    const recentlyUsed = outputTokenIds.slice(-8).filter((tokenId) => tokenId === candidateId).length;

    if (this.topicTokenIds.has(candidateId)) {
      score += 0.4;
    }

    if (recentlyUsed > 0) {
      score -= recentlyUsed * 0.45;
    }

    if (candidate.length <= 2 && !PUNCTUATION_TOKENS.has(candidate)) {
      score -= 0.15;
    }

    if (PUNCTUATION_TOKENS.has(candidate)) {
      score += scorePunctuation(candidate, previousToken, wordsGenerated);
    } else {
      score += scoreWord(candidate, previousToken, wordsGenerated);
    }

    return score;
  }

  private isSafeAppend(outputTokenIds: number[], candidateId: number) {
    const nextTokens = [...outputTokenIds, candidateId];
    const roundTrip = this.tokenizeOutput(this.detokenize(nextTokens));
    return roundTrip !== null && arraysEqual(roundTrip, nextTokens);
  }

  private seedCounts(prompt: string) {
    for (const sentence of BASE_CORPUS) {
      this.addObservedSequence(extractRawTokens(sentence), 2);
    }

    for (const line of prompt.split(/\n+/).map((value) => value.trim()).filter(Boolean)) {
      this.addObservedSequence(extractRawTokens(line), 4);
    }
  }

  private addObservedSequence(tokens: string[], weight: number) {
    const ids = this.mapTokensToIdsRequired(tokens);
    let prev2 = -2;
    let prev1 = -1;

    for (const tokenId of ids) {
      increment(this.unigramCounts, tokenId, weight);
      increment(this.bigramCounts, `${prev1}|${tokenId}`, weight);
      increment(this.trigramCounts, `${prev2}|${prev1}|${tokenId}`, weight);
      increment(this.bigramTotals, `${prev1}`, weight);
      increment(this.trigramTotals, `${prev2}|${prev1}`, weight);
      this.totalObservedTokens += weight;
      prev2 = prev1;
      prev1 = tokenId;
    }
  }

  private truncateContext(tokens: number[]) {
    if (tokens.length <= this.config.maxContextTokens) {
      return tokens;
    }

    return tokens.slice(-this.config.maxContextTokens);
  }

  private mapTokensToIdsRequired(tokens: string[]) {
    const ids: number[] = [];

    for (const token of tokens) {
      const tokenId = this.tokenToId.get(token);
      if (tokenId === undefined) {
        throw new Error(`Unknown transport token: ${token}`);
      }

      ids.push(tokenId);
    }

    return ids;
  }

  private mapTokensToIds(tokens: string[], throwOnMissing = true): number[] | null {
    const ids: number[] = [];

    for (const token of tokens) {
      const tokenId = this.tokenToId.get(token);
      if (tokenId === undefined) {
        if (throwOnMissing) {
          throw new Error(`Unknown transport token: ${token}`);
        }

        return null;
      }

      ids.push(tokenId);
    }

    return ids;
  }
}

function capitalize(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function extractRawTokens(input: string) {
  return Array.from(input.toLowerCase().matchAll(TOKEN_PATTERN), (match) => match[0]);
}

function extractTopicTokens(tokens: string[]) {
  return tokens.filter((token) => !STOP_WORDS.has(token) && !PUNCTUATION_TOKENS.has(token) && token.length >= 3);
}

function arraysEqual(left: number[], right: number[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function countWords(tokens: string[]) {
  return tokens.filter((token) => token && !PUNCTUATION_TOKENS.has(token)).length;
}

function increment(store: Map<string | number, number>, key: string | number, amount: number) {
  store.set(key, (store.get(key) ?? 0) + amount);
}

function scorePunctuation(candidate: string, previousToken: string | null, wordCount: number) {
  if (!previousToken || PUNCTUATION_TOKENS.has(previousToken)) {
    return -6;
  }

  if (candidate === ",") {
    return wordCount >= 4 && wordCount < 14 ? 0.3 : -0.8;
  }

  if (candidate === ":") {
    return wordCount >= 3 && wordCount < 8 ? -0.25 : -1.2;
  }

  if (candidate === ";") {
    return wordCount >= 6 ? -0.15 : -1.5;
  }

  if (SENTENCE_END_TOKENS.has(candidate)) {
    if (wordCount < 4) {
      return -2.4;
    }

    if (wordCount >= 9) {
      return 0.9;
    }

    return 0.15;
  }

  return -0.5;
}

function scoreWord(candidate: string, previousToken: string | null, wordCount: number) {
  let score = 0;

  if (!previousToken || SENTENCE_END_TOKENS.has(previousToken)) {
    if (candidate === "i" || candidate === "that" || candidate === "it" || candidate === "we" || candidate === "maybe") {
      score += 0.65;
    }
  }

  if (previousToken === ",") {
    if (candidate === "and" || candidate === "but" || candidate === "so" || candidate === "because") {
      score += 0.55;
    }
  }

  if (previousToken === "the" || previousToken === "a") {
    score += 0.2;
  }

  if (wordCount >= 18) {
    score -= 0.6;
  }

  if (candidate === "the" || candidate === "a") {
    score -= 0.2;
  }

  return score;
}

function softmax(candidates: Array<{ id: number; logit: number }>, temperature: number) {
  const safeTemperature = Number.isFinite(temperature) && temperature > 0 ? temperature : 1;
  const scaled = candidates.map((candidate) => ({
    id: candidate.id,
    score: candidate.logit / safeTemperature,
  }));
  const maxScore = Math.max(...scaled.map((candidate) => candidate.score));
  const exponentials = scaled.map((candidate) => ({
    id: candidate.id,
    weight: Math.exp(candidate.score - maxScore),
  }));
  const totalWeight = exponentials.reduce((sum, candidate) => sum + candidate.weight, 0);

  return exponentials.map((candidate) => ({
    id: candidate.id,
    probability: totalWeight === 0 ? 0 : candidate.weight / totalWeight,
  }));
}
