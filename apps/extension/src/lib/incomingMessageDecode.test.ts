import test from "node:test";
import assert from "node:assert/strict";
import type { GhostscriptThreadMessage } from "@ghostscript/shared";
import { decodeRankedTextToBitstring, encodeBitstringAsRankedText } from "../../../ghostscript-api/src/transport";
import { buildDecodeHistoryWindows } from "./decodedMessages";
import { attemptIncomingMessageDecode } from "./incomingMessageDecode";
import { buildConversationPrompt, getDefaultEncodingConfig } from "./llmBridge";
import { decodePlaintextFromTransportBitstring, encodePlaintextToTransportBitstring } from "./plaintextTransport";

test("incoming decode succeeds with cached history when the visible DOM history is truncated", async () => {
  const config = getDefaultEncodingConfig();

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
  const bitstring = encodePlaintextToTransportBitstring("Meet by the side entrance.");
  const visibleText = await encodeBitstringAsRankedText({
    prompt,
    bitstring,
    wordTarget: estimateWordTarget(bitstring.length, config.bitsPerStep),
    config,
  });

  const decodeResult = await attemptIncomingMessageDecode({
    visibleText,
    coverTopic: "coffee plans",
    historyWindows: buildDecodeHistoryWindows(createWindow(visibleHistory), createWindow(cachedHistory)),
    encodingConfigs: [config],
    decodeBitstring: async ({ prompt: decodePrompt, visibleText: decodeVisibleText, config: decodeConfig }) =>
      decodeRankedTextToBitstring({
        prompt: decodePrompt,
        visibleText: decodeVisibleText,
        config: decodeConfig,
      }),
    decodePlaintext: decodePlaintextFromTransportBitstring,
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
  const config = getDefaultEncodingConfig();

  const prompt = buildConversationPrompt({
    coverTopic: "coffee plans",
    messages: [],
    wordTarget: estimateWordTarget(64, config.bitsPerStep),
    replyTurn: "",
  });
  const bitstring = encodePlaintextToTransportBitstring("Meet by the side entrance.");
  const visibleText = await encodeBitstringAsRankedText({
    prompt,
    bitstring,
    wordTarget: estimateWordTarget(bitstring.length, config.bitsPerStep),
    config,
  });

  const decodeResult = await attemptIncomingMessageDecode({
    visibleText,
    coverTopic: "coffee plans",
    historyWindows: buildDecodeHistoryWindows(createWindow([]), createWindow([])),
    encodingConfigs: [config],
    decodeBitstring: async ({ prompt: decodePrompt, visibleText: decodeVisibleText, config: decodeConfig }) =>
      decodeRankedTextToBitstring({
        prompt: decodePrompt,
        visibleText: decodeVisibleText,
        config: decodeConfig,
      }),
    decodePlaintext: decodePlaintextFromTransportBitstring,
    fingerprintPrompt: async (candidatePrompt) => candidatePrompt,
  });

  assert.deepEqual(decodeResult, {
    status: "decoded",
    plaintext: "Meet by the side entrance.",
    promptFingerprint: prompt,
    configId: config.configId,
  });
});

test("incoming decode ignores cover text that does not decode into a valid plaintext payload", async () => {
  const config = getDefaultEncodingConfig();

  const prompt = buildConversationPrompt({
    coverTopic: "coffee plans",
    messages: [],
    wordTarget: estimateWordTarget(64, config.bitsPerStep),
    replyTurn: "",
  });
  const legacyBitstring = "101010101010";
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
    encodingConfigs: [config],
    decodeBitstring: async ({ prompt: decodePrompt, visibleText: decodeVisibleText, config: decodeConfig }) =>
      decodeRankedTextToBitstring({
        prompt: decodePrompt,
        visibleText: decodeVisibleText,
        config: decodeConfig,
      }),
    decodePlaintext: decodePlaintextFromTransportBitstring,
    fingerprintPrompt: async (candidatePrompt) => candidatePrompt,
  });

  assert.equal(decodeResult, null);
});

function estimateWordTarget(payloadBitLength: number, bitsPerToken: number) {
  const estimatedTokens = Math.max(12, Math.ceil(payloadBitLength / Math.max(bitsPerToken, 1)));
  return Math.max(10, Math.ceil(estimatedTokens * 0.7));
}

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
