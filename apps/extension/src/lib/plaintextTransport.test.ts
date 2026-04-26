import test from "node:test";
import assert from "node:assert/strict";
import { decodePlaintextFromTransportBitstring, encodePlaintextToTransportBitstring } from "./plaintextTransport";

test("plaintext transport round-trips ASCII", () => {
  const bitstring = encodePlaintextToTransportBitstring("Meet after lunch.");
  assert.equal(decodePlaintextFromTransportBitstring(bitstring), "Meet after lunch.");
});

test("plaintext transport round-trips multi-byte UTF-8", () => {
  const bitstring = encodePlaintextToTransportBitstring("cafe ☕ rendezvous");
  assert.equal(decodePlaintextFromTransportBitstring(bitstring), "cafe ☕ rendezvous");
});

test("plaintext transport round-trips the empty string", () => {
  const bitstring = encodePlaintextToTransportBitstring("");
  assert.equal(decodePlaintextFromTransportBitstring(bitstring), "");
});

test("plaintext transport rejects truncated headers", () => {
  assert.throws(
    () => decodePlaintextFromTransportBitstring("1010"),
    /length header/i,
  );
});

test("plaintext transport rejects declared payload truncation", () => {
  assert.throws(
    () => decodePlaintextFromTransportBitstring(`${"00000000000000000000000000001000"}0`),
    /declared UTF-8 payload length/i,
  );
});

test("plaintext transport rejects invalid UTF-8", () => {
  const invalidUtf8Bitstring = `${"00000000000000000000000000001000"}11111111`;
  assert.throws(
    () => decodePlaintextFromTransportBitstring(invalidUtf8Bitstring),
    /valid UTF-8/i,
  );
});
