import type { ActivePairingState, GhostscriptThreadMessage } from "@ghostscript/shared";
import { deserializeEnvelopeFromBitstring, estimateWordTarget, serializeEnvelopeToBitstring } from "./bitstream";
import { decryptMessageEnvelope, encryptMessageEnvelope, type SessionCryptoMaterial } from "./crypto";
import {
  buildBoundedConversationWindow,
  collectTwoPartyMessages,
  getCurrentDiscordThreadId,
  hideDiscordMessageLocally,
  renderDecodedMessageOverlay,
  sendTextThroughDiscord,
} from "./discord";
import {
  cacheConversationMessages,
  getLocalIdentityKeypair,
  reserveNextMessageId,
  readConversationState,
  setPendingSend,
  markSuppressedMessage,
  storeDecodedMessage,
} from "./ghostscriptState";
import { buildConversationPrompt, decodeCoverTextToBitstring, encodeBitstringAsCoverText, getDefaultEncodingConfig } from "./llmBridge";

export async function sendEncryptedGhostscriptMessage(params: {
  plaintext: string;
  pairing: ActivePairingState;
  localUsername: string;
  partnerUsername: string;
}) {
  const threadId = getRequiredThreadId();
  const existingConversation = await readConversationState(threadId);
  if (existingConversation.pendingSend && existingConversation.pendingSend.status !== "failed") {
    throw new Error("Wait for Discord to confirm the previous Ghostscript message before sending another one.");
  }

  const conversationMessages = collectTwoPartyMessages(params.localUsername, params.partnerUsername);
  await cacheConversationMessages(threadId, conversationMessages);

  const material = await getSessionCryptoMaterial(params.pairing);
  const msgId = await reserveNextMessageId(threadId);

  await setPendingSend(threadId, {
    threadId,
    status: "encoding",
    expectedCoverText: "",
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
      wordTarget,
      messages: buildBoundedConversationWindow(conversationMessages),
    });
    const visibleText = await encodeBitstringAsCoverText({
      prompt,
      bitstring,
      wordTarget,
      config: encodingConfig,
    });

    await setPendingSend(threadId, {
      threadId,
      status: "awaiting-discord-confirm",
      expectedCoverText: visibleText,
      startedAt: Date.now(),
      msgId,
      error: null,
    });

    await sendTextThroughDiscord(visibleText);
    return { visibleText };
  } catch (error) {
    await setPendingSend(threadId, {
      threadId,
      status: "failed",
      expectedCoverText: "",
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

  const messages = collectTwoPartyMessages(params.localUsername, params.partnerUsername);
  await cacheConversationMessages(threadId, messages);

  await reconcilePendingSend(messages);
  const conversation = await readConversationState(threadId);
  await applySuppressedMessages(threadId);
  await decodeIncomingMessages(params, messages, conversation.suppressedMessageIds);
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
      continue;
    }

    if (suppressedMessageIds.includes(message.discordMessageId) || conversation.decodedMessages[message.discordMessageId]) {
      continue;
    }

    const priorMessages = messages.filter((candidate) => compareMessageOrder(candidate, message) < 0);
    const prompt = buildConversationPrompt({
      coverTopic: params.pairing.defaultCoverTopic ?? "general chat",
      wordTarget: estimateWordTarget(message.text.length * 6, getDefaultEncodingConfig().bitsPerStep),
      messages: buildBoundedConversationWindow(priorMessages),
    });

    let bitstring: string | null = null;
    try {
      bitstring = await decodeCoverTextToBitstring({
        visibleText: message.text,
        prompt,
      });
    } catch {
      continue;
    }

    if (!bitstring) {
      continue;
    }

    try {
      const envelope = deserializeEnvelopeFromBitstring(bitstring);
      const plaintext = await decryptMessageEnvelope(envelope, material);
      await storeDecodedMessage(threadId, message.discordMessageId, {
        status: "decoded",
        plaintext,
        visibleText: message.text,
        processedAt: new Date().toISOString(),
      });
      renderDecodedMessageOverlay({
        discordMessageId: message.discordMessageId,
        status: "decoded",
        plaintext,
      });
    } catch {
      await storeDecodedMessage(threadId, message.discordMessageId, {
        status: "tampered",
        plaintext: null,
        visibleText: message.text,
        processedAt: new Date().toISOString(),
      });
      renderDecodedMessageOverlay({
        discordMessageId: message.discordMessageId,
        status: "tampered",
        plaintext: null,
      });
    }
  }
}

async function getSessionCryptoMaterial(pairing: ActivePairingState): Promise<SessionCryptoMaterial> {
  const counterpart = pairing.counterpart;
  if (!counterpart?.identityPublicKey) {
    throw new Error("Your partner's Ghostscript key is not available yet.");
  }

  const localKeypair = await getLocalIdentityKeypair(pairing.session.id);
  if (!localKeypair) {
    throw new Error("The local Ghostscript identity key for this pairing is missing.");
  }

  return {
    sessionId: pairing.session.id,
    localParticipantId: pairing.localParticipant.id,
    counterpartParticipantId: counterpart.id,
    localPrivateKey: localKeypair.privateKey,
    counterpartPublicKey: counterpart.identityPublicKey,
  };
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
