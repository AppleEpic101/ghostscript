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
const ANONYMOUS_SUBJECT_STORAGE_KEY = "ghostscript-anonymous-subject";
const DEPLOY_TOKEN_STORAGE_KEY = "ghostscript-deploy-token";
const STORAGE_PREFIX = "ghostscript-";
const CURRENT_DEPLOY_TOKEN = import.meta.env.VITE_GHOSTSCRIPT_DEPLOY_TOKEN ?? "local-dev";

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

export function clearGhostscriptStorage() {
  if (typeof window === "undefined") {
    return;
  }

  const keysToRemove: string[] = [];

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);

    if (key?.startsWith(STORAGE_PREFIX)) {
      keysToRemove.push(key);
    }
  }

  for (const key of keysToRemove) {
    window.localStorage.removeItem(key);
  }
}

export function getOrCreateAnonymousSubject(): string {
  ensureFreshDeployStorage();
  const existingSubject = readRawStorageValue(ANONYMOUS_SUBJECT_STORAGE_KEY);

  if (existingSubject) {
    return existingSubject;
  }

  const nextSubject =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? `anonymous-browser:${crypto.randomUUID()}`
      : `anonymous-browser:${Date.now().toString(36)}`;

  writeStorageValue(ANONYMOUS_SUBJECT_STORAGE_KEY, nextSubject);
  return nextSubject;
}

function readStorageValue<T>(key: string): T | null {
  ensureFreshDeployStorage();
  const rawValue = readRawStorageValue(key);

  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as T;
  } catch {
    return null;
  }
}

function readRawStorageValue(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(key);
}

function writeStorageValue(key: string, value: unknown) {
  if (typeof window === "undefined") {
    return;
  }

  ensureFreshDeployStorage();
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function ensureFreshDeployStorage() {
  if (typeof window === "undefined") {
    return;
  }

  const storedDeployToken = window.localStorage.getItem(DEPLOY_TOKEN_STORAGE_KEY);

  if (storedDeployToken === CURRENT_DEPLOY_TOKEN) {
    return;
  }

  clearGhostscriptStorage();
  window.localStorage.setItem(DEPLOY_TOKEN_STORAGE_KEY, CURRENT_DEPLOY_TOKEN);
}
