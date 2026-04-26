import type { MessageEnvelope } from "@ghostscript/shared";

const LENGTH_HEADER_BITS = 32;

export function serializeEnvelopeToBitstring(envelope: MessageEnvelope) {
  const envelopeJson = JSON.stringify(envelope);
  const payloadBits = bytesToBitstring(new TextEncoder().encode(envelopeJson));
  return `${numberToBitstring(payloadBits.length, LENGTH_HEADER_BITS)}${payloadBits}`;
}

export function deserializeEnvelopeFromBitstring(bitstring: string): MessageEnvelope {
  if (bitstring.length < LENGTH_HEADER_BITS) {
    throw new Error("Encoded payload is missing the length header.");
  }

  const payloadBitLength = bitstringToNumber(bitstring.slice(0, LENGTH_HEADER_BITS));
  const payloadBits = bitstring.slice(LENGTH_HEADER_BITS, LENGTH_HEADER_BITS + payloadBitLength);

  if (payloadBits.length !== payloadBitLength) {
    throw new Error("Encoded payload ended before the declared bit length.");
  }

  const jsonBytes = bitstringToBytes(payloadBits);
  const envelope = JSON.parse(new TextDecoder().decode(jsonBytes)) as MessageEnvelope;

  if (
    envelope === null ||
    typeof envelope !== "object" ||
    typeof envelope.senderId !== "string" ||
    typeof envelope.msgId !== "number"
  ) {
    throw new Error("Encoded payload did not decode into a valid envelope.");
  }

  return envelope;
}

export function estimateWordTarget(payloadBitLength: number, bitsPerToken: number) {
  const estimatedTokens = Math.max(12, Math.ceil(payloadBitLength / Math.max(bitsPerToken, 1)));
  return Math.max(10, Math.ceil(estimatedTokens * 0.75));
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

function numberToBitstring(value: number, width: number) {
  return value.toString(2).padStart(width, "0");
}

function bitstringToNumber(bitstring: string) {
  return Number.parseInt(bitstring, 2);
}
