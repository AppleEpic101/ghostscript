import test from "node:test";
import assert from "node:assert/strict";
import { buildConversationPrompt } from "../apps/extension/src/lib/llmBridge";
import { encodePlaintextToTransportBitstring, decodePlaintextFromTransportBitstring } from "../apps/extension/src/lib/plaintextTransport";
import { filterPromptMessages } from "../apps/extension/src/lib/promptHistory";
import { buildBoundedConversationWindow } from "../apps/extension/src/lib/discord";
import {
  decodeRankedTextToBitstring,
  encodeBitstringAsRankedText,
} from "../apps/ghostscript-api/src/transport";

test("plaintext survives real local GPT-2 rank-selection transport end to end", async () => {
  const plaintext = "Okay, station works.";
  const prompt = buildConversationPrompt({
    coverTopic: "weekend plans and coffee shops",
    messages: [
      createHistoryMessage("1", "Alice", "are you still free later?", "outgoing"),
      createHistoryMessage("2", "Bob", "probably, depends on how late the line is near the station", "incoming"),
    ],
    wordTarget: 16,
    replyTurn: "",
  });

  const transportBitstring = encodePlaintextToTransportBitstring(plaintext);
  const visibleText = await encodeBitstringAsRankedText({
    prompt,
    bitstring: transportBitstring,
    wordTarget: estimateWordTarget(transportBitstring.length, 3),
  });
  const decodedBitstring = await decodeRankedTextToBitstring({
    prompt,
    visibleText,
  });

  assert.equal(decodedBitstring, transportBitstring);
  assert.equal(decodePlaintextFromTransportBitstring(decodedBitstring ?? ""), plaintext);
});

test("full integration logs direct plaintext transport ratios", async () => {
  const plaintext = "Meet near the side entrance after dinner so we can talk without the line getting weird.";
  const plaintextUtf8Bits = new TextEncoder().encode(plaintext).length * 8;
  const transportBitstring = encodePlaintextToTransportBitstring(plaintext);
  const prompt = buildConversationPrompt({
    coverTopic: "dinner plans and crowded stations",
    messages: [
      createHistoryMessage("1", "Alice", "the line was a mess yesterday", "outgoing"),
      createHistoryMessage("2", "Bob", "yeah we should probably meet somewhere quieter", "incoming"),
    ],
    wordTarget: 16,
    replyTurn: "",
  });

  const visibleText = await encodeBitstringAsRankedText({
    prompt,
    bitstring: transportBitstring,
    wordTarget: estimateWordTarget(transportBitstring.length, 3),
  });
  const decodedBitstring = await decodeRankedTextToBitstring({
    prompt,
    visibleText,
  });
  const recoveredPlaintext = decodePlaintextFromTransportBitstring(decodedBitstring ?? "");

  assert.equal(decodedBitstring, transportBitstring);
  assert.equal(recoveredPlaintext, plaintext);

  console.log(
    [
      "full-integration-ratios",
      `plaintextUtf8Bits=${plaintextUtf8Bits}`,
      `framedTransportBits=${transportBitstring.length}`,
      `headerOverheadBits=${transportBitstring.length - plaintextUtf8Bits}`,
      `transportRatio=${(transportBitstring.length / Math.max(1, plaintextUtf8Bits)).toFixed(3)}`,
      `visibleChars=${visibleText.length}`,
    ].join(" | "),
  );
});

test("one-word message survives full round trip with direct transport metrics", async () => {
  const plaintext = "hi";
  const plaintextUtf8Bytes = new TextEncoder().encode(plaintext).length;
  const transportBitstring = encodePlaintextToTransportBitstring(plaintext);
  const estimatedWordTarget = estimateWordTarget(transportBitstring.length, 3);
  const prompt = buildConversationPrompt({
    coverTopic: "quick coffee check-in",
    messages: [
      createHistoryMessage("1", "Alice", "still around later?", "outgoing"),
      createHistoryMessage("2", "Bob", "yeah probably, just finishing one thing first", "incoming"),
    ],
    wordTarget: 16,
    replyTurn: "",
  });

  const visibleText = await encodeBitstringAsRankedText({
    prompt,
    bitstring: transportBitstring,
    wordTarget: estimatedWordTarget,
  });
  const decodedBitstring = await decodeRankedTextToBitstring({
    prompt,
    visibleText,
  });
  const recoveredPlaintext = decodePlaintextFromTransportBitstring(decodedBitstring ?? "");

  assert.equal(decodedBitstring, transportBitstring);
  assert.equal(recoveredPlaintext, plaintext);

  console.log(
    [
      "one-word-roundtrip-metrics",
      `plaintext="${plaintext}"`,
      `plaintextChars=${plaintext.length}`,
      `plaintextUtf8Bytes=${plaintextUtf8Bytes}`,
      `transportBits=${transportBitstring.length}`,
      `estimatedWordTarget=${estimatedWordTarget}`,
      `visibleChars=${visibleText.length}`,
      `visibleWords=${visibleText.trim().split(/\s+/).filter(Boolean).length}`,
      `decodedTransportBits=${decodedBitstring?.length ?? 0}`,
      `decryptedChars=${recoveredPlaintext.length}`,
      `decryptedUtf8Bytes=${new TextEncoder().encode(recoveredPlaintext).length}`,
    ].join(" | "),
  );
});

test("repeated short sends stay under Discord's hard cap instead of compounding prior cover text", async () => {
  const conversation = createConversationState();
  const cachedMessages: Array<{
    threadId: string;
    discordMessageId: string;
    authorUsername: string;
    snowflakeTimestamp: string;
    text: string;
    direction: "outgoing";
  }> = [];
  const lengths: number[] = [];

  for (let index = 1; index <= 8; index += 1) {
    const transportBitstring = encodePlaintextToTransportBitstring("a");
    const wordTarget = estimateWordTarget(transportBitstring.length, 3);
    const prompt = buildConversationPrompt({
      coverTopic: "coffee plans",
      contextWindow: buildBoundedConversationWindow(filterPromptMessages(cachedMessages, conversation)),
      wordTarget,
      replyTurn: "",
    });
    const visibleText = await encodeBitstringAsRankedText({
      prompt,
      bitstring: transportBitstring,
      wordTarget,
    });

    lengths.push(visibleText.length);
    assert.ok(
      visibleText.length <= 2000,
      `send ${index} exceeded Discord's hard cap with ${visibleText.length} chars`,
    );

    const encodedMessage = createEncodedMessage(visibleText, index, wordTarget, prompt);
    conversation.confirmedEncodedMessages.push(encodedMessage);
    cachedMessages.push({
      threadId: "thread-integration",
      discordMessageId: String(1000000000000000000n + BigInt(index)),
      authorUsername: "alice",
      snowflakeTimestamp: new Date(Date.now() + index * 1000).toISOString(),
      direction: "outgoing",
      text: visibleText,
    });
  }

  assert.ok(lengths[lengths.length - 1] <= lengths[0] + 250, `cover text still drifted too far: ${lengths.join(", ")}`);
});

test("re-encoding the same message does not keep growing cover text", async () => {
  const plaintext = "same message";
  const conversation = createConversationState();
  const cachedMessages: Array<{
    threadId: string;
    discordMessageId: string;
    authorUsername: string;
    snowflakeTimestamp: string;
    text: string;
    direction: "outgoing";
  }> = [];
  const lengths: number[] = [];

  for (let index = 1; index <= 8; index += 1) {
    const transportBitstring = encodePlaintextToTransportBitstring(plaintext);
    const wordTarget = estimateWordTarget(transportBitstring.length, 3);
    const prompt = buildConversationPrompt({
      coverTopic: "coffee plans",
      contextWindow: buildBoundedConversationWindow(filterPromptMessages(cachedMessages, conversation)),
      wordTarget,
      replyTurn: "",
    });
    const visibleText = await encodeBitstringAsRankedText({
      prompt,
      bitstring: transportBitstring,
      wordTarget,
    });

    lengths.push(visibleText.length);
    conversation.confirmedEncodedMessages.push(createEncodedMessage(visibleText, index, wordTarget, prompt));
    cachedMessages.push({
      threadId: "thread-integration",
      discordMessageId: String(2000000000000000000n + BigInt(index)),
      authorUsername: "alice",
      snowflakeTimestamp: new Date(Date.now() + index * 1000).toISOString(),
      direction: "outgoing",
      text: visibleText,
    });
  }

  const firstLength = lengths[0];
  const lastLength = lengths[lengths.length - 1];
  const maxLength = Math.max(...lengths);

  assert.ok(lastLength <= firstLength + 250, `same-message cover text drifted too far: ${lengths.join(", ")}`);
  assert.ok(maxLength <= firstLength + 300, `same-message cover text spiked too far: ${lengths.join(", ")}`);
});

test("failed outgoing cover text in cached history is filtered so retries do not compound", async () => {
  const plaintext = "same message";
  const conversation = createConversationState();
  const cachedMessages: Array<{
    threadId: string;
    discordMessageId: string;
    authorUsername: string;
    snowflakeTimestamp: string;
    text: string;
    direction: "outgoing";
  }> = [];
  const lengths: number[] = [];

  for (let index = 1; index <= 8; index += 1) {
    const transportBitstring = encodePlaintextToTransportBitstring(plaintext);
    const wordTarget = estimateWordTarget(transportBitstring.length, 3);
    const prompt = buildConversationPrompt({
      coverTopic: "coffee plans",
      contextWindow: buildBoundedConversationWindow(filterPromptMessages(cachedMessages, conversation)),
      wordTarget,
      replyTurn: "",
    });
    const visibleText = await encodeBitstringAsRankedText({
      prompt,
      bitstring: transportBitstring,
      wordTarget,
    });

    lengths.push(visibleText.length);
    conversation.pendingSend = {
      threadId: "thread-integration",
      sessionId: "session-integration",
      status: "failed",
      expectedCoverText: visibleText,
      encodedMessage: createEncodedMessage(visibleText, index, wordTarget, prompt),
      startedAt: Date.now(),
      msgId: index,
      error: "Discord rejected the draft.",
    };
    conversation.confirmedEncodedMessages.push(createEncodedMessage(visibleText, index, wordTarget, prompt));
    cachedMessages.push({
      threadId: "thread-integration",
      discordMessageId: String(3000000000000000000n + BigInt(index)),
      authorUsername: "alice",
      snowflakeTimestamp: new Date(Date.now() + index * 1000).toISOString(),
      direction: "outgoing",
      text: visibleText,
    });
  }

  const firstLength = lengths[0];
  const lastLength = lengths[lengths.length - 1];
  const maxLength = Math.max(...lengths);

  assert.ok(lastLength <= firstLength + 250, `failed-retry cover text drifted too far: ${lengths.join(", ")}`);
  assert.ok(maxLength <= firstLength + 300, `failed-retry cover text spiked too far: ${lengths.join(", ")}`);
});

function createConversationState() {
  return {
    confirmedEncodedMessages: [] as Array<{
      visibleText: string;
      configId: "ghostscript-default-v1";
      modelId: "xenova-distilgpt2-v1";
      tokenizerId: "gpt2-tokenizer-v1";
      transportBackend: "local-gpt2-top4-v1";
      msgId: number;
      estimatedWordTarget: number;
      transportProtocolVersion: 1;
      promptFingerprint: string;
    }>,
    decodedMessages: {},
    pendingSend: null as
      | {
          threadId: string;
          sessionId: string;
          status: "failed";
          expectedCoverText: string;
          encodedMessage: ReturnType<typeof createEncodedMessage>;
          startedAt: number;
          msgId: number;
          error: string;
        }
      | null,
  };
}

function createEncodedMessage(visibleText: string, msgId: number, estimatedWordTarget: number, promptFingerprint: string) {
  return {
    visibleText,
    configId: "ghostscript-default-v1" as const,
    modelId: "xenova-distilgpt2-v1",
    tokenizerId: "gpt2-tokenizer-v1",
    transportBackend: "local-gpt2-top4-v1",
    msgId,
    estimatedWordTarget,
    transportProtocolVersion: 1 as const,
    promptFingerprint,
  };
}

function createHistoryMessage(
  discordMessageId: string,
  authorUsername: string,
  text: string,
  direction: "incoming" | "outgoing",
) {
  return {
    threadId: "thread-integration",
    discordMessageId,
    authorUsername,
    snowflakeTimestamp: new Date(Number(discordMessageId) || 0).toISOString(),
    text,
    direction,
  } as const;
}

function estimateWordTarget(payloadBitLength: number, bitsPerToken: number) {
  const estimatedTokens = Math.max(12, Math.ceil(payloadBitLength / Math.max(bitsPerToken, 1)));
  return Math.max(10, Math.ceil(estimatedTokens * 0.7));
}
