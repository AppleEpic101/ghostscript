import test from "node:test";
import assert from "node:assert/strict";
import { buildConversationPrompt } from "./promptBuilder";

test("conversation prompt ends at paired chat history without sender-only reply scaffolding", () => {
  const prompt = buildConversationPrompt({
    coverTopic: "coffee plans",
    contextWindow: {
      threadId: "thread-1",
      truncated: false,
      maxMessages: 18,
      maxChars: 3200,
      messages: [
        {
          threadId: "thread-1",
          discordMessageId: "1",
          authorUsername: "alice",
          snowflakeTimestamp: new Date(1).toISOString(),
          text: "still free later?",
          direction: "outgoing",
        },
        {
          threadId: "thread-1",
          discordMessageId: "2",
          authorUsername: "bob",
          snowflakeTimestamp: new Date(2).toISOString(),
          text: "yeah, after the station line dies down",
          direction: "incoming",
        },
      ],
    },
    wordTarget: 16,
    replyTurn: "meet by the side entrance",
  });

  assert.ok(prompt.includes("alice: still free later?"));
  assert.ok(prompt.includes("bob: yeah, after the station line dies down"));
  assert.ok(!prompt.includes("Current Ghostscript reply turn:"));
  assert.ok(!prompt.includes("meet by the side entrance"));
  assert.equal(prompt.endsWith("bob: yeah, after the station line dies down"), true);
});
