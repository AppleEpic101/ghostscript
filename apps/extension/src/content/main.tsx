import React from "react";
import ReactDOM from "react-dom/client";
import { TRUST_STATUS_LABELS } from "@ghostscript/shared";
import { findDiscordComposerAnchor, isDiscordDirectMessageRoute } from "../lib/discord";
import { getMockConversationState } from "../lib/mockState";
import "./styles.css";

function GhostscriptOverlay() {
  const { contact, conversation } = getMockConversationState();

  return (
    <section className="ghostscript-card" aria-label="Ghostscript secure overlay">
      <p className="ghostscript-eyebrow">Ghostscript secure compose</p>
      <h2>Protected message flow mounts here.</h2>
      <p>
        This placeholder intentionally keeps plaintext in the extension UI and
        out of Discord&apos;s native composer.
      </p>
      <div className="ghostscript-status-row">
        <span>{contact.displayName}</span>
        <strong>{TRUST_STATUS_LABELS[conversation.trustStatus]}</strong>
      </div>
      <textarea
        className="ghostscript-textarea"
        placeholder="Secure plaintext will be composed here in a future pass."
      />
      <button className="ghostscript-button" type="button">
        Simulate cover-text send
      </button>
    </section>
  );
}

function mountOverlay() {
  if (!isDiscordDirectMessageRoute()) {
    return;
  }

  if (document.getElementById("ghostscript-root")) {
    return;
  }

  const anchor = findDiscordComposerAnchor();
  if (!anchor) {
    return;
  }

  const root = document.createElement("div");
  root.id = "ghostscript-root";
  root.setAttribute("data-ghostscript-root", "true");

  const parent = anchor.parentElement ?? document.body;
  parent.insertAdjacentElement("beforebegin", root);

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <GhostscriptOverlay />
    </React.StrictMode>,
  );
}

const observer = new MutationObserver(() => {
  mountOverlay();
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

mountOverlay();
