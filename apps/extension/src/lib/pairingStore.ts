import type {
  ActivePairingState,
  ExtensionState,
  PairedContact,
  PairingParticipant,
  PairingSession,
} from "@ghostscript/shared";
import { readStorageValue, writeStorageValue } from "./storage";

const STORAGE_KEY = "ghostscript-extension-state";

const EMPTY_STATE: ExtensionState = {
  profile: null,
  activePairing: null,
  contacts: [],
  drafts: null,
};

export async function readExtensionState(): Promise<ExtensionState> {
  return (await readStorageValue<ExtensionState>(STORAGE_KEY)) ?? EMPTY_STATE;
}

export async function writeExtensionState(state: ExtensionState) {
  await writeStorageValue(STORAGE_KEY, state);
}

export async function storeDiscordUsername(discordUsername: string) {
  const state = await readExtensionState();
  state.profile = { discordUsername };
  await writeExtensionState(state);
}

export async function storeInviteDraft(inviteCode: string) {
  const state = await readExtensionState();
  state.drafts = inviteCode ? { inviteCode } : null;
  await writeExtensionState(state);
}

export async function clearInviteDraft() {
  const state = await readExtensionState();
  state.drafts = null;
  await writeExtensionState(state);
}

export async function storeCreatedInvite(params: {
  inviteCode: string;
  session: PairingSession;
  localParticipant: PairingParticipant;
  coverTopic: string;
}) {
  const state = await readExtensionState();
  state.activePairing = {
    inviteCode: params.inviteCode,
    status: params.session.status,
    session: params.session,
    localParticipant: params.localParticipant,
    counterpart: null,
    defaultCoverTopic: params.coverTopic,
  };
  state.drafts = null;
  await writeExtensionState(state);
}

export async function storeJoinedPairing(params: {
  inviteCode: string;
  session: PairingSession;
  localParticipant: PairingParticipant;
  counterpart: PairingParticipant;
  coverTopic: string;
}) {
  const state = await readExtensionState();
  const contact = buildContact(params.counterpart, params.session, params.coverTopic);

  state.activePairing = {
    inviteCode: params.inviteCode,
    status: params.session.status,
    session: params.session,
    localParticipant: params.localParticipant,
    counterpart: params.counterpart,
    defaultCoverTopic: params.coverTopic,
  };
  upsertContactRecord(state.contacts, contact);
  state.drafts = null;
  await writeExtensionState(state);
}

export async function applyInviteSessionSnapshot(params: {
  session: PairingSession;
  inviter: PairingParticipant | null;
  joiner: PairingParticipant | null;
  coverTopic: string | null;
}) {
  const state = await readExtensionState();
  const activePairing = state.activePairing;

  if (!activePairing || activePairing.inviteCode !== params.session.invite.code) {
    return null;
  }

  const localParticipant =
    activePairing.localParticipant.role === "inviter" ? params.inviter : params.joiner;
  const counterpart =
    activePairing.localParticipant.role === "inviter" ? params.joiner : params.inviter;

  if (!localParticipant) {
    throw new Error("Active pairing participant is missing from the latest session snapshot.");
  }

  state.activePairing = {
    ...activePairing,
    status: params.session.status,
    session: params.session,
    localParticipant,
    counterpart,
    defaultCoverTopic: params.coverTopic,
  };

  if (counterpart && params.coverTopic && params.session.status === "paired") {
    upsertContactRecord(state.contacts, buildContact(counterpart, params.session, params.coverTopic));
  }

  if (params.session.status === "invalidated") {
    for (const contact of state.contacts) {
      if (contact.sessionId === params.session.id) {
        contact.status = "invalidated";
      }
    }
  }

  await writeExtensionState(state);
  return state.activePairing;
}

export async function getPrimaryContact() {
  const state = await readExtensionState();
  return state.contacts.find((contact) => contact.status === "paired") ?? null;
}

export async function endLocalPairing(inviteCode: string) {
  const state = await readExtensionState();

  if (state.activePairing?.inviteCode === inviteCode) {
    state.activePairing = {
      ...state.activePairing,
      status: "invalidated",
      session: {
        ...state.activePairing.session,
        status: "invalidated",
        invalidatedAt: new Date().toISOString(),
      },
    } satisfies ActivePairingState;
  }

  for (const contact of state.contacts) {
    if (contact.inviteCode === inviteCode) {
      contact.status = "invalidated";
    }
  }

  await writeExtensionState(state);
}

function buildContact(participant: PairingParticipant, session: PairingSession, coverTopic: string): PairedContact {
  return {
    id: participant.id,
    sessionId: participant.sessionId,
    displayName: participant.displayName,
    pairedAt: session.joinedAt ?? session.createdAt,
    defaultCoverTopic: coverTopic,
    inviteCode: session.invite.code,
    status: session.status === "invalidated" ? "invalidated" : "paired",
  };
}

function upsertContactRecord(contacts: PairedContact[], nextContact: PairedContact) {
  const existingIndex = contacts.findIndex((contact) => contact.id === nextContact.id);

  if (existingIndex === -1) {
    contacts.unshift(nextContact);
    return;
  }

  contacts[existingIndex] = nextContact;
}
