import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TRANSPORT_CONFIG_ID } from "@ghostscript/shared";
import { LlmService } from "./llmService";

test("health reports rank-openai transport metadata", () => {
  const service = new LlmService();
  const health = service.getHealth();

  assert.equal(health.mode, "rank-openai");
  assert.equal(health.transportProtocolVersion, 2);
  assert.deepEqual(health.supportedConfigIds, [DEFAULT_TRANSPORT_CONFIG_ID]);
  assert.equal(health.runtime.provider, "openai");
  assert.equal(health.runtime.tokenizerId, "o200k_base-v1");
});

test("encode rejects oversized transport inputs", async () => {
  const service = new LlmService();

  await assert.rejects(
    () =>
      service.encode({
        prompt: "topic",
        bitstring: "0".repeat(131_073),
        wordTarget: 24,
      }),
    (error: unknown) => isApiErrorWithStatus(error, 400),
  );
});

test("decode rejects unsupported config IDs", async () => {
  const service = new LlmService();

  await assert.rejects(
    () =>
      service.decode({
        prompt: "Cover text topic: coffee",
        visibleText: "This looks harmless.",
        config: {
          configId: "ghostscript-legacy-v0" as typeof DEFAULT_TRANSPORT_CONFIG_ID,
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
        },
      }),
    (error: unknown) => isApiErrorWithStatus(error, 400),
  );
});

function isApiErrorWithStatus(error: unknown, statusCode: number) {
  return (
    error instanceof Error &&
    "statusCode" in error &&
    typeof (error as { statusCode?: unknown }).statusCode === "number" &&
    (error as { statusCode: number }).statusCode === statusCode
  );
}
