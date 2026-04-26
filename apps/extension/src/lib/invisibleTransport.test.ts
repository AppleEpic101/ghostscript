import test from "node:test";
import assert from "node:assert/strict";
import { appendInvisiblePayload, extractInvisiblePayload, stripTransportPayload } from "./invisibleTransport";

test("invisible transport roundtrips a payload bitstring", () => {
  const visibleText = "This looks like a normal message.";
  const bitstring = "0101011100001111000011110000";
  const combined = appendInvisiblePayload(visibleText, bitstring);

  assert.deepEqual(extractInvisiblePayload(combined), {
    bitstring,
    visibleText,
  });
});

test("extract returns null when the marker is missing", () => {
  assert.equal(extractInvisiblePayload("Normal visible text only."), null);
});

test("extract fails closed for truncated payloads", () => {
  const combined = appendInvisiblePayload("Visible text", "0101011100001111");

  assert.equal(extractInvisiblePayload(combined.slice(0, -3)), null);
});

test("stripTransportPayload removes a recognized suffix but ignores unrelated trailing invisible noise", () => {
  const visibleText = "Leave this visible.";
  const combined = appendInvisiblePayload(visibleText, "01001100");

  assert.equal(stripTransportPayload(combined), visibleText);
  assert.equal(stripTransportPayload(`${visibleText}\u200b\u200c`), visibleText);
});

test("extract preserves visible whitespace and unicode characters", () => {
  const visibleText = "Cafe plans 你好";
  const combined = appendInvisiblePayload(visibleText, "00110011");

  assert.deepEqual(extractInvisiblePayload(combined), {
    bitstring: "00110011",
    visibleText,
  });
});

test("extract tolerates Discord trimming trailing visible whitespace before the marker", () => {
  const visibleText = "Pool later still sounds good";
  const combined = appendInvisiblePayload(`${visibleText}  `, "00110011");
  const trimmedBeforeMarker = combined.replace(`${visibleText}  \u2063\u2064\u2063`, `${visibleText}\u2063\u2064\u2063`);

  assert.deepEqual(extractInvisiblePayload(trimmedBeforeMarker), {
    bitstring: "00110011",
    visibleText,
  });
});
