import {
  DEFAULT_TRANSPORT_CONFIG_ID,
  type EncodedGhostscriptMessage,
  type GhostscriptThreadMessage,
  type PendingSendStatus,
  type SupportedTransportConfigId,
} from "@ghostscript/shared";
import {
  createWrappingSecret,
  type LocalIdentityBundle,
  type WrappedIdentityBundle,
  unwrapIdentityBundle,
  wrapIdentityBundle,
} from "./crypto";
import {
  normalizeDecodedMessageActiveView,
  type DecodedGhostscriptMessageView,
  type LegacyDecodedGhostscriptMessageView,
} from "./decodedMessages";
import { readStorageValue, writeStorageValue } from "./storage";

const GHOSTSCRIPT_STATE_STORAGE_KEY = "ghostscript-extension-ghostscript-state";

export interface PendingSendState {
  threadId: string;
  sessionId: string;
  status: Exclude<PendingSendStatus, "idle">;
  expectedCoverText: string;
  encodedMessage: EncodedGhostscriptMessage | null;
  startedAt: number;
  msgId: number;
  error: string | null;
}

export interface DecodedGhostscriptMessageState {
  status: "decoded" | "tampered";
  plaintext: string | null;
  visibleText: string;
  encodedMessage: EncodedGhostscriptMessage | null;
  processedAt: string;
  activeView: DecodedGhostscriptMessageView;
}

export interface GhostscriptConversationState {
  threadId: string;
  nextOutboundMessageId: number;
  pinnedEncodingConfigId: SupportedTransportConfigId;
  cachedMessages: GhostscriptThreadMessage[];
  suppressedMessageIds: string[];
  decodedMessages: Record<string, DecodedGhostscriptMessageState>;
  confirmedEncodedMessages: EncodedGhostscriptMessage[];
  pendingSend: PendingSendState | null;
}

export interface GhostscriptState {
  localWrapSecret: string | null;
  identityKeysBySessionId: Record<string, WrappedIdentityBundle | LegacyLocalIdentityKeypair>;
  conversationsByThreadId: Record<string, GhostscriptConversationState>;
}

interface LegacyLocalIdentityKeypair {
  publicKey: string;
  privateKey: string;
}

const EMPTY_STATE: GhostscriptState = {
  localWrapSecret: null,
  identityKeysBySessionId: {},
  conversationsByThreadId: {},
};

const DISCORD_CONFIRM_PENDING_STALE_AFTER_MS = 2 * 60_000;
const CONFIRMED_SEND_STALE_AFTER_MS = 30_000;

export async function readGhostscriptState(): Promise<GhostscriptState> {
  const state = await readStorageValue<GhostscriptState>(GHOSTSCRIPT_STATE_STORAGE_KEY);
  return state ?? EMPTY_STATE;
}

export async function storeLocalIdentityBundle(sessionId: string, bundle: LocalIdentityBundle) {
  const state = await readGhostscriptState();
  const localWrapSecret = state.localWrapSecret ?? (await createWrappingSecret());
  const wrappedIdentity = await wrapIdentityBundle(bundle, localWrapSecret);

  await writeGhostscriptState({
    ...state,
    localWrapSecret,
    identityKeysBySessionId: {
      ...state.identityKeysBySessionId,
      [sessionId]: wrappedIdentity,
    },
  });
}

export async function getLocalIdentityBundle(sessionId: string) {
  const state = await readGhostscriptState();
  const identityRecord = state.identityKeysBySessionId[sessionId];

  if (!identityRecord || !isWrappedIdentityBundle(identityRecord) || !state.localWrapSecret) {
    return null;
  }

  return unwrapIdentityBundle(identityRecord, state.localWrapSecret);
}

export async function ensureConversationState(threadId: string) {
  const state = await readGhostscriptState();
  if (state.conversationsByThreadId[threadId]) {
    return normalizeConversationState(state.conversationsByThreadId[threadId]);
  }

  const conversation = createEmptyConversationState(threadId);
  await writeGhostscriptState({
    ...state,
    conversationsByThreadId: {
      ...state.conversationsByThreadId,
      [threadId]: conversation,
    },
  });

  return conversation;
}

export async function readConversationState(threadId: string) {
  const state = await readGhostscriptState();
  return normalizeConversationState(state.conversationsByThreadId[threadId] ?? createEmptyConversationState(threadId));
}

export async function updateConversationState(
  threadId: string,
  updater: (conversation: GhostscriptConversationState) => GhostscriptConversationState,
) {
  const state = await readGhostscriptState();
  const currentConversation = normalizeConversationState(
    state.conversationsByThreadId[threadId] ?? createEmptyConversationState(threadId),
  );
  const nextConversation = updater(currentConversation);

  await writeGhostscriptState({
    ...state,
    conversationsByThreadId: {
      ...state.conversationsByThreadId,
      [threadId]: nextConversation,
    },
  });

  return nextConversation;
}

export async function cacheConversationMessages(threadId: string, messages: GhostscriptThreadMessage[]) {
  return updateConversationState(threadId, (conversation) => ({
    ...conversation,
    cachedMessages: mergeConversationMessages(conversation.cachedMessages, messages),
  }));
}

export async function reserveNextMessageId(threadId: string) {
  const conversation = await updateConversationState(threadId, (currentConversation) => ({
    ...currentConversation,
    nextOutboundMessageId: currentConversation.nextOutboundMessageId + 1,
  }));

  return conversation.nextOutboundMessageId - 1;
}

export async function setPendingSend(threadId: string, pendingSend: PendingSendState | null) {
  return updateConversationState(threadId, (conversation) => ({
    ...conversation,
    pendingSend,
  }));
}

export async function storeConfirmedEncodedMessage(threadId: string, encodedMessage: EncodedGhostscriptMessage) {
  return updateConversationState(threadId, (conversation) => ({
    ...conversation,
    confirmedEncodedMessages: [
      ...conversation.confirmedEncodedMessages.filter((message) => message.visibleText !== encodedMessage.visibleText),
      encodedMessage,
    ].slice(-24),
  }));
}

export function isPendingSendStale(
  pendingSend: PendingSendState | null | undefined,
  activeSessionId: string,
  now = Date.now(),
) {
  if (!pendingSend) {
    return false;
  }

  if (!pendingSend.sessionId || pendingSend.sessionId !== activeSessionId) {
    return true;
  }

  const ageMs = now - pendingSend.startedAt;
  switch (pendingSend.status) {
    case "encoding":
    case "failed":
      return false;
    case "awaiting-discord-confirm":
    case "deleted-due-to-race":
      return ageMs > DISCORD_CONFIRM_PENDING_STALE_AFTER_MS;
    case "confirmed":
      return ageMs > CONFIRMED_SEND_STALE_AFTER_MS;
  }
}

export async function markSuppressedMessage(threadId: string, discordMessageId: string) {
  return updateConversationState(threadId, (conversation) => ({
    ...conversation,
    suppressedMessageIds: conversation.suppressedMessageIds.includes(discordMessageId)
      ? conversation.suppressedMessageIds
      : [...conversation.suppressedMessageIds, discordMessageId],
  }));
}

export async function storeDecodedMessage(
  threadId: string,
  discordMessageId: string,
  message: DecodedGhostscriptMessageState,
) {
  return updateConversationState(threadId, (conversation) => ({
    ...conversation,
    decodedMessages: {
      ...conversation.decodedMessages,
      [discordMessageId]: message,
    },
  }));
}

export async function setDecodedMessageActiveView(
  threadId: string,
  discordMessageId: string,
  activeView: DecodedGhostscriptMessageView,
) {
  return updateConversationState(threadId, (conversation) => {
    const existingMessage = conversation.decodedMessages[discordMessageId];
    if (!existingMessage) {
      return conversation;
    }

    return {
      ...conversation,
      decodedMessages: {
        ...conversation.decodedMessages,
        [discordMessageId]: {
          ...existingMessage,
          activeView,
        },
      },
    };
  });
}

async function writeGhostscriptState(state: GhostscriptState) {
  await writeStorageValue(GHOSTSCRIPT_STATE_STORAGE_KEY, state);
}

function createEmptyConversationState(threadId: string): GhostscriptConversationState {
  return {
    threadId,
    nextOutboundMessageId: 1,
    pinnedEncodingConfigId: DEFAULT_TRANSPORT_CONFIG_ID,
    cachedMessages: [],
    suppressedMessageIds: [],
    decodedMessages: {},
    confirmedEncodedMessages: [],
    pendingSend: null,
  };
}

function normalizeConversationState(conversation: GhostscriptConversationState): GhostscriptConversationState {
  return {
    ...conversation,
    pinnedEncodingConfigId: conversation.pinnedEncodingConfigId ?? DEFAULT_TRANSPORT_CONFIG_ID,
    confirmedEncodedMessages: conversation.confirmedEncodedMessages ?? [],
    pendingSend: conversation.pendingSend
      ? {
          ...conversation.pendingSend,
          encodedMessage: conversation.pendingSend.encodedMessage ?? null,
        }
      : null,
    decodedMessages: Object.fromEntries(
      Object.entries(conversation.decodedMessages).map(([discordMessageId, message]) => [
        discordMessageId,
        {
          ...message,
          activeView: normalizeDecodedMessageActiveView(message.activeView as LegacyDecodedGhostscriptMessageView),
          encodedMessage: message.encodedMessage ?? null,
        },
      ]),
    ),
  };
}

function isWrappedIdentityBundle(value: WrappedIdentityBundle | LegacyLocalIdentityKeypair): value is WrappedIdentityBundle {
  return "wrappedKeyMaterial" in value && "wrapSalt" in value && "wrapNonce" in value;
}

function mergeConversationMessages(
  existingMessages: GhostscriptThreadMessage[],
  nextMessages: GhostscriptThreadMessage[],
) {
  const merged = new Map<string, GhostscriptThreadMessage>();

  for (const message of [...existingMessages, ...nextMessages]) {
    merged.set(message.discordMessageId, message);
  }

  return Array.from(merged.values()).sort(compareMessagesAscending);
}

function compareMessagesAscending(left: GhostscriptThreadMessage, right: GhostscriptThreadMessage) {
  if (left.snowflakeTimestamp !== right.snowflakeTimestamp) {
    return left.snowflakeTimestamp.localeCompare(right.snowflakeTimestamp);
  }

  try {
    const leftId = BigInt(left.discordMessageId);
    const rightId = BigInt(right.discordMessageId);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  } catch {
    return left.discordMessageId.localeCompare(right.discordMessageId);
  }
}
