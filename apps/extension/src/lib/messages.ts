import type { MessageEnvelope, StegoCodec } from "@ghostscript/shared";
import { GHOSTSCRIPT_SAFE_ALPHABET } from "@ghostscript/shared";
import { utf8Decode, utf8Encode } from "./bytes";

const SAFE_CHAR_SET = new Set<string>(GHOSTSCRIPT_SAFE_ALPHABET);
const ALPHABET_INDEX = new Map<string, number>(
  GHOSTSCRIPT_SAFE_ALPHABET.map((character, index) => [character, index]),
);

export const zeroWidthStegoCodec: StegoCodec = {
  encode(bytes) {
    let output = "";

    for (const byte of bytes) {
      output += GHOSTSCRIPT_SAFE_ALPHABET[byte >> 4];
      output += GHOSTSCRIPT_SAFE_ALPHABET[byte & 0x0f];
    }

    return output;
  },
  decode(text) {
    const trimmed = extractPayloadSuffix(text);

    if (!trimmed || trimmed.length % 2 !== 0) {
      throw new Error("Ghostscript payload is malformed.");
    }

    const result = new Uint8Array(trimmed.length / 2);

    for (let index = 0; index < trimmed.length; index += 2) {
      const high = ALPHABET_INDEX.get(trimmed[index]);
      const low = ALPHABET_INDEX.get(trimmed[index + 1]);

      if (high === undefined || low === undefined) {
        throw new Error("Ghostscript payload contains an unknown symbol.");
      }

      result[index / 2] = (high << 4) | low;
    }

    return result;
  },
  hasPayload(text) {
    return extractPayloadSuffix(text).length > 0;
  },
};

export function encodeEnvelopeIntoCoverText(coverText: string, envelope: MessageEnvelope) {
  const payload = utf8Encode(JSON.stringify(envelope));
  return `${coverText}${zeroWidthStegoCodec.encode(payload)}`;
}

export function decodeEnvelopeFromText(text: string) {
  const payloadSuffix = extractPayloadSuffix(text);

  if (!payloadSuffix) {
    throw new Error("No Ghostscript payload detected.");
  }

  const bytes = zeroWidthStegoCodec.decode(payloadSuffix);
  const parsed = JSON.parse(utf8Decode(bytes)) as MessageEnvelope;

  if (
    parsed.v !== 1 ||
    parsed.codec !== "base16-zero-width-v1" ||
    typeof parsed.senderId !== "string" ||
    typeof parsed.msgId !== "number" ||
    typeof parsed.tag !== "string" ||
    typeof parsed.ct !== "string"
  ) {
    throw new Error("Ghostscript payload failed validation.");
  }

  const coverText = text.slice(0, text.length - payloadSuffix.length);

  return {
    coverText,
    envelope: parsed,
  };
}

export function extractPayloadSuffix(text: string) {
  let end = text.length;

  while (end > 0 && /\s/.test(text[end - 1] ?? "")) {
    end -= 1;
  }

  let start = end;

  while (start > 0 && SAFE_CHAR_SET.has(text[start - 1] ?? "")) {
    start -= 1;
  }

  return text.slice(start, end);
}

export function buildFallbackCoverText(plainText: string, displayName: string) {
  const trimmed = plainText.trim();
  const preview = trimmed.split(/\s+/).slice(0, 6).join(" ").replace(/[^\w\s,.!?-]/g, "");

  if (preview.length === 0) {
    return `Quick follow-up for ${displayName}.`;
  }

  return `Quick follow-up for ${displayName}: ${preview}${trimmed.length > preview.length ? "..." : ""}`;
}
