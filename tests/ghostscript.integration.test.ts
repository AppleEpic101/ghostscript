import test from "node:test";
import assert from "node:assert/strict";
import {
  __internal_encodePlaintextPayload,
  decryptMessageEnvelope,
  encryptMessageEnvelope,
  generateIdentityBundle,
  type SessionCryptoMaterial,
} from "../apps/extension/src/lib/crypto";
import { deserializeEnvelopeFromBitstring, serializeEnvelopeToBitstring } from "../apps/extension/src/lib/bitstream";
import { compressBitstringForTransport, decompressBitstringFromTransport } from "../apps/extension/src/lib/bitCompression";
import { appendInvisiblePayload, extractInvisiblePayload } from "../apps/extension/src/lib/invisibleTransport";

test("encrypted envelopes survive invisible unicode transport end to end", async () => {
  const { aliceMaterial, bobMaterial } = await createSessionMaterials();
  const envelope = await encryptMessageEnvelope("Okay, station works.", 11, aliceMaterial);
  const bitstring = await compressBitstringForTransport(serializeEnvelopeToBitstring(envelope));
  const submittedText = appendInvisiblePayload("Coffee later still sounds good to me.", bitstring.bitstring);
  const extracted = extractInvisiblePayload(submittedText);

  assert.ok(extracted);
  assert.equal(extracted?.visibleText, "Coffee later still sounds good to me.");
  assert.equal(extracted?.bitstring, bitstring.bitstring);

  const decodedEnvelope = deserializeEnvelopeFromBitstring(
    await decompressBitstringFromTransport(extracted?.bitstring ?? ""),
  );
  const plaintext = await decryptMessageEnvelope(decodedEnvelope, bobMaterial);

  assert.equal(plaintext, "Okay, station works.");
});

test("full integration still logs plaintext and transport compression ratios", async () => {
  const { aliceMaterial, bobMaterial } = await createSessionMaterials();
  const plaintextMessage = "Meet near the side entrance after dinner so we can talk without the line getting weird.";
  const plaintextUtf8Bits = new TextEncoder().encode(plaintextMessage).length * 8;
  const wrappedPlaintextBits = __internal_encodePlaintextPayload(plaintextMessage).length * 8;

  const envelope = await encryptMessageEnvelope(plaintextMessage, 17, aliceMaterial);
  const envelopeBitstring = serializeEnvelopeToBitstring(envelope);
  const compressedTransport = await compressBitstringForTransport(envelopeBitstring);
  const submittedText = appendInvisiblePayload("Dinner plans are easier if we keep it low key tonight.", compressedTransport.bitstring);
  const extracted = extractInvisiblePayload(submittedText);
  const decodedEnvelope = deserializeEnvelopeFromBitstring(
    await decompressBitstringFromTransport(extracted?.bitstring ?? ""),
  );
  const decryptedPlaintext = await decryptMessageEnvelope(decodedEnvelope, bobMaterial);
  assert.equal(decryptedPlaintext, plaintextMessage);

  console.log(
    [
      "full-integration-ratios",
      `plaintextUtf8Bits=${plaintextUtf8Bits}`,
      `wrappedPlaintextBits=${wrappedPlaintextBits}`,
      `plaintextCompressionRatio=${(wrappedPlaintextBits / plaintextUtf8Bits).toFixed(3)}`,
      `envelopeBits=${envelopeBitstring.length}`,
      `transportBits=${compressedTransport.bitstring.length}`,
      `transportCompressionRatio=${(compressedTransport.bitstring.length / envelopeBitstring.length).toFixed(3)}`,
      `transportFormat=${compressedTransport.format}`,
      `visibleChars=${extracted?.visibleText.length ?? 0}`,
      `submittedChars=${submittedText.length}`,
    ].join(" | "),
  );
});

test("ordinary visible text without a suffix does not decode", () => {
  assert.equal(extractInvisiblePayload("Just normal cover text here."), null);
});

test("final submitted text stays under Discord's hard cap for a short message", async () => {
  const { aliceMaterial } = await createSessionMaterials();
  const envelope = await encryptMessageEnvelope("a", 12, aliceMaterial);
  const bitstring = await compressBitstringForTransport(serializeEnvelopeToBitstring(envelope));
  const submittedText = appendInvisiblePayload("Still good on my end.", bitstring.bitstring);

  assert.ok(submittedText.length <= 2000, `submitted text exceeded Discord's hard cap: ${submittedText.length}`);
});

async function createSessionMaterials() {
  const alice = await generateIdentityBundle();
  const bob = await generateIdentityBundle();

  const aliceMaterial: SessionCryptoMaterial = {
    sessionId: "session-integration",
    threadId: "thread-integration",
    localParticipantId: "alice",
    counterpartParticipantId: "bob",
    localTransportPrivateKey: alice.transportPrivateKey,
    counterpartTransportPublicKey: bob.transportPublicKey,
  };
  const bobMaterial: SessionCryptoMaterial = {
    sessionId: "session-integration",
    threadId: "thread-integration",
    localParticipantId: "bob",
    counterpartParticipantId: "alice",
    localTransportPrivateKey: bob.transportPrivateKey,
    counterpartTransportPublicKey: alice.transportPublicKey,
  };

  return { aliceMaterial, bobMaterial };
}
