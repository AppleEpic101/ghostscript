import { mockPairingSnapshot } from "@ghostscript/shared";
import { StatusPill } from "../components/StatusPill";

export function LandingRoute() {
  const { contact, conversation, sampleMessage } = mockPairingSnapshot;

  return (
    <section className="panel-grid">
      <article className="panel hero-panel">
        <p className="panel-label">Product surface</p>
        <h2>Pair two people, verify once, then unlock trusted decryption in the extension.</h2>
        <p>
          This scaffold models the pairing journey from invite creation through
          safety-number confirmation, with backend contracts deferred.
        </p>
      </article>

      <article className="panel">
        <p className="panel-label">Current contact</p>
        <h3>{contact.displayName}</h3>
        <p>{contact.discordHandle}</p>
        <StatusPill status={contact.trustStatus} />
      </article>

      <article className="panel">
        <p className="panel-label">Conversation state</p>
        <dl className="metric-list">
          <div>
            <dt>Decrypt ready</dt>
            <dd>{conversation.canDecrypt ? "Yes" : "No"}</dd>
          </div>
          <div>
            <dt>Last message id</dt>
            <dd>{conversation.lastMessageId}</dd>
          </div>
          <div>
            <dt>Image stego</dt>
            <dd>{conversation.imageStegoEnabled ? "Enabled" : "Roadmap"}</dd>
          </div>
        </dl>
      </article>

      <article className="panel">
        <p className="panel-label">Sample envelope</p>
        <code className="code-block">
          {JSON.stringify(sampleMessage, null, 2)}
        </code>
      </article>
    </section>
  );
}
