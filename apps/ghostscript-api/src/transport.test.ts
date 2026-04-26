import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TRANSPORT_CONFIG_ID, type LLMEncodingConfig } from "@ghostscript/shared";
import {
  __internal_createTransport,
  decodeRankedTextToBitstring,
  encodeBitstringAsRankedText,
} from "./transport";

const PROMPT = [
  "Cover text topic: coffee plans and weekend errands",
  "Alice: want to grab coffee after work?",
  "Bob: yeah maybe near the station if the line is not wild",
].join("\n");

function buildConfig(overrides: Partial<LLMEncodingConfig> = {}): LLMEncodingConfig {
  return {
    configId: DEFAULT_TRANSPORT_CONFIG_ID,
    provider: "ghostscript-bridge",
    modelId: "xenova-distilgpt2-v1",
    tokenizerId: "gpt2-tokenizer-v1",
    transportBackend: "local-gpt2-top4-v1",
    temperature: 1,
    pMin: 0,
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

function estimateWordTargetForTest(payloadBitLength: number, bitsPerToken: number) {
  const estimatedTokens = Math.max(12, Math.ceil(payloadBitLength / Math.max(bitsPerToken, 1)));
  return Math.max(10, Math.ceil(estimatedTokens * 0.7));
}

test("rank transport roundtrips a fixed bitstring", { timeout: 300_000 }, async () => {
  const bitstring = "000000000000000000000000001010000110100001100101011011000110110001101111";
  const config = buildConfig();
  const wordTarget = estimateWordTargetForTest(bitstring.length, config.bitsPerStep);
  const visibleText = await encodeBitstringAsRankedText({
    prompt: PROMPT,
    bitstring,
    wordTarget,
    config,
  });

  const decoded = await decodeRankedTextToBitstring({
    prompt: PROMPT,
    visibleText,
    config,
  });

  assert.equal(decoded, bitstring);
  assert.ok(visibleText.length > 0);
});

test("candidate pool respects exclusions and roundtrips with the real tokenizer/model", { timeout: 300_000 }, async () => {
  const config = buildConfig();
  const transport = await __internal_createTransport(PROMPT, config);
  const pool = await transport.buildCandidatePool([]);

  assert.ok(pool.length > 0 && pool.length <= 2 ** config.bitsPerStep);

  const excludedToken = transport.detokenize([pool[0].id]);
  const excludedConfig = buildConfig({
    excludedTokenSet: [excludedToken],
  });
  const excludedTransport = await __internal_createTransport(PROMPT, excludedConfig);
  const excludedPool = await excludedTransport.buildCandidatePool([]);

  assert.ok(excludedPool.every((candidate) => excludedTransport.detokenize([candidate.id]) !== excludedToken));

  const bitstring = "000000000000000000000000000001001011";
  const wordTarget = estimateWordTargetForTest(bitstring.length, config.bitsPerStep);
  const visibleText = await encodeBitstringAsRankedText({
    prompt: PROMPT,
    bitstring,
    wordTarget,
    config,
  });

  const decoded = await decodeRankedTextToBitstring({
    prompt: PROMPT,
    visibleText,
    config,
  });

  assert.equal(decoded, bitstring);
});

test("decode returns null when the visible text does not match a valid candidate path", { timeout: 300_000 }, async () => {
  const bitstring = "000000000000000000000000000100000110100001101001";
  const config = buildConfig();
  const wordTarget = estimateWordTargetForTest(bitstring.length, config.bitsPerStep);
  const visibleText = await encodeBitstringAsRankedText({
    prompt: PROMPT,
    bitstring,
    wordTarget,
    config,
  });
  const tampered = `${visibleText} Extra`;

  const decoded = await decodeRankedTextToBitstring({
    prompt: PROMPT,
    visibleText: tampered,
    config,
  });

  assert.equal(decoded, null);
});

test("rank transport treats wordTarget as advisory only", { timeout: 300_000 }, async () => {
  const bitstring = "000000000000000000000000000100000110100001101001";
  const config = buildConfig();
  const shortTargetVisibleText = await encodeBitstringAsRankedText({
    prompt: PROMPT,
    bitstring,
    wordTarget: 3,
    config,
  });
  const longTargetVisibleText = await encodeBitstringAsRankedText({
    prompt: PROMPT,
    bitstring,
    wordTarget: 28,
    config,
  });

  assert.equal(
    await decodeRankedTextToBitstring({
      prompt: PROMPT,
      visibleText: shortTargetVisibleText,
      config,
    }),
    bitstring,
  );

  assert.equal(
    await decodeRankedTextToBitstring({
      prompt: PROMPT,
      visibleText: longTargetVisibleText,
      config,
    }),
    bitstring,
  );
});
