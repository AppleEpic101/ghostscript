import type {
  CreateInviteResponse,
  JoinInviteResponse,
  PairingParticipant,
  PairingSession,
  VerificationState,
} from "@ghostscript/shared";

const PAIRING_SESSION_STORAGE_KEY = "ghostscript-active-pairing-session";
const CREATE_INVITE_STORAGE_KEY = "ghostscript-create-invite-state";
const JOIN_INVITE_STORAGE_KEY = "ghostscript-join-invite-state";

export interface StoredPairingSession {
  inviteCode: string;
  participant: PairingParticipant;
  session: PairingSession;
  verification: VerificationState | null;
}

export interface StoredCreateInviteState {
  inviterName: string;
  hasEditedName: boolean;
  invite: CreateInviteResponse | null;
}

export interface StoredJoinInviteState {
  inviteCode: string;
  joinerName: string;
  hasEditedJoinerName: boolean;
  response: JoinInviteResponse | null;
}

export function readStoredPairingSession(): StoredPairingSession | null {
  return readStorageValue<StoredPairingSession>(PAIRING_SESSION_STORAGE_KEY);
}

export function writeStoredPairingSession(session: StoredPairingSession) {
  writeStorageValue(PAIRING_SESSION_STORAGE_KEY, session);
}

export function readStoredCreateInviteState(): StoredCreateInviteState | null {
  return readStorageValue<StoredCreateInviteState>(CREATE_INVITE_STORAGE_KEY);
}

export function writeStoredCreateInviteState(state: StoredCreateInviteState) {
  writeStorageValue(CREATE_INVITE_STORAGE_KEY, state);
}

export function readStoredJoinInviteState(): StoredJoinInviteState | null {
  return readStorageValue<StoredJoinInviteState>(JOIN_INVITE_STORAGE_KEY);
}

export function writeStoredJoinInviteState(state: StoredJoinInviteState) {
  writeStorageValue(JOIN_INVITE_STORAGE_KEY, state);
}

function readStorageValue<T>(key: string): T | null {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(key);

  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as T;
  } catch {
    return null;
  }
}

function writeStorageValue(key: string, value: unknown) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
}
