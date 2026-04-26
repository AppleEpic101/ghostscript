import test from "node:test";
import assert from "node:assert/strict";
import {
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
  const prompt = [
    "Cover text topic: weekend plans and coffee shops",
    "Alice: are you still free later?",
    "Bob: probably, depends on how late the line is near the station",
  ].join("\n");

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
  const bitstring = serializeEnvelopeToBitstring(envelope);
  const visibleText = encodeBitstringAsRankedText({
    prompt,
    bitstring,
    wordTarget: estimateWordTarget(bitstring.length, 3),
  });
  const decodedBitstring = decodeRankedTextToBitstring({
    prompt,
    visibleText,
  });

  assert.equal(decodedBitstring, bitstring);

  const decodedEnvelope = deserializeEnvelopeFromBitstring(decodedBitstring ?? "");
  const plaintext = await decryptMessageEnvelope(decodedEnvelope, bobMaterial);

  assert.equal(plaintext, "Okay, station works.");
});

test("repeated short sends stay under the safe budget instead of compounding prior cover text", async () => {
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
    const bitstring = serializeEnvelopeToBitstring(envelope);
    const prompt = buildConversationPrompt({
      coverTopic: "coffee plans",
      messages: buildBoundedConversationWindow(filterPromptMessages(cachedMessages, conversation)),
    });
    const visibleText = encodeBitstringAsRankedText({
      prompt,
      bitstring,
      wordTarget: estimateWordTarget(bitstring.length, 3),
    });

    lengths.push(visibleText.length);
    assert.ok(visibleText.length < 1900, `send ${index} exceeded the safe budget with ${visibleText.length} chars`);

    conversation.confirmedEncodedMessages.push({
      visibleText,
      configId: "ghostscript-default-v1",
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
