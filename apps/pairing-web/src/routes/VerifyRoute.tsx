import { useState } from "react";
import { mockConfirmVerification, mockPairingSnapshot } from "@ghostscript/shared";
import { useAuth } from "../auth/AuthContext";
import { AuthGate } from "../components/AuthGate";
import { StatusPill } from "../components/StatusPill";

export function VerifyRoute() {
  const { isAuthenticated, user } = useAuth();
  const [confirmed, setConfirmed] = useState(false);

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

  const result = confirmed
    ? mockConfirmVerification({
        inviteCode: "GHOST-4827",
        confirmedBy: user?.email ?? "local-user",
      })
    : null;

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
        <p className="safety-number">{mockPairingSnapshot.contact.safetyNumber}</p>
        <div className="hash-word-list">
          {mockPairingSnapshot.contact.hashWords.map((word) => (
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
            <p>Update trust only after both values match for {user?.email}.</p>
          </div>
        </div>
        <button className="primary-button" onClick={() => setConfirmed(true)}>
          Mark verified
        </button>
      </article>
    </section>
  );
}
