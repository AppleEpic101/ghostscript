import React from "react";
import ReactDOM from "react-dom/client";
import { mockPairingSnapshot } from "@ghostscript/shared";
import "./popup.css";

function OptionsApp() {
  return (
    <div className="popup-shell">
      <p className="popup-eyebrow">Ghostscript settings</p>
      <h1>Local key and pairing placeholders</h1>
      <div className="popup-card">
        <span>Identity fingerprint</span>
        <strong>{mockPairingSnapshot.identity.fingerprint}</strong>
        <span>Safety number</span>
        <strong>{mockPairingSnapshot.contact.safetyNumber}</strong>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OptionsApp />
  </React.StrictMode>,
);
