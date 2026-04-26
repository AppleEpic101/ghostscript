import test from "node:test";
import assert from "node:assert/strict";
import type { EncodedGhostscriptMessage, GhostscriptThreadMessage } from "@ghostscript/shared";
import type { GhostscriptConversationState } from "./ghostscriptState";
import { collectKnownCoverTexts, filterPromptMessages } from "./promptHistory";

test("filterPromptMessages removes recognized Ghostscript cover text and preserves normal chat", () => {
  const recognizedVisibleText = "That sounds good, I can stop by after work.";
  const messages = [
    createMessage("100", "alice", recognizedVisibleText, "outgoing"),
    createMessage("101", "bob", "Cool, the line should be shorter by then.", "incoming"),
    createMessage("102", "alice", "I might be ten minutes late.", "outgoing"),
  ];
  const conversation = createConversation({
    confirmedEncodedMessages: [createEncodedMessage(recognizedVisibleText)],
  });

  assert.deepEqual(
    filterPromptMessages(messages, conversation).map((message) => message.discordMessageId),
    ["101", "102"],
  );
});

test("collectKnownCoverTexts includes decoded incoming and pending send cover text", () => {
  const decodedVisibleText = "Maybe the place by the station is easier tonight.";
  const pendingVisibleText = "I can swing by after the rush dies down.";
  const conversation = createConversation({
    decodedMessages: {
      incoming: {
        status: "decoded",
        plaintext: "secret",
        visibleText: decodedVisibleText,
        encodedMessage: createEncodedMessage(decodedVisibleText),
        processedAt: new Date(0).toISOString(),
        activeView: "decrypted",
      },
    },
    pendingSend: {
      threadId: "thread-1",
      sessionId: "session-1",
      status: "awaiting-discord-confirm",
      expectedCoverText: pendingVisibleText,
      encodedMessage: createEncodedMessage(pendingVisibleText),
      startedAt: Date.now(),
      msgId: 1,
      error: null,
    },
  });

  const texts = collectKnownCoverTexts(conversation);

  assert.equal(texts.has(decodedVisibleText), true);
  assert.equal(texts.has(pendingVisibleText), true);
});

test("collectKnownCoverTexts keeps failed send cover text so retries do not learn from it", () => {
  const failedVisibleText = "I can probably head over once the line settles down a little.";
  const conversation = createConversation({
    pendingSend: {
      threadId: "thread-1",
      sessionId: "session-1",
      status: "failed",
      expectedCoverText: failedVisibleText,
      encodedMessage: createEncodedMessage(failedVisibleText),
      startedAt: Date.now(),
      msgId: 2,
      error: "Discord rejected the draft.",
    },
  });

  const texts = collectKnownCoverTexts(conversation);

  assert.equal(texts.has(failedVisibleText), true);
});

function createConversation(
  overrides: Partial<GhostscriptConversationState>,
): Pick<GhostscriptConversationState, "confirmedEncodedMessages" | "decodedMessages" | "pendingSend"> {
  return {
    confirmedEncodedMessages: [],
    decodedMessages: {},
    pendingSend: null,
    ...overrides,
  };
}

function createEncodedMessage(visibleText: string): EncodedGhostscriptMessage {
  return {
    visibleText,
    configId: "ghostscript-default-v1",
    modelId: "xenova-distilgpt2-v1",
    tokenizerId: "gpt2-tokenizer-v1",
    transportBackend: "local-gpt2-top4-v1",
    msgId: 1,
    estimatedWordTarget: 16,
    transportProtocolVersion: 1,
    promptFingerprint: "prompt",
  };
}

function createMessage(
  discordMessageId: string,
  authorUsername: string,
  text: string,
  direction: GhostscriptThreadMessage["direction"],
): GhostscriptThreadMessage {
  return {
    threadId: "thread-1",
    discordMessageId,
    authorUsername,
    text,
    direction,
    snowflakeTimestamp: new Date(Number(discordMessageId)).toISOString(),
  };
}
