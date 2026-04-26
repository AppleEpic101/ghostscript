import type { ActivePairingState, EncodedGhostscriptMessage, GhostscriptThreadMessage } from "@ghostscript/shared";
import { serializeEnvelopeToBitstring } from "./bitstream";
import { compressBitstringForTransport } from "./bitCompression";
import { decryptMessageEnvelope, encryptMessageEnvelope, type SessionCryptoMaterial } from "./crypto";
import {
  buildBoundedConversationWindow,
  collectTwoPartyMessages,
  getCurrentDiscordThreadId,
  renderDecodedMessageOverlay,
  sendTextThroughDiscord,
  showDiscordMessageLocally,
} from "./discord";
import { attemptIncomingMessageDecode } from "./incomingMessageDecode";
import {
  cacheConversationMessages,
  clearSuppressedMessageIds,
  getLocalIdentityBundle,
  isPendingSendStale,
  type DecodedGhostscriptMessageState,
  type PendingSendState,
  readConversationState,
  reserveNextMessageId,
  setPendingSend,
  storeConfirmedEncodedMessage,
  storeDecodedMessage,
} from "./ghostscriptState";
import {
  buildCoverTextMessages,
  generateCoverText,
  getTransportProtocolVersion,
} from "./llmBridge";
import { logGhostscriptDebug } from "./debugLog";
import { appendInvisiblePayload, stripTransportPayload } from "./invisibleTransport";
import { readExtensionState } from "./pairingStore";
import { countFilteredPromptMessages, filterPromptMessages } from "./promptHistory";
import { encodeVisibleTransportPayload } from "./visibleTransport";

const DISCORD_MAX_MESSAGE_LENGTH = 2000;
const PENDING_SEND_MATCH_CLOCK_SKEW_MS = 15_000;

export async function sendEncryptedGhostscriptMessage(params: {
  plaintext: string;
  pairing: ActivePairingState;
  localUsername: string;
  partnerUsername: string;
  aiModeEnabled: boolean;
}) {
  const threadId = getRequiredThreadId();
  logGhostscriptDebug("messaging", "send-start", {
    threadId,
    sessionId: params.pairing.session.id,
    aiModeEnabled: params.aiModeEnabled,
    localUsername: params.localUsername,
    partnerUsername: params.partnerUsername,
    plaintext: params.plaintext,
    plaintextLength: params.plaintext.length,
  });
  const existingConversation = await readConversationState(threadId);
  if (isPendingSendStale(existingConversation.pendingSend, params.pairing.session.id)) {
    await setPendingSend(threadId, null);
  }

  const refreshedConversation = await readConversationState(threadId);
  if (
    refreshedConversation.pendingSend &&
    refreshedConversation.pendingSend.status !== "failed" &&
    refreshedConversation.pendingSend.status !== "confirmed"
  ) {
    throw new Error("Wait for Discord to confirm the previous Ghostscript message before sending another one.");
  }

  const conversationMessages = collectTwoPartyMessages(
    params.localUsername,
    params.partnerUsername,
    getPairingEstablishedAt(params.pairing),
  );
  logGhostscriptDebug("messaging", "send-collected-context", {
    threadId,
    sessionId: params.pairing.session.id,
    messageCount: conversationMessages.length,
  });
  await cacheConversationMessages(threadId, conversationMessages);
  const conversation = await readConversationState(threadId);
  const promptMessages = filterPromptMessages(conversation.cachedMessages, conversation);
  const filteredPromptMessageCount = countFilteredPromptMessages(conversation.cachedMessages, conversation);
  logGhostscriptDebug("messaging", "send-prompt-history-filtered", {
    threadId,
    sessionId: params.pairing.session.id,
    cachedMessageCount: conversation.cachedMessages.length,
    promptMessageCount: promptMessages.length,
    filteredPromptMessageCount,
  });

  const material = await getSessionCryptoMaterial(params.pairing);
  const msgId = await reserveNextMessageId(threadId);
  let attemptedSubmittedText = "";
  let attemptedEncodedMessage: EncodedGhostscriptMessage | null = null;

  await setPendingSend(threadId, {
    threadId,
    sessionId: params.pairing.session.id,
    status: "encoding",
    plaintext: params.plaintext,
    expectedCoverText: "",
    encodedMessage: null,
    startedAt: Date.now(),
    msgId,
    error: null,
  });

  try {
    const envelope = await encryptMessageEnvelope(params.plaintext, msgId, material);
    const envelopeBitstring = serializeEnvelopeToBitstring(envelope);
    const compressedTransport = await compressBitstringForTransport(envelopeBitstring);
    const submission = params.aiModeEnabled
      ? await buildAiModeSubmission({
          compressedTransportBitstring: compressedTransport.bitstring,
          coverTopic: params.pairing.defaultCoverTopic ?? "general chat",
          promptMessages,
          threadId,
          sessionId: params.pairing.session.id,
        })
      : buildVisiblePayloadSubmission(compressedTransport.bitstring);
    const submittedText = submission.submittedText;
    logGhostscriptDebug("messaging", "send-bitstring-compressed", {
      threadId,
      sessionId: params.pairing.session.id,
      aiModeEnabled: params.aiModeEnabled,
      originalBitLength: envelopeBitstring.length,
      framedBitLength: compressedTransport.framedBitLength,
      compressionFormat: compressedTransport.format,
    });
    const encodedMessage = {
      submittedText,
      visibleText: submission.visibleText,
      coverTextGenerator: submission.generator,
      modelId: submission.model,
      msgId,
      transportProtocolVersion: getTransportProtocolVersion(),
    };
    attemptedSubmittedText = submittedText;
    attemptedEncodedMessage = encodedMessage;

    if (submittedText.length > DISCORD_MAX_MESSAGE_LENGTH) {
      throw new Error(
        `Ghostscript generated ${submittedText.length} total characters, which exceeds Discord's ${DISCORD_MAX_MESSAGE_LENGTH}-character limit.`,
      );
    }

    await setPendingSend(threadId, {
      threadId,
      sessionId: params.pairing.session.id,
      status: "awaiting-discord-confirm",
      plaintext: params.plaintext,
      expectedCoverText: submittedText,
      encodedMessage,
      startedAt: Date.now(),
      msgId,
      error: null,
    });

    await sendTextThroughDiscord(submittedText);
    logGhostscriptDebug("messaging", "send-discord-submit-complete", {
      threadId,
      sessionId: params.pairing.session.id,
      aiModeEnabled: params.aiModeEnabled,
      visibleText: submission.visibleText,
      visibleTextLength: submission.visibleText.length,
      submittedTextLength: submittedText.length,
    });
    return { visibleText: submission.visibleText };
  } catch (error) {
    logGhostscriptDebug("messaging", "send-failed", {
      threadId,
      sessionId: params.pairing.session.id,
      error: error instanceof Error ? error.message : "Ghostscript send failed.",
    });
    if (attemptedEncodedMessage) {
      await storeConfirmedEncodedMessage(threadId, attemptedEncodedMessage);
    }
    await setPendingSend(threadId, {
      threadId,
      sessionId: params.pairing.session.id,
      status: "failed",
      plaintext: params.plaintext,
      expectedCoverText: attemptedSubmittedText,
      encodedMessage: attemptedEncodedMessage,
      startedAt: Date.now(),
      msgId,
      error: error instanceof Error ? error.message : "Ghostscript send failed.",
    });
    throw error;
  }
}

export async function syncGhostscriptConversation(params: {
  pairing: ActivePairingState;
  localUsername: string;
  partnerUsername: string;
}) {
  const threadId = getCurrentDiscordThreadId();
  if (!threadId) {
    return;
  }

  if (isPendingSendStale((await readConversationState(threadId)).pendingSend, params.pairing.session.id)) {
    await setPendingSend(threadId, null);
  }

  const pairingEstablishedAt = getPairingEstablishedAt(params.pairing);
  const messages = collectTwoPartyMessages(
    params.localUsername,
    params.partnerUsername,
    pairingEstablishedAt,
  );
  logGhostscriptDebug("messaging", "sync-collected-messages", {
    threadId,
    pairingEstablishedAt,
    messageCount: messages.length,
    incomingCount: messages.filter((message) => message.direction === "incoming").length,
    outgoingCount: messages.filter((message) => message.direction === "outgoing").length,
  });
  await cacheConversationMessages(threadId, messages);

  await reconcilePendingSend(messages);
  const conversation = await readConversationState(threadId);
  const filteredPromptMessageCount = countFilteredPromptMessages(conversation.cachedMessages, conversation);
  logGhostscriptDebug("messaging", "sync-prompt-history-filtered", {
    threadId,
    sessionId: params.pairing.session.id,
    cachedMessageCount: conversation.cachedMessages.length,
    filteredPromptMessageCount,
  });
  await restorePreviouslySuppressedMessages(threadId);
  await decodeIncomingMessages(params, messages);
  await restoreDecodedMessageOverlays(threadId, messages);
}

async function reconcilePendingSend(messages: GhostscriptThreadMessage[]) {
  const threadId = getRequiredThreadId();
  const conversation = await readConversationState(threadId);
  const pendingSend = conversation.pendingSend;

  if (!pendingSend || (pendingSend.status !== "awaiting-discord-confirm" && pendingSend.status !== "deleted-due-to-race")) {
    return;
  }

  const matchingOutgoingMessage = messages.find((message) => isMatchingPendingOutgoingMessage(message, pendingSend));

  if (matchingOutgoingMessage) {
    if (pendingSend.encodedMessage) {
      await storeConfirmedEncodedMessage(threadId, pendingSend.encodedMessage);
    }
    await storeDecodedMessage(threadId, matchingOutgoingMessage.discordMessageId, {
      status: "decoded",
      plaintext: pendingSend.plaintext,
      visibleText: pendingSend.encodedMessage?.visibleText ?? matchingOutgoingMessage.text,
      encodedMessage: pendingSend.encodedMessage,
      processedAt: new Date().toISOString(),
      activeView: "decrypted",
    });
    renderDecodedMessageOverlay({
      threadId,
      discordMessageId: matchingOutgoingMessage.discordMessageId,
      status: "decoded",
      plaintext: pendingSend.plaintext,
      visibleText: pendingSend.encodedMessage?.visibleText ?? matchingOutgoingMessage.text,
      activeView: "decrypted",
    });
    await setPendingSend(threadId, {
      ...pendingSend,
      status: "confirmed",
      error: null,
    });
    return;
  }
}

async function restorePreviouslySuppressedMessages(threadId: string) {
  const conversation = await readConversationState(threadId);

  for (const messageId of conversation.suppressedMessageIds) {
    showDiscordMessageLocally(messageId);
  }

  if (conversation.suppressedMessageIds.length > 0) {
    await clearSuppressedMessageIds(threadId);
  }
}

async function decodeIncomingMessages(
  params: { pairing: ActivePairingState; localUsername: string; partnerUsername: string },
  messages: GhostscriptThreadMessage[],
) {
  const threadId = getRequiredThreadId();
  const conversation = await readConversationState(threadId);
  const material = await getSessionCryptoMaterial(params.pairing);

  for (const message of messages) {
    if (message.direction !== "incoming") {
      logGhostscriptDebug("messaging", "decode-skipped", {
        threadId,
        discordMessageId: message.discordMessageId,
        reason: "not-incoming",
      });
      continue;
    }

    if (conversation.decodedMessages[message.discordMessageId]) {
      logGhostscriptDebug("messaging", "decode-skipped", {
        threadId,
        discordMessageId: message.discordMessageId,
        reason: "already-processed",
      });
      continue;
    }

    logGhostscriptDebug("messaging", "decode-attempting", {
      threadId,
      discordMessageId: message.discordMessageId,
      visibleText: message.text,
    });

    const decodeResult = await attemptIncomingMessageDecode({
      messageText: message.text,
      material,
      decryptEnvelope: decryptMessageEnvelope,
    });

    if (!decodeResult) {
      logGhostscriptDebug("messaging", "decode-no-payload", {
        threadId,
        discordMessageId: message.discordMessageId,
        outcome: "not-decoded",
      });
      continue;
    }

    if (decodeResult.status === "decoded") {
      logGhostscriptDebug("messaging", "decode-success", {
        threadId,
        discordMessageId: message.discordMessageId,
        plaintext: decodeResult.plaintext,
      });
      await storeDecodedMessage(threadId, message.discordMessageId, {
        status: "decoded",
        plaintext: decodeResult.plaintext,
        visibleText: decodeResult.visibleText,
        encodedMessage: {
          submittedText: message.text,
          visibleText: decodeResult.visibleText,
          coverTextGenerator: "invisible-unicode-suffix",
          modelId: "received-message",
          msgId: 0,
          transportProtocolVersion: getTransportProtocolVersion(),
        },
        processedAt: new Date().toISOString(),
        activeView: "decrypted",
      });
      renderDecodedMessageOverlay({
        threadId,
        discordMessageId: message.discordMessageId,
        status: "decoded",
        plaintext: decodeResult.plaintext,
        visibleText: decodeResult.visibleText,
        activeView: "decrypted",
      });
      continue;
    }

    if (decodeResult.status === "tampered") {
      logGhostscriptDebug("messaging", "decode-tampered", {
        threadId,
        discordMessageId: message.discordMessageId,
        outcome: "tampered",
      });
      await storeDecodedMessage(threadId, message.discordMessageId, {
        status: "tampered",
        plaintext: null,
        visibleText: decodeResult.visibleText,
        encodedMessage: {
          submittedText: message.text,
          visibleText: decodeResult.visibleText,
          coverTextGenerator: "invisible-unicode-suffix",
          modelId: "received-message",
          msgId: 0,
          transportProtocolVersion: getTransportProtocolVersion(),
        },
        processedAt: new Date().toISOString(),
        activeView: "decrypted",
      });
      renderDecodedMessageOverlay({
        threadId,
        discordMessageId: message.discordMessageId,
        status: "tampered",
        plaintext: null,
        visibleText: decodeResult.visibleText,
        activeView: "decrypted",
      });
    }
  }
}

async function restoreDecodedMessageOverlays(threadId: string, messages: GhostscriptThreadMessage[]) {
  const conversation = await readConversationState(threadId);
  const eligibleMessageIds = new Set(
    messages
      .filter((message) => message.direction === "incoming" || message.direction === "outgoing")
      .map((message) => message.discordMessageId),
  );

  for (const [discordMessageId, decodedMessage] of Object.entries(conversation.decodedMessages)) {
    if (!eligibleMessageIds.has(discordMessageId)) {
      continue;
    }

    renderStoredDecodedMessage(threadId, discordMessageId, decodedMessage);
  }
}

function renderStoredDecodedMessage(
  threadId: string,
  discordMessageId: string,
  decodedMessage: DecodedGhostscriptMessageState,
) {
  renderDecodedMessageOverlay({
    threadId,
    discordMessageId,
    status: decodedMessage.status,
    plaintext: decodedMessage.plaintext,
    visibleText: decodedMessage.visibleText,
    activeView: decodedMessage.activeView,
  });
}

async function getSessionCryptoMaterial(pairing: ActivePairingState): Promise<SessionCryptoMaterial> {
  const counterpart = pairing.counterpart;
  const counterpartTransportPublicKey = await resolveCounterpartTransportKey(pairing);
  if (!counterpart || !counterpartTransportPublicKey) {
    throw new Error("Your partner's Ghostscript key is not available yet.");
  }

  const localKeypair = await getLocalIdentityBundle(pairing.session.id);
  if (!localKeypair) {
    throw new Error("The local Ghostscript identity bundle is missing or still uses the legacy key format. Re-pair to continue.");
  }

  return {
    threadId: getRequiredThreadId(),
    sessionId: pairing.session.id,
    localParticipantId: pairing.localParticipant.id,
    counterpartParticipantId: counterpart.id,
    localTransportPrivateKey: localKeypair.transportPrivateKey,
    counterpartTransportPublicKey,
  };
}

async function resolveCounterpartTransportKey(pairing: ActivePairingState) {
  const directKey = pairing.counterpart?.transportPublicKey ?? (pairing.counterpart as { identityPublicKey?: string | null } | null)?.identityPublicKey ?? null;
  if (directKey) {
    return directKey;
  }

  const state = await readExtensionState();
  const contact = state.contacts.find(
    (candidate) =>
      candidate.id === pairing.counterpart?.id ||
      (candidate.sessionId === pairing.session.id && candidate.username === pairing.counterpart?.username),
  );

  return contact?.transportPublicKey ?? null;
}

function getRequiredThreadId() {
  const threadId = getCurrentDiscordThreadId();
  if (!threadId) {
    throw new Error("Ghostscript could not determine the active Discord thread.");
  }

  return threadId;
}

function getPairingEstablishedAt(pairing: ActivePairingState) {
  return pairing.session.joinedAt ?? pairing.session.createdAt;
}

async function buildAiModeSubmission(params: {
  compressedTransportBitstring: string;
  coverTopic: string;
  promptMessages: GhostscriptThreadMessage[];
  threadId: string;
  sessionId: string;
}) {
  const contextWindow = buildBoundedConversationWindow(params.promptMessages);
  const recentMessages = buildCoverTextMessages({
    contextWindow,
  });
  logGhostscriptDebug("messaging", "send-cover-context-built", {
    coverTopic: params.coverTopic,
    threadId: params.threadId,
    sessionId: params.sessionId,
    recentMessageCount: recentMessages.length,
  });
  const coverText = await generateCoverText({
    coverTopic: params.coverTopic,
    recentMessages,
  });

  return {
    submittedText: appendInvisiblePayload(coverText.visibleText, params.compressedTransportBitstring),
    visibleText: coverText.visibleText,
    generator: coverText.generator,
    model: coverText.model,
  };
}

function buildVisiblePayloadSubmission(compressedTransportBitstring: string) {
  const visiblePayload = encodeVisibleTransportPayload(compressedTransportBitstring);

  return {
    submittedText: visiblePayload,
    visibleText: visiblePayload,
    generator: "visible-ascii-transport",
    model: "visible-ascii-transport",
  };
}

export function isMatchingPendingOutgoingMessage(
  message: GhostscriptThreadMessage,
  pendingSend: Pick<PendingSendState, "expectedCoverText" | "startedAt">,
) {
  const messageTimestamp = Date.parse(message.snowflakeTimestamp);
  if (
    Number.isFinite(messageTimestamp) &&
    messageTimestamp < pendingSend.startedAt - PENDING_SEND_MATCH_CLOCK_SKEW_MS
  ) {
    return false;
  }

  const normalizedMessageText = normalizePendingSendMatchText(message.text);
  const normalizedMessageVisibleText = normalizePendingSendMatchText(stripTransportPayload(message.text));
  const normalizedExpectedText = normalizePendingSendMatchText(pendingSend.expectedCoverText);
  const normalizedExpectedVisibleText = normalizePendingSendMatchText(
    stripTransportPayload(pendingSend.expectedCoverText),
  );

  if (normalizedMessageText === normalizedExpectedText) {
    return message.direction !== "incoming";
  }

  if (message.direction !== "outgoing") {
    return false;
  }

  return (
    normalizedMessageText === normalizedExpectedVisibleText ||
    normalizedMessageVisibleText === normalizedExpectedVisibleText
  );
}

function normalizePendingSendMatchText(value: string) {
  return value.trim();
}
