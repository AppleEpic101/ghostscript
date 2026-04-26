import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TRANSPORT_CONFIG_ID } from "@ghostscript/shared";
import { LlmService } from "./llmService";

test("health reports rank-local transport metadata", () => {
  const service = new LlmService();
  const health = service.getHealth();

  assert.equal(health.mode, "rank-local");
  assert.equal(health.transportProtocolVersion, 1);
  assert.deepEqual(health.supportedConfigIds, [DEFAULT_TRANSPORT_CONFIG_ID]);
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
