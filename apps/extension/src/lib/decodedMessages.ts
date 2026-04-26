import type { GhostscriptThreadMessage } from "@ghostscript/shared";

export type DecodedGhostscriptMessageView = "decrypted" | "cover";
export type LegacyDecodedGhostscriptMessageView = DecodedGhostscriptMessageView | "original" | null | undefined;

const MINIMUM_SHARED_TAIL_MESSAGES = 3;

export function normalizeDecodedMessageActiveView(
  activeView: LegacyDecodedGhostscriptMessageView,
): DecodedGhostscriptMessageView {
  if (activeView === "cover" || activeView === "original") {
    return "cover";
  }

  return "decrypted";
}

export function getDecodedMessageBody(params: {
  activeView: DecodedGhostscriptMessageView;
  plaintext: string | null;
  visibleText: string;
}) {
  const isCoverText = params.activeView === "cover";

  return {
    text: isCoverText ? params.visibleText : params.plaintext ?? "",
    isCoverText,
  };
}

export function getPreferredDebugMessageText(params: {
  status: "decoded" | "tampered" | null;
  plaintext: string | null;
}) {
  if (params.status === "tampered") {
    return "Ghostscript recovered a framed message here, but it failed authentication.";
  }

  if (params.status === "decoded" && params.plaintext) {
    return params.plaintext;
  }

  return "this message was not decoded";
}

export function buildDecodeHistoryWindows(
  visibleHistoryWindow: GhostscriptThreadMessage[],
  cachedHistoryWindow: GhostscriptThreadMessage[],
) {
  const windows: GhostscriptThreadMessage[][] = [];

  if (cachedHistoryWindow.length === 0 && visibleHistoryWindow.length === 0) {
    windows.push([]);
    return windows;
  }

  if (cachedHistoryWindow.length > 0) {
    windows.push(cachedHistoryWindow);
  }

  if (visibleHistoryWindow.length === 0) {
    return windows;
  }

  if (cachedHistoryWindow.length === 0) {
    windows.push(visibleHistoryWindow);
    return windows;
  }

  if (
    areConversationWindowsEqual(visibleHistoryWindow, cachedHistoryWindow) ||
    doesWindowEndWith(cachedHistoryWindow, visibleHistoryWindow) ||
    doesWindowEndWith(visibleHistoryWindow, cachedHistoryWindow) ||
    shareRecentMessageTail(visibleHistoryWindow, cachedHistoryWindow)
  ) {
    if (!areConversationWindowsEqual(visibleHistoryWindow, cachedHistoryWindow)) {
      windows.push(visibleHistoryWindow);
    }

    return windows;
  }

  return [];
}

function shareRecentMessageTail(left: GhostscriptThreadMessage[], right: GhostscriptThreadMessage[]) {
  const sharedTailLength = Math.min(left.length, right.length);
  const minimumSharedTail = Math.min(MINIMUM_SHARED_TAIL_MESSAGES, sharedTailLength);

  for (let length = sharedTailLength; length >= minimumSharedTail; length -= 1) {
    if (doesWindowEndWith(left, right.slice(-length)) || doesWindowEndWith(right, left.slice(-length))) {
      return true;
    }
  }

  return false;
}

function doesWindowEndWith(messages: GhostscriptThreadMessage[], trailingWindow: GhostscriptThreadMessage[]) {
  if (trailingWindow.length === 0) {
    return true;
  }

  if (trailingWindow.length > messages.length) {
    return false;
  }

  const offset = messages.length - trailingWindow.length;
  return trailingWindow.every((message, index) => areMessagesEquivalent(messages[offset + index], message));
}

function areConversationWindowsEqual(left: GhostscriptThreadMessage[], right: GhostscriptThreadMessage[]) {
  return left.length === right.length && left.every((message, index) => areMessagesEquivalent(message, right[index]));
}

function areMessagesEquivalent(left: GhostscriptThreadMessage | undefined, right: GhostscriptThreadMessage | undefined) {
  return (
    left !== undefined &&
    right !== undefined &&
    left.discordMessageId === right.discordMessageId &&
    left.authorUsername === right.authorUsername &&
    left.text === right.text
  );
}
