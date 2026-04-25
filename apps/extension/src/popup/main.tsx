import React from "react";
import ReactDOM from "react-dom/client";
import { FEATURE_FLAGS, mockPairingSnapshot, TRUST_STATUS_LABELS } from "@ghostscript/shared";
import "./popup.css";

function PopupApp() {
  return (
    <div className="popup-shell">
      <p className="popup-eyebrow">Ghostscript</p>
      <h1>Discord privacy overlay</h1>
      <p className="popup-copy">
        Pairing is handled in the web app. The extension owns secure compose,
        message detection, and local trust state.
      </p>
      <div className="popup-card">
        <span>Contact</span>
        <strong>{mockPairingSnapshot.contact.displayName}</strong>
        <span>Trust</span>
        <strong>{TRUST_STATUS_LABELS[mockPairingSnapshot.contact.trustStatus]}</strong>
      </div>
      <div className="popup-card">
        <span>Text MVP</span>
        <strong>{FEATURE_FLAGS.textMvp ? "Scaffolded" : "Off"}</strong>
        <span>Image stretch</span>
        <strong>{FEATURE_FLAGS.imageStretchDisabled ? "Deferred" : "Enabled"}</strong>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PopupApp />
  </React.StrictMode>,
);
