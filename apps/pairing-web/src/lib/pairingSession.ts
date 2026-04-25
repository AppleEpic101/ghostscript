import type { PairingParticipant, PairingSession, VerificationState } from "@ghostscript/shared";

const PAIRING_SESSION_STORAGE_KEY = "ghostscript-active-pairing-session";

export interface StoredPairingSession {
  inviteCode: string;
  participant: PairingParticipant;
  session: PairingSession;
  verification: VerificationState | null;
}

export function readStoredPairingSession(): StoredPairingSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(PAIRING_SESSION_STORAGE_KEY);

  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as StoredPairingSession;
  } catch {
    return null;
  }
}

export function writeStoredPairingSession(session: StoredPairingSession) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(PAIRING_SESSION_STORAGE_KEY, JSON.stringify(session));
}
