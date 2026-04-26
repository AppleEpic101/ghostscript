const MARKER = "\u2063\u2064\u2063";
const SEPARATOR = "\u2064\u2063\u2064";
const ALPHABET = ["\u200b", "\u200c", "\u200d", "\u2060"] as const;
const ALPHABET_TO_BITS = new Map<string, string>(ALPHABET.map((char, index) => [char, index.toString(2).padStart(2, "0")]));
const VERSION = 1;
const LENGTH_HEADER_BITS = 32;
const CODE_UNIT_LENGTH_BITS = 32;
const TRAILING_NOISE = new Set(["\u200b", "\u200c", "\u200d", "\u2060", "\ufeff"]);
const MAX_VISIBLE_LENGTH_FALLBACK_DELTA = 8;

export function appendInvisiblePayload(visibleText: string, bitstring: string) {
  assertBitstring(bitstring);
  const normalizedVisibleText = normalizeTransportVisibleText(visibleText);
  const payload = `${numberToBitstring(VERSION, 8)}${numberToBitstring(bitstring.length, LENGTH_HEADER_BITS)}${bitstring}`;
  return `${normalizedVisibleText}${MARKER}${encodeBits(payload)}${SEPARATOR}${numberToInvisibleDigits(normalizedVisibleText.length)}`;
}

export function extractInvisiblePayload(messageText: string) {
  const markerIndex = messageText.lastIndexOf(MARKER);
  if (markerIndex === -1) {
    return null;
  }

  const separatorIndex = messageText.indexOf(SEPARATOR, markerIndex + MARKER.length);
  if (separatorIndex === -1) {
    return null;
  }

  const payloadChunk = messageText.slice(markerIndex + MARKER.length, separatorIndex);
  const visibleLengthChunk = messageText.slice(separatorIndex + SEPARATOR.length);
  if (!payloadChunk || !visibleLengthChunk) {
    return null;
  }

  const payloadBits = decodeBits(payloadChunk);
  const visibleLength = invisibleDigitsToNumber(visibleLengthChunk);
  if (payloadBits === null || visibleLength === null) {
    return null;
  }

  if (payloadBits.length < 8 + LENGTH_HEADER_BITS) {
    return null;
  }

  const version = Number.parseInt(payloadBits.slice(0, 8), 2);
  if (version !== VERSION) {
    return null;
  }

  const declaredLength = Number.parseInt(payloadBits.slice(8, 8 + LENGTH_HEADER_BITS), 2);
  const bitstring = payloadBits.slice(8 + LENGTH_HEADER_BITS, 8 + LENGTH_HEADER_BITS + declaredLength);
  if (declaredLength < 0 || bitstring.length !== declaredLength) {
    return null;
  }

  const declaredVisibleText = messageText.slice(0, visibleLength);
  if (`${declaredVisibleText}${MARKER}${payloadChunk}${SEPARATOR}${visibleLengthChunk}` === messageText) {
    return {
      bitstring,
      visibleText: declaredVisibleText,
    };
  }

  const markerVisibleText = messageText.slice(0, markerIndex);
  if (
    visibleLength >= markerIndex &&
    visibleLength - markerIndex <= MAX_VISIBLE_LENGTH_FALLBACK_DELTA &&
    normalizeTransportVisibleText(markerVisibleText) === markerVisibleText
  ) {
    return {
      bitstring,
      visibleText: markerVisibleText,
    };
  }

  return null;
}

export function stripTransportPayload(messageText: string) {
  const extracted = extractInvisiblePayload(messageText);
  return extracted?.visibleText ?? stripTrailingInvisibleNoise(messageText);
}

function encodeBits(bitstring: string) {
  const padded = bitstring.padEnd(Math.ceil(bitstring.length / 2) * 2, "0");
  let encoded = "";

  for (let index = 0; index < padded.length; index += 2) {
    encoded += ALPHABET[Number.parseInt(padded.slice(index, index + 2), 2)] ?? fail("Invalid transport chunk.");
  }

  return encoded;
}

function decodeBits(value: string) {
  let bits = "";

  for (const char of value) {
    const encoded = ALPHABET_TO_BITS.get(char);
    if (!encoded) {
      return null;
    }
    bits += encoded;
  }

  return bits;
}

function numberToInvisibleDigits(value: number) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Visible text length must be a non-negative integer.");
  }

  return encodeBits(numberToBitstring(value, CODE_UNIT_LENGTH_BITS));
}

function invisibleDigitsToNumber(value: string) {
  const bits = decodeBits(value);
  if (!bits || bits.length !== CODE_UNIT_LENGTH_BITS) {
    return null;
  }

  return Number.parseInt(bits, 2);
}

function stripTrailingInvisibleNoise(value: string) {
  const chars = Array.from(value);
  while (chars.length > 0 && TRAILING_NOISE.has(chars[chars.length - 1] ?? "")) {
    chars.pop();
  }

  return chars.join("");
}

function assertBitstring(bitstring: string) {
  if (!/^[01]*$/.test(bitstring)) {
    throw new Error("Invisible transport payload must be a bitstring containing only 0 and 1.");
  }
}

function numberToBitstring(value: number, width: number) {
  return value.toString(2).padStart(width, "0");
}

export function normalizeTransportVisibleText(value: string) {
  return value.replace(/\r\n/g, "\n").trimEnd();
}

function fail(message: string): never {
  throw new Error(message);
}
