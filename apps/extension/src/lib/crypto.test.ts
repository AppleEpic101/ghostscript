import test from "node:test";
import assert from "node:assert/strict";
import {
  createWrappingSecret,
  decryptMessageEnvelope,
  encryptMessageEnvelope,
  generateIdentityBundle,
  type SessionCryptoMaterial,
  unwrapIdentityBundle,
  wrapIdentityBundle,
} from "./crypto";

test("wrapped identities roundtrip through argon2id-based local storage wrapping", async () => {
  const identity = await generateIdentityBundle();
  const wrappingSecret = await createWrappingSecret();
  const wrapped = await wrapIdentityBundle(identity, wrappingSecret);
  const unwrapped = await unwrapIdentityBundle(wrapped, wrappingSecret);

  assert.deepEqual(unwrapped, identity);
});

test("x25519 + hkdf + xchacha20poly1305 envelopes decrypt across both peers", async () => {
  const alice = await generateIdentityBundle();
  const bob = await generateIdentityBundle();
  const sessionId = "session-1";
  const threadId = "thread-1";

  const aliceMaterial: SessionCryptoMaterial = {
    sessionId,
    threadId,
    localParticipantId: "alice",
    counterpartParticipantId: "bob",
    localTransportPrivateKey: alice.transportPrivateKey,
    counterpartTransportPublicKey: bob.transportPublicKey,
  };
  const bobMaterial: SessionCryptoMaterial = {
    sessionId,
    threadId,
    localParticipantId: "bob",
    counterpartParticipantId: "alice",
    localTransportPrivateKey: bob.transportPrivateKey,
    counterpartTransportPublicKey: alice.transportPublicKey,
  };

  const envelope = await encryptMessageEnvelope("Meet near the station after seven.", 7, aliceMaterial);
  const plaintext = await decryptMessageEnvelope(envelope, bobMaterial);
  const nextEnvelope = await encryptMessageEnvelope("Meet near the station after seven.", 8, aliceMaterial);

  assert.equal(plaintext, "Meet near the station after seven.");
  assert.notEqual(envelope.ciphertext, nextEnvelope.ciphertext);
});

test("tampered ciphertext fails closed", async () => {
  const alice = await generateIdentityBundle();
  const bob = await generateIdentityBundle();

  const aliceMaterial: SessionCryptoMaterial = {
    sessionId: "session-2",
    threadId: "thread-2",
    localParticipantId: "alice",
    counterpartParticipantId: "bob",
    localTransportPrivateKey: alice.transportPrivateKey,
    counterpartTransportPublicKey: bob.transportPublicKey,
  };
  const bobMaterial: SessionCryptoMaterial = {
    sessionId: "session-2",
    threadId: "thread-2",
    localParticipantId: "bob",
    counterpartParticipantId: "alice",
    localTransportPrivateKey: bob.transportPrivateKey,
    counterpartTransportPublicKey: alice.transportPublicKey,
  };

  const envelope = await encryptMessageEnvelope("The details can wait until later.", 3, aliceMaterial);
  const tamperedEnvelope = {
    ...envelope,
    ciphertext: envelope.ciphertext.slice(0, -1) + (envelope.ciphertext.endsWith("A") ? "B" : "A"),
  };

  await assert.rejects(() => decryptMessageEnvelope(tamperedEnvelope, bobMaterial));
});
