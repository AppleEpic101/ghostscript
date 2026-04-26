import type { GhostscriptThreadMessage, PendingSendStatus } from "@ghostscript/shared";
import { readStorageValue, writeStorageValue } from "./storage";

const GHOSTSCRIPT_STATE_STORAGE_KEY = "ghostscript-extension-ghostscript-state";

export interface LocalIdentityKeypair {
  publicKey: string;
  privateKey: string;
}

export interface PendingSendState {
  threadId: string;
  sessionId: string;
  status: Exclude<PendingSendStatus, "idle">;
  expectedCoverText: string;
  startedAt: number;
  msgId: number;
  error: string | null;
}

export type DecodedGhostscriptMessageView = "decrypted" | "original";

export interface DecodedGhostscriptMessageState {
  status: "decoded" | "tampered";
  plaintext: string | null;
  visibleText: string;
  processedAt: string;
  activeView: DecodedGhostscriptMessageView;
}

export interface GhostscriptConversationState {
  threadId: string;
  nextOutboundMessageId: number;
  cachedMessages: GhostscriptThreadMessage[];
  suppressedMessageIds: string[];
  decodedMessages: Record<string, DecodedGhostscriptMessageState>;
  pendingSend: PendingSendState | null;
}

export interface GhostscriptState {
  identityKeysBySessionId: Record<string, LocalIdentityKeypair>;
  conversationsByThreadId: Record<string, GhostscriptConversationState>;
}

const EMPTY_STATE: GhostscriptState = {
  identityKeysBySessionId: {},
  conversationsByThreadId: {},
};

const PENDING_SEND_STALE_AFTER_MS = 30_000;

export async function readGhostscriptState(): Promise<GhostscriptState> {
  const state = await readStorageValue<GhostscriptState>(GHOSTSCRIPT_STATE_STORAGE_KEY);
  return state ?? EMPTY_STATE;
}

export async function storeLocalIdentityKeypair(sessionId: string, keypair: LocalIdentityKeypair) {
  const state = await readGhostscriptState();
  await writeGhostscriptState({
    ...state,
    identityKeysBySessionId: {
      ...state.identityKeysBySessionId,
      [sessionId]: keypair,
    },
  });
}

export async function getLocalIdentityKeypair(sessionId: string) {
  const state = await readGhostscriptState();
  return state.identityKeysBySessionId[sessionId] ?? null;
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
    cachedMessages: messages,
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

  return now - pendingSend.startedAt > PENDING_SEND_STALE_AFTER_MS;
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
    cachedMessages: [],
    suppressedMessageIds: [],
    decodedMessages: {},
    pendingSend: null,
  };
}

function normalizeConversationState(conversation: GhostscriptConversationState): GhostscriptConversationState {
  return {
    ...conversation,
    decodedMessages: Object.fromEntries(
      Object.entries(conversation.decodedMessages).map(([discordMessageId, message]) => [
        discordMessageId,
        {
          ...message,
          activeView: message.activeView ?? "decrypted",
        },
      ]),
    ),
  };
}
