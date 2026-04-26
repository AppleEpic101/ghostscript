import test from "node:test";
import assert from "node:assert/strict";
import { buildCoverTextPrompt, LlmService } from "./llmService";

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

test("template cover text avoids generic stock phrasing and can pivot from the recent message", async () => {
  const service = new LlmService();

  const response = await service.encode({
    coverTopic: "late night food runs",
    recentMessages: [
      "Alice: that place was way louder than i expected",
      "Bob: honestly the fries were carrying the whole experience",
    ],
  });

  assert.match(response.visibleText, /late night food runs|fries|louder|experience/i);
  assert.doesNotMatch(response.visibleText, /\bvibe\b/i);
  assert.doesNotMatch(response.visibleText, /\bcircle back\b/i);
  assert.doesNotMatch(response.visibleText, /\bfor now\b/i);
});

test("cover text prompt includes the casual lowercase logistics example style guidance", () => {
  const prompt = buildCoverTextPrompt("casual convo", ["Alex: u still coming over for the game tonight?"]);

  assert.match(prompt, /lowercase by default/i);
  assert.match(prompt, /i've got wings/i);
  assert.match(prompt, /spicy chips/i);
  assert.match(prompt, /reaction-based/i);
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
