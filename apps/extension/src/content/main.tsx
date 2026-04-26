import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactDOM, { type Root } from "react-dom/client";
import { getCurrentDiscordThreadId, getDiscordNativeTextbox } from "../lib/discord";
import { isPendingSendStale, readConversationState, setPendingSend } from "../lib/ghostscriptState";
import { sendEncryptedGhostscriptMessage, syncGhostscriptConversation } from "../lib/ghostscriptMessaging";
import { getInviteSessionStatus } from "../lib/pairingApi";
import { applyInviteSessionSnapshot, readExtensionState } from "../lib/pairingStore";
import overlayStyles from "./styles.css?inline";

const COMPOSER_OVERLAY_HOST_ID = "ghostscript-composer-overlay-root";
const CONVERSATION_SPACER_ID = "ghostscript-conversation-spacer";
const DISCORD_CHANNELS_ROUTE_PREFIX = "/channels";
const COMPOSER_OVERLAY_TABBAR_HEIGHT = 42;
const COMPOSER_OVERLAY_MIN_HEIGHT = 128;
const COMPOSER_OVERLAY_CONVERSATION_GAP = 14;
const SCROLLER_BOTTOM_LOCK_THRESHOLD = 48;
const CONVERSATION_SYNC_DEBOUNCE_MS = 450;

let composerOverlayRoot: Root | null = null;
let routeObserverAbortController: AbortController | null = null;
let lastKnownRoute = getCurrentRoute();
let visibilityCheckSequence = 0;
let storageChangeListenerInstalled = false;
let composerOverlaySyncFrame: number | null = null;
let composerOverlayMode: ComposerMode = "encrypted";
let conversationSyncTimeout: number | null = null;
let conversationSyncInFlight = false;

const NATIVE_TEXTBOX_MASK_DATASET_KEY = "ghostscriptMaskedByOverlay";
const NATIVE_TEXTBOX_PREVIOUS_OPACITY_DATASET_KEY = "ghostscriptPreviousOpacity";
const NATIVE_TEXTBOX_PREVIOUS_POINTER_EVENTS_DATASET_KEY = "ghostscriptPreviousPointerEvents";
const NATIVE_TEXTBOX_PREVIOUS_CARET_COLOR_DATASET_KEY = "ghostscriptPreviousCaretColor";

type ComposerMode = "encrypted" | "normal";

function canUseChromeStorageObserver() {
  try {
    return typeof chrome !== "undefined" && !!chrome.runtime?.id && !!chrome.storage?.onChanged;
  } catch {
    return false;
  }
}

function GhostscriptComposerOverlay({ onLayoutChange }: { onLayoutChange: () => void }) {
  const [mode, setMode] = useState<ComposerMode>("encrypted");
  const [encryptedDraft, setEncryptedDraft] = useState("");
  const [normalDraft, setNormalDraft] = useState("");
  const [coverTopic, setCoverTopic] = useState("Not set yet");
  const [sendStatus, setSendStatus] = useState("Ready to encrypt.");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendLocked, setSendLocked] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    const syncState = async () => {
      try {
        const state = await readExtensionState();
        if (cancelled) {
          return;
        }

        setCoverTopic(state.activePairing?.defaultCoverTopic ?? state.contacts[0]?.defaultCoverTopic ?? "Not set yet");

        const threadId = getCurrentDiscordThreadId();
        if (!threadId) {
          setSendStatus("Open a Discord thread to start.");
          setSendLocked(true);
          return;
        }

        const conversation = await readConversationState(threadId);
        if (cancelled) {
          return;
        }

        if (state.activePairing && isPendingSendStale(conversation.pendingSend, state.activePairing.session.id)) {
          await setPendingSend(threadId, null);
          if (cancelled) {
            return;
          }

          setSendStatus("Ready to encrypt.");
          setSendError(null);
          setSendLocked(false);
          return;
        }

        if (!conversation.pendingSend) {
          setSendStatus("Ready to encrypt.");
          setSendError(null);
          setSendLocked(false);
          return;
        }

        setSendLocked(conversation.pendingSend.status !== "failed");
        switch (conversation.pendingSend.status) {
          case "encoding":
            setSendStatus("Generating natural cover text...");
            setSendError(null);
            break;
          case "awaiting-discord-confirm":
            setSendStatus("Waiting for Discord to confirm the previous Ghostscript message...");
            setSendError(null);
            break;
          case "failed":
            setSendStatus("Ghostscript send failed.");
            setSendError(conversation.pendingSend.error);
            break;
        }
      } catch {
        if (!cancelled) {
          setCoverTopic("Not set yet");
          setSendStatus("Ghostscript is unavailable right now.");
        }
      }
    };

    void syncState();
    const intervalId = window.setInterval(() => {
      void syncState();
    }, 800);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
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
    syncDiscordNativeTextboxMask(mode === "encrypted");
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
  }, [activeDraft, coverTopic, isEncryptedMode, mode, onLayoutChange, sendError, sendStatus]);

  async function handleEncryptedSend() {
    const plaintext = encryptedDraft.trim();
    if (!plaintext) {
      return;
    }

    setSendError(null);
    setSendStatus("Generating natural cover text...");
    setSendLocked(true);

    try {
      const state = await readFreshExtensionState(true);
      const activePairing = state.activePairing;
      const localUsername = state.profile?.discordUsername ?? "";
      const partnerUsername = activePairing?.counterpart?.username ?? "";

      if (!activePairing || activePairing.status !== "paired") {
        throw new Error("Ghostscript is no longer paired in this Discord session.");
      }

      if (!localUsername || !partnerUsername) {
        throw new Error("Both Discord usernames must be available before Ghostscript can send.");
      }

      await sendEncryptedGhostscriptMessage({
        plaintext,
        pairing: activePairing,
        localUsername,
        partnerUsername,
      });

      setEncryptedDraft("");
      setSendStatus("Waiting for Discord to confirm the previous Ghostscript message...");
      scheduleConversationSync();
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Ghostscript send failed.");
      setSendStatus("Ghostscript send failed.");
      setSendLocked(false);
    }
  }

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
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !sendLocked) {
                  event.preventDefault();
                  void handleEncryptedSend();
                }
              }}
            />
            <div className="ghostscript-composer-actions">
              <p className="ghostscript-composer-status" role="status">
                {sendError ?? sendStatus}
              </p>
              <button
                type="button"
                className="ghostscript-composer-send"
                disabled={sendLocked || !encryptedDraft.trim()}
                onClick={() => {
                  void handleEncryptedSend();
                }}
              >
                Send encrypted
              </button>
            </div>
          </>
        ) : null}
      </section>
    </>
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
    syncDiscordNativeTextboxMask(false);
    clearConversationSpacer();
    return;
  }

  syncDiscordNativeTextboxMask(composerOverlayMode === "encrypted");

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

function scheduleConversationSync() {
  if (conversationSyncTimeout !== null) {
    window.clearTimeout(conversationSyncTimeout);
  }

  conversationSyncTimeout = window.setTimeout(() => {
    conversationSyncTimeout = null;
    void syncConversationActivity();
  }, CONVERSATION_SYNC_DEBOUNCE_MS);
}

async function syncConversationActivity() {
  if (conversationSyncInFlight) {
    return;
  }

  conversationSyncInFlight = true;

  try {
    const state = await readFreshExtensionState(false);
    const activePairing = state.activePairing;
    const localUsername = state.profile?.discordUsername ?? "";
    const partnerUsername = activePairing?.counterpart?.username ?? "";

    if (!activePairing || activePairing.status !== "paired" || !localUsername || !partnerUsername) {
      return;
    }

    await syncGhostscriptConversation({
      pairing: activePairing,
      localUsername,
      partnerUsername,
    });
  } catch {
    // Conversation sync is best-effort so the overlay can stay responsive on Discord DOM churn.
  } finally {
    conversationSyncInFlight = false;
  }
}

function unmountComposerOverlay() {
  if (composerOverlaySyncFrame !== null) {
    window.cancelAnimationFrame(composerOverlaySyncFrame);
    composerOverlaySyncFrame = null;
  }

  if (conversationSyncTimeout !== null) {
    window.clearTimeout(conversationSyncTimeout);
    conversationSyncTimeout = null;
  }

  composerOverlayRoot?.unmount();
  composerOverlayRoot = null;
  composerOverlayMode = "encrypted";
  syncDiscordNativeTextboxMask(false);
  document.getElementById(COMPOSER_OVERLAY_HOST_ID)?.remove();
  clearConversationSpacer();
}

async function readFreshExtensionState(forcePairingRefresh: boolean) {
  const state = await readExtensionState();
  const activePairing = state.activePairing;

  if (!activePairing) {
    return state;
  }

  const missingCounterpartIdentity =
    activePairing.status !== "paired" ||
    !activePairing.counterpart?.username ||
    !activePairing.counterpart?.transportPublicKey;

  if (!forcePairingRefresh && !missingCounterpartIdentity) {
    return state;
  }

  try {
    const snapshot = await getInviteSessionStatus(activePairing.inviteCode);
    await applyInviteSessionSnapshot(snapshot);
    return await readExtensionState();
  } catch {
    return state;
  }
}

function getCurrentRoute() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function isDiscordChannelRoute() {
  if (window.location.hostname !== "discord.com") {
    return false;
  }

  const pathSegments = window.location.pathname.split("/").filter(Boolean);
  return pathSegments[0] === DISCORD_CHANNELS_ROUTE_PREFIX.slice(1) && pathSegments.length >= 3;
}

async function shouldShowOverlay() {
  if (!isDiscordChannelRoute()) {
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
    mountComposerOverlay();
    scheduleComposerOverlaySync();
    scheduleConversationSync();
    return;
  }

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
    scheduleComposerOverlaySync();
    scheduleConversationSync();
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
      scheduleConversationSync();
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

function syncDiscordNativeTextboxMask(masked: boolean) {
  const textbox = getDiscordNativeTextbox();
  if (!textbox) {
    return;
  }

  if (masked) {
    if (textbox.dataset[NATIVE_TEXTBOX_MASK_DATASET_KEY] !== "true") {
      textbox.dataset[NATIVE_TEXTBOX_MASK_DATASET_KEY] = "true";
      textbox.dataset[NATIVE_TEXTBOX_PREVIOUS_OPACITY_DATASET_KEY] = textbox.style.opacity;
      textbox.dataset[NATIVE_TEXTBOX_PREVIOUS_POINTER_EVENTS_DATASET_KEY] = textbox.style.pointerEvents;
      textbox.dataset[NATIVE_TEXTBOX_PREVIOUS_CARET_COLOR_DATASET_KEY] = textbox.style.caretColor;
    }

    textbox.style.opacity = "0";
    textbox.style.pointerEvents = "none";
    textbox.style.caretColor = "transparent";
    return;
  }

  if (textbox.dataset[NATIVE_TEXTBOX_MASK_DATASET_KEY] !== "true") {
    return;
  }

  textbox.style.opacity = textbox.dataset[NATIVE_TEXTBOX_PREVIOUS_OPACITY_DATASET_KEY] ?? "";
  textbox.style.pointerEvents = textbox.dataset[NATIVE_TEXTBOX_PREVIOUS_POINTER_EVENTS_DATASET_KEY] ?? "";
  textbox.style.caretColor = textbox.dataset[NATIVE_TEXTBOX_PREVIOUS_CARET_COLOR_DATASET_KEY] ?? "";
  delete textbox.dataset[NATIVE_TEXTBOX_MASK_DATASET_KEY];
  delete textbox.dataset[NATIVE_TEXTBOX_PREVIOUS_OPACITY_DATASET_KEY];
  delete textbox.dataset[NATIVE_TEXTBOX_PREVIOUS_POINTER_EVENTS_DATASET_KEY];
  delete textbox.dataset[NATIVE_TEXTBOX_PREVIOUS_CARET_COLOR_DATASET_KEY];
}
