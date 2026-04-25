import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  TRUST_STATUS_LABELS,
  deriveVerificationProgress,
  type PairingParticipant,
  type VaultState,
} from "@ghostscript/shared";
import { confirmInvite, createInvite, getInviteSessionStatus, joinInvite } from "../lib/pairingApi";
import {
  applyConfirmationResult,
  applyInviteSessionStatus,
  buildContactFromPairing,
  readExtensionState,
  storeActivePairing,
  storeContact,
} from "../lib/pairingStore";
import { getRuntimeVaultState, initializeIdentityVault, lockIdentityVault, unlockIdentityVault } from "../lib/vault";
import "./popup.css";

const VERIFICATION_STATUS_POLL_MS = 3000;

function OptionsApp() {
  const [vaultState, setVaultState] = useState<VaultState>("uninitialized");
  const [displayName, setDisplayName] = useState("Ghost User");
  const [passphrase, setPassphrase] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stateSummary, setStateSummary] = useState<Awaited<ReturnType<typeof readExtensionState>> | null>(null);

  async function refresh() {
    const [nextVaultState, nextState] = await Promise.all([
      getRuntimeVaultState(),
      readExtensionState(),
    ]);

    setVaultState(nextVaultState);
    setStateSummary(nextState);
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const activePairing = stateSummary?.activePairing;

    if (
      !activePairing ||
      activePairing.session.status !== "paired-unverified" ||
      activePairing.verification?.bothConfirmed
    ) {
      return;
    }

    let cancelled = false;
    let requestInFlight = false;

    const refreshVerificationStatus = async () => {
      if (requestInFlight) {
        return;
      }

      requestInFlight = true;

      try {
        const response = await getInviteSessionStatus(activePairing.inviteCode);

        if (cancelled) {
          return;
        }

        await applyInviteSessionStatus(response);
        await refresh();
      } catch (nextError) {
        if (!cancelled) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : "Unable to refresh pairing verification status.",
          );
        }
      } finally {
        requestInFlight = false;
      }
    };

    void refreshVerificationStatus();
    const intervalId = window.setInterval(() => {
      void refreshVerificationStatus();
    }, VERIFICATION_STATUS_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [stateSummary?.activePairing]);

  async function handleUnlock() {
    setError(null);
    setFeedback(null);

    try {
      if (!passphrase.trim()) {
        throw new Error("Enter a passphrase first.");
      }

      if (vaultState === "uninitialized") {
        await initializeIdentityVault(passphrase);
        setFeedback("Local identity created.");
      } else {
        await unlockIdentityVault(passphrase);
        setFeedback("Local keys unlocked for this extension session.");
      }

      setPassphrase("");
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to unlock local identity.");
    }
  }

  async function handleCreateInvite() {
    setError(null);
    setFeedback(null);

    try {
      const nextState = await readExtensionState();

      if (!nextState.identity?.publicKey) {
        setError("Create and unlock a local identity first.");
        return;
      }

      const response = await createInvite({
        inviterName: displayName.trim() || "Ghost User",
        inviterIdentity: {
          provider: "anonymous",
          subject: nextState.identity.id,
        },
        publicKey: {
          keyId: `key_${nextState.identity.senderId?.replace(":", "_") ?? "ghostscript"}`,
          algorithm: "Ed25519",
          publicKey: nextState.identity.publicKey,
          fingerprint: nextState.identity.fingerprint,
          createdAt: nextState.identity.createdAt,
        },
      });

      await storeActivePairing({
        inviteCode: response.session.inviteCode,
        session: response.session,
        localParticipant: response.inviter,
        counterpart: null,
        verification: null,
      });

      setInviteCode(response.session.inviteCode);
      setFeedback(`Invite created: ${response.session.inviteCode}`);
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to create invite.");
    }
  }

  async function handleJoinInvite() {
    setError(null);
    setFeedback(null);

    try {
      const nextState = await readExtensionState();

      if (!nextState.identity?.publicKey) {
        setError("Create and unlock a local identity first.");
        return;
      }

      if (!inviteCode.trim()) {
        setError("Enter an invite code first.");
        return;
      }

      const response = await joinInvite(inviteCode.trim().toUpperCase(), {
        joinerName: displayName.trim() || "Ghost User",
        joinerIdentity: {
          provider: "anonymous",
          subject: nextState.identity.id,
        },
        publicKey: {
          keyId: `key_${nextState.identity.senderId?.replace(":", "_") ?? "ghostscript"}`,
          algorithm: "Ed25519",
          publicKey: nextState.identity.publicKey,
          fingerprint: nextState.identity.fingerprint,
          createdAt: nextState.identity.createdAt,
        },
      });

      await storeActivePairing({
        inviteCode: response.session.inviteCode,
        session: response.session,
        localParticipant: response.joiner,
        counterpart: response.inviter,
        verification: response.verification,
      });
      await storeContact(buildContactFromPairing(response.inviter, response.verification, "paired-unverified"));

      setFeedback(`Joined invite ${response.session.inviteCode}. Confirm the safety number on both sides.`);
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to join invite.");
    }
  }

  async function handleConfirmPairing() {
    setError(null);
    setFeedback(null);

    try {
      const nextState = await readExtensionState();
      const activePairing = nextState.activePairing;

      if (!activePairing) {
        setError("Create or join an invite first.");
        return;
      }

      const response = await confirmInvite(activePairing.inviteCode, {
        participantId: activePairing.localParticipant.id,
      });

      const updatedPairing = await applyConfirmationResult(response);

      if (response.counterpart) {
        await storeContact(buildContactFromPairing(response.counterpart, response.verification, response.trustStatus));
      }

      setFeedback(
        updatedPairing?.verification?.bothConfirmed
          ? "Pairing verified. The Discord overlay can now encrypt and decrypt."
          : "Your side is confirmed. Wait for the other participant to confirm as well.",
      );
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to confirm pairing.");
    }
  }

  function handleLock() {
    lockIdentityVault();
    setFeedback("Local key vault locked.");
    setError(null);
    void refresh();
  }

  const activeContact = stateSummary?.contacts[0] ?? null;
  const activePairing = stateSummary?.activePairing ?? null;
  const verificationProgress =
    activePairing?.verification
      ? deriveVerificationProgress(
          activePairing.localParticipant.role,
          activePairing.verification,
        )
      : null;
  const verificationStatus = getPopupVerificationStatus(verificationProgress);

  return (
    <div className="popup-shell popup-shell--wide">
      <p className="popup-eyebrow">Ghostscript settings</p>
      <h1>Local identity, pairing, and trust</h1>
      <p className="popup-copy">
        This page initializes your local key vault and stores the paired contact that the Discord overlay uses.
      </p>

      <div className="popup-card popup-card--stack">
        <h2>Vault</h2>
        <div className="popup-metadata">
          <span>Status</span>
          <strong>{vaultState}</strong>
          <span>Fingerprint</span>
          <strong>{stateSummary?.identity?.fingerprint ?? "Not created yet"}</strong>
        </div>
        <label className="popup-label">
          <span>Passphrase</span>
          <input
            className="popup-input"
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            placeholder={vaultState === "uninitialized" ? "Create a passphrase" : "Unlock passphrase"}
          />
        </label>
        <div className="popup-actions">
          <button type="button" onClick={() => void handleUnlock()}>
            {vaultState === "uninitialized" ? "Create secure identity" : "Unlock keys"}
          </button>
          <button type="button" className="popup-secondary" onClick={handleLock}>
            Lock
          </button>
        </div>
      </div>

      <div className="popup-card popup-card--stack">
        <h2>Pairing</h2>
        <label className="popup-label">
          <span>Display name</span>
          <input
            className="popup-input"
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Ghost User"
          />
        </label>
        <label className="popup-label">
          <span>Invite code</span>
          <input
            className="popup-input"
            type="text"
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value)}
            placeholder="GHOST-4827"
          />
        </label>
        <div className="popup-actions">
          <button type="button" onClick={() => void handleCreateInvite()}>
            Create invite
          </button>
          <button type="button" className="popup-secondary" onClick={() => void handleJoinInvite()}>
            Join invite
          </button>
          <button type="button" className="popup-secondary" onClick={() => void handleConfirmPairing()}>
            Confirm safety number
          </button>
        </div>
      </div>

      <div className="popup-card popup-card--stack">
        <h2>Active state</h2>
        {activePairing ? (
          <div className={`popup-status-card ${verificationStatus.className}`}>
            <strong>{verificationStatus.title}</strong>
            <p>{verificationStatus.body}</p>
            <span>{verificationStatus.meta}</span>
          </div>
        ) : null}
        <SummaryPairingRow
          label="Session"
          value={activePairing?.session.inviteCode ?? "No active pairing"}
        />
        <SummaryPairingRow
          label="Trust"
          value={activeContact ? TRUST_STATUS_LABELS[activeContact.trustStatus] : "Unpaired"}
        />
        <SummaryPairingRow
          label="Safety number"
          value={activeContact?.safetyNumber ?? activePairing?.verification?.safetyNumber ?? "Unavailable"}
        />
        <SummaryPairingRow
          label="Hash words"
          value={(activeContact?.hashWords ?? activePairing?.verification?.hashWords ?? []).join(" ") || "Unavailable"}
        />
        <SummaryPairingRow
          label="Counterpart"
          value={formatParticipant(activePairing?.counterpart) ?? activeContact?.displayName ?? "Unavailable"}
        />
      </div>

      {feedback ? <p className="popup-feedback popup-feedback--success">{feedback}</p> : null}
      {error ? <p className="popup-feedback popup-feedback--error">{error}</p> : null}
    </div>
  );
}

function SummaryPairingRow(props: { label: string; value: string }) {
  return (
    <div className="popup-metadata">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function formatParticipant(participant: PairingParticipant | null | undefined) {
  if (!participant) {
    return null;
  }

  return `${participant.displayName} (${participant.publicKey.fingerprint})`;
}

function getPopupVerificationStatus(
  progress: ReturnType<typeof deriveVerificationProgress> | null,
) {
  if (!progress) {
    return {
      className: "popup-status-card--waiting",
      title: "Verification will appear here after a join.",
      body: "Once both people are paired, this popup will show who has marked the session verified.",
      meta: "No verification state is available yet.",
    };
  }

  switch (progress.state) {
    case "both-verified":
      return {
        className: "popup-status-card--success",
        title: "Both people marked verified.",
        body: "The pairing is trusted and ready for encrypted messaging.",
        meta: "Verification complete.",
      };
    case "you-verified-waiting":
      return {
        className: "popup-status-card--waiting",
        title: "Your side is confirmed.",
        body: "Wait for the other participant to press Confirm safety number.",
        meta: `Refreshing every ${VERIFICATION_STATUS_POLL_MS / 1000} seconds.`,
      };
    case "other-verified-waiting":
      return {
        className: "popup-status-card--success",
        title: "The other participant already confirmed.",
        body: "You can finish verification now once the safety number matches.",
        meta: `Refreshing every ${VERIFICATION_STATUS_POLL_MS / 1000} seconds.`,
      };
    case "waiting-for-both":
    default:
      return {
        className: "popup-status-card--waiting",
        title: "Waiting for both people to confirm.",
        body: "Compare the safety number on both sides, then each person should confirm.",
        meta: `Refreshing every ${VERIFICATION_STATUS_POLL_MS / 1000} seconds.`,
      };
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OptionsApp />
  </React.StrictMode>,
);
