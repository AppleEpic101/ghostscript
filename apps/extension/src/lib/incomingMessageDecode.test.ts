import test from "node:test";
import assert from "node:assert/strict";
import { serializeEnvelopeToBitstring } from "./bitstream";
import { compressBitstringForTransport } from "./bitCompression";
import { generateIdentityBundle, encryptMessageEnvelope, decryptMessageEnvelope, type SessionCryptoMaterial } from "./crypto";
import { attemptIncomingMessageDecode } from "./incomingMessageDecode";
import { appendInvisiblePayload } from "./invisibleTransport";
import { encodeVisibleTransportPayload, extractVisibleTransportPayload } from "./visibleTransport";

test("incoming decode succeeds for a message with an invisible transport suffix", async () => {
  const { aliceMaterial, bobMaterial } = await createSessionMaterials();
  const envelope = await encryptMessageEnvelope("Meet by the side entrance.", 11, aliceMaterial);
  const bitstring = await compressBitstringForTransport(serializeEnvelopeToBitstring(envelope));
  const messageText = appendInvisiblePayload("Coffee near the station still works for me.", bitstring.bitstring);

  const decodeResult = await attemptIncomingMessageDecode({
    messageText,
    material: bobMaterial,
    decryptEnvelope: decryptMessageEnvelope,
  });

  assert.deepEqual(decodeResult, {
    status: "decoded",
    plaintext: "Meet by the side entrance.",
    visibleText: "Coffee near the station still works for me.",
  });
});

test("incoming decode succeeds for a visible ASCII transport payload message", async () => {
  const { aliceMaterial, bobMaterial } = await createSessionMaterials();
  const envelope = await encryptMessageEnvelope("Meet by the side entrance.", 11, aliceMaterial);
  const bitstring = await compressBitstringForTransport(serializeEnvelopeToBitstring(envelope));
  const messageText = encodeVisibleTransportPayload(bitstring.bitstring);

  const decodeResult = await attemptIncomingMessageDecode({
    messageText,
    material: bobMaterial,
    decryptEnvelope: decryptMessageEnvelope,
  });

  assert.deepEqual(decodeResult, {
    status: "decoded",
    plaintext: "Meet by the side entrance.",
    visibleText: messageText,
  });
});

test("incoming decode returns null for ordinary visible messages", async () => {
  const { bobMaterial } = await createSessionMaterials();

  const decodeResult = await attemptIncomingMessageDecode({
    messageText: "This is just a normal Discord message.",
    material: bobMaterial,
    decryptEnvelope: decryptMessageEnvelope,
  });

  assert.equal(decodeResult, null);
});

test("incoming decode marks tampered invisible payloads as tampered", async () => {
  const { aliceMaterial, bobMaterial } = await createSessionMaterials();
  const envelope = await encryptMessageEnvelope("Meet by the side entrance.", 11, aliceMaterial);
  const bitstring = await compressBitstringForTransport(serializeEnvelopeToBitstring(envelope));
  const tamperedBitstring = `${bitstring.bitstring.slice(0, 20)}${bitstring.bitstring[20] === "0" ? "1" : "0"}${bitstring.bitstring.slice(21)}`;
  const tampered = appendInvisiblePayload("Coffee near the station still works for me.", tamperedBitstring);

  const decodeResult = await attemptIncomingMessageDecode({
    messageText: tampered,
    material: bobMaterial,
    decryptEnvelope: decryptMessageEnvelope,
  });

  assert.deepEqual(decodeResult, {
    status: "tampered",
    plaintext: null,
    visibleText: "Coffee near the station still works for me.",
  });
});

test("incoming decode marks tampered visible ASCII payloads as tampered", async () => {
  const { aliceMaterial, bobMaterial } = await createSessionMaterials();
  const envelope = await encryptMessageEnvelope("Meet by the side entrance.", 11, aliceMaterial);
  const bitstring = await compressBitstringForTransport(serializeEnvelopeToBitstring(envelope));
  const visiblePayload = encodeVisibleTransportPayload(bitstring.bitstring);
  const extracted = extractVisibleTransportPayload(visiblePayload);
  const tamperedBitstring = `${extracted?.bitstring.slice(0, 20)}${extracted?.bitstring[20] === "0" ? "1" : "0"}${extracted?.bitstring.slice(21)}`;
  const tampered = encodeVisibleTransportPayload(tamperedBitstring);

  const decodeResult = await attemptIncomingMessageDecode({
    messageText: tampered,
    material: bobMaterial,
    decryptEnvelope: decryptMessageEnvelope,
  });

  assert.deepEqual(decodeResult, {
    status: "tampered",
    plaintext: null,
    visibleText: tampered,
  });
});

async function createSessionMaterials() {
  const alice = await generateIdentityBundle();
  const bob = await generateIdentityBundle();

  const aliceMaterial: SessionCryptoMaterial = {
    sessionId: "session-1",
    threadId: "thread-1",
    localParticipantId: "alice",
    counterpartParticipantId: "bob",
    localTransportPrivateKey: alice.transportPrivateKey,
    counterpartTransportPublicKey: bob.transportPublicKey,
  };
  const bobMaterial: SessionCryptoMaterial = {
    sessionId: "session-1",
    threadId: "thread-1",
    localParticipantId: "bob",
    counterpartParticipantId: "alice",
    localTransportPrivateKey: bob.transportPrivateKey,
    counterpartTransportPublicKey: alice.transportPublicKey,
  };

  return { aliceMaterial, bobMaterial };
}
