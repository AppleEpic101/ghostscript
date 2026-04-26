import type { MessageEnvelope } from "@ghostscript/shared";
import { estimateWordTarget } from "./promptBuilder";

const OUTER_LENGTH_HEADER_BITS = 32;
const VERSION_BITS = 8;
const STRING_LENGTH_BITS = 16;
const MESSAGE_ID_BITS = 32;
const CIPHERTEXT_LENGTH_BITS = 32;
const PAYLOAD_LENGTH_BITS = 32;

export function serializeEnvelopeToBitstring(envelope: MessageEnvelope) {
  const senderBytes = new TextEncoder().encode(envelope.senderId);
  const ciphertextBytes = base64ToBytes(envelope.ciphertext);
  const authTagBytes = base64ToBytes(envelope.authTag ?? "");

  const body = [
    numberToBitstring(envelope.v, VERSION_BITS),
    numberToBitstring(senderBytes.length, STRING_LENGTH_BITS),
    bytesToBitstring(senderBytes),
    numberToBitstring(envelope.msgId, MESSAGE_ID_BITS),
    numberToBitstring(ciphertextBytes.length, CIPHERTEXT_LENGTH_BITS),
    bytesToBitstring(ciphertextBytes),
    numberToBitstring(authTagBytes.length, STRING_LENGTH_BITS),
    bytesToBitstring(authTagBytes),
    numberToBitstring(envelope.payloadBitLength, PAYLOAD_LENGTH_BITS),
  ].join("");

  return `${numberToBitstring(body.length, OUTER_LENGTH_HEADER_BITS)}${body}`;
}

export function deserializeEnvelopeFromBitstring(bitstring: string): MessageEnvelope {
  if (bitstring.length < OUTER_LENGTH_HEADER_BITS) {
    throw new Error("Encoded payload is missing the length header.");
  }

  const bodyBitLength = bitstringToNumber(bitstring.slice(0, OUTER_LENGTH_HEADER_BITS));
  const bodyBits = bitstring.slice(OUTER_LENGTH_HEADER_BITS, OUTER_LENGTH_HEADER_BITS + bodyBitLength);
  if (bodyBits.length !== bodyBitLength) {
    throw new Error("Encoded payload ended before the declared bit length.");
  }

  const cursor = createBitCursor(bodyBits);
  const version = cursor.readNumber(VERSION_BITS);
  const senderId = new TextDecoder().decode(cursor.readBytes(cursor.readNumber(STRING_LENGTH_BITS)));
  const msgId = cursor.readNumber(MESSAGE_ID_BITS);
  const ciphertext = bytesToBase64(cursor.readBytes(cursor.readNumber(CIPHERTEXT_LENGTH_BITS)));
  const authTagLength = cursor.readNumber(STRING_LENGTH_BITS);
  const authTag = authTagLength > 0 ? bytesToBase64(cursor.readBytes(authTagLength)) : null;
  const payloadBitLength = cursor.readNumber(PAYLOAD_LENGTH_BITS);

  if (!senderId || !Number.isInteger(msgId) || !ciphertext) {
    throw new Error("Encoded payload did not decode into a valid envelope.");
  }

  return {
    v: version as MessageEnvelope["v"],
    senderId,
    msgId,
    ciphertext,
    authTag,
    payloadBitLength,
  };
}

export { estimateWordTarget };

function createBitCursor(bitstring: string) {
  let offset = 0;

  return {
    readBits(width: number) {
      const value = bitstring.slice(offset, offset + width);
      if (value.length !== width) {
        throw new Error("Encoded payload ended unexpectedly.");
      }
      offset += width;
      return value;
    },
    readNumber(width: number) {
      return bitstringToNumber(this.readBits(width));
    },
    readBytes(length: number) {
      return bitstringToBytes(this.readBits(length * 8));
    },
  };
}

function bytesToBitstring(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(2).padStart(8, "0")).join("");
}

function bitstringToBytes(bitstring: string) {
  if (bitstring.length % 8 !== 0) {
    throw new Error("Bitstring length must be a multiple of 8.");
  }

  const bytes = new Uint8Array(bitstring.length / 8);

  for (let index = 0; index < bitstring.length; index += 8) {
    bytes[index / 8] = Number.parseInt(bitstring.slice(index, index + 8), 2);
  }

  return bytes;
}

function base64ToBytes(value: string) {
  if (!value) {
    return new Uint8Array();
  }

  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(value, "base64"));
  }

  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function bytesToBase64(value: Uint8Array) {
  if (value.length === 0) {
    return "";
  }

  if (typeof Buffer !== "undefined") {
    return Buffer.from(value).toString("base64");
  }

  return btoa(String.fromCharCode(...value));
}

function numberToBitstring(value: number, width: number) {
  return value.toString(2).padStart(width, "0");
}

function bitstringToNumber(bitstring: string) {
  return Number.parseInt(bitstring, 2);
}
