import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { PAIRING_STATUS_LABELS, type PairingStatus } from "@ghostscript/shared";
import { createInvite, joinInvite } from "../lib/pairingApi";
import {
  clearInviteDraft,
  readExtensionState,
  storeCreatedInvite,
  storeDiscordUsername,
  storeInviteDraft,
  storeJoinedPairing,
} from "../lib/pairingStore";
import "./popup.css";

type PopupStep = "home" | "create-invite-details";
type RequestStatus = "idle" | "loading" | "success" | "error";

function PopupApp() {
  const [discordUsername, setDiscordUsername] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [coverTopic, setCoverTopic] = useState("");
  const [step, setStep] = useState<PopupStep>("home");
  const [requestStatus, setRequestStatus] = useState<RequestStatus>("idle");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [pairingStatus, setPairingStatus] = useState<PairingStatus | null>(null);
  const [pairedContactName, setPairedContactName] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const state = await readExtensionState();
      setDiscordUsername(state.profile?.discordUsername ?? "");
      setInviteCode(state.drafts?.inviteCode ?? "");
      setPairingStatus(state.activePairing?.status ?? state.contacts[0]?.status ?? null);
      setPairedContactName(state.activePairing?.counterpart?.displayName ?? state.contacts[0]?.displayName ?? null);

      if (state.activePairing?.localParticipant.role === "inviter") {
        setCreatedCode(state.activePairing.inviteCode);
      }
    })();
  }, []);

  async function handleCreateStep() {
    setError(null);
    setFeedback(null);

    if (!discordUsername.trim()) {
      setError("Enter your Discord username first.");
      return;
    }

    await storeDiscordUsername(discordUsername.trim());
    setStep("create-invite-details");
  }

  async function handleCreateInvite() {
    setError(null);
    setFeedback(null);

    if (!discordUsername.trim()) {
      setError("Enter your Discord username first.");
      setStep("home");
      return;
    }

    if (!coverTopic.trim()) {
      setError("Add the concealed-instructions topic before creating an invite.");
      return;
    }

    setRequestStatus("loading");

    try {
      const response = await createInvite({
        inviterName: discordUsername.trim(),
        coverTopic: coverTopic.trim(),
      });

      await storeDiscordUsername(discordUsername.trim());
      await storeCreatedInvite({
        inviteCode: response.session.invite.code,
        session: response.session,
        localParticipant: response.inviter,
        coverTopic: response.coverTopic,
      });

      setCreatedCode(response.session.invite.code);
      setPairingStatus(response.session.status);
      setPairedContactName(null);
      setRequestStatus("success");
      setFeedback("Invite ready. Share this code, then head back to Discord once they join.");
      setError(null);
    } catch (nextError) {
      setRequestStatus("error");
      setError(nextError instanceof Error ? nextError.message : "Unable to create invite.");
    }
  }

  async function handleJoinInvite() {
    setError(null);
    setFeedback(null);

    if (!discordUsername.trim()) {
      setError("Enter your Discord username first.");
      return;
    }

    if (!inviteCode.trim()) {
      setError("Enter the 4-digit invite code.");
      return;
    }

    const normalizedCode = inviteCode.replace(/\D/g, "").slice(0, 4);
    await storeDiscordUsername(discordUsername.trim());
    await storeInviteDraft(normalizedCode);
    setRequestStatus("loading");

    try {
      const response = await joinInvite(normalizedCode, {
        joinerName: discordUsername.trim(),
      });

      await storeJoinedPairing({
        inviteCode: response.session.invite.code,
        session: response.session,
        localParticipant: response.joiner,
        counterpart: response.inviter,
        coverTopic: response.coverTopic,
      });
      await clearInviteDraft();

      setInviteCode(response.session.invite.code);
      setCreatedCode(null);
      setPairingStatus(response.session.status);
      setPairedContactName(response.inviter.displayName);
      setRequestStatus("success");
      setFeedback("Connection ready. Return to Discord to use Ghostscript with this paired contact.");
    } catch (nextError) {
      setRequestStatus("error");
      setError(nextError instanceof Error ? nextError.message : "Unable to join invite.");
    }
  }

  async function handleInviteCodeChange(nextValue: string) {
    const normalizedCode = nextValue.replace(/\D/g, "").slice(0, 4);
    setInviteCode(normalizedCode);
    await storeInviteDraft(normalizedCode);
  }

  const isLoading = requestStatus === "loading";

  return (
    <div className="popup-shell">
      <p className="popup-eyebrow">Ghostscript</p>
      <h1>Pair for concealed Discord messaging</h1>
      <p className="popup-copy">
        Ghostscript pairs you with one other person so Discord only sees normal-looking cover text while your extension keeps the paired connection locally.
      </p>

      <section className="popup-card">
        <div className="popup-flow-header">
          <strong>{step === "home" ? "Pairing" : "Create invite"}</strong>
          {pairingStatus ? <span className="popup-pill">{PAIRING_STATUS_LABELS[pairingStatus]}</span> : null}
        </div>

        {step === "home" ? (
          <div className="popup-grid">
            <label className="popup-label">
              <span>Discord username</span>
              <input
                className="popup-input"
                type="text"
                value={discordUsername}
                onChange={(event) => setDiscordUsername(event.target.value)}
                placeholder="@yourname"
              />
            </label>

            <label className="popup-label">
              <span>Invite code</span>
              <input
                className="popup-input"
                type="text"
                inputMode="numeric"
                value={inviteCode}
                onChange={(event) => void handleInviteCodeChange(event.target.value)}
                placeholder="4 digits"
              />
            </label>

            <div className="popup-actions">
              <button className="popup-button" type="button" disabled={isLoading} onClick={() => void handleCreateStep()}>
                {isLoading ? "Working..." : "Create invite"}
              </button>
              <button className="popup-secondary" type="button" disabled={isLoading} onClick={() => void handleJoinInvite()}>
                {isLoading ? "Joining..." : "Join invite"}
              </button>
            </div>
          </div>
        ) : (
          <div className="popup-grid">
            <label className="popup-label">
              <span>Concealed-instructions topic</span>
              <textarea
                className="popup-textarea"
                value={coverTopic}
                onChange={(event) => setCoverTopic(event.target.value)}
                placeholder="Example: casual weekend plans, coffee gear, hiking routes"
              />
            </label>

            <div className="popup-actions popup-actions--stack">
              <button className="popup-button" type="button" disabled={isLoading} onClick={() => void handleCreateInvite()}>
                {isLoading ? "Creating invite..." : "Create invite code"}
              </button>
              <button
                className="popup-secondary"
                type="button"
                disabled={isLoading}
                onClick={() => {
                  setStep("home");
                  setError(null);
                }}
              >
                Back
              </button>
            </div>
          </div>
        )}

        {createdCode ? <div className="popup-result-code">{createdCode}</div> : null}
        {createdCode ? <p className="popup-footnote">Share this 4-digit code directly. Joining it is enough to authorize the pairing for MVP.</p> : null}
      </section>

      <section className="popup-card">
        <div className="popup-summary">
          <span>Status</span>
          <strong>{pairingStatus ? PAIRING_STATUS_LABELS[pairingStatus] : "No pairing yet"}</strong>
          <span>Paired contact</span>
          <strong>{pairedContactName ?? "None yet"}</strong>
          <span>Next step</span>
          <strong>{pairingStatus === "paired" ? "Return to Discord" : "Create or join an invite"}</strong>
        </div>
        <button className="popup-linklike" type="button" onClick={() => void chrome.runtime.openOptionsPage()}>
          Open advanced settings
        </button>
      </section>

      {feedback ? <p className="popup-feedback popup-feedback--success">{feedback}</p> : null}
      {error ? <p className="popup-feedback popup-feedback--error">{error}</p> : null}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PopupApp />
  </React.StrictMode>,
);
