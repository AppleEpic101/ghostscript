import test from "node:test";
import assert from "node:assert/strict";
import {
  __internal_encodePlaintextPayload,
  decryptMessageEnvelope,
  encryptMessageEnvelope,
  generateIdentityBundle,
  type SessionCryptoMaterial,
} from "../apps/extension/src/lib/crypto";
import {
  deserializeEnvelopeFromBitstring,
  estimateWordTarget,
  serializeEnvelopeToBitstring,
} from "../apps/extension/src/lib/bitstream";
import {
  compressBitstringForTransport,
  decompressBitstringFromTransport,
} from "../apps/extension/src/lib/bitCompression";
import { buildConversationPrompt } from "../apps/extension/src/lib/llmBridge";
import { filterPromptMessages } from "../apps/extension/src/lib/promptHistory";
import { buildBoundedConversationWindow } from "../apps/extension/src/lib/discord";
import {
  decodeRankedTextToBitstring,
  encodeBitstringAsRankedText,
} from "../apps/ghostscript-api/src/transport";

test("encrypted envelopes survive rank-selection transport end to end", async () => {
  const alice = await generateIdentityBundle();
  const bob = await generateIdentityBundle();
  const prompt = buildConversationPrompt({
    coverTopic: "weekend plans and coffee shops",
    messages: [
      createHistoryMessage("1", "Alice", "are you still free later?", "outgoing"),
      createHistoryMessage("2", "Bob", "probably, depends on how late the line is near the station", "incoming"),
    ],
    wordTarget: 16,
    replyTurn: "",
  });

  const aliceMaterial: SessionCryptoMaterial = {
    sessionId: "session-integration",
    threadId: "thread-integration",
    localParticipantId: "alice",
    counterpartParticipantId: "bob",
    localTransportPrivateKey: alice.transportPrivateKey,
    counterpartTransportPublicKey: bob.transportPublicKey,
  };
  const bobMaterial: SessionCryptoMaterial = {
    sessionId: "session-integration",
    threadId: "thread-integration",
    localParticipantId: "bob",
    counterpartParticipantId: "alice",
    localTransportPrivateKey: bob.transportPrivateKey,
    counterpartTransportPublicKey: alice.transportPublicKey,
  };

  const envelope = await encryptMessageEnvelope("Okay, station works.", 11, aliceMaterial);
  const bitstring = await compressBitstringForTransport(serializeEnvelopeToBitstring(envelope));
  const visibleText = await encodeBitstringAsRankedText({
    prompt,
    bitstring: bitstring.bitstring,
    wordTarget: estimateWordTarget(bitstring.bitstring.length, 3),
  });
  const decodedBitstring = await decodeRankedTextToBitstring({
    prompt,
    visibleText,
  });

  assert.equal(decodedBitstring, bitstring.bitstring);

  const decodedEnvelope = deserializeEnvelopeFromBitstring(
    await decompressBitstringFromTransport(decodedBitstring ?? ""),
  );
  const plaintext = await decryptMessageEnvelope(decodedEnvelope, bobMaterial);

  assert.equal(plaintext, "Okay, station works.");
});

test("full integration logs plaintext and transport compression ratios", async () => {
  const alice = await generateIdentityBundle();
  const bob = await generateIdentityBundle();
  const plaintextMessage = "Meet near the side entrance after dinner so we can talk without the line getting weird.";
  const plaintextUtf8Bits = new TextEncoder().encode(plaintextMessage).length * 8;
  const wrappedPlaintextBits = __internal_encodePlaintextPayload(plaintextMessage).length * 8;

  const aliceMaterial: SessionCryptoMaterial = {
    sessionId: "session-ratio",
    threadId: "thread-ratio",
    localParticipantId: "alice",
    counterpartParticipantId: "bob",
    localTransportPrivateKey: alice.transportPrivateKey,
    counterpartTransportPublicKey: bob.transportPublicKey,
  };
  const bobMaterial: SessionCryptoMaterial = {
    sessionId: "session-ratio",
    threadId: "thread-ratio",
    localParticipantId: "bob",
    counterpartParticipantId: "alice",
    localTransportPrivateKey: bob.transportPrivateKey,
    counterpartTransportPublicKey: alice.transportPublicKey,
  };

  const prompt = buildConversationPrompt({
    coverTopic: "dinner plans and crowded stations",
    messages: [
      createHistoryMessage("1", "Alice", "the line was a mess yesterday", "outgoing"),
      createHistoryMessage("2", "Bob", "yeah we should probably meet somewhere quieter", "incoming"),
    ],
    wordTarget: 16,
    replyTurn: "",
  });

  const envelope = await encryptMessageEnvelope(plaintextMessage, 17, aliceMaterial);
  const envelopeBitstring = serializeEnvelopeToBitstring(envelope);
  const compressedTransport = await compressBitstringForTransport(envelopeBitstring);
  const visibleText = await encodeBitstringAsRankedText({
    prompt,
    bitstring: compressedTransport.bitstring,
    wordTarget: estimateWordTarget(compressedTransport.bitstring.length, 3),
  });
  const decodedBitstring = await decodeRankedTextToBitstring({
    prompt,
    visibleText,
  });

  assert.equal(decodedBitstring, compressedTransport.bitstring);
  const decodedEnvelope = deserializeEnvelopeFromBitstring(
    await decompressBitstringFromTransport(decodedBitstring ?? ""),
  );
  const decryptedPlaintext = await decryptMessageEnvelope(decodedEnvelope, bobMaterial);
  assert.equal(decryptedPlaintext, plaintextMessage);

  console.log(
    [
      "full-integration-ratios",
      `plaintextUtf8Bits=${plaintextUtf8Bits}`,
      `wrappedPlaintextBits=${wrappedPlaintextBits}`,
      `plaintextCompressionRatio=${(wrappedPlaintextBits / plaintextUtf8Bits).toFixed(3)}`,
      `envelopeBits=${envelopeBitstring.length}`,
      `transportBits=${compressedTransport.bitstring.length}`,
      `transportCompressionRatio=${(compressedTransport.bitstring.length / envelopeBitstring.length).toFixed(3)}`,
      `transportFormat=${compressedTransport.format}`,
      `visibleChars=${visibleText.length}`,
    ].join(" | "),
  );
});

test("repeated short sends stay under Discord's hard cap instead of compounding prior cover text", async () => {
  const alice = await generateIdentityBundle();
  const bob = await generateIdentityBundle();
  const aliceMaterial: SessionCryptoMaterial = {
    sessionId: "session-integration",
    threadId: "thread-integration",
    localParticipantId: "alice",
    counterpartParticipantId: "bob",
    localTransportPrivateKey: alice.transportPrivateKey,
    counterpartTransportPublicKey: bob.transportPublicKey,
  };
  const conversation = {
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
    pendingSend: null,
  };
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
    const envelope = await encryptMessageEnvelope("a", index, aliceMaterial);
    const bitstring = await compressBitstringForTransport(serializeEnvelopeToBitstring(envelope));
    const wordTarget = estimateWordTarget(bitstring.bitstring.length, 3);
    const prompt = buildConversationPrompt({
      coverTopic: "coffee plans",
      contextWindow: buildBoundedConversationWindow(filterPromptMessages(cachedMessages, conversation)),
      wordTarget,
      replyTurn: "",
    });
    const visibleText = await encodeBitstringAsRankedText({
      prompt,
      bitstring: bitstring.bitstring,
      wordTarget,
    });

    lengths.push(visibleText.length);
    assert.ok(
      visibleText.length <= 2000,
      `send ${index} exceeded Discord's hard cap with ${visibleText.length} chars`,
    );

    conversation.confirmedEncodedMessages.push({
      visibleText,
      configId: "ghostscript-default-v1",
      modelId: "xenova-distilgpt2-v1",
      tokenizerId: "gpt2-tokenizer-v1",
      transportBackend: "local-gpt2-top4-v1",
      msgId: index,
      estimatedWordTarget: wordTarget,
      transportProtocolVersion: 1,
      promptFingerprint: prompt,
    });
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
  const alice = await generateIdentityBundle();
  const bob = await generateIdentityBundle();
  const aliceMaterial: SessionCryptoMaterial = {
    sessionId: "session-integration",
    threadId: "thread-integration",
    localParticipantId: "alice",
    counterpartParticipantId: "bob",
    localTransportPrivateKey: alice.transportPrivateKey,
    counterpartTransportPublicKey: bob.transportPublicKey,
  };
  void bob;

  const plaintext = "same message";
  const conversation = {
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
    pendingSend: null,
  };
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
    const envelope = await encryptMessageEnvelope(plaintext, index, aliceMaterial);
    const bitstring = await compressBitstringForTransport(serializeEnvelopeToBitstring(envelope));
    const wordTarget = estimateWordTarget(bitstring.bitstring.length, 3);
    const prompt = buildConversationPrompt({
      coverTopic: "coffee plans",
      contextWindow: buildBoundedConversationWindow(filterPromptMessages(cachedMessages, conversation)),
      wordTarget,
      replyTurn: "",
    });
    const visibleText = await encodeBitstringAsRankedText({
      prompt,
      bitstring: bitstring.bitstring,
      wordTarget,
    });

    lengths.push(visibleText.length);
    conversation.confirmedEncodedMessages.push({
      visibleText,
      configId: "ghostscript-default-v1",
      modelId: "xenova-distilgpt2-v1",
      tokenizerId: "gpt2-tokenizer-v1",
      transportBackend: "local-gpt2-top4-v1",
      msgId: index,
      estimatedWordTarget: wordTarget,
      transportProtocolVersion: 1,
      promptFingerprint: prompt,
    });
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
  const alice = await generateIdentityBundle();
  const bob = await generateIdentityBundle();
  const aliceMaterial: SessionCryptoMaterial = {
    sessionId: "session-integration",
    threadId: "thread-integration",
    localParticipantId: "alice",
    counterpartParticipantId: "bob",
    localTransportPrivateKey: alice.transportPrivateKey,
    counterpartTransportPublicKey: bob.transportPublicKey,
  };

  const plaintext = "same message";
  const conversation = {
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
          encodedMessage: {
            visibleText: string;
            configId: "ghostscript-default-v1";
            modelId: "xenova-distilgpt2-v1";
            tokenizerId: "gpt2-tokenizer-v1";
            transportBackend: "local-gpt2-top4-v1";
            msgId: number;
            estimatedWordTarget: number;
            transportProtocolVersion: 1;
            promptFingerprint: string;
          };
          startedAt: number;
          msgId: number;
          error: string;
        }
      | null,
  };
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
    const envelope = await encryptMessageEnvelope(plaintext, index, aliceMaterial);
    const bitstring = await compressBitstringForTransport(serializeEnvelopeToBitstring(envelope));
    const wordTarget = estimateWordTarget(bitstring.bitstring.length, 3);
    const prompt = buildConversationPrompt({
      coverTopic: "coffee plans",
      contextWindow: buildBoundedConversationWindow(filterPromptMessages(cachedMessages, conversation)),
      wordTarget,
      replyTurn: "",
    });
    const visibleText = await encodeBitstringAsRankedText({
      prompt,
      bitstring: bitstring.bitstring,
      wordTarget,
    });

    lengths.push(visibleText.length);
    conversation.pendingSend = {
      threadId: "thread-integration",
      sessionId: "session-integration",
      status: "failed",
      expectedCoverText: visibleText,
      encodedMessage: {
        visibleText,
        configId: "ghostscript-default-v1",
        modelId: "xenova-distilgpt2-v1",
        tokenizerId: "gpt2-tokenizer-v1",
        transportBackend: "local-gpt2-top4-v1",
        msgId: index,
        estimatedWordTarget: wordTarget,
        transportProtocolVersion: 1,
        promptFingerprint: prompt,
      },
      startedAt: Date.now(),
      msgId: index,
      error: "Discord rejected the draft.",
    };
    conversation.confirmedEncodedMessages.push({
      visibleText,
      configId: "ghostscript-default-v1",
      modelId: "xenova-distilgpt2-v1",
      tokenizerId: "gpt2-tokenizer-v1",
      transportBackend: "local-gpt2-top4-v1",
      msgId: index,
      estimatedWordTarget: wordTarget,
      transportProtocolVersion: 1,
      promptFingerprint: prompt,
    });
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
