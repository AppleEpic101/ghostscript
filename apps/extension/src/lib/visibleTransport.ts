const PREFIX = "GS1:";

export function encodeVisibleTransportPayload(bitstring: string) {
  assertBitstring(bitstring);
  return `${PREFIX}${toBase64Url(bitstringToBytes(bitstring))}`;
}

export function extractVisibleTransportPayload(messageText: string) {
  const normalizedMessageText = messageText.trim();
  if (!normalizedMessageText.startsWith(PREFIX)) {
    return null;
  }

  const encoded = normalizedMessageText.slice(PREFIX.length);
  if (!encoded) {
    return null;
  }

  const bytes = fromBase64Url(encoded);
  if (!bytes) {
    return null;
  }

  return {
    bitstring: bytesToBitstring(bytes),
    visibleText: normalizedMessageText,
  };
}

function bitstringToBytes(bitstring: string) {
  const bytes = new Uint8Array(bitstring.length / 8);

  for (let index = 0; index < bitstring.length; index += 8) {
    bytes[index / 8] = Number.parseInt(bitstring.slice(index, index + 8), 2);
  }

  return bytes;
}

function bytesToBitstring(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(2).padStart(8, "0")).join("");
}

function toBase64Url(bytes: Uint8Array) {
  const base64 = typeof Buffer !== "undefined"
    ? Buffer.from(bytes).toString("base64")
    : btoa(String.fromCharCode(...bytes));

  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  if (!/^[A-Za-z0-9\-_]+$/.test(value)) {
    return null;
  }

  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");

  try {
    if (typeof Buffer !== "undefined") {
      return Uint8Array.from(Buffer.from(base64, "base64"));
    }

    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function assertBitstring(bitstring: string) {
  if (!bitstring || bitstring.length % 8 !== 0 || !/^[01]+$/.test(bitstring)) {
    throw new Error("Visible transport payload requires a non-empty bitstring aligned to whole bytes.");
  }
}
