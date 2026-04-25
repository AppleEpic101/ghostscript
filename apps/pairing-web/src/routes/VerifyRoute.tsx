import { useEffect, useState } from "react";
import { mockPairingSnapshot } from "@ghostscript/shared";
import { useAuth } from "../auth/AuthContext";
import { AuthGate } from "../components/AuthGate";
import { StatusPill } from "../components/StatusPill";
import { confirmInvite } from "../lib/pairingApi";
import { readStoredPairingSession, writeStoredPairingSession } from "../lib/pairingSession";

export function VerifyRoute() {
  const { isAuthenticated, user } = useAuth();
  const [storedSession, setStoredSession] = useState(readStoredPairingSession);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setStoredSession(readStoredPairingSession());
  }, []);

  if (!isAuthenticated) {
    return (
      <AuthGate
        title="Sign in to verify a contact."
        description="Verification now records which Google account confirmed the safety number for this browser session."
      >
        <article className="panel detail-strip">
          <div>
            <p className="panel-label">Audit trail</p>
            <p>The verification action stores the signed-in account email as the confirmer identity.</p>
          </div>
          <div>
            <p className="panel-label">Trust update</p>
            <p>Only after the values match should the contact move to verified.</p>
          </div>
        </article>
      </AuthGate>
    );
  }

  const verification = storedSession?.verification;
  const result =
    storedSession?.session.status === "verified" || verification?.bothConfirmed
      ? {
          trustStatus: "verified" as const,
        }
      : null;

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
              Update trust only after both values match for {user?.email}. Current session:
              {" "}
              {storedSession?.inviteCode ?? "none"}
            </p>
          </div>
        </div>
        <button className="primary-button" onClick={handleConfirm} disabled={isSubmitting}>
          {isSubmitting ? "Confirming..." : "Mark verified"}
        </button>
        {errorMessage ? <p>{errorMessage}</p> : null}
      </article>
    </section>
  );
}
