import { deflateSync, inflateSync } from "fflate";

const RAW_FORMAT = 0;
const DEFLATE_FORMAT = 1;
const HEADER_BYTES = 5;
const LENGTH_HEADER_BITS = 32;

export interface CompressedTransportBitstring {
  bitstring: string;
  format: "raw" | "deflate";
  originalBitLength: number;
  framedBitLength: number;
}

export async function compressBitstringForTransport(bitstring: string): Promise<CompressedTransportBitstring> {
  assertBitstring(bitstring);

  const packed = bitstringToBytes(bitstring);
  const rawFramed = frameCompressedBytes(RAW_FORMAT, bitstring.length, packed);
  const deflatedPayload = deflateSync(packed);
  const deflatedFramed = frameCompressedBytes(DEFLATE_FORMAT, bitstring.length, deflatedPayload);
  const selected = deflatedFramed.length < rawFramed.length
    ? { format: "deflate" as const, bytes: deflatedFramed }
    : { format: "raw" as const, bytes: rawFramed };
  const framedPayloadBitstring = bytesToBitstring(selected.bytes);

  return {
    bitstring: `${numberToBitstring(framedPayloadBitstring.length, LENGTH_HEADER_BITS)}${framedPayloadBitstring}`,
    format: selected.format,
    originalBitLength: bitstring.length,
    framedBitLength: LENGTH_HEADER_BITS + (selected.bytes.length * 8),
  };
}

export async function decompressBitstringFromTransport(bitstring: string): Promise<string> {
  assertBitstring(bitstring);

  if (bitstring.length < LENGTH_HEADER_BITS) {
    throw new Error("Compressed transport bitstring is missing its outer length header.");
  }

  const framedBitLength = bitstringToNumber(bitstring.slice(0, LENGTH_HEADER_BITS));
  const framedPayloadBits = bitstring.slice(LENGTH_HEADER_BITS, LENGTH_HEADER_BITS + framedBitLength);
  if (framedPayloadBits.length !== framedBitLength) {
    throw new Error("Compressed transport bitstring ended before its declared payload length.");
  }

  if (framedPayloadBits.length % 8 !== 0) {
    throw new Error("Compressed transport payload must align to a whole number of bytes.");
  }

  const bytes = bitstringToBytes(framedPayloadBits);
  if (bytes.length < HEADER_BYTES) {
    throw new Error("Compressed transport payload is missing its framing header.");
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
      : fail("Compressed transport payload used an unknown format.");

  return bytesToBitstring(unpacked, originalBitLength);
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

function bytesToBitstring(bytes: Uint8Array, originalBitLength = bytes.length * 8) {
  const bitstring = Array.from(bytes, (value) => value.toString(2).padStart(8, "0")).join("");
  return bitstring.slice(0, originalBitLength);
}

function assertBitstring(bitstring: string) {
  if (!/^[01]*$/.test(bitstring)) {
    throw new Error("Bit compression requires a bitstring containing only 0 and 1.");
  }
}

function numberToBitstring(value: number, width: number) {
  return value.toString(2).padStart(width, "0");
}

function bitstringToNumber(bitstring: string) {
  return Number.parseInt(bitstring, 2);
}

function fail(message: string): never {
  throw new Error(message);
}
