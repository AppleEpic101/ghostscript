import test from "node:test";
import assert from "node:assert/strict";
import { getErrorDetails, logTerminalEvent } from "./logging";

test("logTerminalEvent emits structured encode lifecycle logs", () => {
  const originalConsoleLog = console.log;
  const writes: unknown[][] = [];
  console.log = (...args: unknown[]) => {
    writes.push(args);
  };

  try {
    logTerminalEvent("api", "encode-route-start", {
      promptLength: 128,
      runtime: { candidateDevices: ["coreml", "cpu"] },
    });
  } finally {
    console.log = originalConsoleLog;
  }

  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.[0], "[Ghostscript Terminal]");
  const payload = JSON.parse(String(writes[0]?.[1])) as {
    source: string;
    event: string;
    details: { promptLength: number };
  };
  assert.equal(payload.source, "api");
  assert.equal(payload.event, "encode-route-start");
  assert.equal(payload.details.promptLength, 128);
});

test("getErrorDetails preserves error metadata for request failure logs", () => {
  const details = getErrorDetails(new Error("encode failed"));

  assert.equal(details.name, "Error");
  assert.equal(details.message, "encode failed");
  assert.equal(typeof details.stack, "string");
});

test("getErrorDetails handles uncaught non-Error rejections", () => {
  const details = getErrorDetails("runtime exploded");

  assert.deepEqual(details, {
    name: "NonError",
    message: "runtime exploded",
    stack: null,
  });
});
