import type {
  ConfirmVerificationResponse,
  ConversationState,
  IdentityKey,
  InviteSessionStatusResponse,
  PairingParticipant,
  PairingSession,
  PairedContact,
  TrustStatus,
  VaultState,
  VerificationState,
} from "@ghostscript/shared";
import { readStorageValue, removeStorageValue, writeStorageValue } from "./storage";

const STORAGE_KEY = "ghostscript-extension-state";

export interface ActivePairingState {
  inviteCode: string;
  session: PairingSession;
  localParticipant: PairingParticipant;
  counterpart: PairingParticipant | null;
  verification: VerificationState | null;
}

export interface ExtensionState {
  identity: IdentityKey | null;
  activePairing: ActivePairingState | null;
  contacts: PairedContact[];
  conversations: Record<string, ConversationState>;
}

const EMPTY_STATE: ExtensionState = {
  identity: null,
  activePairing: null,
  contacts: [],
  conversations: {},
};

export async function readExtensionState(): Promise<ExtensionState> {
  return (await readStorageValue<ExtensionState>(STORAGE_KEY)) ?? EMPTY_STATE;
}

export async function writeExtensionState(state: ExtensionState) {
  await writeStorageValue(STORAGE_KEY, state);
}

export async function clearExtensionState() {
  await removeStorageValue(STORAGE_KEY);
}

export async function storeIdentity(identity: IdentityKey) {
  const state = await readExtensionState();
  state.identity = identity;
  await writeExtensionState(state);
}

export async function getStoredIdentity() {
  const state = await readExtensionState();
  return state.identity;
}

export async function storeActivePairing(pairing: ActivePairingState) {
  const state = await readExtensionState();
  state.activePairing = pairing;
  await writeExtensionState(state);
}

export async function applyConfirmationResult(response: ConfirmVerificationResponse) {
  const state = await readExtensionState();

  if (!state.activePairing) {
    throw new Error("No active pairing is available.");
  }

  state.activePairing = {
    ...state.activePairing,
    session: response.session,
    localParticipant: response.participant,
    counterpart: response.counterpart ?? state.activePairing.counterpart,
    verification: response.verification,
  };

  const counterpart = response.counterpart ?? state.activePairing.counterpart;

  if (counterpart) {
    upsertContactRecord(
      state.contacts,
      buildContactFromPairing(counterpart, response.verification, response.trustStatus),
    );
  }

  await writeExtensionState(state);
  return state.activePairing;
}

export async function applyInviteSessionStatus(response: InviteSessionStatusResponse) {
  const state = await readExtensionState();
  const activePairing = state.activePairing;

  if (!activePairing) {
    throw new Error("No active pairing is available.");
  }

  const localParticipant =
    activePairing.localParticipant.role === "inviter"
      ? response.inviter
      : response.joiner;
  const counterpart =
    activePairing.localParticipant.role === "inviter"
      ? response.joiner
      : response.inviter;

  if (!localParticipant) {
    throw new Error("The active pairing participant is missing from the latest session status.");
  }

  state.activePairing = {
    ...activePairing,
    session: response.session,
    localParticipant,
    counterpart: counterpart ?? activePairing.counterpart,
    verification: response.verification ?? activePairing.verification,
  };

  if (counterpart && response.verification) {
    upsertContactRecord(
      state.contacts,
      buildContactFromPairing(
        counterpart,
        response.verification,
        response.verification.bothConfirmed ? "verified" : "paired-unverified",
      ),
    );
  }

  await writeExtensionState(state);
  return state.activePairing;
}

export async function getPrimaryContact() {
  const state = await readExtensionState();

  return (
    state.contacts.find((contact) => contact.trustStatus === "verified") ??
    state.contacts.find((contact) => contact.trustStatus === "paired-unverified") ??
    null
  );
}

export async function storeContact(contact: PairedContact) {
  const state = await readExtensionState();
  upsertContactRecord(state.contacts, contact);
  await writeExtensionState(state);
}

export async function getConversationState(
  conversationId: string,
  contact: PairedContact,
): Promise<ConversationState> {
  const state = await readExtensionState();
  const existing = state.conversations[conversationId];

  if (existing) {
    return existing;
  }

  const created: ConversationState = {
    conversationId,
    contactId: contact.id,
    trustStatus: contact.trustStatus,
    canDecrypt: contact.trustStatus === "verified",
    lastMessageId: 0,
    sendCounter: 0,
    receiveWatermark: 0,
    sharedSecretRef: contact.senderId,
    lastProcessedDiscordMessageId: null,
    locked: true,
    imageStegoEnabled: false,
  };

  state.conversations[conversationId] = created;
  await writeExtensionState(state);
  return created;
}

export async function updateConversationState(
  conversationId: string,
  updater: (conversation: ConversationState) => ConversationState,
) {
  const state = await readExtensionState();
  const current =
    state.conversations[conversationId] ??
    ({
      conversationId,
      contactId: "",
      trustStatus: "unpaired",
      canDecrypt: false,
      lastMessageId: 0,
      sendCounter: 0,
      receiveWatermark: 0,
      sharedSecretRef: undefined,
      lastProcessedDiscordMessageId: null,
      locked: true,
      imageStegoEnabled: false,
    } satisfies ConversationState);

  state.conversations[conversationId] = updater(current);
  await writeExtensionState(state);
  return state.conversations[conversationId];
}

export async function getVaultState(): Promise<VaultState> {
  const identity = await getStoredIdentity();
  return identity ? "locked" : "uninitialized";
}

export function buildContactFromPairing(
  participant: PairingParticipant,
  verification: VerificationState,
  trustStatus: Extract<TrustStatus, "paired-unverified" | "verified">,
): PairedContact {
  return {
    id: participant.sessionId,
    displayName: participant.displayName,
    discordHandle: participant.identity.email ?? participant.displayName,
    participantId: participant.id,
    publicKey: participant.publicKey,
    senderId: `ed25519:${participant.publicKey.fingerprint.replace(/\s+/g, "").toLowerCase().slice(0, 8)}`,
    verifiedAt: verification.verifiedAt,
    trustStatus,
    safetyNumber: verification.safetyNumber,
    hashWords: verification.hashWords,
    pairedAt: verification.verifiedAt ?? participant.createdAt,
  };
}

export function upsertContactRecord(contacts: PairedContact[], nextContact: PairedContact) {
  const existingIndex = contacts.findIndex((contact) => contact.id === nextContact.id);

  if (existingIndex === -1) {
    contacts.unshift(nextContact);
    return;
  }

  contacts[existingIndex] = nextContact;
}
