import type {
  ActivePairingState,
  ExtensionState,
  PairedContact,
  PairingParticipant,
  PairingSession,
} from "@ghostscript/shared";
import { readStorageValue, writeStorageValue } from "./storage";

const PROFILE_STORAGE_KEY = "ghostscript-extension-profile";
const DRAFT_STORAGE_KEY = "ghostscript-extension-drafts";
const PAIRING_CACHE_STORAGE_KEY = "ghostscript-extension-pairing-cache";

interface PairingCacheState {
  activePairing: ActivePairingState | null;
  contacts: PairedContact[];
}

const EMPTY_STATE: ExtensionState = {
  profile: null,
  activePairing: null,
  contacts: [],
  drafts: null,
};

export async function readExtensionState(): Promise<ExtensionState> {
  const [profile, drafts, pairingCache] = await Promise.all([
    readStorageValue<ExtensionState["profile"]>(PROFILE_STORAGE_KEY),
    readStorageValue<ExtensionState["drafts"]>(DRAFT_STORAGE_KEY),
    readStorageValue<PairingCacheState>(PAIRING_CACHE_STORAGE_KEY),
  ]);

  return {
    profile: profile ?? EMPTY_STATE.profile,
    drafts: drafts ?? EMPTY_STATE.drafts,
    activePairing: normalizeActivePairing(pairingCache?.activePairing ?? EMPTY_STATE.activePairing),
    contacts: normalizeContacts(pairingCache?.contacts ?? EMPTY_STATE.contacts),
  };
}

export async function storeDiscordUsername(discordUsername: string) {
  await writeStorageValue(PROFILE_STORAGE_KEY, discordUsername ? { discordUsername } : null);
}

export async function storeInviteDraft(inviteCode: string) {
  await writeStorageValue(DRAFT_STORAGE_KEY, inviteCode ? { inviteCode } : null);
}

export async function clearInviteDraft() {
  await writeStorageValue(DRAFT_STORAGE_KEY, null);
}

export async function storeCreatedInvite(params: {
  inviteCode: string;
  session: PairingSession;
  localParticipant: PairingParticipant;
  coverTopic: string;
}) {
  await writePairingCache({
    activePairing: {
      inviteCode: params.inviteCode,
      status: params.session.status,
      session: params.session,
      localParticipant: params.localParticipant,
      counterpart: null,
      defaultCoverTopic: params.coverTopic,
    },
    contacts: [],
  });

  await clearInviteDraft();
}

export async function storeJoinedPairing(params: {
  inviteCode: string;
  session: PairingSession;
  localParticipant: PairingParticipant;
  counterpart: PairingParticipant;
  coverTopic: string;
}) {
  const currentState = await readExtensionState();
  const contact = buildContact(params.counterpart, params.session, params.coverTopic);

  await writePairingCache({
    activePairing: {
      inviteCode: params.inviteCode,
      status: params.session.status,
      session: params.session,
      localParticipant: params.localParticipant,
      counterpart: params.counterpart,
      defaultCoverTopic: params.coverTopic,
    },
    contacts: upsertContactRecord(currentState.contacts, contact),
  });

  await clearInviteDraft();
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

  const contacts = [...state.contacts];

  if (counterpart && params.coverTopic && params.session.status === "paired") {
    const nextContact = buildContact(counterpart, params.session, params.coverTopic);
    replaceOrInsertContact(contacts, nextContact);
  }

  if (params.session.status === "invalidated") {
    for (const contact of contacts) {
      if (contact.sessionId === params.session.id) {
        contact.status = "invalidated";
      }
    }

    await writePairingCache({
      activePairing: null,
      contacts,
    });
    await clearInviteDraft();
    return null;
  }

  const nextActivePairing: ActivePairingState = {
    ...activePairing,
    status: params.session.status,
    session: params.session,
    localParticipant,
    counterpart,
    defaultCoverTopic: params.coverTopic,
  };

  await writePairingCache({
    activePairing: nextActivePairing,
    contacts,
  });

  return nextActivePairing;
}

export async function getPrimaryContact() {
  const state = await readExtensionState();
  return state.contacts.find((contact) => contact.status === "paired") ?? null;
}

export async function endLocalPairing(inviteCode: string) {
  const state = await readExtensionState();
  const contacts = state.contacts.map((contact) =>
    contact.inviteCode === inviteCode ? { ...contact, status: "invalidated" as const } : contact,
  );

  await writePairingCache({
    activePairing: state.activePairing?.inviteCode === inviteCode ? null : state.activePairing,
    contacts,
  });
  await clearInviteDraft();
}

async function writePairingCache(pairingCache: PairingCacheState) {
  await writeStorageValue(PAIRING_CACHE_STORAGE_KEY, pairingCache);
}

function buildContact(participant: PairingParticipant, session: PairingSession, coverTopic: string): PairedContact {
  return {
    id: participant.id,
    sessionId: participant.sessionId,
    username: participant.username,
    pairedAt: session.joinedAt ?? session.createdAt,
    defaultCoverTopic: coverTopic,
    inviteCode: session.invite.code,
    status: session.status === "invalidated" ? "invalidated" : "paired",
  };
}

function upsertContactRecord(contacts: PairedContact[], nextContact: PairedContact) {
  const nextContacts = [...contacts];
  replaceOrInsertContact(nextContacts, nextContact);
  return nextContacts;
}

function replaceOrInsertContact(contacts: PairedContact[], nextContact: PairedContact) {
  const existingIndex = contacts.findIndex((contact) => contact.id === nextContact.id);

  if (existingIndex === -1) {
    contacts.unshift(nextContact);
    return;
  }

  contacts[existingIndex] = nextContact;
}

function normalizeActivePairing(activePairing: ActivePairingState | null) {
  if (!activePairing) {
    return null;
  }

  return {
    ...activePairing,
    localParticipant: normalizeParticipant(activePairing.localParticipant),
    counterpart: activePairing.counterpart ? normalizeParticipant(activePairing.counterpart) : null,
  };
}

function normalizeParticipant(participant: PairingParticipant) {
  return {
    ...participant,
    username: participant.username ?? (participant as PairingParticipant & { displayName?: string }).displayName ?? "",
  };
}

function normalizeContacts(contacts: PairedContact[]) {
  return contacts.map((contact) => ({
    ...contact,
    username: contact.username ?? (contact as PairedContact & { displayName?: string }).displayName ?? "",
  }));
}
