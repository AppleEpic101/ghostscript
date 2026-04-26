import test from "node:test";
import assert from "node:assert/strict";
import { classifyTwoPartyAuthors, extractMessageText, filterEligibleTwoPartyMessages, resolveDiscordMessageId, sendTextThroughDiscord } from "./discord";
import { appendInvisiblePayload } from "./invisibleTransport";

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

test("extractMessageText preserves an invisible Ghostscript payload from textContent even when innerText omits it", () => {
  const visibleText = "coffee later still works for me";
  const encodedText = appendInvisiblePayload(visibleText, "0101011100");
  const element = {
    innerText: visibleText,
    textContent: encodedText,
    querySelector: () => null,
  } as unknown as HTMLElement;

  assert.equal(extractMessageText(element), encodedText);
});

test("extractMessageText still returns ordinary visible text for normal Discord messages", () => {
  const element = {
    innerText: "just a normal message",
    textContent: "just a normal message",
    querySelector: () => null,
  } as unknown as HTMLElement;

  assert.equal(extractMessageText(element), "just a normal message");
});

test("sendTextThroughDiscord replaces an existing draft before submitting", async () => {
  const harness = installDiscordComposerHarness({
    initialText: "previous failed ghostscript draft",
    execCommand(command, _showUi, value) {
      if (command === "delete") {
        harness.textbox.textContent = "";
        return true;
      }

      if (command === "insertText") {
        harness.textbox.textContent = String(value ?? "");
        return true;
      }

      return false;
    },
    onSubmit() {
      harness.textbox.textContent = "";
    },
  });

  await sendTextThroughDiscord("fresh replacement text");

  assert.equal(harness.textbox.textContent, "");
  assert.deepEqual(harness.execCommands, ["delete", "insertText"]);
  assert.equal(harness.submitted, 1);
  harness.restore();
});

test("sendTextThroughDiscord throws when the composer append path leaves the old draft in place", async () => {
  const harness = installDiscordComposerHarness({
    initialText: "previous failed ghostscript draft",
    execCommand(command, _showUi, value) {
      if (command === "delete") {
        return true;
      }

      if (command === "insertText") {
        harness.textbox.textContent = `previous failed ghostscript draft ${String(value ?? "")}`.trim();
        return true;
      }

      return false;
    },
  });

  await assert.rejects(
    () => sendTextThroughDiscord("fresh replacement text"),
    /Discord composer did not replace the existing draft cleanly\./,
  );

  assert.deepEqual(harness.execCommands, ["delete", "insertText"]);
  harness.restore();
});

test("sendTextThroughDiscord clears a lingering previous failed attempt before retrying", async () => {
  const harness = installDiscordComposerHarness({
    initialText: "cover text from retry one",
    execCommand(command, _showUi, value) {
      if (command === "delete") {
        harness.textbox.textContent = "";
        return true;
      }

      if (command === "insertText") {
        harness.textbox.textContent = String(value ?? "");
        return true;
      }

      return false;
    },
    onSubmit() {
      harness.lastSubmittedText = harness.textbox.textContent;
      harness.textbox.textContent = "";
    },
  });

  await sendTextThroughDiscord("cover text from retry two");

  assert.equal(harness.lastSubmittedText, "cover text from retry two");
  assert.equal(harness.textbox.textContent, "");
  harness.restore();
});

interface ComposerHarnessOptions {
  initialText?: string;
  execCommand: (command: string, showUi: boolean, value?: unknown) => boolean;
  onSubmit?: () => void;
}

function installDiscordComposerHarness(options: ComposerHarnessOptions) {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalHTMLFormElement = globalThis.HTMLFormElement;
  const originalHTMLButtonElement = globalThis.HTMLButtonElement;
  const originalEvent = globalThis.Event;
  const originalInputEvent = globalThis.InputEvent;
  const originalKeyboardEvent = globalThis.KeyboardEvent;
  const originalMouseEvent = globalThis.MouseEvent;
  const originalPointerEvent = globalThis.PointerEvent;

  class FakeEvent {
    type: string;
    bubbles: boolean;
    cancelable: boolean;

    constructor(type: string, init: { bubbles?: boolean; cancelable?: boolean } = {}) {
      this.type = type;
      this.bubbles = init.bubbles ?? false;
      this.cancelable = init.cancelable ?? false;
    }
  }

  class FakeInputEvent extends FakeEvent {
    inputType?: string;
    data?: string | null;

    constructor(type: string, init: { bubbles?: boolean; cancelable?: boolean; inputType?: string; data?: string | null } = {}) {
      super(type, init);
      this.inputType = init.inputType;
      this.data = init.data;
    }
  }

  class FakeKeyboardEvent extends FakeEvent {
    key?: string;
    code?: string;
    keyCode?: number;
    which?: number;

    constructor(type: string, init: { bubbles?: boolean; cancelable?: boolean; key?: string; code?: string; keyCode?: number; which?: number } = {}) {
      super(type, init);
      this.key = init.key;
      this.code = init.code;
      this.keyCode = init.keyCode;
      this.which = init.which;
    }
  }

  class FakeMouseEvent extends FakeEvent {}
  class FakePointerEvent extends FakeEvent {
    pointerId?: number;
    pointerType?: string;

    constructor(type: string, init: { bubbles?: boolean; cancelable?: boolean; pointerId?: number; pointerType?: string } = {}) {
      super(type, init);
      this.pointerId = init.pointerId;
      this.pointerType = init.pointerType;
    }
  }

  class FakeHTMLElement {
    textContent = "";
    innerText = "";
    parentElement: FakeHTMLElement | null = null;
    ownerDocument!: FakeDocument;
    private readonly listeners = new Map<string, Array<(event: FakeEvent) => void>>();

    focus() {}

    dispatchEvent(event: FakeEvent) {
      for (const listener of this.listeners.get(event.type) ?? []) {
        listener(event);
      }
      return true;
    }

    addEventListener(type: string, listener: (event: FakeEvent) => void) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    closest(selector: string): FakeHTMLElement | null {
      if (selector === "form") {
        return this.parentElement instanceof FakeFormElement ? this.parentElement : null;
      }

      return this.parentElement;
    }

    querySelector<T>(_selector: string): T | null {
      return null;
    }
  }

  class FakeButtonElement extends FakeHTMLElement {
    disabled = false;
    click() {
      this.dispatchEvent(new FakeMouseEvent("click", { bubbles: true, cancelable: true }));
      return true;
    }
  }

  class FakeFormElement extends FakeHTMLElement {
    sendButton: FakeButtonElement;
    onSubmit: (() => void) | undefined;

    constructor(sendButton: FakeButtonElement, onSubmit?: () => void) {
      super();
      this.sendButton = sendButton;
      this.onSubmit = onSubmit;
      sendButton.parentElement = this;
    }

    override querySelector<T>(selector: string): T | null {
      if (
        selector === 'button[type="submit"]' ||
        selector === 'button[aria-label*="Send" i]' ||
        selector === 'button[class*="sendButton"]' ||
        selector === '[role="button"][aria-label*="Send" i]'
      ) {
        return this.sendButton as T;
      }

      return null;
    }

    requestSubmit() {
      this.onSubmit?.();
    }
  }

  class FakeTextboxElement extends FakeHTMLElement {}

  class FakeRange {
    selectNodeContents(_element: FakeHTMLElement) {}
  }

  class FakeSelection {
    removeAllRanges() {}
    addRange(_range: FakeRange) {}
  }

  class FakeDocument {
    textbox: FakeTextboxElement;
    execCommands: string[];
    execCommandImpl: ComposerHarnessOptions["execCommand"];

    constructor(textbox: FakeTextboxElement, execCommands: string[], execCommandImpl: ComposerHarnessOptions["execCommand"]) {
      this.textbox = textbox;
      this.execCommands = execCommands;
      this.execCommandImpl = execCommandImpl;
    }

    querySelector(selector: string) {
      if (selector === '[role="textbox"][contenteditable="true"]') {
        return this.textbox;
      }

      return null;
    }

    createRange() {
      return new FakeRange();
    }

    execCommand(command: string, showUi: boolean, value?: unknown) {
      this.execCommands.push(command);
      return this.execCommandImpl(command, showUi, value);
    }
  }

  const execCommands: string[] = [];
  const sendButton = new FakeButtonElement();
  const form = new FakeFormElement(sendButton, options.onSubmit);
  const textbox = new FakeTextboxElement();
  textbox.textContent = options.initialText ?? "";
  textbox.innerText = options.initialText ?? "";
  textbox.parentElement = form;
  const document = new FakeDocument(textbox, execCommands, options.execCommand);
  textbox.ownerDocument = document;
  form.ownerDocument = document;
  sendButton.ownerDocument = document;

  textbox.addEventListener("input", () => {
    textbox.innerText = textbox.textContent;
  });

  let submitted = 0;
  let lastSubmittedText = "";
  form.onSubmit = () => {
    submitted += 1;
    lastSubmittedText = textbox.textContent;
    options.onSubmit?.();
    textbox.innerText = textbox.textContent;
  };

  const selection = new FakeSelection();
  const windowObject = {
    getSelection: () => selection,
    setTimeout: (callback: () => void) => {
      callback();
      return 0;
    },
  } as unknown as Window & typeof globalThis;

  globalThis.HTMLElement = FakeHTMLElement as unknown as typeof HTMLElement;
  globalThis.HTMLFormElement = FakeFormElement as unknown as typeof HTMLFormElement;
  globalThis.HTMLButtonElement = FakeButtonElement as unknown as typeof HTMLButtonElement;
  globalThis.Event = FakeEvent as unknown as typeof Event;
  globalThis.InputEvent = FakeInputEvent as unknown as typeof InputEvent;
  globalThis.KeyboardEvent = FakeKeyboardEvent as unknown as typeof KeyboardEvent;
  globalThis.MouseEvent = FakeMouseEvent as unknown as typeof MouseEvent;
  globalThis.PointerEvent = FakePointerEvent as unknown as typeof PointerEvent;
  globalThis.document = document as unknown as Document;
  globalThis.window = windowObject;

  return {
    textbox,
    execCommands,
    get submitted() {
      return submitted;
    },
    get lastSubmittedText() {
      return lastSubmittedText;
    },
    set lastSubmittedText(value: string) {
      lastSubmittedText = value;
    },
    restore() {
      globalThis.window = originalWindow;
      globalThis.document = originalDocument;
      globalThis.HTMLElement = originalHTMLElement;
      globalThis.HTMLFormElement = originalHTMLFormElement;
      globalThis.HTMLButtonElement = originalHTMLButtonElement;
      globalThis.Event = originalEvent;
      globalThis.InputEvent = originalInputEvent;
      globalThis.KeyboardEvent = originalKeyboardEvent;
      globalThis.MouseEvent = originalMouseEvent;
      globalThis.PointerEvent = originalPointerEvent;
    },
  };
}
