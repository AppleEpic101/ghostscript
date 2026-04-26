import test from "node:test";
import assert from "node:assert/strict";
import {
  decryptMessageEnvelope,
  encryptMessageEnvelope,
  generateIdentityBundle,
  type SessionCryptoMaterial,
} from "../apps/extension/src/lib/crypto";
import {
  compressPlaintextToLayeredRankBitstring,
  compressPlaintextToRankBitstring,
  decompressPlaintextFromLayeredRankBitstring,
  decompressPlaintextFromRankBitstring,
} from "../apps/ghostscript-api/src/plaintextRankCompression";

function createMaterials() {
  return Promise.all([generateIdentityBundle(), generateIdentityBundle()]).then(([alice, bob]) => {
    const sessionId = "session-rank-crypto";
    const threadId = "thread-rank-crypto";

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

    return { aliceMaterial, bobMaterial };
  });
}

test("rank-compressed plaintext survives encrypt/decrypt/decompress end to end", async () => {
  const plaintext = "we can keep the message short and casual.";
  const { aliceMaterial, bobMaterial } = await createMaterials();
  const compressed = compressPlaintextToRankBitstring(plaintext);

  const envelope = await encryptMessageEnvelope(compressed.bitstring, 101, aliceMaterial);
  const decryptedBitstring = await decryptMessageEnvelope(envelope, bobMaterial);
  const recoveredPlaintext = decompressPlaintextFromRankBitstring(decryptedBitstring);

  console.log(
    [
      `plaintext="${plaintext}"`,
      `compressed=${compressed.stats.compressedBitLength}b`,
      `fixedWidth=${compressed.stats.fixedWidthBitLength}b`,
      `utf8=${compressed.stats.utf8BitLength}b`,
      `vsFixed=${compressed.stats.compressedToFixedWidthRatio.toFixed(3)}`,
      `vsUtf8=${compressed.stats.compressedToUtf8Ratio.toFixed(3)}`,
    ].join(" | "),
  );

  assert.equal(recoveredPlaintext, plaintext);
});

test("rank-compressed unusual plaintext survives encrypt/decrypt with literal fallback", async () => {
  const plaintext = "Meet me at 7:45? Bring ID: ZX-81.\nThanks!";
  const { aliceMaterial, bobMaterial } = await createMaterials();
  const compressed = compressPlaintextToRankBitstring(plaintext);

  const envelope = await encryptMessageEnvelope(compressed.bitstring, 102, aliceMaterial);
  const decryptedBitstring = await decryptMessageEnvelope(envelope, bobMaterial);
  const recoveredPlaintext = decompressPlaintextFromRankBitstring(decryptedBitstring);

  console.log(
    [
      `plaintext="${plaintext.replace("\n", "\\n")}"`,
      `compressed=${compressed.stats.compressedBitLength}b`,
      `fixedWidth=${compressed.stats.fixedWidthBitLength}b`,
      `utf8=${compressed.stats.utf8BitLength}b`,
      `vsFixed=${compressed.stats.compressedToFixedWidthRatio.toFixed(3)}`,
      `vsUtf8=${compressed.stats.compressedToUtf8Ratio.toFixed(3)}`,
      `literal=${compressed.stats.literalCount}`,
    ].join(" | "),
  );

  assert.ok(compressed.stats.literalCount > 0);
  assert.equal(recoveredPlaintext, plaintext);
});

test("rank-compressed plaintext with traditional bit compression survives encrypt/decrypt end to end", async () => {
  const plaintext = "the coffee place near the station is still open.";
  const { aliceMaterial, bobMaterial } = await createMaterials();
  const compressed = compressPlaintextToLayeredRankBitstring(plaintext);

  const envelope = await encryptMessageEnvelope(compressed.traditionalCompression.base64, 103, aliceMaterial);
  const decryptedBase64 = await decryptMessageEnvelope(envelope, bobMaterial);
  const recoveredPlaintext = decompressPlaintextFromLayeredRankBitstring(decryptedBase64);

  console.log(
    [
      `plaintext="${plaintext}"`,
      `rankOnly=${compressed.stats.compressedBitLength}b`,
      `layered=${compressed.traditionalCompression.framedBitLength}b`,
      `layerFormat=${compressed.traditionalCompression.format}`,
      `layerVsRank=${compressed.traditionalCompression.ratioVsRankBitstring.toFixed(3)}`,
      `fixedWidth=${compressed.stats.fixedWidthBitLength}b`,
      `utf8=${compressed.stats.utf8BitLength}b`,
    ].join(" | "),
  );

  assert.equal(recoveredPlaintext, plaintext);
});
