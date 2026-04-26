import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactDOM, { type Root } from "react-dom/client";
import { PAIRING_STATUS_LABELS } from "@ghostscript/shared";
import { applyInviteSessionSnapshot, readExtensionState } from "../lib/pairingStore";
import { getInviteSessionStatus } from "../lib/pairingApi";
import overlayStyles from "./styles.css?inline";

const SESSION_SYNC_POLL_MS = 5000;
const OVERLAY_HOST_ID = "ghostscript-status-root";
const COMPOSER_OVERLAY_HOST_ID = "ghostscript-composer-overlay-root";
const CONVERSATION_SPACER_ID = "ghostscript-conversation-spacer";
const DISCORD_ME_ROUTE_PREFIX = "/channels/@me";
const COMPOSER_OVERLAY_TABBAR_HEIGHT = 42;
const COMPOSER_OVERLAY_MIN_HEIGHT = 128;
const COMPOSER_OVERLAY_CONVERSATION_GAP = 14;
const SCROLLER_BOTTOM_LOCK_THRESHOLD = 48;

let overlayRoot: Root | null = null;
let composerOverlayRoot: Root | null = null;
let routeObserverAbortController: AbortController | null = null;
let lastKnownRoute = getCurrentRoute();
let visibilityCheckSequence = 0;
let storageChangeListenerInstalled = false;
let composerOverlaySyncFrame: number | null = null;
let composerOverlayMode: ComposerMode = "encrypted";

interface OverlayState {
  status: string;
  contactName: string;
  coverTopic: string;
  detail: string;
}

type ComposerMode = "encrypted" | "normal";

const DEFAULT_OVERLAY_STATE: OverlayState = {
  status: "Paired",
  contactName: "Waiting for the other person",
  coverTopic: "Not set yet",
  detail: "This connection is ready. Ghostscript no longer waits for a manual verification step.",
};

function canUseChromeStorageObserver() {
  try {
    return typeof chrome !== "undefined" && !!chrome.runtime?.id && !!chrome.storage?.onChanged;
  } catch {
    return false;
  }
}

function GhostscriptStatusOverlay({ onPairingLost }: { onPairingLost: () => void }) {
  const [overlayState, setOverlayState] = useState<OverlayState>(DEFAULT_OVERLAY_STATE);

  async function refreshState() {
    const state = await readExtensionState();
    const activePairing = state.activePairing;
    const contact = state.contacts[0] ?? null;

    if (!activePairing || activePairing.status !== "paired") {
      onPairingLost();
      return;
    }

    setOverlayState({
      status: PAIRING_STATUS_LABELS[activePairing.status],
      contactName:
        activePairing.counterpart?.displayName ?? contact?.displayName ?? "Waiting for the other person",
      coverTopic: activePairing.defaultCoverTopic ?? contact?.defaultCoverTopic ?? "Not set yet",
      detail: "This connection is ready. Ghostscript no longer waits for a manual verification step.",
    });
  }

  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      const state = await readExtensionState();
      const activePairing = state.activePairing;

      if (!activePairing || activePairing.status !== "paired") {
        if (!cancelled) {
          onPairingLost();
        }
        return;
      }

      try {
        const snapshot = await getInviteSessionStatus(activePairing.inviteCode);
        await applyInviteSessionSnapshot(snapshot);
      } catch {
        // The popup surfaces request errors. The overlay only mirrors the latest known local state.
      }

      if (!cancelled) {
        await refreshState();
      }
    };

    void sync();
    const intervalId = window.setInterval(() => {
      void sync();
    }, SESSION_SYNC_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [onPairingLost]);

  return (
    <>
      <style>{overlayStyles}</style>
      <section className="ghostscript-status-card" aria-label="Ghostscript pairing status">
        <h2>Ghostscript</h2>
        <p>{overlayState.detail}</p>
        <div className="ghostscript-status-meta">
          <span>Status</span>
          <strong>{overlayState.status}</strong>
          <span>Contact</span>
          <strong>{overlayState.contactName}</strong>
          <span>Topic</span>
          <strong>{overlayState.coverTopic}</strong>
        </div>
      </section>
    </>
  );
}

function GhostscriptComposerOverlay({ onLayoutChange }: { onLayoutChange: () => void }) {
  const [mode, setMode] = useState<ComposerMode>("encrypted");
  const [encryptedDraft, setEncryptedDraft] = useState("");
  const [normalDraft, setNormalDraft] = useState("");
  const [coverTopic, setCoverTopic] = useState("Not set yet");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    const syncCoverTopic = async () => {
      try {
        const state = await readExtensionState();
        if (cancelled) {
          return;
        }

        setCoverTopic(state.activePairing?.defaultCoverTopic ?? state.contacts[0]?.defaultCoverTopic ?? "Not set yet");
      } catch {
        if (!cancelled) {
          setCoverTopic("Not set yet");
        }
      }
    };

    void syncCoverTopic();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [mode]);

  const isEncryptedMode = mode === "encrypted";
  const activeDraft = isEncryptedMode ? encryptedDraft : normalDraft;
  const setActiveDraft = isEncryptedMode ? setEncryptedDraft : setNormalDraft;

  useEffect(() => {
    composerOverlayMode = mode;
    onLayoutChange();

    if (mode === "normal") {
      window.setTimeout(() => {
        getDiscordNativeTextbox()?.focus();
      }, 0);
    }
  }, [mode, onLayoutChange]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !isEncryptedMode) {
      onLayoutChange();
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
    onLayoutChange();
  }, [activeDraft, coverTopic, isEncryptedMode, mode, onLayoutChange]);

  return (
    <>
      <style>{overlayStyles}</style>
      <section className={`ghostscript-composer-shell ghostscript-composer-shell--${mode}`}>
        <div className="ghostscript-composer-tabs" role="tablist" aria-label="Ghostscript composer mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "normal"}
            className={`ghostscript-composer-tab ${mode === "normal" ? "ghostscript-composer-tab--active" : ""}`}
            onClick={() => {
              setMode("normal");
            }}
          >
            Normal
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "encrypted"}
            className={`ghostscript-composer-tab ${mode === "encrypted" ? "ghostscript-composer-tab--active" : ""}`}
            onClick={() => {
              setMode("encrypted");
            }}
          >
            End-to-end
          </button>
        </div>
        {isEncryptedMode ? (
          <>
            <label className="ghostscript-composer-label" htmlFor="ghostscript-composer-textarea">
              {`End-to-end draft · Topic: ${coverTopic}`}
            </label>
            <textarea
              id="ghostscript-composer-textarea"
              ref={textareaRef}
              className="ghostscript-composer-textarea"
              value={activeDraft}
              onChange={(event) => {
                setActiveDraft(event.target.value);
              }}
              placeholder="Type the message you want Ghostscript to encrypt."
              spellCheck={false}
            />
          </>
        ) : null}
      </section>
    </>
  );
}

function mountOverlay() {
  let host = document.getElementById(OVERLAY_HOST_ID);

  if (!host) {
    host = document.createElement("div");
    host.id = OVERLAY_HOST_ID;
    host.className = "ghostscript-status-host";
    document.body.appendChild(host);
  }

  if (!overlayRoot) {
    overlayRoot = ReactDOM.createRoot(host);
  }

  overlayRoot.render(
    <React.StrictMode>
      <GhostscriptStatusOverlay
        onPairingLost={() => {
          void syncOverlayVisibility();
        }}
      />
    </React.StrictMode>,
  );
}

function getDiscordComposerTarget() {
  const textbox = getDiscordNativeTextbox();

  if (!(textbox instanceof HTMLElement)) {
    return null;
  }

  const candidates = [
    textbox.closest('[class*="channelTextArea"]'),
    textbox.closest('[class*="textArea"]'),
    textbox.closest('[class*="slateTextArea"]'),
    textbox.parentElement,
    textbox.parentElement?.parentElement,
    textbox,
  ];

  for (const candidate of candidates) {
    if (!(candidate instanceof HTMLElement)) {
      continue;
    }

    const bounds = candidate.getBoundingClientRect();
    if (bounds.width >= 220 && bounds.height >= 36) {
      return candidate;
    }
  }

  return textbox;
}

function getDiscordNativeTextbox() {
  const textbox = document.querySelector('[role="textbox"][contenteditable="true"]');
  return textbox instanceof HTMLElement ? textbox : null;
}

function findScrollableAncestor(element: HTMLElement | null) {
  let current = element;

  while (current) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY;

    if ((overflowY === "auto" || overflowY === "scroll") && current.scrollHeight > current.clientHeight) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function getDiscordConversationScroller() {
  const candidates = [
    document.querySelector('[data-list-id="chat-messages"]'),
    document.querySelector('[role="log"]'),
    document.querySelector('[aria-label^="Messages"]'),
  ];

  for (const candidate of candidates) {
    if (!(candidate instanceof HTMLElement)) {
      continue;
    }

    const scrollableAncestor = findScrollableAncestor(candidate);
    if (scrollableAncestor) {
      return scrollableAncestor;
    }
  }

  return null;
}

function createComposerOverlayHost() {
  const host = document.createElement("div");
  host.id = COMPOSER_OVERLAY_HOST_ID;
  host.className = "ghostscript-composer-host";
  document.body.appendChild(host);
  return host;
}

function clearConversationSpacer() {
  document.getElementById(CONVERSATION_SPACER_ID)?.remove();
}

function syncConversationSpacer(inset: number) {
  const scroller = getDiscordConversationScroller();
  if (!scroller) {
    clearConversationSpacer();
    return;
  }

  const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  const shouldLockToBottom = distanceFromBottom <= SCROLLER_BOTTOM_LOCK_THRESHOLD;

  let spacer = document.getElementById(CONVERSATION_SPACER_ID);
  if (!(spacer instanceof HTMLElement) || spacer.parentElement !== scroller) {
    spacer?.remove();
    spacer = document.createElement("div");
    spacer.id = CONVERSATION_SPACER_ID;
    spacer.className = "ghostscript-conversation-spacer";
    spacer.setAttribute("aria-hidden", "true");
    scroller.appendChild(spacer);
  }

  spacer.style.height = `${Math.max(0, Math.round(inset))}px`;

  if (shouldLockToBottom) {
    scroller.scrollTop = scroller.scrollHeight;
  }
}

function mountComposerOverlay() {
  let host = document.getElementById(COMPOSER_OVERLAY_HOST_ID);

  if (!host) {
    host = createComposerOverlayHost();
  }

  if (!composerOverlayRoot) {
    composerOverlayRoot = ReactDOM.createRoot(host);
  }

  composerOverlayRoot.render(
    <React.StrictMode>
      <GhostscriptComposerOverlay
        onLayoutChange={() => {
          scheduleComposerOverlaySync();
        }}
      />
    </React.StrictMode>,
  );
}

function syncComposerOverlay() {
  const target = getDiscordComposerTarget();
  const existingHost = document.getElementById(COMPOSER_OVERLAY_HOST_ID);

  if (!existingHost) {
    return;
  }

  if (!target) {
    existingHost.style.display = "none";
    clearConversationSpacer();
    return;
  }

  const bounds = target.getBoundingClientRect();

  existingHost.style.display = "block";
  existingHost.style.left = `${bounds.left}px`;
  existingHost.style.width = `${bounds.width}px`;
  const minimumHeight =
    composerOverlayMode === "encrypted"
      ? Math.max(COMPOSER_OVERLAY_MIN_HEIGHT, bounds.height + COMPOSER_OVERLAY_TABBAR_HEIGHT)
      : 0;
  existingHost.style.minHeight = `${minimumHeight}px`;
  existingHost.style.height = "auto";

  const overlayHeight = Math.max(minimumHeight, existingHost.offsetHeight);
  const overlayTop = Math.max(
    12,
    composerOverlayMode === "encrypted" ? bounds.bottom - overlayHeight : bounds.top - overlayHeight - 8,
  );
  existingHost.style.top = `${overlayTop}px`;

  const conversationInset =
    composerOverlayMode === "encrypted"
      ? Math.max(0, overlayHeight - bounds.height + COMPOSER_OVERLAY_CONVERSATION_GAP)
      : overlayHeight + COMPOSER_OVERLAY_CONVERSATION_GAP;
  syncConversationSpacer(conversationInset);
}

function scheduleComposerOverlaySync() {
  if (composerOverlaySyncFrame !== null) {
    return;
  }

  composerOverlaySyncFrame = window.requestAnimationFrame(() => {
    composerOverlaySyncFrame = null;
    syncComposerOverlay();
  });
}

function unmountComposerOverlay() {
  if (composerOverlaySyncFrame !== null) {
    window.cancelAnimationFrame(composerOverlaySyncFrame);
    composerOverlaySyncFrame = null;
  }

  composerOverlayRoot?.unmount();
  composerOverlayRoot = null;
  composerOverlayMode = "encrypted";
  document.getElementById(COMPOSER_OVERLAY_HOST_ID)?.remove();
  clearConversationSpacer();
}

function unmountOverlay() {
  overlayRoot?.unmount();
  overlayRoot = null;
  document.getElementById(OVERLAY_HOST_ID)?.remove();
}

function getCurrentRoute() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function isDiscordMeRoute() {
  return (
    window.location.hostname === "discord.com" &&
    (window.location.pathname === DISCORD_ME_ROUTE_PREFIX ||
      window.location.pathname.startsWith(`${DISCORD_ME_ROUTE_PREFIX}/`))
  );
}

async function shouldShowOverlay() {
  if (!isDiscordMeRoute()) {
    return false;
  }

  const state = await readExtensionState();
  return state.activePairing?.status === "paired";
}

async function syncOverlayVisibility() {
  const sequence = ++visibilityCheckSequence;
  let showOverlay = false;

  try {
    showOverlay = await shouldShowOverlay();
  } catch {
    showOverlay = false;
  }

  if (sequence !== visibilityCheckSequence) {
    return;
  }

  if (showOverlay) {
    mountOverlay();
    mountComposerOverlay();
    scheduleComposerOverlaySync();
    return;
  }

  unmountOverlay();
  unmountComposerOverlay();
}

function handleRouteChange() {
  const nextRoute = getCurrentRoute();
  if (nextRoute === lastKnownRoute) {
    return;
  }

  lastKnownRoute = nextRoute;
  void syncOverlayVisibility();
}

function installRouteObservers() {
  if (routeObserverAbortController) {
    return;
  }

  routeObserverAbortController = new AbortController();
  const { signal } = routeObserverAbortController;

  const wrapHistoryMethod = (methodName: "pushState" | "replaceState") => {
    const originalMethod = window.history[methodName];

    window.history[methodName] = function wrappedHistoryMethod(...args) {
      const result = originalMethod.apply(this, args);
      handleRouteChange();
      return result;
    };

    signal.addEventListener(
      "abort",
      () => {
        window.history[methodName] = originalMethod;
      },
      { once: true },
    );
  };

  wrapHistoryMethod("pushState");
  wrapHistoryMethod("replaceState");

  window.addEventListener("popstate", handleRouteChange, { signal });
  window.addEventListener("hashchange", handleRouteChange, { signal });
  window.addEventListener("resize", scheduleComposerOverlaySync, { signal });
  document.addEventListener("scroll", scheduleComposerOverlaySync, {
    capture: true,
    passive: true,
    signal,
  });

  const observer = new MutationObserver(() => {
    handleRouteChange();
    if (overlayRoot) {
      scheduleComposerOverlaySync();
    }
  });

  observer.observe(document, {
    childList: true,
    subtree: true,
  });

  signal.addEventListener(
    "abort",
    () => {
      observer.disconnect();
    },
    { once: true },
  );
}

function installStorageObserver() {
  if (storageChangeListenerInstalled || !canUseChromeStorageObserver()) {
    return;
  }

  storageChangeListenerInstalled = true;

  try {
    chrome.storage.onChanged.addListener((_changes, areaName) => {
      if (areaName !== "local") {
        return;
      }

      void syncOverlayVisibility();
    });
  } catch {
    storageChangeListenerInstalled = false;
  }
}

if (window.location.hostname === "discord.com") {
  installRouteObservers();
  installStorageObserver();
  void syncOverlayVisibility();
}
