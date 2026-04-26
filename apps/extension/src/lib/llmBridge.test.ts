import test from "node:test";
import assert from "node:assert/strict";
import {
  __internal_getBridgeTimeoutMessage,
  __internal_getBridgeUnreachableMessage,
  __internal_requestBridgeJson,
} from "./llmBridge";

test("bridge request reports a stable actionable error when the API is unreachable", async () => {
  const baseUrl = "http://localhost:8787";

  await assert.rejects(
    () =>
      __internal_requestBridgeJson(baseUrl, "/encode", { prompt: "topic" }, async () => {
        throw new TypeError("fetch failed");
      }),
    new Error(__internal_getBridgeUnreachableMessage(baseUrl)),
  );
});

test("bridge request reports a specific timeout when cover-text generation hangs", async () => {
  const abortError = new DOMException("The operation was aborted.", "AbortError");

  await assert.rejects(
    () =>
      __internal_requestBridgeJson("http://localhost:8787", "/encode", { prompt: "topic" }, async () => {
        throw abortError;
      }),
    new Error(__internal_getBridgeTimeoutMessage("/encode", 180_000)),
  );
});
