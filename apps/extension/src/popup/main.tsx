import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { generateIdentityBundle, toPublicIdentity } from "../lib/crypto";
import { storeLocalIdentityBundle } from "../lib/ghostscriptState";
import { createInvite, getInviteSessionStatus, joinInvite, resetPairing } from "../lib/pairingApi";
import {
  applyInviteSessionSnapshot,
  clearInviteDraft,
  endLocalPairing,
  readExtensionState,
  storeAiModeEnabled,
  storeCreatedInvite,
  storeDiscordUsername,
  storeInviteDraft,
  storeJoinedPairing,
} from "../lib/pairingStore";
import "./popup.css";

type PopupStep = "home" | "create-invite-details" | "join-invite";
type RequestStatus = "idle" | "loading" | "success" | "error";
const LOBBY_SYNC_POLL_MS = 3000;

function PopupApp() {
  const [discordUsername, setDiscordUsername] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [coverTopic, setCoverTopic] = useState("");
  const [aiModeEnabled, setAiModeEnabled] = useState(true);
  const [step, setStep] = useState<PopupStep>("home");
  const [requestStatus, setRequestStatus] = useState<RequestStatus>("idle");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [lobbyInviteCode, setLobbyInviteCode] = useState<string | null>(null);
  const [lobbyParticipants, setLobbyParticipants] = useState<string[]>([]);
  const [lobbyDetail, setLobbyDetail] = useState<string | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    void hydrateFromState();
  }, []);

  useEffect(() => {
    const normalizedUsername = discordUsername.trim();

    void storeDiscordUsername(normalizedUsername);
  }, [discordUsername]);

  useEffect(() => {
    let cancelled = false;

    const syncLobby = async () => {
      const state = await readExtensionState();
      const activePairing = state.activePairing;

      if (!activePairing) {
        return;
      }

      try {
        const snapshot = await getInviteSessionStatus(activePairing.inviteCode);
        await applyInviteSessionSnapshot(snapshot);

        if (!cancelled) {
          await hydrateFromState();
          if (snapshot.session.status === "invalidated") {
            setStep("home");
            setCoverTopic("");
            setInviteCode("");
            setFeedback("The other person left the lobby. This connection is closed.");
            setError(null);
          }
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Unable to refresh the lobby.");
        }
      }
    };

    void syncLobby();
    const intervalId = window.setInterval(() => {
      void syncLobby();
    }, LOBBY_SYNC_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  async function hydrateFromState() {
    const state = await readExtensionState();
    setDiscordUsername(state.profile?.discordUsername ?? "");
    setAiModeEnabled(state.aiModeEnabled);
    setInviteCode(state.drafts?.inviteCode ?? "");

    if (!state.activePairing) {
      setCreatedCode(null);
      setLobbyInviteCode(null);
      setLobbyParticipants([]);
      setLobbyDetail(null);
      setCoverTopic("");
      return;
    }

    if (state.activePairing.status === "invalidated") {
      setCreatedCode(null);
      setLobbyInviteCode(null);
      setLobbyParticipants([]);
      setLobbyDetail(null);
      setStep("home");
      setCoverTopic("");
      return;
    }

    setCoverTopic(state.activePairing.defaultCoverTopic ?? "");
    setLobbyInviteCode(state.activePairing.inviteCode);
    setLobbyParticipants(
      [
        state.activePairing.localParticipant.username,
        state.activePairing.counterpart?.username ?? null,
      ].filter((participant): participant is string => Boolean(participant)),
    );

    if (state.activePairing.localParticipant.role === "inviter") {
      setCreatedCode(state.activePairing.inviteCode);
      setLobbyDetail(
        state.activePairing.status === "paired"
          ? "Both people are in the lobby."
          : "Waiting for someone else to join this code.",
      );
      return;
    }

    setCreatedCode(null);
    setLobbyDetail(
      state.activePairing.counterpart
        ? "Both people are in the lobby."
        : "Joined the code. Waiting for the other person to appear.",
    );
  }

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
      const identityBundle = await generateIdentityBundle();
      const response = await createInvite({
        inviterName: discordUsername.trim(),
        coverTopic: coverTopic.trim(),
        identity: toPublicIdentity(identityBundle),
      });

      await storeDiscordUsername(discordUsername.trim());
      await storeLocalIdentityBundle(response.session.id, identityBundle);
      await storeCreatedInvite({
        inviteCode: response.session.invite.code,
        session: response.session,
        localParticipant: response.inviter,
        coverTopic: response.coverTopic,
      });

      await hydrateFromState();
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
      const identityBundle = await generateIdentityBundle();
      const response = await joinInvite(normalizedCode, {
        joinerName: discordUsername.trim(),
        identity: toPublicIdentity(identityBundle),
      });

      await storeLocalIdentityBundle(response.session.id, identityBundle);
      await storeJoinedPairing({
        inviteCode: response.session.invite.code,
        session: response.session,
        localParticipant: response.joiner,
        counterpart: response.inviter,
        coverTopic: response.coverTopic,
      });
      await clearInviteDraft();

      await hydrateFromState();
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

  async function handleLeaveLobby() {
    if (!lobbyInviteCode) {
      return;
    }

    setIsLeaving(true);
    setError(null);
    setFeedback(null);

    try {
      await resetPairing({ inviteCode: lobbyInviteCode });
      await endLocalPairing(lobbyInviteCode);
      setCreatedCode(null);
      setLobbyInviteCode(null);
      setLobbyParticipants([]);
      setLobbyDetail(null);
      setInviteCode("");
      setCoverTopic("");
      setStep("home");
      setFeedback("Left the lobby.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to leave the lobby.");
    } finally {
      setIsLeaving(false);
    }
  }

  async function handleCopyLobbyCode() {
    if (!lobbyInviteCode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(lobbyInviteCode);
      setFeedback("Code copied to clipboard.");
      setError(null);
    } catch {
      setError("Unable to copy the code right now.");
    }
  }

  const isLoading = requestStatus === "loading";

  return (
    <div className="popup-shell">
      <div className="popup-brand">
        <img className="popup-brand__logo" src="/icons/ghostscript-128.png" alt="Ghostscript logo" />
      </div>
      <p className="popup-eyebrow">Ghostscript</p>
      <h1>Pair for concealed Discord messaging</h1>
      <p className="popup-copy">
        Ghostscript pairs you with one other person so Discord only sees normal-looking cover text while the pairing service keeps the shared connection state in sync.
      </p>

      <section className="popup-card popup-card--settings">
        <div className="popup-toggle-row">
          <div className="popup-toggle-copy">
            <strong>AI mode</strong>
            <span>{aiModeEnabled ? "On: AI cover text + hidden payload" : "Off: visible ASCII payload message"}</span>
          </div>
          <button
            className={`popup-toggle ${aiModeEnabled ? "popup-toggle--active" : ""}`}
            type="button"
            role="switch"
            aria-checked={aiModeEnabled}
            onClick={() => {
              const nextValue = !aiModeEnabled;
              setAiModeEnabled(nextValue);
              void storeAiModeEnabled(nextValue);
            }}
          >
            <span className="popup-toggle__thumb" />
          </button>
        </div>
      </section>

      {lobbyInviteCode ? (
        <section className="popup-card popup-card--lobby">
          <button className="popup-lobby-code" type="button" onClick={() => void handleCopyLobbyCode()}>
            <span>{lobbyInviteCode}</span>
            <small>Click to copy</small>
          </button>
          <label className="popup-label">
            <span>Concealed-instructions topic</span>
            <textarea
              className="popup-textarea popup-textarea--readonly"
              value={coverTopic}
              readOnly
              aria-readonly="true"
            />
          </label>
          <p className="popup-copy popup-copy--tight">{lobbyDetail}</p>
          <div className="popup-lobby-list">
            {lobbyParticipants.map((participant) => (
              <div key={participant} className="popup-lobby-person">
                {participant}
              </div>
            ))}
            {lobbyParticipants.length < 2 ? (
              <div className="popup-lobby-person popup-lobby-person--waiting">Waiting for someone else...</div>
            ) : null}
          </div>
          <div className="popup-actions popup-actions--stack">
            <button className="popup-danger" type="button" disabled={isLeaving} onClick={() => void handleLeaveLobby()}>
              {isLeaving ? "Leaving..." : "Leave"}
            </button>
          </div>
        </section>
      ) : (
        <section className="popup-card">
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

              <div className="popup-actions">
                <button className="popup-button" type="button" disabled={isLoading} onClick={() => void handleCreateStep()}>
                  {isLoading ? "Working..." : "Create invite"}
                </button>
                <button
                  className="popup-secondary"
                  type="button"
                  disabled={isLoading}
                  onClick={async () => {
                    setError(null);
                    setFeedback(null);

                    if (!discordUsername.trim()) {
                      setError("Enter your Discord username first.");
                      return;
                    }

                    await storeDiscordUsername(discordUsername.trim());
                    setStep("join-invite");
                  }}
                >
                  {isLoading ? "Working..." : "Join invite"}
                </button>
              </div>
            </div>
          ) : step === "create-invite-details" ? (
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
          ) : (
            <div className="popup-grid">
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

              <div className="popup-actions popup-actions--stack">
                <button className="popup-button" type="button" disabled={isLoading} onClick={() => void handleJoinInvite()}>
                  {isLoading ? "Joining..." : "Join invite"}
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
          {createdCode ? <p className="popup-footnote">Share this 4-digit code directly.</p> : null}
        </section>
      )}
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
