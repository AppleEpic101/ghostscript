import nacl from "tweetnacl";
import { deflateSync, inflateSync } from "fflate";
import type { MessageEnvelope } from "@ghostscript/shared";
import { logGhostscriptDebug } from "./debugLog";

const ENVELOPE_VERSION = 1 as const;
const WRAPPED_IDENTITY_VERSION = 1 as const;
const WRAP_IV_BYTES = 12;
const PLAINTEXT_PAYLOAD_MAGIC = "GSCP1";
const PLAINTEXT_FORMAT_RAW = 0;
const PLAINTEXT_FORMAT_DEFLATE = 1;

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
  const transportKeys = nacl.box.keyPair();
  const signingKeys = nacl.sign.keyPair();
  const identityFingerprint = toHex(
    await sha256(signingKeys.publicKey),
  ).slice(0, 32);

  return {
    transportPublicKey: toBase64(transportKeys.publicKey),
    transportPrivateKey: toBase64(transportKeys.secretKey),
    signingPublicKey: toBase64(signingKeys.publicKey),
    signingPrivateKey: toBase64(signingKeys.secretKey),
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
  return toBase64(randomBytes(32));
}

export async function wrapIdentityBundle(
  bundle: LocalIdentityBundle,
  wrappingSecret: string,
): Promise<WrappedIdentityBundle> {
  const salt = randomBytes(16);
  const nonce = randomBytes(WRAP_IV_BYTES);
  const wrappingKey = await derivePbkdf2Key(wrappingSecret, salt, ["encrypt"]);
  const plaintext = new TextEncoder().encode(
    JSON.stringify({
      transportPrivateKey: bundle.transportPrivateKey,
      signingPrivateKey: bundle.signingPrivateKey,
    }),
  );
  const additionalData = new TextEncoder().encode(`ghostscript.identity.v${WRAPPED_IDENTITY_VERSION}`);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData,
      tagLength: 128,
    },
    wrappingKey,
    plaintext,
  );

  return {
    version: WRAPPED_IDENTITY_VERSION,
    transportPublicKey: bundle.transportPublicKey,
    signingPublicKey: bundle.signingPublicKey,
    identityFingerprint: bundle.identityFingerprint,
    wrapSalt: toBase64(salt),
    wrapNonce: toBase64(nonce),
    wrappedKeyMaterial: arrayBufferToBase64(ciphertext),
  };
}

export async function unwrapIdentityBundle(
  wrappedIdentity: WrappedIdentityBundle,
  wrappingSecret: string,
): Promise<LocalIdentityBundle> {
  const wrappingKey = await derivePbkdf2Key(wrappingSecret, fromBase64(wrappedIdentity.wrapSalt), ["decrypt"]);
  const additionalData = new TextEncoder().encode(`ghostscript.identity.v${wrappedIdentity.version}`);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64(wrappedIdentity.wrapNonce),
      additionalData,
      tagLength: 128,
    },
    wrappingKey,
    base64ToArrayBuffer(wrappedIdentity.wrappedKeyMaterial),
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
}

export async function encryptMessageEnvelope(
  plaintext: string,
  msgId: number,
  material: SessionCryptoMaterial,
  options?: {
    legacyPayloadEncoding?: boolean;
  },
): Promise<MessageEnvelope> {
  logGhostscriptDebug("crypto", "encrypt-start", {
    sessionId: material.sessionId,
    threadId: material.threadId,
    senderId: material.localParticipantId,
    recipientId: material.counterpartParticipantId,
    msgId,
    plaintext,
    plaintextLength: plaintext.length,
  });
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
  const cryptoKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const encodedPlaintext = options?.legacyPayloadEncoding
    ? new TextEncoder().encode(plaintext)
    : encodePlaintextPayload(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData,
      tagLength: 128,
    },
    cryptoKey,
    encodedPlaintext,
  );

  const envelope = {
    v: ENVELOPE_VERSION,
    senderId: material.localParticipantId,
    msgId,
    ciphertext: arrayBufferToBase64(ciphertext),
  };

  logGhostscriptDebug("crypto", "encrypt-complete", {
    sessionId: material.sessionId,
    threadId: material.threadId,
    senderId: material.localParticipantId,
    recipientId: material.counterpartParticipantId,
    msgId,
    ciphertextLength: envelope.ciphertext.length,
    payloadEncoding: options?.legacyPayloadEncoding ? "legacy-raw-utf8" : "compressed-default",
  });

  return envelope;
}

export async function decryptMessageEnvelope(
  envelope: MessageEnvelope,
  material: SessionCryptoMaterial,
): Promise<string> {
  const senderId = envelope.senderId;
  if (senderId !== material.counterpartParticipantId && senderId !== material.localParticipantId) {
    throw new Error("Envelope sender does not match the active Ghostscript pairing.");
  }

  logGhostscriptDebug("crypto", "decrypt-start", {
    sessionId: material.sessionId,
    threadId: material.threadId,
    senderId,
    recipientId: material.localParticipantId,
    msgId: envelope.msgId,
    ciphertextLength: envelope.ciphertext.length,
  });

  try {
    const { key, nonce } = await deriveDirectionalSecrets(material, senderId, material.localParticipantId, envelope.msgId);
    const additionalData = encodeAdditionalData(material.threadId, senderId, material.localParticipantId, envelope.msgId);
    const cryptoKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData,
        tagLength: 128,
      },
      cryptoKey,
      base64ToArrayBuffer(envelope.ciphertext),
    );
    const decodedPlaintext = decodePlaintextPayload(new Uint8Array(plaintext));

    logGhostscriptDebug("crypto", "decrypt-complete", {
      sessionId: material.sessionId,
      threadId: material.threadId,
      senderId,
      recipientId: material.localParticipantId,
      msgId: envelope.msgId,
      plaintext: decodedPlaintext,
      plaintextLength: decodedPlaintext.length,
    });

    return decodedPlaintext;
  } catch (error) {
    logGhostscriptDebug("crypto", "decrypt-failed", {
      sessionId: material.sessionId,
      threadId: material.threadId,
      senderId,
      recipientId: material.localParticipantId,
      msgId: envelope.msgId,
      error: error instanceof Error ? error.message : "Unknown decrypt failure.",
    });
    throw error;
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
    "aes-gcm",
    32,
  );
  const nonceBase = await hkdfSha256(
    rootKey,
    `ghostscript:nonce:${senderId}->${recipientId}`,
    "aes-gcm",
    12,
  );

  return {
    key,
    nonce: deriveNonceFromBase(nonceBase, msgId),
  };
}

async function deriveConversationRootKey(material: SessionCryptoMaterial) {
  const sharedSecret = nacl.scalarMult(
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
  const nonce = Uint8Array.from(nonceBase);
  const counter = new Uint8Array(nonce.length);
  const view = new DataView(counter.buffer);

  if (nonce.length >= 8) {
    view.setBigUint64(nonce.length - 8, BigInt(msgId));
  }

  return xorBytes(nonce, counter);
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

async function derivePbkdf2Key(secret: string, salt: Uint8Array, usages: KeyUsage[]) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toBufferSource(salt),
      iterations: 210_000,
      hash: "SHA-256",
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    usages,
  );
}

async function sha256(input: Uint8Array) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", toBufferSource(input)));
}

function encodeAdditionalData(threadId: string, senderId: string, recipientId: string, msgId: number) {
  return new TextEncoder().encode(`ghostscript:v${ENVELOPE_VERSION}:${threadId}:${senderId}:${recipientId}:${msgId}`);
}

export function __internal_encodePlaintextPayload(plaintext: string) {
  return encodePlaintextPayload(plaintext);
}

export function __internal_decodePlaintextPayload(bytes: Uint8Array) {
  return decodePlaintextPayload(bytes);
}

function xorBytes(left: Uint8Array, right: Uint8Array) {
  const output = new Uint8Array(left.length);
  for (let index = 0; index < left.length; index += 1) {
    output[index] = left[index] ^ (right[index] ?? 0);
  }
  return output;
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toBase64(input: Uint8Array) {
  let binary = "";
  for (const value of input) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary);
}

function fromBase64(input: string) {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  return toBase64(new Uint8Array(buffer));
}

function base64ToArrayBuffer(value: string) {
  return fromBase64(value).buffer;
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function toBufferSource(bytes: Uint8Array) {
  return Uint8Array.from(bytes);
}

function encodePlaintextPayload(plaintext: string) {
  const rawBytes = new TextEncoder().encode(plaintext);
  const rawWrapped = wrapPlaintextPayload(PLAINTEXT_FORMAT_RAW, rawBytes);
  const deflatedWrapped = wrapPlaintextPayload(PLAINTEXT_FORMAT_DEFLATE, deflateSync(rawBytes));
  return deflatedWrapped.length < rawWrapped.length ? deflatedWrapped : rawWrapped;
}

function decodePlaintextPayload(bytes: Uint8Array) {
  if (!hasPlaintextPayloadMagic(bytes)) {
    return new TextDecoder().decode(bytes);
  }

  const format = bytes[PLAINTEXT_PAYLOAD_MAGIC.length];
  const payload = bytes.slice(PLAINTEXT_PAYLOAD_MAGIC.length + 1);
  const decodedBytes = format === PLAINTEXT_FORMAT_DEFLATE
    ? inflateSync(payload)
    : format === PLAINTEXT_FORMAT_RAW
      ? payload
      : fail("Unknown Ghostscript plaintext payload format.");

  return new TextDecoder().decode(decodedBytes);
}

function wrapPlaintextPayload(format: number, payload: Uint8Array) {
  const magicBytes = new TextEncoder().encode(PLAINTEXT_PAYLOAD_MAGIC);
  const output = new Uint8Array(magicBytes.length + 1 + payload.length);
  output.set(magicBytes, 0);
  output[magicBytes.length] = format;
  output.set(payload, magicBytes.length + 1);
  return output;
}

function hasPlaintextPayloadMagic(bytes: Uint8Array) {
  const magicBytes = new TextEncoder().encode(PLAINTEXT_PAYLOAD_MAGIC);
  if (bytes.length < magicBytes.length + 1) {
    return false;
  }

  for (let index = 0; index < magicBytes.length; index += 1) {
    if (bytes[index] !== magicBytes[index]) {
      return false;
    }
  }

  return true;
}

function fail(message: string): never {
  throw new Error(message);
}
