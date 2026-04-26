import test from "node:test";
import assert from "node:assert/strict";
import { isMatchingPendingOutgoingMessage } from "./ghostscriptMessaging";
import { appendInvisiblePayload } from "./invisibleTransport";
import { encodeVisibleTransportPayload } from "./visibleTransport";

test("isMatchingPendingOutgoingMessage accepts a Discord-readback message that only preserves visible text", () => {
  const visibleText = "Coffee near the station still works for me.";
  const expectedCoverText = appendInvisiblePayload(visibleText, "0101011100");

  const matches = isMatchingPendingOutgoingMessage(
    {
      threadId: "thread-1",
      discordMessageId: "1498000000000001000",
      authorUsername: "bobby",
      snowflakeTimestamp: "2026-04-26T08:14:20.000Z",
      text: visibleText,
      direction: "outgoing",
    },
    {
      expectedCoverText,
      startedAt: Date.parse("2026-04-26T08:14:18.000Z"),
    },
  );

  assert.equal(matches, true);
});

test("isMatchingPendingOutgoingMessage still accepts the full submitted transport payload", () => {
  const visibleText = "Coffee near the station still works for me.";
  const expectedCoverText = appendInvisiblePayload(visibleText, "0101011100");

  const matches = isMatchingPendingOutgoingMessage(
    {
      threadId: "thread-1",
      discordMessageId: "1498000000000001000",
      authorUsername: "bobby",
      snowflakeTimestamp: "2026-04-26T08:14:20.000Z",
      text: expectedCoverText,
      direction: "outgoing",
    },
    {
      expectedCoverText,
      startedAt: Date.parse("2026-04-26T08:14:18.000Z"),
    },
  );

  assert.equal(matches, true);
});

test("isMatchingPendingOutgoingMessage rejects older outgoing messages even if the visible text matches", () => {
  const visibleText = "Coffee near the station still works for me.";
  const expectedCoverText = appendInvisiblePayload(visibleText, "0101011100");

  const matches = isMatchingPendingOutgoingMessage(
    {
      threadId: "thread-1",
      discordMessageId: "1498000000000001000",
      authorUsername: "bobby",
      snowflakeTimestamp: "2026-04-26T08:13:40.000Z",
      text: visibleText,
      direction: "outgoing",
    },
    {
      expectedCoverText,
      startedAt: Date.parse("2026-04-26T08:14:18.000Z"),
    },
  );

  assert.equal(matches, false);
});

test("isMatchingPendingOutgoingMessage accepts a visible ASCII payload message by exact submitted text", () => {
  const expectedCoverText = encodeVisibleTransportPayload("01010111000011110000111100000000");

  const matches = isMatchingPendingOutgoingMessage(
    {
      threadId: "thread-1",
      discordMessageId: "1498000000000001000",
      authorUsername: "bobby",
      snowflakeTimestamp: "2026-04-26T08:14:20.000Z",
      text: expectedCoverText,
      direction: "outgoing",
    },
    {
      expectedCoverText,
      startedAt: Date.parse("2026-04-26T08:14:18.000Z"),
    },
  );

  assert.equal(matches, true);
});

test("isMatchingPendingOutgoingMessage accepts an exact payload match even when the message was classified as other", () => {
  const expectedCoverText = encodeVisibleTransportPayload("01010111000011110000111100000000");

  const matches = isMatchingPendingOutgoingMessage(
    {
      threadId: "thread-1",
      discordMessageId: "1498000000000001001",
      authorUsername: "bobby display variant",
      snowflakeTimestamp: "2026-04-26T08:14:21.000Z",
      text: expectedCoverText,
      direction: "other",
    },
    {
      expectedCoverText,
      startedAt: Date.parse("2026-04-26T08:14:18.000Z"),
    },
  );

  assert.equal(matches, true);
});

test("isMatchingPendingOutgoingMessage does not accept an incoming message by visible-text-only weak match", () => {
  const visibleText = "Coffee near the station still works for me.";
  const expectedCoverText = appendInvisiblePayload(visibleText, "0101011100");

  const matches = isMatchingPendingOutgoingMessage(
    {
      threadId: "thread-1",
      discordMessageId: "1498000000000001002",
      authorUsername: "partner",
      snowflakeTimestamp: "2026-04-26T08:14:22.000Z",
      text: visibleText,
      direction: "incoming",
    },
    {
      expectedCoverText,
      startedAt: Date.parse("2026-04-26T08:14:18.000Z"),
    },
  );

  assert.equal(matches, false);
});
