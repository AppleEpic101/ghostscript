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
      <article className="panel">
        <p className="panel-label">Safety number</p>
        <h2>Verify the contact before trusting decryption</h2>
        <p className="safety-number">{mockPairingSnapshot.contact.safetyNumber}</p>
        <div className="hash-word-list">
          {mockPairingSnapshot.contact.hashWords.map((word) => (
            <span key={word}>{word}</span>
          ))}
        </div>
        <button className="primary-button" onClick={() => setConfirmed(true)}>
          Mark verified
        </button>
        {result ? <StatusPill status={result.trustStatus} /> : null}
      </article>
    </section>
  );
}
