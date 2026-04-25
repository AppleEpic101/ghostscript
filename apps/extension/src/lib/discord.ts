export function findDiscordComposerAnchor(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('[role="textbox"]') ??
    document.querySelector<HTMLElement>("[data-list-item-id]")
  );
}

export function isDiscordDirectMessageRoute(): boolean {
  return /^\/channels\/@me\/\d+$/.test(window.location.pathname);
}

export function getActiveConversationId() {
  const match = window.location.pathname.match(/^\/channels\/@me\/(\d+)$/);
  return match?.[1] ?? null;
}

export function getActiveConversationLabel() {
  return (
    document.querySelector<HTMLElement>("header h1, header [data-text-variant]")?.textContent?.trim() ??
    "this DM"
  );
}

export function findDiscordMessageRows() {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-list-item-id^="chat-messages_"]'),
  );
}

export function getDiscordMessageId(row: HTMLElement) {
  return row.getAttribute("data-list-item-id") ?? row.id ?? "";
}

export function extractMessageText(row: HTMLElement) {
  const contentNodes = row.querySelectorAll<HTMLElement>('[id^="message-content-"]');
  const text = Array.from(contentNodes, (node) => node.innerText.trim())
    .filter(Boolean)
    .join("\n");

  if (text) {
    return text;
  }

  return row.innerText.trim();
}

export function insertIntoDiscordComposer(text: string) {
  const composer = document.querySelector<HTMLElement>('[role="textbox"]');

  if (!composer) {
    throw new Error("Discord composer is unavailable.");
  }

  composer.focus();
  const didInsert = document.execCommand("insertText", false, text);

  if (!didInsert) {
    composer.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        data: text,
        inputType: "insertText",
      }),
    );

    composer.textContent = text;

    composer.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: text,
        inputType: "insertText",
      }),
    );
  }

  composer.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter" }));
  composer.dispatchEvent(new KeyboardEvent("keypress", { bubbles: true, key: "Enter", code: "Enter" }));
  composer.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter", code: "Enter" }));
}
