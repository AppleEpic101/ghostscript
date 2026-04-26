import test from "node:test";
import assert from "node:assert/strict";
import type { GhostscriptThreadMessage } from "@ghostscript/shared";
import { decodeRankedTextToBitstring, encodeBitstringAsRankedText } from "../../../ghostscript-api/src/transport";
import { serializeEnvelopeToBitstring } from "./bitstream";
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
  });
  const envelope = await encryptMessageEnvelope("Meet by the side entrance.", 11, aliceMaterial);
  const visibleText = encodeBitstringAsRankedText({
    prompt,
    bitstring: serializeEnvelopeToBitstring(envelope),
    wordTarget: 20,
    config,
  });

  const decodeResult = await attemptIncomingMessageDecode({
    visibleText,
    coverTopic: "coffee plans",
    historyWindows: buildDecodeHistoryWindows(visibleHistory, cachedHistory),
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
