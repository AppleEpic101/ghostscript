import test from "node:test";
import assert from "node:assert/strict";
import { classifyTwoPartyAuthors, filterEligibleTwoPartyMessages, resolveDiscordMessageId } from "./discord";

test("classifyTwoPartyAuthors matches punctuation and spacing differences in Discord names", () => {
  const classification = classifyTwoPartyAuthors(
    ["John Smith", "Casey_River"],
    "casey_river",
    "john.smith",
  );

  assert.deepEqual(Array.from(classification.localAuthors), ["casey_river"]);
  assert.deepEqual(Array.from(classification.partnerAuthors), ["john smith"]);
});

test("classifyTwoPartyAuthors infers the partner in a two-author thread when only the local name matches", () => {
  const classification = classifyTwoPartyAuthors(
    ["Casey River", "Weekend Coffee"],
    "casey_river",
    "john.smith",
  );

  assert.deepEqual(Array.from(classification.localAuthors), ["casey river"]);
  assert.deepEqual(Array.from(classification.partnerAuthors), ["weekend coffee"]);
});

test("filterEligibleTwoPartyMessages keeps only post-link partner and local messages with stable order", () => {
  const messages = filterEligibleTwoPartyMessages(
    [
      {
        threadId: "thread-1",
        discordMessageId: "101",
        authorUsername: "John Smith",
        snowflakeTimestamp: "2026-04-26T07:34:59.000Z",
        text: "before link",
      },
      {
        threadId: "thread-1",
        discordMessageId: "102",
        authorUsername: "Casey River",
        snowflakeTimestamp: "2026-04-26T07:35:01.000Z",
        text: "after link one",
      },
      {
        threadId: "thread-1",
        discordMessageId: "103",
        authorUsername: "John Smith",
        snowflakeTimestamp: "2026-04-26T07:35:02.000Z",
        text: "after link two",
      },
      {
        threadId: "thread-1",
        discordMessageId: "104",
        authorUsername: "Random Person",
        snowflakeTimestamp: "2026-04-26T07:35:03.000Z",
        text: "ignore me",
      },
    ],
    "casey_river",
    "john.smith",
    "2026-04-26T07:35:00.000Z",
  );

  assert.deepEqual(
    messages.map((message) => ({
      discordMessageId: message.discordMessageId,
      direction: message.direction,
      text: message.text,
    })),
    [
      {
        discordMessageId: "102",
        direction: "outgoing",
        text: "after link one",
      },
      {
        discordMessageId: "103",
        direction: "incoming",
        text: "after link two",
      },
    ],
  );
});

test("filterEligibleTwoPartyMessages classifies exact local and partner usernames after pairing", () => {
  const messages = filterEligibleTwoPartyMessages(
    [
      {
        threadId: "thread-1",
        discordMessageId: "1498000000000000001",
        authorUsername: "bobby",
        snowflakeTimestamp: "2026-04-26T08:14:10.000Z",
        text: "hello",
      },
      {
        threadId: "thread-1",
        discordMessageId: "1498000000000000002",
        authorUsername: "appleepic",
        snowflakeTimestamp: "2026-04-26T08:14:20.000Z",
        text: "reply",
      },
    ],
    "bobby",
    "appleepic",
    "2026-04-26T08:13:57.601Z",
  );

  assert.deepEqual(
    messages.map((message) => ({
      discordMessageId: message.discordMessageId,
      direction: message.direction,
    })),
    [
      {
        discordMessageId: "1498000000000000001",
        direction: "outgoing",
      },
      {
        discordMessageId: "1498000000000000002",
        direction: "incoming",
      },
    ],
  );
});

test("resolveDiscordMessageId rejects a thread wrapper id when no nested message ids are present", () => {
  assert.equal(
    resolveDiscordMessageId({
      threadId: "1497096313542545408",
      ownElementId: "chat-messages-1497096313542545408",
      ownListItemId: null,
    }),
    null,
  );
});

test("resolveDiscordMessageId prefers a nested real message id over the thread wrapper id", () => {
  assert.equal(
    resolveDiscordMessageId({
      threadId: "1497096313542545408",
      ownElementId: "chat-messages-1497096313542545408",
      ownListItemId: null,
      nestedMessageContentId: "message-content-1498000000000000002",
    }),
    "1498000000000000002",
  );
});
