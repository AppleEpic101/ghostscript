import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TRANSPORT_CONFIG_ID, type LLMEncodingConfig } from "@ghostscript/shared";
import {
  __internal_collectTopMergeSafeCandidates,
  __internal_createTransport,
  __internal_decodeRankedTextToBitstringDetailed,
  __internal_encodeBitstringAsRankedTextDetailed,
  encodeBitstringAsRankedText,
} from "./transport";

const PROMPT = [
  "Cover text topic: coffee plans and weekend errands",
  "Paired Discord chat history:",
  "Alice: want to grab coffee after work?",
  "Bob: yeah maybe near the station if the line is not wild",
  "Next Discord message:",
].join("\n");

function buildConfig(overrides: Partial<LLMEncodingConfig> = {}): LLMEncodingConfig {
  return {
    configId: DEFAULT_TRANSPORT_CONFIG_ID,
    provider: "ghostscript-bridge",
    modelId: "gpt-4.1-mini",
    tokenizerId: "o200k_base-v1",
    transportBackend: "openai-chat-toplogprobs-o200k-v1",
    bitsPerStep: 2,
    excludedTokenSet: ["<|endoftext|>", "<s>", "</s>"],
    fallbackStrategy: "reduce-bits",
    tieBreakRule: "token-id-ascending",
    payloadTerminationStrategy: "length-header",
    contextTruncationStrategy: "tail",
    maxContextTokens: 512,
    ...overrides,
  };
}

function createFakeTokenizer() {
  const singleTokenByText = new Map<string, number>([
    ["A", 10],
    ["B", 11],
    ["C", 12],
    ["D", 13],
    ["!", 14],
    ["E", 15],
  ]);
  const textByToken = new Map<number, string>([
    [10, "A"],
    [11, "B"],
    [12, "C"],
    [13, "D"],
    [14, "!"],
    [15, "E"],
    [90, "A!"],
  ]);

  return {
    encode(text: string) {
      if (text === "A!") {
        return [90];
      }

      const tokenIds: number[] = [];
      for (const char of text) {
        const tokenId = singleTokenByText.get(char);
        if (tokenId === undefined) {
          throw new Error(`Unknown fake token text: ${char}`);
        }
        tokenIds.push(tokenId);
      }
      return tokenIds;
    },
    decode(tokenIds: number[]) {
      return tokenIds
        .map((tokenId) => {
          const text = textByToken.get(tokenId);
          if (text === undefined) {
            throw new Error(`Unknown fake token id: ${tokenId}`);
          }
          return text;
        })
        .join("");
    },
  };
}

function createStaticStepFetcher() {
  return async () => ({
    candidates: [
      { token: "A", logprob: -0.1, bytes: [65] },
      { token: "B", logprob: -0.2, bytes: [66] },
      { token: "C", logprob: -0.3, bytes: [67] },
      { token: "D", logprob: -0.4, bytes: [68] },
      { token: "!", logprob: -0.5, bytes: [33] },
      { token: "E", logprob: -0.6, bytes: [69] },
    ],
    usage: {
      promptTokens: 12,
      completionTokens: 1,
      totalTokens: 13,
    },
  });
}

function estimateWordTargetForTest(payloadBitLength: number, bitsPerToken: number) {
  const estimatedTokens = Math.max(12, Math.ceil(payloadBitLength / Math.max(bitsPerToken, 1)));
  return Math.max(10, Math.ceil(estimatedTokens * 0.7));
}

test("rank transport roundtrips a fixed bitstring with injected API/tokenizer deps", async () => {
  const bitstring = "000000000000000000000000001010000110100001100101011011000110110001101111";
  const config = buildConfig();
  const wordTarget = estimateWordTargetForTest(bitstring.length, config.bitsPerStep);
  const deps = {
    tokenizer: createFakeTokenizer(),
    stepFetcher: createStaticStepFetcher(),
  };

  const encodeResult = await __internal_encodeBitstringAsRankedTextDetailed({
    prompt: PROMPT,
    bitstring,
    wordTarget,
    config,
    deps,
  });
  const decodeResult = await __internal_decodeRankedTextToBitstringDetailed({
    prompt: PROMPT,
    visibleText: encodeResult.visibleText,
    config,
    deps,
  });

  assert.equal(decodeResult.bitstring, bitstring);
  assert.ok(encodeResult.visibleText.length > 0);
  assert.equal(encodeResult.metrics.stepCount > 0, true);
});

test("candidate pool respects exclusions and pairwise merge safety", async () => {
  const config = buildConfig({
    excludedTokenSet: ["D"],
  });
  const transport = await __internal_createTransport(PROMPT, config, {
    tokenizer: createFakeTokenizer(),
    stepFetcher: createStaticStepFetcher(),
  });
  const pool = await transport.buildCandidatePool([10]);

  assert.deepEqual(
    pool.map((candidate) => candidate.id),
    [10, 11, 12, 15],
  );
});

test("candidate pool keeps scanning the ranked candidates until it finds enough merge-safe options", async () => {
  const rankedCandidates = [
    { id: 10, logit: 100, canonicalText: "a" },
    { id: 11, logit: 99, canonicalText: "b" },
    { id: 12, logit: 98, canonicalText: "c" },
    { id: 13, logit: 97, canonicalText: "d" },
    { id: 14, logit: 96, canonicalText: "e" },
    { id: 15, logit: 95, canonicalText: "f" },
    { id: 16, logit: 94, canonicalText: "g" },
    { id: 17, logit: 93, canonicalText: "h" },
  ];
  const mergeSafeIds = new Set([14, 15, 16, 17]);
  const minimumPoolSize = 4;
  const safeCandidates = await __internal_collectTopMergeSafeCandidates({
    rankedCandidates,
    minimumPoolSize,
    isMergeSafe: async (candidate) => mergeSafeIds.has(candidate.id),
  });

  assert.deepEqual(
    safeCandidates.map((candidate) => candidate.id),
    [14, 15, 16, 17],
  );
  assert.equal(safeCandidates.length, minimumPoolSize);
});

test("decode fails cleanly when the visible text token is not in the replayed candidate pool", async () => {
  const config = buildConfig();
  const deps = {
    tokenizer: createFakeTokenizer(),
    stepFetcher: createStaticStepFetcher(),
  };
  const result = await __internal_decodeRankedTextToBitstringDetailed({
    prompt: PROMPT,
    visibleText: "E",
    config,
    deps,
  });

  assert.equal(result.bitstring, null);
});

test("rank transport treats wordTarget as advisory only", async () => {
  const bitstring = "000000000000000000000000000100000110100001101001";
  const config = buildConfig();
  const deps = {
    tokenizer: createFakeTokenizer(),
    stepFetcher: createStaticStepFetcher(),
  };
  const shortTargetVisibleText = await __internal_encodeBitstringAsRankedTextDetailed({
    prompt: PROMPT,
    bitstring,
    wordTarget: 3,
    config,
    deps,
  });
  const longTargetVisibleText = await __internal_encodeBitstringAsRankedTextDetailed({
    prompt: PROMPT,
    bitstring,
    wordTarget: 28,
    config,
    deps,
  });

  assert.equal(
    (
      await __internal_decodeRankedTextToBitstringDetailed({
        prompt: PROMPT,
        visibleText: shortTargetVisibleText.visibleText,
        config,
        deps,
      })
    ).bitstring,
    bitstring,
  );

  assert.equal(
    (
      await __internal_decodeRankedTextToBitstringDetailed({
        prompt: PROMPT,
        visibleText: longTargetVisibleText.visibleText,
        config,
        deps,
      })
    ).bitstring,
    bitstring,
  );
});

test("transport rejects incompatible pinned runtime metadata", async () => {
  await assert.rejects(
    () =>
      encodeBitstringAsRankedText({
        prompt: PROMPT,
        bitstring: "00000000000000000000000000010000",
        wordTarget: 12,
        config: buildConfig({ tokenizerId: "different-tokenizer" }),
      }),
    /incompatible with the pinned openai runtime|unsupported ghostscript tokenizer/i,
  );
});
