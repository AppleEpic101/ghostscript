import test from "node:test";
import assert from "node:assert/strict";
import type { GhostscriptThreadMessage } from "@ghostscript/shared";
import { decodeRankedTextToBitstring, encodeBitstringAsRankedText } from "../../../ghostscript-api/src/transport";
import { estimateWordTarget, serializeEnvelopeToBitstring } from "./bitstream";
import { compressBitstringForTransport } from "./bitCompression";
import { generateIdentityBundle, encryptMessageEnvelope, decryptMessageEnvelope, type SessionCryptoMaterial } from "./crypto";
import { buildDecodeHistoryWindows } from "./decodedMessages";
import { attemptIncomingMessageDecode } from "./incomingMessageDecode";
import { buildConversationPrompt, getDefaultEncodingConfig } from "./llmBridge";

test("incoming decode succeeds with cached history when the visible DOM history is truncated", async () => {
  const alice = await generateIdentityBundle();
  const bob = await generateIdentityBundle();
  const config = getDefaultEncodingConfig();
  const aliceMaterial: SessionCryptoMaterial = {
    sessionId: "session-1",
    threadId: "thread-1",
    localParticipantId: "alice",
    counterpartParticipantId: "bob",
    localTransportPrivateKey: alice.transportPrivateKey,
    counterpartTransportPublicKey: bob.transportPublicKey,
  };
  const bobMaterial: SessionCryptoMaterial = {
    sessionId: "session-1",
    threadId: "thread-1",
    localParticipantId: "bob",
    counterpartParticipantId: "alice",
    localTransportPrivateKey: bob.transportPrivateKey,
    counterpartTransportPublicKey: alice.transportPublicKey,
  };

  const cachedHistory = [
    createMessage("100", "alice", "Want to meet near the station?"),
    createMessage("101", "bob", "Yeah, I can make that work."),
    createMessage("102", "alice", "Perfect, I might be a few minutes late."),
  ];
  const visibleHistory = cachedHistory.slice(1);
  const prompt = buildConversationPrompt({
    coverTopic: "coffee plans",
    messages: cachedHistory,
    wordTarget: estimateWordTarget(64, config.bitsPerStep),
    replyTurn: "",
  });
  const envelope = await encryptMessageEnvelope("Meet by the side entrance.", 11, aliceMaterial);
  const bitstring = await compressBitstringForTransport(serializeEnvelopeToBitstring(envelope));
  const visibleText = await encodeBitstringAsRankedText({
    prompt,
    bitstring: bitstring.bitstring,
    wordTarget: estimateWordTarget(bitstring.bitstring.length, config.bitsPerStep),
    config,
  });

  const decodeResult = await attemptIncomingMessageDecode({
    visibleText,
    coverTopic: "coffee plans",
    historyWindows: buildDecodeHistoryWindows(createWindow(visibleHistory), createWindow(cachedHistory)),
    material: bobMaterial,
    encodingConfigs: [config],
    defaultConfigId: config.configId,
    decodeBitstring: async ({ prompt: decodePrompt, visibleText: decodeVisibleText, config: decodeConfig }) =>
      decodeRankedTextToBitstring({
        prompt: decodePrompt,
        visibleText: decodeVisibleText,
        config: decodeConfig,
      }),
    decryptEnvelope: decryptMessageEnvelope,
    fingerprintPrompt: async (candidatePrompt) => candidatePrompt,
  });

  assert.deepEqual(decodeResult, {
    status: "decoded",
    plaintext: "Meet by the side entrance.",
    promptFingerprint: prompt,
    configId: config.configId,
  });
});

test("incoming decode succeeds for the first post-pairing message with no prior history", async () => {
  const alice = await generateIdentityBundle();
  const bob = await generateIdentityBundle();
  const config = getDefaultEncodingConfig();
  const aliceMaterial: SessionCryptoMaterial = {
    sessionId: "session-1",
    threadId: "thread-1",
    localParticipantId: "alice",
    counterpartParticipantId: "bob",
    localTransportPrivateKey: alice.transportPrivateKey,
    counterpartTransportPublicKey: bob.transportPublicKey,
  };
  const bobMaterial: SessionCryptoMaterial = {
    sessionId: "session-1",
    threadId: "thread-1",
    localParticipantId: "bob",
    counterpartParticipantId: "alice",
    localTransportPrivateKey: bob.transportPrivateKey,
    counterpartTransportPublicKey: alice.transportPublicKey,
  };

  const prompt = buildConversationPrompt({
    coverTopic: "coffee plans",
    messages: [],
    wordTarget: estimateWordTarget(64, config.bitsPerStep),
    replyTurn: "",
  });
  const envelope = await encryptMessageEnvelope("Meet by the side entrance.", 11, aliceMaterial);
  const bitstring = await compressBitstringForTransport(serializeEnvelopeToBitstring(envelope));
  const visibleText = await encodeBitstringAsRankedText({
    prompt,
    bitstring: bitstring.bitstring,
    wordTarget: estimateWordTarget(bitstring.bitstring.length, config.bitsPerStep),
    config,
  });

  const decodeResult = await attemptIncomingMessageDecode({
    visibleText,
    coverTopic: "coffee plans",
    historyWindows: buildDecodeHistoryWindows(createWindow([]), createWindow([])),
    material: bobMaterial,
    encodingConfigs: [config],
    defaultConfigId: config.configId,
    decodeBitstring: async ({ prompt: decodePrompt, visibleText: decodeVisibleText, config: decodeConfig }) =>
      decodeRankedTextToBitstring({
        prompt: decodePrompt,
        visibleText: decodeVisibleText,
        config: decodeConfig,
      }),
    decryptEnvelope: decryptMessageEnvelope,
    fingerprintPrompt: async (candidatePrompt) => candidatePrompt,
  });

  assert.deepEqual(decodeResult, {
    status: "decoded",
    plaintext: "Meet by the side entrance.",
    promptFingerprint: prompt,
    configId: config.configId,
  });
});

test("incoming decode remains compatible with legacy uncompressed transport bitstrings", async () => {
  const alice = await generateIdentityBundle();
  const bob = await generateIdentityBundle();
  const config = getDefaultEncodingConfig();
  const aliceMaterial: SessionCryptoMaterial = {
    sessionId: "session-1",
    threadId: "thread-1",
    localParticipantId: "alice",
    counterpartParticipantId: "bob",
    localTransportPrivateKey: alice.transportPrivateKey,
    counterpartTransportPublicKey: bob.transportPublicKey,
  };
  const bobMaterial: SessionCryptoMaterial = {
    sessionId: "session-1",
    threadId: "thread-1",
    localParticipantId: "bob",
    counterpartParticipantId: "alice",
    localTransportPrivateKey: bob.transportPrivateKey,
    counterpartTransportPublicKey: alice.transportPublicKey,
  };

  const prompt = buildConversationPrompt({
    coverTopic: "coffee plans",
    messages: [],
    wordTarget: estimateWordTarget(64, config.bitsPerStep),
    replyTurn: "",
  });
  const envelope = await encryptMessageEnvelope("Meet by the side entrance.", 11, aliceMaterial);
  const legacyBitstring = serializeEnvelopeToBitstring(envelope);
  const visibleText = await encodeBitstringAsRankedText({
    prompt,
    bitstring: legacyBitstring,
    wordTarget: estimateWordTarget(legacyBitstring.length, config.bitsPerStep),
    config,
  });

  const decodeResult = await attemptIncomingMessageDecode({
    visibleText,
    coverTopic: "coffee plans",
    historyWindows: buildDecodeHistoryWindows(createWindow([]), createWindow([])),
    material: bobMaterial,
    encodingConfigs: [config],
    defaultConfigId: config.configId,
    decodeBitstring: async ({ prompt: decodePrompt, visibleText: decodeVisibleText, config: decodeConfig }) =>
      decodeRankedTextToBitstring({
        prompt: decodePrompt,
        visibleText: decodeVisibleText,
        config: decodeConfig,
      }),
    decryptEnvelope: decryptMessageEnvelope,
    fingerprintPrompt: async (candidatePrompt) => candidatePrompt,
  });

  assert.deepEqual(decodeResult, {
    status: "decoded",
    plaintext: "Meet by the side entrance.",
    promptFingerprint: prompt,
    configId: config.configId,
  });
});

function createMessage(discordMessageId: string, authorUsername: string, text: string): GhostscriptThreadMessage {
  return {
    threadId: "thread-1",
    discordMessageId,
    authorUsername,
    text,
    direction: authorUsername === "alice" ? "outgoing" : "incoming",
    snowflakeTimestamp: new Date(Number(discordMessageId)).toISOString(),
  };
}

function createWindow(messages: GhostscriptThreadMessage[]) {
  return {
    threadId: "thread-1",
    messages,
    truncated: false,
    maxMessages: 18,
    maxChars: 3200,
  };
}
