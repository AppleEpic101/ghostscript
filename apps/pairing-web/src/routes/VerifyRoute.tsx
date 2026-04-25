import { useState } from "react";
import { mockConfirmVerification, mockPairingSnapshot } from "@ghostscript/shared";
import { StatusPill } from "../components/StatusPill";

export function VerifyRoute() {
  const [confirmed, setConfirmed] = useState(false);
  const result = confirmed
    ? mockConfirmVerification({
        inviteCode: "GHOST-4827",
        confirmedBy: "local-user",
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
            <p>Update trust only after both values match.</p>
          </div>
        </div>
        <button className="primary-button" onClick={() => setConfirmed(true)}>
          Mark verified
        </button>
      </article>
    </section>
  );
}
