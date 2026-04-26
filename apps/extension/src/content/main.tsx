import React, { useEffect, useState } from "react";
import ReactDOM, { type Root } from "react-dom/client";
import { PAIRING_STATUS_LABELS } from "@ghostscript/shared";
import { applyInviteSessionSnapshot, readExtensionState } from "../lib/pairingStore";
import { getInviteSessionStatus } from "../lib/pairingApi";
import overlayStyles from "./styles.css?inline";

const SESSION_SYNC_POLL_MS = 5000;
const OVERLAY_HOST_ID = "ghostscript-status-root";
const DISCORD_ME_ROUTE_PREFIX = "/channels/@me";

let overlayRoot: Root | null = null;
let routeObserverAbortController: AbortController | null = null;
let lastKnownRoute = getCurrentRoute();
let visibilityCheckSequence = 0;
let storageChangeListenerInstalled = false;

interface OverlayState {
  status: string;
  contactName: string;
  coverTopic: string;
  detail: string;
}

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
    return;
  }

  unmountOverlay();
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

  const observer = new MutationObserver(() => {
    handleRouteChange();
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
