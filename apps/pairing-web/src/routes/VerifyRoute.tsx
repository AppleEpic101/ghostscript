import { useEffect, useRef, useState } from "react";
import { deriveVerificationProgress, mockPairingSnapshot } from "@ghostscript/shared";
import { StatusPill } from "../components/StatusPill";
import { confirmInvite, getInviteSessionStatus } from "../lib/pairingApi";
import { readStoredPairingSession, writeStoredPairingSession } from "../lib/pairingSession";

const VERIFICATION_STATUS_POLL_MS = 3000;

export function VerifyRoute() {
  const [storedSession, setStoredSession] = useState(readStoredPairingSession);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const pollingRequestInFlight = useRef(false);

  useEffect(() => {
    setStoredSession(readStoredPairingSession());
  }, []);

  const verification = storedSession?.verification;
  const progress = storedSession
    ? deriveVerificationProgress(storedSession.participant.role, storedSession.verification)
    : null;
  const result =
    storedSession?.session.status === "verified" || progress?.bothConfirmed
      ? { trustStatus: "verified" as const }
      : null;

  useEffect(() => {
    if (!storedSession) {
      setIsPolling(false);
      return;
    }

    if (storedSession.session.status !== "paired-unverified" || progress?.bothConfirmed) {
      setIsPolling(false);
      return;
    }

    let cancelled = false;

    const pollVerificationStatus = async () => {
      if (pollingRequestInFlight.current) {
        return;
      }

      pollingRequestInFlight.current = true;
      setIsPolling(true);

      try {
        const response = await getInviteSessionStatus(storedSession.inviteCode);

        if (cancelled) {
          return;
        }

        const nextSession = {
          inviteCode: storedSession.inviteCode,
          participant:
            storedSession.participant.role === "inviter"
              ? (response.inviter ?? storedSession.participant)
              : (response.joiner ?? storedSession.participant),
          session: response.session,
          verification: response.verification,
        };

        writeStoredPairingSession(nextSession);
        setStoredSession(nextSession);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error ? error.message : "Unable to refresh verification status.",
          );
        }
      } finally {
        pollingRequestInFlight.current = false;

        if (!cancelled) {
          setIsPolling(false);
        }
      }
    };

    void pollVerificationStatus();
    const intervalId = window.setInterval(() => {
      void pollVerificationStatus();
    }, VERIFICATION_STATUS_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      pollingRequestInFlight.current = false;
      setIsPolling(false);
    };
  }, [
    progress?.bothConfirmed,
    storedSession?.inviteCode,
    storedSession?.participant.role,
    storedSession?.session.status,
  ]);

  const handleConfirm = async () => {
    if (!storedSession) {
      setErrorMessage("Create or join an invite before confirming.");
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);
      const response = await confirmInvite(storedSession.inviteCode, {
        participantId: storedSession.participant.id,
      });
      const nextSession = {
        inviteCode: storedSession.inviteCode,
        participant: response.participant,
        session: response.session,
        verification: response.verification,
      };
      writeStoredPairingSession(nextSession);
      setStoredSession(nextSession);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to confirm pairing.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const statusBox = getVerificationStatusBox(progress, isPolling);
  const confirmButtonLabel = progress?.bothConfirmed
    ? "Verified"
    : progress?.localConfirmed
      ? "Marked verified"
      : isSubmitting
        ? "Confirming..."
        : "Mark verified";
  const confirmDisabled = isSubmitting || Boolean(progress?.localConfirmed);

  return (
    <section className="panel-grid single-column">
      <article className="panel verify-panel">
        <div className="verify-header">
          <div>
            <p className="panel-label">Safety number</p>
            <h2>Verify the contact before decryption is trusted.</h2>
          </div>
          {result ? <StatusPill status={result.trustStatus} /> : null}
        </div>
        <p className="safety-number">
          {verification?.safetyNumber ?? mockPairingSnapshot.contact.safetyNumber}
        </p>
        <div className="hash-word-list">
          {(verification?.hashWords ?? mockPairingSnapshot.contact.hashWords).map((word) => (
            <span key={word}>{word}</span>
          ))}
        </div>
        <div className="verification-checklist">
          <div>
            <strong>Read the digits aloud</strong>
            <p>Confirm that both sides see the same safety number.</p>
          </div>
          <div>
            <strong>Check the hash words</strong>
            <p>Use the short word list as a quick mismatch check.</p>
          </div>
          <div>
            <strong>Mark as verified</strong>
            <p>
              Update trust only after both values match for this browser session. Current session:
              {" "}
              {storedSession?.inviteCode ?? "none"}
            </p>
          </div>
        </div>
        <div className={`invite-status-box ${statusBox.className}`}>
          <p className="invite-status-title">{statusBox.title}</p>
          <p>{statusBox.body}</p>
          <p className="invite-status-meta">{statusBox.meta}</p>
        </div>
        <button className="primary-button" onClick={handleConfirm} disabled={confirmDisabled}>
          {confirmButtonLabel}
        </button>
        {errorMessage ? <p>{errorMessage}</p> : null}
      </article>
    </section>
  );
}

function getVerificationStatusBox(
  progress: ReturnType<typeof deriveVerificationProgress> | null,
  isPolling: boolean,
) {
  const pollMeta = isPolling
    ? "Checking for updates now..."
    : `Checking every ${VERIFICATION_STATUS_POLL_MS / 1000} seconds.`;

  if (!progress) {
    return {
      className: "invite-status-box-warning",
      title: "Verification is not ready yet.",
      body: "Create or join an invite before marking this pairing as verified.",
      meta: "No active pairing session is stored in this browser.",
    };
  }

  switch (progress.state) {
    case "both-verified":
      return {
        className: "invite-status-box-success",
        title: "Both people marked this pairing verified.",
        body: "This contact is now trusted for decryption and encrypted messaging.",
        meta: "Verification is complete for this session.",
      };
    case "you-verified-waiting":
      return {
        className: "invite-status-box-waiting",
        title: "Your side is verified.",
        body: "Wait for the other person to press Mark verified on their side.",
        meta: pollMeta,
      };
    case "other-verified-waiting":
      return {
        className: "invite-status-box-success",
        title: "The other person already marked verified.",
        body: "You can finish verification now after confirming the same safety number.",
        meta: pollMeta,
      };
    case "waiting-for-both":
    default:
      return {
        className: "invite-status-box-waiting",
        title: "Verification is waiting on both people.",
        body: "Compare the safety number and hash words, then each person should mark verified.",
        meta: pollMeta,
      };
  }
}
