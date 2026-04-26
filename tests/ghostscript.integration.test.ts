import test from "node:test";
import assert from "node:assert/strict";
import {
  decryptMessageEnvelope,
  encryptMessageEnvelope,
  generateIdentityBundle,
  type SessionCryptoMaterial,
} from "../apps/extension/src/lib/crypto";
import {
  deserializeEnvelopeFromBitstring,
  serializeEnvelopeToBitstring,
} from "../apps/extension/src/lib/bitstream";
import {
  decodeRankedTextToBitstring,
  encodeBitstringAsRankedText,
} from "../apps/ghostscript-api/src/transport";

test("encrypted envelopes survive rank-selection transport end to end", async () => {
  const alice = await generateIdentityBundle();
  const bob = await generateIdentityBundle();
  const prompt = [
    "Cover text topic: weekend plans and coffee shops",
    "Respond to this message in about 20 words.",
    "Alice: are you still free later?",
    "Bob: probably, depends on how late the line is near the station",
  ].join("\n");

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

  const envelope = await encryptMessageEnvelope("Okay, station works.", 11, aliceMaterial);
  const bitstring = serializeEnvelopeToBitstring(envelope);
  const visibleText = encodeBitstringAsRankedText({
    prompt,
    bitstring,
    wordTarget: 20,
  });
  const decodedBitstring = decodeRankedTextToBitstring({
    prompt,
    visibleText,
  });

  assert.equal(decodedBitstring, bitstring);

  const decodedEnvelope = deserializeEnvelopeFromBitstring(decodedBitstring ?? "");
  const plaintext = await decryptMessageEnvelope(decodedEnvelope, bobMaterial);

  assert.equal(plaintext, "Okay, station works.");
});
