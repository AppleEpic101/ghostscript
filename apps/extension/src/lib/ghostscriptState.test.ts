import test from "node:test";
import assert from "node:assert/strict";
import { isPendingSendStale, type PendingSendState } from "./ghostscriptState";

const SESSION_ID = "session-1";
const STARTED_AT = Date.UTC(2026, 3, 26, 12, 0, 0);

test("encoding sends do not become stale while cover text generation is still running", () => {
  assert.equal(
    isPendingSendStale(createPendingSend("encoding"), SESSION_ID, STARTED_AT + 10 * 60_000),
    false,
  );
});

test("failed sends stay visible until the user retries or clears them", () => {
  assert.equal(
    isPendingSendStale(createPendingSend("failed"), SESSION_ID, STARTED_AT + 10 * 60_000),
    false,
  );
});

test("awaiting Discord confirmation eventually becomes stale", () => {
  assert.equal(
    isPendingSendStale(createPendingSend("awaiting-discord-confirm"), SESSION_ID, STARTED_AT + 2 * 60_000 + 1),
    true,
  );
});

test("confirmed sends auto-clear after the short success window", () => {
  assert.equal(
    isPendingSendStale(createPendingSend("confirmed"), SESSION_ID, STARTED_AT + 30_000 + 1),
    true,
  );
});

test("session mismatches still clear pending send state immediately", () => {
  assert.equal(
    isPendingSendStale(createPendingSend("encoding"), "different-session", STARTED_AT + 1_000),
    true,
  );
});

function createPendingSend(status: PendingSendState["status"]): PendingSendState {
  return {
    threadId: "thread-1",
    sessionId: SESSION_ID,
    status,
    expectedCoverText: "",
    encodedMessage: null,
    startedAt: STARTED_AT,
    msgId: 1,
    error: status === "failed" ? "Ghostscript send failed." : null,
  };
}
