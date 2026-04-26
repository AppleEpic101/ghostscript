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
  assert.ok(Array.isArray(health.runtime.candidateDevices));
  assert.ok(health.runtime.candidateDevices.length > 0);
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

test("encode accepts small advisory word targets for rank-local transport", async () => {
  const service = new LlmService();
  const bitstring = "000000000000000000000000000100000110100001101001";

  const response = await service.encode({
    prompt: "Cover text topic: coffee\nAlice: can you keep this short?",
    bitstring,
    wordTarget: 3,
  });

  assert.equal(typeof response.visibleText, "string");
  assert.ok(response.visibleText.length > 0);
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
