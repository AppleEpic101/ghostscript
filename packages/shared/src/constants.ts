import type { TrustStatus } from "./types";

export const PROTOCOL_VERSION = 1;

export const FEATURE_FLAGS = {
  textMvp: true,
  imageStretchDisabled: true,
} as const;

export const TRUST_STATUS_LABELS: Record<TrustStatus, string> = {
  unpaired: "Unpaired",
  "paired-unverified": "Paired, verification pending",
  verified: "Verified",
  locked: "Locked",
  "tampered/decryption-failed": "Tampered / decryption failed",
};

export const GHOSTSCRIPT_SAFE_ALPHABET = [
  "\u200B",
  "\u200C",
  "\u200D",
  "\u2060",
  "\u2061",
  "\u2062",
  "\u2063",
  "\u2064",
  "\u206A",
  "\u206B",
  "\u206C",
  "\u206D",
  "\u206E",
  "\u206F",
  "\uFEFF",
  "\uFFA0",
] as const;
