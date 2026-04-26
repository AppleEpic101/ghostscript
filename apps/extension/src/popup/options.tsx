import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { PAIRING_STATUS_LABELS } from "@ghostscript/shared";
import { resetPairing } from "../lib/pairingApi";
import { endLocalPairing, readExtensionState, storeDiscordUsername } from "../lib/pairingStore";
import "./popup.css";

function OptionsApp() {
  const [discordUsername, setDiscordUsername] = useState("");
  const [savedUsername, setSavedUsername] = useState("");
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [contactName, setContactName] = useState<string | null>(null);
  const [coverTopic, setCoverTopic] = useState<string | null>(null);
  const [statusLabel, setStatusLabel] = useState("No pairing yet");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEndingConnection, setIsEndingConnection] = useState(false);

  async function refresh() {
    const state = await readExtensionState();
    const activePairing = state.activePairing;
    const contact = state.contacts[0] ?? null;

    setDiscordUsername(state.profile?.discordUsername ?? "");
    setSavedUsername(state.profile?.discordUsername ?? "Not set");
    setInviteCode(activePairing?.inviteCode ?? contact?.inviteCode ?? null);
    setContactName(activePairing?.counterpart?.displayName ?? contact?.displayName ?? null);
    setCoverTopic(activePairing?.defaultCoverTopic ?? contact?.defaultCoverTopic ?? null);
    setStatusLabel(activePairing ? PAIRING_STATUS_LABELS[activePairing.status] : contact ? PAIRING_STATUS_LABELS[contact.status] : "No pairing yet");
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleSaveUsername() {
    setError(null);
    setFeedback(null);

    if (!discordUsername.trim()) {
      setError("Enter a username before saving.");
      return;
    }

    await storeDiscordUsername(discordUsername.trim());
    setFeedback("Saved your default Discord username for the popup.");
    await refresh();
  }

  async function handleEndConnection() {
    if (!inviteCode) {
      return;
    }

    setError(null);
    setFeedback(null);
    setIsEndingConnection(true);

    try {
      await resetPairing({ inviteCode });
      await endLocalPairing(inviteCode);
      setFeedback("Connection ended. Re-open the popup to start a new invite-based pairing.");
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to end the connection.");
    } finally {
      setIsEndingConnection(false);
    }
  }

  return (
    <div className="popup-shell popup-shell--wide">
      <p className="popup-eyebrow">Ghostscript advanced settings</p>
      <h1>Local pairing details</h1>
      <p className="popup-copy">
        The popup is now the main entry surface. This page only keeps lightweight local settings and connection management.
      </p>

      <section className="popup-card">
        <label className="popup-label">
          <span>Default Discord username</span>
          <input
            className="popup-input"
            type="text"
            value={discordUsername}
            onChange={(event) => setDiscordUsername(event.target.value)}
            placeholder="@yourname"
          />
        </label>
        <div className="popup-actions popup-actions--stack">
          <button className="popup-button" type="button" onClick={() => void handleSaveUsername()}>
            Save username
          </button>
        </div>
      </section>

      <section className="popup-card">
        <div className="popup-summary">
          <span>Saved username</span>
          <strong>{savedUsername}</strong>
          <span>Status</span>
          <strong>{statusLabel}</strong>
          <span>Invite code</span>
          <strong>{inviteCode ?? "None"}</strong>
          <span>Contact</span>
          <strong>{contactName ?? "None"}</strong>
          <span>Default topic</span>
          <strong>{coverTopic ?? "None"}</strong>
        </div>
        {inviteCode ? (
          <div className="popup-actions popup-actions--stack">
            <button className="popup-danger" type="button" disabled={isEndingConnection} onClick={() => void handleEndConnection()}>
              {isEndingConnection ? "Ending connection..." : "End connection"}
            </button>
          </div>
        ) : null}
      </section>

      {feedback ? <p className="popup-feedback popup-feedback--success">{feedback}</p> : null}
      {error ? <p className="popup-feedback popup-feedback--error">{error}</p> : null}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OptionsApp />
  </React.StrictMode>,
);
