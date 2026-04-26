import type { ActivePairingState, GhostscriptThreadMessage } from "@ghostscript/shared";
import { estimateWordTarget, serializeEnvelopeToBitstring } from "./bitstream";
import { decryptMessageEnvelope, encryptMessageEnvelope, type SessionCryptoMaterial } from "./crypto";
import { buildDecodeHistoryWindows } from "./decodedMessages";
import {
  buildBoundedConversationWindow,
  collectTwoPartyMessages,
  getCurrentDiscordThreadId,
  hideDiscordMessageLocally,
  renderDebugOverlayOnAllMessages,
  renderDecodedMessageOverlay,
  sendTextThroughDiscord,
} from "./discord";
import { attemptIncomingMessageDecode } from "./incomingMessageDecode";
import {
  cacheConversationMessages,
  getLocalIdentityBundle,
  isPendingSendStale,
  type DecodedGhostscriptMessageState,
  reserveNextMessageId,
  readConversationState,
  setPendingSend,
  markSuppressedMessage,
  storeDecodedMessage,
} from "./ghostscriptState";
import {
  buildConversationPrompt,
  decodeCoverTextToBitstring,
  encodeBitstringAsCoverText,
  fingerprintTransportPrompt,
  getDefaultEncodingConfig,
  getSupportedEncodingConfigs,
  getTransportProtocolVersion,
} from "./llmBridge";
import { readExtensionState } from "./pairingStore";

const DISCORD_MAX_MESSAGE_LENGTH = 2000;

export async function sendEncryptedGhostscriptMessage(params: {
  plaintext: string;
  pairing: ActivePairingState;
  localUsername: string;
  partnerUsername: string;
}) {
  const threadId = getRequiredThreadId();
  const existingConversation = await readConversationState(threadId);
  if (isPendingSendStale(existingConversation.pendingSend, params.pairing.session.id)) {
    await setPendingSend(threadId, null);
  }

  const refreshedConversation = await readConversationState(threadId);
  if (refreshedConversation.pendingSend && refreshedConversation.pendingSend.status !== "failed") {
    throw new Error("Wait for Discord to confirm the previous Ghostscript message before sending another one.");
  }

  const conversationMessages = collectTwoPartyMessages(
    params.localUsername,
    params.partnerUsername,
    getPairingEstablishedAt(params.pairing),
  );
  await cacheConversationMessages(threadId, conversationMessages);
  const conversation = await readConversationState(threadId);

  const material = await getSessionCryptoMaterial(params.pairing);
  const msgId = await reserveNextMessageId(threadId);

  await setPendingSend(threadId, {
    threadId,
    sessionId: params.pairing.session.id,
    status: "encoding",
    expectedCoverText: "",
    encodedMessage: null,
    startedAt: Date.now(),
    msgId,
    error: null,
  });

  try {
    const envelope = await encryptMessageEnvelope(params.plaintext, msgId, material);
    const bitstring = serializeEnvelopeToBitstring(envelope);
    const encodingConfig = getDefaultEncodingConfig();
    const wordTarget = estimateWordTarget(bitstring.length, encodingConfig.bitsPerStep);
    const prompt = buildConversationPrompt({
      coverTopic: params.pairing.defaultCoverTopic ?? "general chat",
      messages: buildBoundedConversationWindow(conversation.cachedMessages),
    });
    const visibleText = await encodeBitstringAsCoverText({
      prompt,
      bitstring,
      wordTarget,
      config: encodingConfig,
    });
    const encodedMessage = {
      visibleText,
      configId: encodingConfig.configId,
      transportProtocolVersion: getTransportProtocolVersion(),
      promptFingerprint: await fingerprintTransportPrompt(prompt),
    };

    if (visibleText.length > DISCORD_MAX_MESSAGE_LENGTH) {
      throw new Error(
        `Ghostscript generated ${visibleText.length} characters of cover text, which exceeds Discord's ${DISCORD_MAX_MESSAGE_LENGTH}-character limit.`,
      );
    }

    await setPendingSend(threadId, {
      threadId,
      sessionId: params.pairing.session.id,
      status: "awaiting-discord-confirm",
      expectedCoverText: visibleText,
      encodedMessage,
      startedAt: Date.now(),
      msgId,
      error: null,
    });

    await sendTextThroughDiscord(visibleText);
    return { visibleText };
  } catch (error) {
    await setPendingSend(threadId, {
      threadId,
      sessionId: params.pairing.session.id,
      status: "failed",
      expectedCoverText: "",
      encodedMessage: null,
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
  console.info("[Ghostscript] Sync collected in-scope thread messages.", {
    threadId,
    pairingEstablishedAt,
    messageCount: messages.length,
    incomingCount: messages.filter((message) => message.direction === "incoming").length,
    outgoingCount: messages.filter((message) => message.direction === "outgoing").length,
  });
  await renderDebugOverlayOnAllMessages(messages);
  await cacheConversationMessages(threadId, messages);

  await reconcilePendingSend(messages);
  const conversation = await readConversationState(threadId);
  await applySuppressedMessages(threadId);
  await decodeIncomingMessages(params, messages, conversation.suppressedMessageIds);
  await restoreDecodedMessageOverlays(threadId, messages);
  await renderDebugOverlayOnAllMessages(messages);
}

async function reconcilePendingSend(messages: GhostscriptThreadMessage[]) {
  const threadId = getRequiredThreadId();
  const conversation = await readConversationState(threadId);
  const pendingSend = conversation.pendingSend;

  if (!pendingSend || pendingSend.status !== "awaiting-discord-confirm") {
    return;
  }

  const matchingOutgoingMessage = messages.find(
    (message) =>
      message.direction === "outgoing" &&
      message.text.trim() === pendingSend.expectedCoverText &&
      Date.parse(message.snowflakeTimestamp) >= pendingSend.startedAt,
  );

  if (matchingOutgoingMessage) {
    await setPendingSend(threadId, null);
    return;
  }

  const partnerMessagesDuringWindow = messages.filter(
    (message) =>
      message.direction === "incoming" &&
      Date.parse(message.snowflakeTimestamp) >= pendingSend.startedAt &&
      !conversation.suppressedMessageIds.includes(message.discordMessageId),
  );

  for (const message of partnerMessagesDuringWindow) {
    await markSuppressedMessage(threadId, message.discordMessageId);
    hideDiscordMessageLocally(message.discordMessageId);
  }
}

async function applySuppressedMessages(threadId: string) {
  const conversation = await readConversationState(threadId);

  for (const messageId of conversation.suppressedMessageIds) {
    hideDiscordMessageLocally(messageId);
  }
}

async function decodeIncomingMessages(
  params: { pairing: ActivePairingState; localUsername: string; partnerUsername: string },
  messages: GhostscriptThreadMessage[],
  suppressedMessageIds: string[],
) {
  const threadId = getRequiredThreadId();
  const conversation = await readConversationState(threadId);
  const material = await getSessionCryptoMaterial(params.pairing);

  for (const message of messages) {
    if (message.direction !== "incoming") {
      console.info("[Ghostscript] Decode skipped.", {
        threadId,
        discordMessageId: message.discordMessageId,
        reason: "not-incoming",
      });
      continue;
    }

    if (suppressedMessageIds.includes(message.discordMessageId)) {
      console.info("[Ghostscript] Decode skipped.", {
        threadId,
        discordMessageId: message.discordMessageId,
        reason: "suppressed",
      });
      continue;
    }

    if (conversation.decodedMessages[message.discordMessageId]) {
      console.info("[Ghostscript] Decode skipped.", {
        threadId,
        discordMessageId: message.discordMessageId,
        reason: "already-processed",
      });
      continue;
    }

    const priorMessages = messages.filter((candidate) => compareMessageOrder(candidate, message) < 0);
    const cachedPriorMessages = conversation.cachedMessages.filter((candidate) => compareMessageOrder(candidate, message) < 0);
    const visibleHistoryWindow = buildBoundedConversationWindow(priorMessages);
    const cachedHistoryWindow = buildBoundedConversationWindow(cachedPriorMessages);
    const historyWindows = buildDecodeHistoryWindows(visibleHistoryWindow, cachedHistoryWindow);

    console.info("[Ghostscript] Decode attempting.", {
      threadId,
      discordMessageId: message.discordMessageId,
      visibleHistoryMessageCount: visibleHistoryWindow.length,
      cachedHistoryMessageCount: cachedHistoryWindow.length,
      historyWindowCount: historyWindows.length,
    });

    const diagnostics: Array<{ outcome: string; configId: string; historyWindowSize: number; error?: string }> = [];
    const decodeResult = await attemptIncomingMessageDecode({
      visibleText: message.text,
      coverTopic: params.pairing.defaultCoverTopic ?? "general chat",
      historyWindows,
      material,
      encodingConfigs: getSupportedEncodingConfigs(),
      defaultConfigId: getDefaultEncodingConfig().configId,
      decodeBitstring: decodeCoverTextToBitstring,
      decryptEnvelope: decryptMessageEnvelope,
      fingerprintPrompt: fingerprintTransportPrompt,
      onAttempt(event) {
        diagnostics.push({
          outcome: event.outcome,
          configId: event.configId,
          historyWindowSize: event.historyWindowSize,
          error: event.error,
        });
      },
    });

    if (!decodeResult) {
      console.info("[Ghostscript] Decode completed without a recoverable Ghostscript payload.", {
        threadId,
        discordMessageId: message.discordMessageId,
        diagnostics,
        outcome: "not-decoded",
      });
      continue;
    }

    if (decodeResult.status === "decoded") {
      console.info("[Ghostscript] Last decrypted incoming message:", {
        threadId,
        discordMessageId: message.discordMessageId,
        plaintext: decodeResult.plaintext,
        diagnostics,
      });
      await storeDecodedMessage(threadId, message.discordMessageId, {
        status: "decoded",
        plaintext: decodeResult.plaintext,
        visibleText: message.text,
        encodedMessage: {
          visibleText: message.text,
          configId: decodeResult.configId,
          transportProtocolVersion: getTransportProtocolVersion(),
          promptFingerprint: decodeResult.promptFingerprint,
        },
        processedAt: new Date().toISOString(),
        activeView: "decrypted",
      });
      renderDecodedMessageOverlay({
        threadId,
        discordMessageId: message.discordMessageId,
        status: "decoded",
        plaintext: decodeResult.plaintext,
        visibleText: message.text,
        activeView: "decrypted",
      });
      continue;
    }

    if (decodeResult.status === "tampered") {
      console.info("[Ghostscript] Decode recovered a framed payload but authentication failed.", {
        threadId,
        discordMessageId: message.discordMessageId,
        diagnostics,
        outcome: "tampered",
      });
      await storeDecodedMessage(threadId, message.discordMessageId, {
        status: "tampered",
        plaintext: null,
        visibleText: message.text,
        encodedMessage: {
          visibleText: message.text,
          configId: decodeResult.configId,
          transportProtocolVersion: getTransportProtocolVersion(),
          promptFingerprint: decodeResult.promptFingerprint,
        },
        processedAt: new Date().toISOString(),
        activeView: "decrypted",
      });
      renderDecodedMessageOverlay({
        threadId,
        discordMessageId: message.discordMessageId,
        status: "tampered",
        plaintext: null,
        visibleText: message.text,
        activeView: "decrypted",
      });
    }
  }
}

async function restoreDecodedMessageOverlays(threadId: string, messages: GhostscriptThreadMessage[]) {
  const conversation = await readConversationState(threadId);
  const eligibleIncomingMessageIds = new Set(
    messages.filter((message) => message.direction === "incoming").map((message) => message.discordMessageId),
  );

  for (const [discordMessageId, decodedMessage] of Object.entries(conversation.decodedMessages)) {
    if (!eligibleIncomingMessageIds.has(discordMessageId)) {
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

function compareMessageOrder(left: GhostscriptThreadMessage, right: GhostscriptThreadMessage) {
  if (left.snowflakeTimestamp !== right.snowflakeTimestamp) {
    return left.snowflakeTimestamp.localeCompare(right.snowflakeTimestamp);
  }

  return left.discordMessageId.localeCompare(right.discordMessageId);
}

function getPairingEstablishedAt(pairing: ActivePairingState) {
  return pairing.session.joinedAt ?? pairing.session.createdAt;
}
