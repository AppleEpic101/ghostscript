import type { ActivePairingState, EncodedGhostscriptMessage, GhostscriptThreadMessage } from "@ghostscript/shared";
import { buildDecodeHistoryWindows } from "./decodedMessages";
import {
  buildBoundedConversationWindow,
  collectTwoPartyMessages,
  getCurrentDiscordThreadId,
  hideDiscordMessageLocally,
  renderDecodedMessageOverlay,
  sendTextThroughDiscord,
} from "./discord";
import { attemptIncomingMessageDecode } from "./incomingMessageDecode";
import {
  cacheConversationMessages,
  isPendingSendStale,
  type DecodedGhostscriptMessageState,
  reserveNextMessageId,
  readConversationState,
  setPendingSend,
  markSuppressedMessage,
  storeConfirmedEncodedMessage,
  storeDecodedMessage,
} from "./ghostscriptState";
import {
  decodeCoverTextToBitstring,
  encodeBitstringAsCoverText,
  fingerprintTransportPrompt,
  getDefaultEncodingConfig,
  getSupportedEncodingConfigs,
  getTransportProtocolVersion,
} from "./llmBridge";
import { logGhostscriptDebug } from "./debugLog";
import { decodePlaintextFromTransportBitstring, encodePlaintextToTransportBitstring } from "./plaintextTransport";
import { countFilteredPromptMessages, filterPromptMessages } from "./promptHistory";
import { buildConversationPrompt, estimateWordTarget } from "./promptBuilder";

const DISCORD_MAX_MESSAGE_LENGTH = 2000;

export async function sendEncryptedGhostscriptMessage(params: {
  plaintext: string;
  pairing: ActivePairingState;
  localUsername: string;
  partnerUsername: string;
}) {
  const threadId = getRequiredThreadId();
  logGhostscriptDebug("messaging", "send-start", {
    threadId,
    sessionId: params.pairing.session.id,
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

  const msgId = await reserveNextMessageId(threadId);
  let attemptedCoverText = "";
  let attemptedEncodedMessage: EncodedGhostscriptMessage | null = null;

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
    const transportBitstring = encodePlaintextToTransportBitstring(params.plaintext);
    const encodingConfig = getDefaultEncodingConfig();
    const wordTarget = estimateWordTarget(transportBitstring.length, encodingConfig.bitsPerStep);
    const contextWindow = buildBoundedConversationWindow(promptMessages);
    const prompt = buildConversationPrompt({
      coverTopic: params.pairing.defaultCoverTopic ?? "general chat",
      contextWindow,
      wordTarget,
      replyTurn: params.plaintext,
    });
    logGhostscriptDebug("messaging", "send-prompt-built", {
      threadId,
      sessionId: params.pairing.session.id,
      prompt,
      promptLength: prompt.length,
    });
    const visibleText = await encodeBitstringAsCoverText({
      prompt,
      bitstring: transportBitstring,
      wordTarget,
      config: encodingConfig,
    });
    logGhostscriptDebug("messaging", "send-transport-encoded", {
      threadId,
      sessionId: params.pairing.session.id,
      plaintextBitLength: transportBitstring.length - 32,
      framedBitLength: transportBitstring.length,
    });
    const encodedMessage = {
      visibleText,
      configId: encodingConfig.configId,
      modelId: encodingConfig.modelId,
      tokenizerId: encodingConfig.tokenizerId,
      transportBackend: encodingConfig.transportBackend,
      msgId,
      estimatedWordTarget: wordTarget,
      transportProtocolVersion: getTransportProtocolVersion(),
      promptFingerprint: await fingerprintTransportPrompt(prompt),
    };
    attemptedCoverText = visibleText;
    attemptedEncodedMessage = encodedMessage;

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
    logGhostscriptDebug("messaging", "send-discord-submit-complete", {
      threadId,
      sessionId: params.pairing.session.id,
      visibleText,
      visibleTextLength: visibleText.length,
    });
    return { visibleText };
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
      expectedCoverText: attemptedCoverText,
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
  await applySuppressedMessages(threadId);
  await decodeIncomingMessages(params, messages, conversation.suppressedMessageIds);
  await restoreDecodedMessageOverlays(threadId, messages);
}

async function reconcilePendingSend(messages: GhostscriptThreadMessage[]) {
  const threadId = getRequiredThreadId();
  const conversation = await readConversationState(threadId);
  const pendingSend = conversation.pendingSend;

  if (
    !pendingSend ||
    (pendingSend.status !== "awaiting-discord-confirm" && pendingSend.status !== "deleted-due-to-race")
  ) {
    return;
  }

  const matchingOutgoingMessage = messages.find(
    (message) =>
      message.direction === "outgoing" &&
      message.text.trim() === pendingSend.expectedCoverText &&
      Date.parse(message.snowflakeTimestamp) >= pendingSend.startedAt,
  );

  if (matchingOutgoingMessage) {
    if (pendingSend.encodedMessage) {
      await storeConfirmedEncodedMessage(threadId, pendingSend.encodedMessage);
    }
    await setPendingSend(threadId, {
      ...pendingSend,
      status: "confirmed",
      error: null,
    });
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
    await setPendingSend(threadId, pendingSend ? {
      ...pendingSend,
      status: "deleted-due-to-race",
      error: `Ignored partner message ${message.discordMessageId} while waiting for local Discord confirmation.`,
    } : null);
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

  for (const message of messages) {
    if (message.direction !== "incoming") {
      logGhostscriptDebug("messaging", "decode-skipped", {
        threadId,
        discordMessageId: message.discordMessageId,
        reason: "not-incoming",
      });
      continue;
    }

    if (suppressedMessageIds.includes(message.discordMessageId)) {
      logGhostscriptDebug("messaging", "decode-skipped", {
        threadId,
        discordMessageId: message.discordMessageId,
        reason: "suppressed",
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

    const priorMessages = messages.filter((candidate) => compareMessageOrder(candidate, message) < 0);
    const cachedPriorMessages = conversation.cachedMessages.filter((candidate) => compareMessageOrder(candidate, message) < 0);
    const visibleHistoryWindow = buildBoundedConversationWindow(filterPromptMessages(priorMessages, conversation));
    const cachedHistoryWindow = buildBoundedConversationWindow(filterPromptMessages(cachedPriorMessages, conversation));
    const historyWindows = buildDecodeHistoryWindows(visibleHistoryWindow, cachedHistoryWindow);

    logGhostscriptDebug("messaging", "decode-attempting", {
      threadId,
      discordMessageId: message.discordMessageId,
      visibleText: message.text,
      visibleHistoryMessageCount: visibleHistoryWindow.messages.length,
      cachedHistoryMessageCount: cachedHistoryWindow.messages.length,
      historyWindowCount: historyWindows.length,
    });

    const diagnostics: Array<{ outcome: string; configId: string; historyWindowSize: number; error?: string }> = [];
    const decodeResult = await attemptIncomingMessageDecode({
      visibleText: message.text,
      coverTopic: params.pairing.defaultCoverTopic ?? "general chat",
      historyWindows,
      encodingConfigs: getSupportedEncodingConfigs(),
      decodeBitstring: decodeCoverTextToBitstring,
      decodePlaintext: decodePlaintextFromTransportBitstring,
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
      logGhostscriptDebug("messaging", "decode-no-payload", {
        threadId,
        discordMessageId: message.discordMessageId,
        diagnostics,
        outcome: "not-decoded",
      });
      continue;
    }

    if (decodeResult.status === "decoded") {
      logGhostscriptDebug("messaging", "decode-success", {
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
          modelId: getDefaultEncodingConfig().modelId,
          tokenizerId: getDefaultEncodingConfig().tokenizerId,
          transportBackend: getDefaultEncodingConfig().transportBackend,
          msgId: 0,
          estimatedWordTarget: 0,
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
