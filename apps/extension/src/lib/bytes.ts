export function utf8Encode(value: string) {
  return new TextEncoder().encode(value);
}

export function utf8Decode(value: Uint8Array) {
  return new TextDecoder().decode(value);
}

export function bytesToHex(value: Uint8Array) {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(value: string) {
  if (value.length % 2 !== 0) {
    throw new Error("Hex input must have an even length.");
  }

  const result = new Uint8Array(value.length / 2);

  for (let index = 0; index < value.length; index += 2) {
    result[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }

  return result;
}

export function bytesToBase64(value: Uint8Array) {
  let binary = "";

  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

export function base64ToBytes(value: string) {
  const binary = atob(value);
  const result = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    result[index] = binary.charCodeAt(index);
  }

  return result;
}

export function uint32ToBytes(value: number) {
  const result = new Uint8Array(4);
  const view = new DataView(result.buffer);
  view.setUint32(0, value, false);
  return result;
}

export function bytesToUint32(value: Uint8Array) {
  if (value.byteLength !== 4) {
    throw new Error("Expected 4 bytes.");
  }

  return new DataView(value.buffer, value.byteOffset, value.byteLength).getUint32(0, false);
}

export function concatBytes(parts: Uint8Array[]) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}
