import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { FEATURE_FLAGS, TRUST_STATUS_LABELS, type VaultState } from "@ghostscript/shared";
import { readExtensionState } from "../lib/pairingStore";
import { getRuntimeVaultState } from "../lib/vault";
import "./popup.css";

function PopupApp() {
  const [vaultState, setVaultState] = useState<VaultState>("uninitialized");
  const [contactName, setContactName] = useState("No pairing yet");
  const [trustStatus, setTrustStatus] = useState("Unpaired");

  useEffect(() => {
    void (async () => {
      const [nextVaultState, state] = await Promise.all([
        getRuntimeVaultState(),
        readExtensionState(),
      ]);

      setVaultState(nextVaultState);
      setContactName(state.contacts[0]?.displayName ?? "No pairing yet");
      setTrustStatus(state.contacts[0] ? TRUST_STATUS_LABELS[state.contacts[0].trustStatus] : "Unpaired");
    })();
  }, []);

  return (
    <div className="popup-shell">
      <p className="popup-eyebrow">Ghostscript</p>
      <h1>Discord privacy overlay</h1>
      <p className="popup-copy">
        The overlay handles secure compose and message reveal inside Discord. Pairing and vault setup live in settings.
      </p>
      <div className="popup-card">
        <span>Vault</span>
        <strong>{vaultState}</strong>
        <span>Contact</span>
        <strong>{contactName}</strong>
        <span>Trust</span>
        <strong>{trustStatus}</strong>
      </div>
      <div className="popup-card">
        <span>Text MVP</span>
        <strong>{FEATURE_FLAGS.textMvp ? "Enabled" : "Off"}</strong>
        <span>Image stretch</span>
        <strong>{FEATURE_FLAGS.imageStretchDisabled ? "Deferred" : "Enabled"}</strong>
      </div>
      <button className="popup-primary" type="button" onClick={() => void chrome.runtime.openOptionsPage()}>
        Open settings
      </button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PopupApp />
  </React.StrictMode>,
);
