import test from "node:test";
import assert from "node:assert/strict";
import { encodeVisibleTransportPayload, extractVisibleTransportPayload } from "./visibleTransport";

test("visible transport roundtrips a whole-byte bitstring through ASCII payload text", () => {
  const bitstring = "01010111000011110000111100000000";
  const visibleText = encodeVisibleTransportPayload(bitstring);

  assert.deepEqual(extractVisibleTransportPayload(visibleText), {
    bitstring,
    visibleText,
  });
});

test("visible transport returns null for ordinary chat text", () => {
  assert.equal(extractVisibleTransportPayload("just a normal discord reply"), null);
});

test("visible transport returns null for malformed payload text", () => {
  assert.equal(extractVisibleTransportPayload("GS1:not valid!!!"), null);
});
