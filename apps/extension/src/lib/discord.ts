import type { GhostscriptThreadMessage } from "@ghostscript/shared";

const MESSAGE_CONTAINER_SELECTORS = [
  'li[id^="chat-messages-"]',
  'div[id^="chat-messages-"]',
  'article[id^="message-"]',
  'li[data-list-item-id^="chat-messages_"]',
  'div[data-list-item-id^="chat-messages_"]',
];

const AUTHOR_SELECTORS = [
  '[id^="message-username-"]',
  'h3 [class*="username"]',
  '[class*="headerText"] [class*="username"]',
];

const CONTENT_SELECTORS = ['[id^="message-content-"]', '[class*="messageContent"]', '[data-slate-node="element"]'];

export function getCurrentDiscordThreadId() {
  const pathSegments = window.location.pathname.split("/").filter(Boolean);
  return pathSegments.length >= 3 ? pathSegments[2] ?? null : null;
}

export function getDiscordNativeTextbox() {
  const textbox = document.querySelector('[role="textbox"][contenteditable="true"]');
  return textbox instanceof HTMLElement ? textbox : null;
}

export function collectTwoPartyMessages(localUsername: string, partnerUsername: string): GhostscriptThreadMessage[] {
  const threadId = getCurrentDiscordThreadId();

  if (!threadId) {
    return [];
  }

  const elements = findMessageContainers();
  const messages: GhostscriptThreadMessage[] = [];
  const seenMessageIds = new Set<string>();
  let previousAuthor = "";

  for (const element of elements) {
    const discordMessageId = extractMessageId(element);
    if (!discordMessageId || seenMessageIds.has(discordMessageId)) {
      continue;
    }

    const authorUsername = extractAuthorUsername(element) || previousAuthor;
    const text = extractMessageText(element);

    if (!authorUsername || !text) {
      continue;
    }

    previousAuthor = authorUsername;

    const normalizedAuthor = normalizeUsername(authorUsername);
    const normalizedLocal = normalizeUsername(localUsername);
    const normalizedPartner = normalizeUsername(partnerUsername);

    let direction: GhostscriptThreadMessage["direction"] = "other";
    if (normalizedAuthor === normalizedLocal) {
      direction = "outgoing";
    } else if (normalizedAuthor === normalizedPartner) {
      direction = "incoming";
    }

    if (direction === "other") {
      continue;
    }

    seenMessageIds.add(discordMessageId);
    messages.push({
      threadId,
      discordMessageId,
      authorUsername,
      snowflakeTimestamp: getSnowflakeTimestamp(discordMessageId),
      text,
      direction,
    });
  }

  return messages.sort(compareMessagesAscending);
}

export function buildBoundedConversationWindow(
  messages: GhostscriptThreadMessage[],
  limits = { maxMessages: 18, maxChars: 3200 },
) {
  const orderedMessages = [...messages].sort(compareMessagesAscending);
  const selected: GhostscriptThreadMessage[] = [];
  let charCount = 0;

  for (let index = orderedMessages.length - 1; index >= 0; index -= 1) {
    const message = orderedMessages[index];
    const nextCharCount = charCount + message.text.length + message.authorUsername.length + 2;

    if (selected.length >= limits.maxMessages || nextCharCount > limits.maxChars) {
      break;
    }

    selected.push(message);
    charCount = nextCharCount;
  }

  return selected.reverse();
}

export async function sendTextThroughDiscord(text: string) {
  const textbox = getDiscordNativeTextbox();
  if (!textbox) {
    throw new Error("Discord's native composer is not available on this page.");
  }

  textbox.focus();
  selectAllEditableText(textbox);

  if (!document.execCommand("insertText", false, text)) {
    textbox.textContent = text;
    textbox.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }

  dispatchEnterKey(textbox, "keydown");
  dispatchEnterKey(textbox, "keypress");
  dispatchEnterKey(textbox, "keyup");
}

export function hideDiscordMessageLocally(discordMessageId: string) {
  const messageElement = findMessageElementById(discordMessageId);
  if (!messageElement) {
    return;
  }

  messageElement.dataset.ghostscriptSuppressed = "true";
  messageElement.style.display = "none";
}

export function renderDecodedMessageOverlay(params: {
  discordMessageId: string;
  status: "decoded" | "tampered";
  plaintext: string | null;
}) {
  const messageElement = findMessageElementById(params.discordMessageId);
  if (!messageElement) {
    return;
  }

  let overlay = messageElement.querySelector<HTMLElement>("[data-ghostscript-decoded-overlay]");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.dataset.ghostscriptDecodedOverlay = "true";
    overlay.className = "ghostscript-decoded-overlay";
    messageElement.appendChild(overlay);
  }

  overlay.textContent =
    params.status === "decoded" ? `Ghostscript: ${params.plaintext ?? ""}` : "Ghostscript: tampered/corrupted";
}

function findMessageContainers() {
  return MESSAGE_CONTAINER_SELECTORS.flatMap((selector) =>
    Array.from(document.querySelectorAll<HTMLElement>(selector)),
  );
}

function findMessageElementById(discordMessageId: string) {
  const allMessageElements = findMessageContainers();
  return allMessageElements.find((element) => extractMessageId(element) === discordMessageId) ?? null;
}

function extractMessageId(element: HTMLElement) {
  const candidates = [
    element.id,
    element.getAttribute("data-list-item-id"),
    element.querySelector<HTMLElement>("[id]")?.id ?? "",
  ];

  for (const candidate of candidates) {
    const match = candidate?.match(/(\d{17,20})/);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function extractAuthorUsername(element: HTMLElement) {
  for (const selector of AUTHOR_SELECTORS) {
    const candidate = element.querySelector(selector);
    const text = candidate?.textContent?.trim();
    if (text) {
      return text;
    }
  }

  return "";
}

function extractMessageText(element: HTMLElement) {
  for (const selector of CONTENT_SELECTORS) {
    const candidate = element.querySelector<HTMLElement>(selector);
    const text = candidate?.innerText?.trim();
    if (text) {
      return text;
    }
  }

  return element.innerText.trim();
}

function getSnowflakeTimestamp(discordMessageId: string) {
  try {
    const snowflake = BigInt(discordMessageId);
    const timestamp = Number((snowflake >> 22n) + 1420070400000n);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date(0).toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

function compareMessagesAscending(left: GhostscriptThreadMessage, right: GhostscriptThreadMessage) {
  if (left.snowflakeTimestamp !== right.snowflakeTimestamp) {
    return left.snowflakeTimestamp.localeCompare(right.snowflakeTimestamp);
  }

  try {
    const leftId = BigInt(left.discordMessageId);
    const rightId = BigInt(right.discordMessageId);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  } catch {
    return left.discordMessageId.localeCompare(right.discordMessageId);
  }
}

function normalizeUsername(value: string) {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

function selectAllEditableText(element: HTMLElement) {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

function dispatchEnterKey(target: HTMLElement, type: "keydown" | "keypress" | "keyup") {
  target.dispatchEvent(
    new KeyboardEvent(type, {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    }),
  );
}
