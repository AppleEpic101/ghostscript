const LENGTH_HEADER_BITS = 32;

export function encodePlaintextToTransportBitstring(plaintext: string) {
  const payloadBytes = new TextEncoder().encode(plaintext);
  const payloadBitLength = payloadBytes.length * 8;

  return `${numberToBitstring(payloadBitLength, LENGTH_HEADER_BITS)}${bytesToBitstring(payloadBytes)}`;
}

export function decodePlaintextFromTransportBitstring(bitstring: string) {
  assertBitstring(bitstring);

  if (bitstring.length < LENGTH_HEADER_BITS) {
    throw new Error("Plaintext transport bitstring is missing its 32-bit length header.");
  }

  const payloadBitLength = bitstringToNumber(bitstring.slice(0, LENGTH_HEADER_BITS));
  const payloadBits = bitstring.slice(LENGTH_HEADER_BITS, LENGTH_HEADER_BITS + payloadBitLength);

  if (payloadBits.length !== payloadBitLength) {
    throw new Error("Plaintext transport bitstring ended before the declared UTF-8 payload length.");
  }

  if (payloadBitLength % 8 !== 0) {
    throw new Error("Plaintext transport payload length must be byte-aligned UTF-8.");
  }

  const payloadBytes = bitstringToBytes(payloadBits);

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes);
  } catch {
    throw new Error("Plaintext transport payload is not valid UTF-8.");
  }
}

function assertBitstring(bitstring: string) {
  if (!/^[01]*$/.test(bitstring)) {
    throw new Error("Plaintext transport requires a bitstring containing only 0 and 1.");
  }
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
