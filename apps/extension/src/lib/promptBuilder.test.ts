import test from "node:test";
import assert from "node:assert/strict";
import { buildConversationPrompt } from "./promptBuilder";

test("conversation prompt separates paired history from the next generated message", () => {
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

  assert.ok(prompt.includes("Paired Discord chat history:"));
  assert.ok(prompt.includes("alice: still free later?"));
  assert.ok(prompt.includes("bob: yeah, after the station line dies down"));
  assert.ok(prompt.includes("Next Discord message:"));
  assert.ok(!prompt.includes("meet by the side entrance"));
  assert.equal(prompt.endsWith("Next Discord message:"), true);
});

test("conversation prompt includes an explicit empty-history marker", () => {
  const prompt = buildConversationPrompt({
    coverTopic: "coffee plans",
    contextWindow: {
      threadId: "thread-1",
      truncated: false,
      maxMessages: 18,
      maxChars: 3200,
      messages: [],
    },
    wordTarget: 16,
    replyTurn: "",
  });

  assert.ok(prompt.includes("Paired Discord chat history:"));
  assert.ok(prompt.includes("(no prior paired messages)"));
  assert.ok(prompt.endsWith("Next Discord message:"));
});
