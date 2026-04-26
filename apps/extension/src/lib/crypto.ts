import type { MessageEnvelope } from "@ghostscript/shared";

const ENVELOPE_VERSION = 1 as const;

export interface SessionCryptoMaterial {
  sessionId: string;
  localParticipantId: string;
  counterpartParticipantId: string;
  localPrivateKey: string;
  counterpartPublicKey: string;
}

export interface GeneratedIdentityKeypair {
  publicKey: string;
  privateKey: string;
}

export async function generateIdentityKeypair(): Promise<GeneratedIdentityKeypair> {
  const keypair = await crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    ["deriveBits"],
  );

  return {
    publicKey: arrayBufferToBase64(await crypto.subtle.exportKey("spki", keypair.publicKey)),
    privateKey: arrayBufferToBase64(await crypto.subtle.exportKey("pkcs8", keypair.privateKey)),
  };
}

export async function encryptMessageEnvelope(
  plaintext: string,
  msgId: number,
  material: SessionCryptoMaterial,
): Promise<MessageEnvelope> {
  const sharedSecret = await deriveSharedSecret(material.localPrivateKey, material.counterpartPublicKey);
  const keyBytes = await deriveSubkey(sharedSecret, `${material.sessionId}:payload-key`, 32);
  const nonce = await deriveSubkey(sharedSecret, `${material.sessionId}:nonce:${msgId}`, 12);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const additionalData = new TextEncoder().encode(
    `${ENVELOPE_VERSION}:${material.localParticipantId}:${material.counterpartParticipantId}:${msgId}`,
  );

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData,
      tagLength: 128,
    },
    key,
    new TextEncoder().encode(plaintext),
  );

  return {
    v: ENVELOPE_VERSION,
    senderId: material.localParticipantId,
    msgId,
    nonce: arrayBufferToBase64(nonce.buffer),
    ciphertext: arrayBufferToBase64(ciphertext),
    payloadBitLength: ciphertext.byteLength * 8,
  };
}

export async function decryptMessageEnvelope(
  envelope: MessageEnvelope,
  material: SessionCryptoMaterial,
): Promise<string> {
  const sharedSecret = await deriveSharedSecret(material.localPrivateKey, material.counterpartPublicKey);
  const keyBytes = await deriveSubkey(sharedSecret, `${material.sessionId}:payload-key`, 32);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  const additionalData = new TextEncoder().encode(
    `${envelope.v}:${envelope.senderId}:${material.localParticipantId}:${envelope.msgId}`,
  );

  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToUint8Array(envelope.nonce),
      additionalData,
      tagLength: 128,
    },
    key,
    base64ToUint8Array(envelope.ciphertext),
  );

  return new TextDecoder().decode(plaintext);
}

async function deriveSharedSecret(localPrivateKey: string, counterpartPublicKey: string) {
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    base64ToArrayBuffer(localPrivateKey),
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    false,
    ["deriveBits"],
  );
  const publicKey = await crypto.subtle.importKey(
    "spki",
    base64ToArrayBuffer(counterpartPublicKey),
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    false,
    [],
  );

  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "ECDH",
        public: publicKey,
      },
      privateKey,
      256,
    ),
  );
}

async function deriveSubkey(sharedSecret: Uint8Array, label: string, length: number) {
  const digest = await crypto.subtle.digest("SHA-256", concatenateBytes(sharedSecret, new TextEncoder().encode(label)));
  return new Uint8Array(digest).slice(0, length);
}

function concatenateBytes(left: Uint8Array, right: Uint8Array) {
  const output = new Uint8Array(left.length + right.length);
  output.set(left, 0);
  output.set(right, left.length);
  return output;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }

  return btoa(binary);
}

function base64ToArrayBuffer(value: string) {
  return base64ToUint8Array(value).buffer;
}

function base64ToUint8Array(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
