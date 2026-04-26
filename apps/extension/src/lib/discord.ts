import type { GhostscriptThreadMessage } from "@ghostscript/shared";
import {
  getDecodedMessageBody,
  getPreferredDebugMessageText,
  type DecodedGhostscriptMessageView,
} from "./decodedMessages";
import { logGhostscriptDebug } from "./debugLog";
import { readConversationState } from "./ghostscriptState";
import { setDecodedMessageActiveView } from "./ghostscriptState";

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
const DISCORD_MAX_MESSAGE_LENGTH = 2000;
const SEND_BUTTON_SELECTORS = [
  'button[type="submit"]',
  'button[aria-label*="Send" i]',
  'button[class*="sendButton"]',
  '[role="button"][aria-label*="Send" i]',
];

export function getCurrentDiscordThreadId() {
  const pathSegments = window.location.pathname.split("/").filter(Boolean);
  return pathSegments.length >= 3 ? pathSegments[2] ?? null : null;
}

export function getDiscordNativeTextbox() {
  const textbox = document.querySelector('[role="textbox"][contenteditable="true"]');
  return textbox instanceof HTMLElement ? textbox : null;
}

export function collectTwoPartyMessages(localUsername: string, partnerUsername: string, sinceTimestamp?: string) {
  const threadId = getCurrentDiscordThreadId();

  if (!threadId) {
    logGhostscriptDebug("collector", "collect-skipped", {
      reason: "no-thread-id",
      localUsername,
      partnerUsername,
      sinceTimestamp: sinceTimestamp ?? null,
    });
    return [];
  }

  const elements = findMessageContainers();
  const seenMessageIds = new Set<string>();
  let previousAuthor = "";
  const extractedMessages: Array<{
    threadId: string;
    discordMessageId: string;
    authorUsername: string;
    snowflakeTimestamp: string;
    text: string;
  }> = [];

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
    seenMessageIds.add(discordMessageId);
    const snowflakeTimestamp = getSnowflakeTimestamp(discordMessageId);

    extractedMessages.push({
      threadId,
      discordMessageId,
      authorUsername,
      snowflakeTimestamp,
      text,
    });
  }

  logGhostscriptDebug("collector", "raw-messages-extracted", {
    threadId,
    localUsername,
    partnerUsername,
    sinceTimestamp: sinceTimestamp ?? null,
    extractedCount: extractedMessages.length,
    extractedMessages: extractedMessages.map((message) => ({
      discordMessageId: message.discordMessageId,
      authorUsername: message.authorUsername,
      snowflakeTimestamp: message.snowflakeTimestamp,
      text: message.text,
    })),
  });

  return filterEligibleTwoPartyMessages(extractedMessages, localUsername, partnerUsername, sinceTimestamp);
}

export function filterEligibleTwoPartyMessages(
  extractedMessages: Array<{
    threadId: string;
    discordMessageId: string;
    authorUsername: string;
    snowflakeTimestamp: string;
    text: string;
  }>,
  localUsername: string,
  partnerUsername: string,
  sinceTimestamp?: string,
) {
  const minimumTimestamp = normalizeTimestampFloor(sinceTimestamp);
  const timestampFilteredMessages = extractedMessages.filter(
    (message) =>
      !!message.authorUsername.trim() &&
      !!message.text.trim() &&
      message.snowflakeTimestamp >= minimumTimestamp,
  );
  const authorClassification = classifyTwoPartyAuthors(
    timestampFilteredMessages.map((message) => message.authorUsername),
    localUsername,
    partnerUsername,
  );

  logGhostscriptDebug("collector", "post-filter-classification", {
    localUsername,
    partnerUsername,
    sinceTimestamp: sinceTimestamp ?? null,
    minimumTimestamp,
    timestampFilteredCount: timestampFilteredMessages.length,
    timestampFilteredMessages: timestampFilteredMessages.map((message) => ({
      discordMessageId: message.discordMessageId,
      authorUsername: message.authorUsername,
      snowflakeTimestamp: message.snowflakeTimestamp,
      text: message.text,
    })),
    localAuthors: Array.from(authorClassification.localAuthors),
    partnerAuthors: Array.from(authorClassification.partnerAuthors),
  });

  const eligibleMessages = timestampFilteredMessages
    .map((message) => {
      const normalizedAuthor = normalizeUsername(message.authorUsername);
      let direction: GhostscriptThreadMessage["direction"] = "other";
      if (authorClassification.localAuthors.has(normalizedAuthor)) {
        direction = "outgoing";
      } else if (authorClassification.partnerAuthors.has(normalizedAuthor)) {
        direction = "incoming";
      }

      return {
        ...message,
        direction,
      };
    })
    .filter((message) => message.direction !== "other")
    .sort(compareMessagesAscending);

  logGhostscriptDebug("collector", "eligible-messages-final", {
    localUsername,
    partnerUsername,
    sinceTimestamp: sinceTimestamp ?? null,
    eligibleCount: eligibleMessages.length,
    eligibleMessages: eligibleMessages.map((message) => ({
      discordMessageId: message.discordMessageId,
      authorUsername: message.authorUsername,
      snowflakeTimestamp: message.snowflakeTimestamp,
      direction: message.direction,
      text: message.text,
    })),
  });

  return eligibleMessages;
}

export function classifyTwoPartyAuthors(authorUsernames: string[], localUsername: string, partnerUsername: string) {
  const normalizedLocal = normalizeUsername(localUsername);
  const normalizedPartner = normalizeUsername(partnerUsername);
  const distinctAuthors = Array.from(new Set(authorUsernames.map(normalizeUsername).filter(Boolean)));
  const localAuthors = new Set(distinctAuthors.filter((author) => usernamesProbablyMatch(author, normalizedLocal)));
  const partnerAuthors = new Set(distinctAuthors.filter((author) => usernamesProbablyMatch(author, normalizedPartner)));

  if (distinctAuthors.length === 2) {
    if (localAuthors.size > 0 && partnerAuthors.size === 0) {
      const inferredPartner = distinctAuthors.find((author) => !localAuthors.has(author));
      if (inferredPartner) {
        partnerAuthors.add(inferredPartner);
      }
    }

    if (partnerAuthors.size > 0 && localAuthors.size === 0) {
      const inferredLocal = distinctAuthors.find((author) => !partnerAuthors.has(author));
      if (inferredLocal) {
        localAuthors.add(inferredLocal);
      }
    }
  }

  return {
    localAuthors,
    partnerAuthors,
  };
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
  if (text.length > DISCORD_MAX_MESSAGE_LENGTH) {
    throw new Error(`Discord messages cannot exceed ${DISCORD_MAX_MESSAGE_LENGTH} characters.`);
  }

  const textbox = getDiscordNativeTextbox();
  if (!textbox) {
    throw new Error("Discord's native composer is not available on this page.");
  }

  textbox.focus();
  selectAllEditableText(textbox);

  if (!document.execCommand("insertText", false, text)) {
    textbox.textContent = text;
  }
  dispatchEditableInputEvents(textbox, text);

  dispatchEnterKey(textbox, "keydown");
  dispatchEnterKey(textbox, "keypress");
  dispatchEnterKey(textbox, "keyup");

  await waitForDiscordComposerSettle();

  if (extractEditableText(textbox).trim() === text.trim()) {
    submitDiscordComposer(textbox);
    await waitForDiscordComposerSettle();
  }

  if (extractEditableText(textbox).trim() === text.trim()) {
    clickDiscordSendButton(textbox);
    await waitForDiscordComposerSettle();
  }

  if (extractEditableText(textbox).trim() === text.trim()) {
    throw new Error(
      "Ghostscript filled Discord's composer, but Discord did not send the message automatically.",
    );
  }
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
  threadId: string;
  discordMessageId: string;
  status: "decoded" | "tampered";
  plaintext: string | null;
  visibleText: string;
  activeView: DecodedGhostscriptMessageView;
}) {
  const messageElement = findMessageElementById(params.discordMessageId);
  if (!messageElement) {
    return;
  }

  const contentElement = findMessageContentElement(messageElement);
  if (contentElement) {
    contentElement.dataset.ghostscriptHiddenContent = "true";
    contentElement.setAttribute("aria-hidden", "true");
  }

  const overlayAnchor = contentElement?.parentElement ?? messageElement;
  let overlay = overlayAnchor.querySelector<HTMLElement>("[data-ghostscript-decoded-overlay]");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.dataset.ghostscriptDecodedOverlay = "true";
    overlay.className = "ghostscript-decoded-overlay";
    overlayAnchor.appendChild(overlay);
  }

  overlay.dataset.ghostscriptMessageId = params.discordMessageId;
  overlay.dataset.ghostscriptThreadId = params.threadId;
  overlay.dataset.ghostscriptStatus = params.status;
  overlay.classList.toggle("ghostscript-decoded-overlay--tampered", params.status === "tampered");

  if (params.status === "tampered") {
    overlay.innerHTML = `
      <div class="ghostscript-decoded-overlay__header">
        <span class="ghostscript-decoded-overlay__badge">Ghostscript</span>
        <span class="ghostscript-decoded-overlay__state">Tampered/Corrupted</span>
      </div>
      <p class="ghostscript-decoded-overlay__body ghostscript-decoded-overlay__body--tampered">Ghostscript recovered a framed message here, but it failed authentication.</p>
    `;
    return;
  }

  overlay.innerHTML = `
    <div class="ghostscript-decoded-overlay__header">
      <span class="ghostscript-decoded-overlay__badge">Ghostscript</span>
      <div class="ghostscript-decoded-overlay__toggle" role="tablist" aria-label="Ghostscript message view">
        <button
          type="button"
          class="ghostscript-decoded-overlay__toggle-button"
          data-ghostscript-view="decrypted"
          role="tab"
          aria-selected="${params.activeView === "decrypted"}"
        >
          Decrypted
        </button>
        <button
          type="button"
          class="ghostscript-decoded-overlay__toggle-button"
          data-ghostscript-view="cover"
          role="tab"
          aria-selected="${params.activeView === "cover"}"
        >
          Cover text
        </button>
      </div>
    </div>
    <p class="ghostscript-decoded-overlay__body" data-ghostscript-decoded-overlay-body="true"></p>
  `;

  const body = overlay.querySelector<HTMLElement>("[data-ghostscript-decoded-overlay-body]");
  if (body) {
    const presentation = getDecodedMessageBody({
      activeView: params.activeView,
      plaintext: params.plaintext,
      visibleText: params.visibleText,
    });
    body.textContent = presentation.text;
    body.classList.toggle("ghostscript-decoded-overlay__body--cover", presentation.isCoverText);
  }

  for (const button of overlay.querySelectorAll<HTMLButtonElement>("[data-ghostscript-view]")) {
    const nextView = button.dataset.ghostscriptView;
    const isActive = nextView === params.activeView;
    button.classList.toggle("ghostscript-decoded-overlay__toggle-button--active", isActive);
    button.tabIndex = isActive ? 0 : -1;
    button.onclick = () => {
      if (nextView !== "decrypted" && nextView !== "cover") {
        return;
      }

      renderDecodedMessageOverlay({
        ...params,
        activeView: nextView,
      });
      void setDecodedMessageActiveView(params.threadId, params.discordMessageId, nextView);
    };
  }
}

export async function renderDebugOverlayOnAllMessages(messages: GhostscriptThreadMessage[]) {
  const threadId = getCurrentDiscordThreadId();
  const conversation = threadId ? await readConversationState(threadId) : null;
  const incomingMessages = messages.filter((message) => message.direction === "incoming");
  const eligibleMessageIds = new Set(incomingMessages.map((message) => message.discordMessageId));
  let overlayCount = 0;
  let removedOverlayCount = 0;

  for (const existingOverlay of document.querySelectorAll<HTMLElement>("[data-ghostscript-debug-overlay]")) {
    const overlayMessageId = existingOverlay.dataset.ghostscriptMessageId ?? "";
    if (eligibleMessageIds.has(overlayMessageId)) {
      continue;
    }

    existingOverlay.remove();
    removedOverlayCount += 1;
  }

  for (const message of incomingMessages) {
    const messageElement = findMessageElementById(message.discordMessageId);
    if (!messageElement) {
      logGhostscriptDebug("debug-overlay", "attach-skipped", {
        discordMessageId: message.discordMessageId,
        reason: "message-element-not-mounted",
      });
      continue;
    }

    const discordMessageId = message.discordMessageId;
    const contentElement = findMessageContentElement(messageElement);
    const authorUsername = message.authorUsername;
    const decodedMessage = conversation?.decodedMessages[discordMessageId] ?? null;
    const debugText = getPreferredDebugMessageText({
      status: decodedMessage?.status ?? null,
      plaintext: decodedMessage?.plaintext ?? null,
    });
    const overlayAnchor = contentElement?.parentElement ?? messageElement;
    let overlay = overlayAnchor.querySelector<HTMLElement>("[data-ghostscript-debug-overlay]");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.dataset.ghostscriptDebugOverlay = "true";
      overlay.className = "ghostscript-decoded-overlay";
      overlayAnchor.appendChild(overlay);
    }

    overlay.dataset.ghostscriptMessageId = discordMessageId;
    overlay.innerHTML = `
      <div class="ghostscript-decoded-overlay__header">
        <span class="ghostscript-decoded-overlay__badge">Ghostscript Debug</span>
        <span class="ghostscript-decoded-overlay__state">Attached</span>
      </div>
      <p class="ghostscript-decoded-overlay__body">Message ${discordMessageId} · ${authorUsername}\n${debugText}</p>
    `;
    overlayCount += 1;
  }

  logGhostscriptDebug("debug-overlay", "attach-complete", {
    overlayCount,
    removedOverlayCount,
  });
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

function findMessageContentElement(messageElement: HTMLElement) {
  for (const selector of CONTENT_SELECTORS) {
    const candidate = messageElement.querySelector<HTMLElement>(selector);
    if (candidate) {
      return candidate;
    }
  }

  return null;
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
  return value
    .trim()
    .replace(/^@+/, "")
    .replace(/#[0-9]{4,}$/, "")
    .toLowerCase();
}

function usernamesProbablyMatch(left: string, right: string) {
  if (!left || !right) {
    return false;
  }

  if (left === right) {
    return true;
  }

  const compactLeft = compactUsername(left);
  const compactRight = compactUsername(right);

  if (!compactLeft || !compactRight) {
    return false;
  }

  return (
    compactLeft === compactRight ||
    (compactLeft.length >= 5 && compactRight.includes(compactLeft)) ||
    (compactRight.length >= 5 && compactLeft.includes(compactRight))
  );
}

function compactUsername(value: string) {
  return value.replace(/[^a-z0-9]/g, "");
}

function normalizeTimestampFloor(value?: string) {
  if (!value) {
    return "";
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
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

function dispatchEditableInputEvents(target: HTMLElement, text: string) {
  target.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
  target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
}

function extractEditableText(element: HTMLElement) {
  return element.innerText.trim() || element.textContent?.trim() || "";
}

function clickDiscordSendButton(textbox: HTMLElement) {
  const composerRoot = getDiscordComposerRoot(textbox);

  for (const selector of SEND_BUTTON_SELECTORS) {
    const sendButton = composerRoot?.querySelector<HTMLButtonElement>(selector);
    if (sendButton && !sendButton.disabled) {
      dispatchSendButtonClick(sendButton);
      return;
    }
  }
}

function submitDiscordComposer(textbox: HTMLElement) {
  const composerForm = textbox.closest("form");
  if (!(composerForm instanceof HTMLFormElement)) {
    return;
  }

  const sendButton = findDiscordSendButton(textbox);
  if (typeof composerForm.requestSubmit === "function") {
    composerForm.requestSubmit(sendButton ?? undefined);
    return;
  }

  const submitted = composerForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  if (!submitted) {
    return;
  }

  if (sendButton) {
    dispatchSendButtonClick(sendButton);
  }
}

function findDiscordSendButton(textbox: HTMLElement) {
  const composerRoot = getDiscordComposerRoot(textbox);

  for (const selector of SEND_BUTTON_SELECTORS) {
    const sendButton = composerRoot?.querySelector<HTMLButtonElement>(selector);
    if (sendButton && !sendButton.disabled) {
      return sendButton;
    }
  }

  return null;
}

function getDiscordComposerRoot(textbox: HTMLElement) {
  return (
    textbox.closest("form") ??
    textbox.closest('[class*="channelTextArea"]') ??
    textbox.closest('[class*="form"]') ??
    textbox.parentElement ??
    document.body
  );
}

function dispatchSendButtonClick(button: HTMLButtonElement) {
  button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse" }));
  button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  button.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse" }));
  button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
  button.click();
}

function waitForDiscordComposerSettle() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 30);
  });
}
