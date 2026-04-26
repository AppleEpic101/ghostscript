import sodium from "libsodium-wrappers-sumo";
import type { MessageEnvelope } from "@ghostscript/shared";

const ENVELOPE_VERSION = 1 as const;
const WRAPPED_IDENTITY_VERSION = 1 as const;
const BASE64_VARIANT = sodium.base64_variants.URLSAFE_NO_PADDING;

export interface SessionCryptoMaterial {
  sessionId: string;
  threadId: string;
  localParticipantId: string;
  counterpartParticipantId: string;
  localTransportPrivateKey: string;
  counterpartTransportPublicKey: string;
}

export interface LocalIdentityBundle {
  transportPublicKey: string;
  transportPrivateKey: string;
  signingPublicKey: string;
  signingPrivateKey: string;
  identityFingerprint: string;
}

export interface WrappedIdentityBundle {
  version: 1;
  transportPublicKey: string;
  signingPublicKey: string;
  identityFingerprint: string;
  wrapSalt: string;
  wrapNonce: string;
  wrappedKeyMaterial: string;
}

export interface PublicIdentityBundle {
  transportPublicKey: string;
  signingPublicKey: string;
  identityFingerprint: string;
}

export async function generateIdentityBundle(): Promise<LocalIdentityBundle> {
  const sodiumInstance = await getSodium();
  const transportKeys = sodiumInstance.crypto_box_keypair();
  const signingKeys = sodiumInstance.crypto_sign_keypair();
  const identityFingerprint = sodiumInstance.to_hex(
    sodiumInstance.crypto_generichash(16, signingKeys.publicKey, null),
  );

  return {
    transportPublicKey: toBase64(transportKeys.publicKey),
    transportPrivateKey: toBase64(transportKeys.privateKey),
    signingPublicKey: toBase64(signingKeys.publicKey),
    signingPrivateKey: toBase64(signingKeys.privateKey),
    identityFingerprint,
  };
}

export function toPublicIdentity(bundle: LocalIdentityBundle): PublicIdentityBundle {
  return {
    transportPublicKey: bundle.transportPublicKey,
    signingPublicKey: bundle.signingPublicKey,
    identityFingerprint: bundle.identityFingerprint,
  };
}

export async function createWrappingSecret() {
  const sodiumInstance = await getSodium();
  return toBase64(sodiumInstance.randombytes_buf(32));
}

export async function wrapIdentityBundle(
  bundle: LocalIdentityBundle,
  wrappingSecret: string,
): Promise<WrappedIdentityBundle> {
  const sodiumInstance = await getSodium();
  const salt = sodiumInstance.randombytes_buf(sodiumInstance.crypto_pwhash_SALTBYTES);
  const nonce = sodiumInstance.randombytes_buf(sodiumInstance.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const wrappingKey = sodiumInstance.crypto_pwhash(
    sodiumInstance.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
    wrappingSecret,
    salt,
    sodiumInstance.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodiumInstance.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodiumInstance.crypto_pwhash_ALG_ARGON2ID13,
  );

  try {
    const plaintext = new TextEncoder().encode(
      JSON.stringify({
        transportPrivateKey: bundle.transportPrivateKey,
        signingPrivateKey: bundle.signingPrivateKey,
      }),
    );
    const additionalData = new TextEncoder().encode(`ghostscript.identity.v${WRAPPED_IDENTITY_VERSION}`);
    const ciphertext = sodiumInstance.crypto_aead_xchacha20poly1305_ietf_encrypt(
      plaintext,
      additionalData,
      null,
      nonce,
      wrappingKey,
    );

    return {
      version: WRAPPED_IDENTITY_VERSION,
      transportPublicKey: bundle.transportPublicKey,
      signingPublicKey: bundle.signingPublicKey,
      identityFingerprint: bundle.identityFingerprint,
      wrapSalt: toBase64(salt),
      wrapNonce: toBase64(nonce),
      wrappedKeyMaterial: toBase64(ciphertext),
    };
  } finally {
    sodiumInstance.memzero(wrappingKey);
  }
}

export async function unwrapIdentityBundle(
  wrappedIdentity: WrappedIdentityBundle,
  wrappingSecret: string,
): Promise<LocalIdentityBundle> {
  const sodiumInstance = await getSodium();
  const wrappingKey = sodiumInstance.crypto_pwhash(
    sodiumInstance.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
    wrappingSecret,
    fromBase64(wrappedIdentity.wrapSalt),
    sodiumInstance.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodiumInstance.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodiumInstance.crypto_pwhash_ALG_ARGON2ID13,
  );

  try {
    const additionalData = new TextEncoder().encode(`ghostscript.identity.v${wrappedIdentity.version}`);
    const plaintext = sodiumInstance.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      fromBase64(wrappedIdentity.wrappedKeyMaterial),
      additionalData,
      fromBase64(wrappedIdentity.wrapNonce),
      wrappingKey,
    );
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as {
      transportPrivateKey?: string;
      signingPrivateKey?: string;
    };

    if (!parsed.transportPrivateKey || !parsed.signingPrivateKey) {
      throw new Error("Wrapped identity record is missing private-key material.");
    }

    return {
      transportPublicKey: wrappedIdentity.transportPublicKey,
      transportPrivateKey: parsed.transportPrivateKey,
      signingPublicKey: wrappedIdentity.signingPublicKey,
      signingPrivateKey: parsed.signingPrivateKey,
      identityFingerprint: wrappedIdentity.identityFingerprint,
    };
  } finally {
    sodiumInstance.memzero(wrappingKey);
  }
}

export async function encryptMessageEnvelope(
  plaintext: string,
  msgId: number,
  material: SessionCryptoMaterial,
): Promise<MessageEnvelope> {
  const sodiumInstance = await getSodium();
  const { key, nonce } = await deriveDirectionalSecrets(
    material,
    material.localParticipantId,
    material.counterpartParticipantId,
    msgId,
  );
  const additionalData = encodeAdditionalData(
    material.threadId,
    material.localParticipantId,
    material.counterpartParticipantId,
    msgId,
  );

  try {
    const ciphertext = sodiumInstance.crypto_aead_xchacha20poly1305_ietf_encrypt(
      new TextEncoder().encode(plaintext),
      additionalData,
      null,
      nonce,
      key,
    );

    return {
      v: ENVELOPE_VERSION,
      senderId: material.localParticipantId,
      msgId,
      ciphertext: toBase64(ciphertext),
    };
  } finally {
    sodiumInstance.memzero(key);
  }
}

export async function decryptMessageEnvelope(
  envelope: MessageEnvelope,
  material: SessionCryptoMaterial,
): Promise<string> {
  const sodiumInstance = await getSodium();
  const senderId = envelope.senderId;
  if (senderId !== material.counterpartParticipantId && senderId !== material.localParticipantId) {
    throw new Error("Envelope sender does not match the active Ghostscript pairing.");
  }

  const { key, nonce } = await deriveDirectionalSecrets(material, senderId, material.localParticipantId, envelope.msgId);
  const additionalData = encodeAdditionalData(material.threadId, senderId, material.localParticipantId, envelope.msgId);

  try {
    const plaintext = sodiumInstance.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      fromBase64(envelope.ciphertext),
      additionalData,
      nonce,
      key,
    );

    return new TextDecoder().decode(plaintext);
  } finally {
    sodiumInstance.memzero(key);
  }
}

async function deriveDirectionalSecrets(
  material: SessionCryptoMaterial,
  senderId: string,
  recipientId: string,
  msgId: number,
) {
  const rootKey = await deriveConversationRootKey(material);
  const key = await hkdfSha256(
    rootKey,
    `ghostscript:key:${senderId}->${recipientId}`,
    "xchacha20poly1305",
    32,
  );
  const nonceBase = await hkdfSha256(
    rootKey,
    `ghostscript:nonce:${senderId}->${recipientId}`,
    "xchacha20poly1305",
    24,
  );

  return {
    key,
    nonce: deriveNonceFromBase(nonceBase, msgId),
  };
}

async function deriveConversationRootKey(material: SessionCryptoMaterial) {
  const sodiumInstance = await getSodium();
  const sharedSecret = sodiumInstance.crypto_scalarmult(
    fromBase64(material.localTransportPrivateKey),
    fromBase64(material.counterpartTransportPublicKey),
  );

  return hkdfSha256(
    sharedSecret,
    `ghostscript:session:${material.sessionId}`,
    `thread:${material.threadId}|participants:${[material.localParticipantId, material.counterpartParticipantId]
      .sort()
      .join("|")}`,
    32,
  );
}

function deriveNonceFromBase(nonceBase: Uint8Array, msgId: number) {
  const nonce = nonceBase.slice(0, 24);
  const counter = new Uint8Array(8);
  const view = new DataView(counter.buffer);
  view.setBigUint64(0, BigInt(msgId));
  nonce.set(counter, 16);
  return nonce;
}

async function hkdfSha256(inputKeyMaterial: Uint8Array, salt: string, info: string, length: number) {
  const baseKey = await crypto.subtle.importKey("raw", toBufferSource(inputKeyMaterial), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(salt),
      info: new TextEncoder().encode(info),
    },
    baseKey,
    length * 8,
  );

  return new Uint8Array(bits);
}

function toBufferSource(bytes: Uint8Array) {
  return Uint8Array.from(bytes);
}

function encodeAdditionalData(threadId: string, senderId: string, recipientId: string, msgId: number) {
  return new TextEncoder().encode(`ghostscript:v${ENVELOPE_VERSION}:${threadId}:${senderId}:${recipientId}:${msgId}`);
}

function toBase64(input: Uint8Array) {
  return sodium.to_base64(input, BASE64_VARIANT);
}

function fromBase64(input: string) {
  return sodium.from_base64(input, BASE64_VARIANT);
}

async function getSodium() {
  await sodium.ready;
  return sodium;
}
