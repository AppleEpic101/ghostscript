import test from "node:test";
import assert from "node:assert/strict";
import type { GhostscriptThreadMessage } from "@ghostscript/shared";
import { readConversationState } from "./ghostscriptState";
import {
  buildDecodeHistoryWindows,
  getDecodedMessageBody,
  getPreferredDebugMessageText,
  normalizeDecodedMessageActiveView,
} from "./decodedMessages";
import { writeStorageValue } from "./storage";

const STORAGE_KEY = "ghostscript-extension-ghostscript-state";

test("decoded message active-view normalization preserves decrypted default and maps legacy original to cover", async () => {
  installWindowStorage();

  await writeStorageValue(STORAGE_KEY, {
    localWrapSecret: null,
    identityKeysBySessionId: {},
    conversationsByThreadId: {
      "thread-1": {
        threadId: "thread-1",
        nextOutboundMessageId: 1,
        cachedMessages: [],
        suppressedMessageIds: [],
        pendingSend: null,
        decodedMessages: {
          "message-1": {
            status: "decoded",
            plaintext: "plaintext one",
            visibleText: "cover one",
            encodedMessage: null,
            processedAt: new Date(0).toISOString(),
            activeView: "original",
          },
          "message-2": {
            status: "decoded",
            plaintext: "plaintext two",
            visibleText: "cover two",
            encodedMessage: null,
            processedAt: new Date(0).toISOString(),
          },
        },
      },
    },
  });

  const conversation = await readConversationState("thread-1");

  assert.equal(normalizeDecodedMessageActiveView("original"), "cover");
  assert.equal(normalizeDecodedMessageActiveView(undefined), "decrypted");
  assert.equal(conversation.decodedMessages["message-1"]?.activeView, "cover");
  assert.equal(conversation.decodedMessages["message-2"]?.activeView, "decrypted");
});

test("cover-text presentation uses the visible text and marks the highlighted mode", () => {
  const decryptedBody = getDecodedMessageBody({
    activeView: "decrypted",
    plaintext: "Meet at the station.",
    visibleText: "I might stop for coffee first.",
  });
  const coverBody = getDecodedMessageBody({
    activeView: "cover",
    plaintext: "Meet at the station.",
    visibleText: "I might stop for coffee first.",
  });

  assert.deepEqual(decryptedBody, {
    text: "Meet at the station.",
    isCoverText: false,
  });
  assert.deepEqual(coverBody, {
    text: "I might stop for coffee first.",
    isCoverText: true,
  });
});

test("debug presentation prefers decrypted plaintext when a message has been decoded", () => {
  assert.equal(
    getPreferredDebugMessageText({
      status: "decoded",
      plaintext: "Meet at the station.",
    }),
    "Meet at the station.",
  );

  assert.equal(
    getPreferredDebugMessageText({
      status: "tampered",
      plaintext: null,
    }),
    "this message was not decoded",
  );
});

test("decode history windows still attempt decode when there is no prior conversation context", () => {
  const historyWindows = buildDecodeHistoryWindows([], []);

  assert.equal(historyWindows.length, 1);
  assert.deepEqual(historyWindows[0], []);
});

test("decode history windows keep cached context available when the visible DOM is truncated", () => {
  const fullHistory = [
    createMessage("100", "alice", "First"),
    createMessage("101", "bob", "Second"),
    createMessage("102", "alice", "Third"),
  ];
  const visibleHistory = fullHistory.slice(1);

  const historyWindows = buildDecodeHistoryWindows(visibleHistory, fullHistory);

  assert.equal(historyWindows.length, 2);
  assert.deepEqual(historyWindows[0], fullHistory);
  assert.deepEqual(historyWindows[1], visibleHistory);
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

function installWindowStorage() {
  const storage = new Map<string, string>();
  const localStorage = {
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
    clear() {
      storage.clear();
    },
  };

  Object.assign(globalThis, {
    window: {
      localStorage,
    },
  });
}
