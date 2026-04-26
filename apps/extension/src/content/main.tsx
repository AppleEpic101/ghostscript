import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { PAIRING_STATUS_LABELS } from "@ghostscript/shared";
import { applyInviteSessionSnapshot, readExtensionState } from "../lib/pairingStore";
import { getInviteSessionStatus } from "../lib/pairingApi";
import overlayStyles from "./styles.css?inline";

const SESSION_SYNC_POLL_MS = 5000;

function GhostscriptStatusOverlay() {
  const [status, setStatus] = useState("Not paired");
  const [contactName, setContactName] = useState("No active connection");
  const [coverTopic, setCoverTopic] = useState("Set after pairing");
  const [detail, setDetail] = useState("Ghostscript will treat a consumed invite as ready for Discord messaging.");

  async function refreshState() {
    const state = await readExtensionState();
    const activePairing = state.activePairing;
    const contact = state.contacts[0] ?? null;

    if (!activePairing) {
      setStatus("Not paired");
      setContactName("No active connection");
      setCoverTopic("Set after pairing");
      setDetail("Open Ghostscript from the toolbar to create or join an invite.");
      return;
    }

    setStatus(PAIRING_STATUS_LABELS[activePairing.status]);
    setContactName(activePairing.counterpart?.displayName ?? contact?.displayName ?? "Waiting for the other person");
    setCoverTopic(activePairing.defaultCoverTopic ?? contact?.defaultCoverTopic ?? "Not set yet");
    setDetail(
      activePairing.status === "paired"
        ? "This connection is ready. Ghostscript no longer waits for a manual verification step."
        : activePairing.status === "invalidated"
          ? "This invite is no longer active. Re-pair from the extension popup."
          : "Invite created. Share the code out of band, then return to Discord once they join.",
    );
  }

  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      const state = await readExtensionState();
      const activePairing = state.activePairing;

      if (!activePairing) {
        if (!cancelled) {
          await refreshState();
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
  }, []);

  return (
    <>
      <style>{overlayStyles}</style>
      <section className="ghostscript-status-card" aria-label="Ghostscript pairing status">
        <h2>Ghostscript</h2>
        <p>{detail}</p>
        <div className="ghostscript-status-meta">
          <span>Status</span>
          <strong>{status}</strong>
          <span>Contact</span>
          <strong>{contactName}</strong>
          <span>Topic</span>
          <strong>{coverTopic}</strong>
        </div>
      </section>
    </>
  );
}

function mountOverlay() {
  let host = document.getElementById("ghostscript-status-root");

  if (!host) {
    host = document.createElement("div");
    host.id = "ghostscript-status-root";
    host.className = "ghostscript-status-host";
    document.body.appendChild(host);
  }

  ReactDOM.createRoot(host).render(
    <React.StrictMode>
      <GhostscriptStatusOverlay />
    </React.StrictMode>,
  );
}

if (window.location.hostname === "discord.com") {
  mountOverlay();
}
