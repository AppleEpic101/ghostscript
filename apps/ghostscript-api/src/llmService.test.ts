import test from "node:test";
import assert from "node:assert/strict";
import { LlmService } from "./llmService";

test("health reports cover-text transport metadata", () => {
  const service = new LlmService();
  const health = service.getHealth();

  assert.equal(typeof health.mode, "string");
  assert.equal(health.transportProtocolVersion, 1);
  assert.equal(health.decodeSupported, false);
});

test("encode rejects oversized cover topics", async () => {
  const service = new LlmService();

  await assert.rejects(
    () =>
      service.encode({
        coverTopic: "a".repeat(201),
      }),
    (error: unknown) => isApiErrorWithStatus(error, 400),
  );
});

test("encode returns non-empty cover text", async () => {
  const service = new LlmService();

  const response = await service.encode({
    coverTopic: "coffee plans",
    recentMessages: ["Alice: want to grab coffee later?"],
  });

  assert.equal(typeof response.visibleText, "string");
  assert.ok(response.visibleText.length > 0);
  assert.equal(typeof response.generator, "string");
});

test("decode is no longer supported", async () => {
  const service = new LlmService();

  await assert.rejects(
    () =>
      service.decode({
        visibleText: "This looks harmless.",
      }),
    (error: unknown) => isApiErrorWithStatus(error, 410),
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
