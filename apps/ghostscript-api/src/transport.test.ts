import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TRANSPORT_CONFIG_ID, type LLMEncodingConfig } from "@ghostscript/shared";
import {
  __internal_createAdapter,
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
    ...overrides,
  };
}

test("rank transport roundtrips a fixed bitstring", () => {
  const bitstring = "000000000000000000000000001010000110100001100101011011000110110001101111";
  const config = buildConfig();
  const visibleText = encodeBitstringAsRankedText({
    prompt: PROMPT,
    bitstring,
    wordTarget: 18,
    config,
  });

  const decoded = decodeRankedTextToBitstring({
    prompt: PROMPT,
    visibleText,
    config,
  });

  assert.equal(decoded, bitstring);
  assert.match(visibleText, /^[A-Z][A-Za-z0-9 ,.!?;:']+$/);
});

test("candidate filtering respects exclusions and reduced-width fallback stays decodable", () => {
  const fallbackConfig = buildConfig({
    pMin: 0.02,
  });
  const fallbackAdapter = __internal_createAdapter(PROMPT, 18, fallbackConfig);
  const fallbackPool = fallbackAdapter.buildCandidatePool([]);

  assert.ok(fallbackPool.length > 0 && fallbackPool.length < 2 ** fallbackConfig.bitsPerStep);

  const excludedToken = fallbackAdapter.detokenize([fallbackPool[0].id]).toLowerCase();
  const excludedConfig = buildConfig({
    excludedTokenSet: [excludedToken],
  });
  const excludedAdapter = __internal_createAdapter(PROMPT, 18, excludedConfig);
  const excludedPool = excludedAdapter.buildCandidatePool([]);

  assert.ok(excludedPool.every((candidate) => excludedAdapter.detokenize([candidate.id]).toLowerCase() !== excludedToken));

  const bitstring = "000000000000000000000000000001001011";
  const visibleText = encodeBitstringAsRankedText({
    prompt: PROMPT,
    bitstring,
    wordTarget: 18,
    config: fallbackConfig,
  });

  const decoded = decodeRankedTextToBitstring({
    prompt: PROMPT,
    visibleText,
    config: fallbackConfig,
  });

  assert.equal(decoded, bitstring);
});

test("decode returns null when the visible text does not match a valid candidate path", () => {
  const bitstring = "000000000000000000000000000100000110100001101001";
  const config = buildConfig();
  const visibleText = encodeBitstringAsRankedText({
    prompt: PROMPT,
    bitstring,
    wordTarget: 16,
    config,
  });
  const tampered = `${visibleText} Extra`;

  const decoded = decodeRankedTextToBitstring({
    prompt: PROMPT,
    visibleText: tampered,
    config,
  });

  assert.equal(decoded, null);
});

test("rank transport ignores wordTarget as protocol state", () => {
  const bitstring = "000000000000000000000000000100000110100001101001";
  const config = buildConfig();
  const shortTargetVisibleText = encodeBitstringAsRankedText({
    prompt: PROMPT,
    bitstring,
    wordTarget: 10,
    config,
  });
  const longTargetVisibleText = encodeBitstringAsRankedText({
    prompt: PROMPT,
    bitstring,
    wordTarget: 28,
    config,
  });

  assert.equal(shortTargetVisibleText, longTargetVisibleText);
  assert.equal(
    decodeRankedTextToBitstring({
      prompt: PROMPT,
      visibleText: longTargetVisibleText,
      config,
    }),
    bitstring,
  );
});
