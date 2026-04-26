import { deflateSync, inflateSync } from "node:zlib";

const RAW_FORMAT = 0;
const DEFLATE_FORMAT = 1;
const HEADER_BYTES = 5;

export interface BitCompressionResult {
  format: "raw" | "deflate";
  bytes: Uint8Array;
  originalBitLength: number;
}

export function compressBitstring(bitstring: string): BitCompressionResult {
  assertBitstring(bitstring);

  const packed = bitstringToBytes(bitstring);
  const rawFramed = frameCompressedBytes(RAW_FORMAT, bitstring.length, packed);
  const deflatedPayload = deflateSync(packed);
  const deflatedFramed = frameCompressedBytes(DEFLATE_FORMAT, bitstring.length, deflatedPayload);

  if (deflatedFramed.length < rawFramed.length) {
    return {
      format: "deflate",
      bytes: deflatedFramed,
      originalBitLength: bitstring.length,
    };
  }

  return {
    format: "raw",
    bytes: rawFramed,
    originalBitLength: bitstring.length,
  };
}

export function decompressBitstring(bytes: Uint8Array): string {
  if (bytes.length < HEADER_BYTES) {
    throw new Error("Compressed bit payload is missing its framing header.");
  }

  const format = bytes[0];
  const originalBitLength =
    (bytes[1] << 24) |
    (bytes[2] << 16) |
    (bytes[3] << 8) |
    bytes[4];
  const payload = bytes.slice(HEADER_BYTES);

  const unpacked = format === DEFLATE_FORMAT
    ? inflateSync(payload)
    : format === RAW_FORMAT
      ? payload
      : fail("Compressed bit payload used an unknown format.");

  return bytesToBitstring(unpacked, originalBitLength);
}

export function compressBitstringToBase64(bitstring: string) {
  const result = compressBitstring(bitstring);
  return {
    ...result,
    base64: bytesToBase64(result.bytes),
  };
}

export function decompressBitstringFromBase64(base64: string) {
  return decompressBitstring(base64ToBytes(base64));
}

export function bytesToBase64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

export function base64ToBytes(base64: string) {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

function frameCompressedBytes(format: number, originalBitLength: number, payload: Uint8Array) {
  if (!Number.isInteger(originalBitLength) || originalBitLength < 0) {
    throw new Error("Original bit length must be a non-negative integer.");
  }

  const framed = new Uint8Array(HEADER_BYTES + payload.length);
  framed[0] = format;
  framed[1] = (originalBitLength >>> 24) & 0xff;
  framed[2] = (originalBitLength >>> 16) & 0xff;
  framed[3] = (originalBitLength >>> 8) & 0xff;
  framed[4] = originalBitLength & 0xff;
  framed.set(payload, HEADER_BYTES);
  return framed;
}

function bitstringToBytes(bitstring: string) {
  const bytes = new Uint8Array(Math.ceil(bitstring.length / 8));

  for (let index = 0; index < bitstring.length; index += 8) {
    const chunk = bitstring.slice(index, index + 8).padEnd(8, "0");
    bytes[index / 8] = Number.parseInt(chunk, 2);
  }

  return bytes;
}

function bytesToBitstring(bytes: Uint8Array, originalBitLength: number) {
  const bitstring = Array.from(bytes, (value) => value.toString(2).padStart(8, "0")).join("");
  return bitstring.slice(0, originalBitLength);
}

function assertBitstring(bitstring: string) {
  if (!/^[01]*$/.test(bitstring)) {
    throw new Error("Bit compression requires a bitstring containing only 0 and 1.");
  }
}

function fail(message: string): never {
  throw new Error(message);
}
