import sodiumModule from "libsodium-wrappers-sumo";
import { decompressSync, zlibSync } from "fflate";
import type { IdentityKey, MessageEnvelope, PublicKeyBundle } from "@ghostscript/shared";
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  concatBytes,
  hexToBytes,
  uint32ToBytes,
  utf8Decode,
  utf8Encode,
} from "./bytes";

const WRAP_KEY_BYTES = 32;
const NONCE_BYTES = 24;
const MESSAGE_KEY_BYTES = 32;
const HKDF_TOTAL_BYTES = MESSAGE_KEY_BYTES + NONCE_BYTES;

type SodiumModule = typeof sodiumModule;

export interface GeneratedIdentityRecord {
  identity: IdentityKey;
  publicKey: PublicKeyBundle;
}

export interface StoredIdentityRecord {
  identity: IdentityKey;
}

export interface UnlockedIdentityRecord {
  identity: IdentityKey;
  privateKey: string;
}

export interface SessionSecrets {
  messageKey: Uint8Array;
  nonceBase: Uint8Array;
}

export interface EncryptTextOptions {
  messageKey: Uint8Array;
  nonceBase: Uint8Array;
  plaintext: string;
  msgId: number;
  senderId: string;
}

export interface DecryptTextOptions {
  envelope: MessageEnvelope;
  messageKey: Uint8Array;
  nonceBase: Uint8Array;
}

let sodiumPromise: Promise<SodiumModule> | null = null;

async function getSodium() {
  if (!sodiumPromise) {
    sodiumPromise = (async () => {
      await sodiumModule.ready;
      return sodiumModule;
    })();
  }

  return sodiumPromise;
}

export async function generateIdentity(passphrase: string): Promise<GeneratedIdentityRecord> {
  const sodium = await getSodium();
  const keypair = sodium.crypto_sign_keypair();
  const publicKey = keypair.publicKey;
  const secretKey = keypair.privateKey;
  const wrapSalt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const wrapKey = sodium.crypto_pwhash(
    WRAP_KEY_BYTES,
    passphrase,
    wrapSalt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  const wrapNonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const wrappedPrivateKey = sodium.crypto_secretbox_easy(secretKey, wrapNonce, wrapKey);
  sodium.memzero(wrapKey);

  const fingerprint = await formatFingerprint(publicKey);
  const senderId = toSenderId(fingerprint);
  const createdAt = new Date().toISOString();

  return {
    identity: {
      id: `identity_${senderId.replace(":", "_")}`,
      algorithm: "Ed25519",
      publicKey: bytesToBase64(publicKey),
      fingerprint,
      senderId,
      createdAt,
      wrappedPrivateKey: bytesToBase64(wrappedPrivateKey),
      wrapSalt: bytesToBase64(wrapSalt),
      wrapNonce: bytesToBase64(wrapNonce),
    },
    publicKey: {
      keyId: `key_${senderId.replace(":", "_")}`,
      algorithm: "Ed25519",
      publicKey: bytesToBase64(publicKey),
      fingerprint,
      createdAt,
    },
  };
}

export async function unwrapIdentityPrivateKey(
  identity: IdentityKey,
  passphrase: string,
): Promise<UnlockedIdentityRecord> {
  if (!identity.wrappedPrivateKey || !identity.wrapSalt || !identity.wrapNonce) {
    throw new Error("Identity record is missing wrapped key material.");
  }

  const sodium = await getSodium();
  const wrapKey = sodium.crypto_pwhash(
    WRAP_KEY_BYTES,
    passphrase,
    base64ToBytes(identity.wrapSalt),
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  const privateKey = sodium.crypto_secretbox_open_easy(
    base64ToBytes(identity.wrappedPrivateKey),
    base64ToBytes(identity.wrapNonce),
    wrapKey,
  );
  sodium.memzero(wrapKey);

  if (!privateKey) {
    throw new Error("Incorrect passphrase.");
  }

  return {
    identity,
    privateKey: bytesToBase64(privateKey),
  };
}

export async function deriveSessionSecrets(
  privateKeyBase64: string,
  peerPublicKeyBase64: string,
  fingerprintA: string,
  fingerprintB: string,
): Promise<SessionSecrets> {
  const sodium = await getSodium();
  const curvePrivateKey = sodium.crypto_sign_ed25519_sk_to_curve25519(base64ToBytes(privateKeyBase64));
  const curvePublicKey = sodium.crypto_sign_ed25519_pk_to_curve25519(base64ToBytes(peerPublicKeyBase64));
  const sharedSecret = sodium.crypto_scalarmult(curvePrivateKey, curvePublicKey);
  const hkdfSalt = await sha256Bytes(utf8Encode([fingerprintA, fingerprintB].sort().join(":")));
  const derived = await hkdfSha256(sharedSecret, hkdfSalt, utf8Encode("ghostscript-text-v1"), HKDF_TOTAL_BYTES);

  return {
    messageKey: derived.slice(0, MESSAGE_KEY_BYTES),
    nonceBase: derived.slice(MESSAGE_KEY_BYTES),
  };
}

export async function encryptTextMessage(
  options: EncryptTextOptions,
): Promise<MessageEnvelope> {
  const sodium = await getSodium();
  const plaintextBytes = utf8Encode(options.plaintext);
  const shouldCompress = plaintextBytes.length > 64;
  const payloadBody = shouldCompress ? zlibSync(plaintextBytes) : plaintextBytes;
  const payload = new Uint8Array(payloadBody.length + 1);
  payload[0] = shouldCompress ? 1 : 0;
  payload.set(payloadBody, 1);

  const nonce = deriveMessageNonce(options.nonceBase, options.msgId);
  const combined = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    payload,
    null,
    null,
    nonce,
    options.messageKey,
  );
  const ct = combined.slice(0, combined.length - 16);
  const tag = combined.slice(combined.length - 16);

  return {
    v: 1,
    senderId: options.senderId,
    msgId: options.msgId,
    codec: "base16-zero-width-v1",
    tag: bytesToHex(tag),
    ct: bytesToHex(ct),
  };
}

export async function decryptTextMessage(
  options: DecryptTextOptions,
): Promise<string> {
  const sodium = await getSodium();
  const nonce = deriveMessageNonce(options.nonceBase, options.envelope.msgId);
  const combined = concatBytes([hexToBytes(options.envelope.ct), hexToBytes(options.envelope.tag)]);
  const payload = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    combined,
    null,
    nonce,
    options.messageKey,
  );

  if (!payload || payload.length === 0) {
    throw new Error("Unable to decrypt message.");
  }

  const isCompressed = payload[0] === 1;
  const body = payload.slice(1);
  const plaintextBytes = isCompressed ? decompressSync(body) : body;
  return utf8Decode(plaintextBytes);
}

export async function formatFingerprint(publicKey: Uint8Array) {
  const digest = await sha256Bytes(publicKey);
  return bytesToHex(digest.slice(0, 8))
    .toUpperCase()
    .match(/.{1,4}/g)
    ?.join(" ") ?? "";
}

export function toSenderId(fingerprint: string) {
  return `ed25519:${fingerprint.replace(/\s+/g, "").toLowerCase().slice(0, 8)}`;
}

function deriveMessageNonce(nonceBase: Uint8Array, msgId: number) {
  const nonce = nonceBase.slice(0, NONCE_BYTES);
  nonce.set(uint32ToBytes(msgId), NONCE_BYTES - 4);
  return nonce;
}

async function sha256Bytes(value: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(value));
  return new Uint8Array(digest);
}

async function hkdfSha256(
  keyMaterial: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  outputBytes: number,
) {
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(keyMaterial), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: normalizedBytes(salt),
      info: normalizedBytes(info),
    },
    key,
    outputBytes * 8,
  );

  return new Uint8Array(bits);
}

function normalizedBytes(value: Uint8Array) {
  return new Uint8Array(value);
}

function toArrayBuffer(value: Uint8Array) {
  return normalizedBytes(value).buffer;
}
