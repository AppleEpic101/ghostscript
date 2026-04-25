import { mockPairingSnapshot } from "@ghostscript/shared";
import { StatusPill } from "../components/StatusPill";

export function LandingRoute() {
  const { identity, contact, conversation, sampleMessage } = mockPairingSnapshot;

  return (
    <section className="route-stack">
      <article className="hero-panel panel">
        <div className="hero-copy">
          <p className="panel-label">Overview</p>
          <h2>Pair a contact, verify the safety number, then unlock trusted decryption.</h2>
          <p>
            This flow covers invite creation, local identity binding, and safety-number
            verification before the extension treats a conversation as trusted.
          </p>
        </div>
        <div className="hero-aside">
          <div className="hero-stat">
            <span>Pairing mode</span>
            <strong>Anonymous local browser</strong>
          </div>
          <div className="hero-stat">
            <span>Protocol</span>
            <strong>v{sampleMessage.v}</strong>
          </div>
          <div className="hero-stat">
            <span>Identity key</span>
            <strong>{identity.algorithm}</strong>
          </div>
          <div className="hero-stat">
            <span>Current trust</span>
            <StatusPill status={contact.trustStatus} />
          </div>
        </div>
      </article>

      <section className="panel-grid">
        <article className="panel dossier-panel">
          <p className="panel-label">Contact dossier</p>
          <div className="identity-row">
            <div>
              <h3>{contact.displayName || "Awaiting joiner identity"}</h3>
              <p>{contact.discordHandle || "@pending"}</p>
            </div>
            <StatusPill status={contact.trustStatus} />
          </div>
          <dl className="metric-list">
            <div>
              <dt>Fingerprint</dt>
              <dd>{identity.fingerprint}</dd>
            </div>
            <div>
              <dt>Paired at</dt>
              <dd>{new Date(contact.pairedAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Conversation</dt>
              <dd>{conversation.conversationId}</dd>
            </div>
          </dl>
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

        <article className="panel timeline-panel">
          <p className="panel-label">Flow</p>
          <div className="timeline-step">
            <strong>1. Issue invite</strong>
            <p>Create a short-lived code for the recipient.</p>
          </div>
          <div className="timeline-step">
            <strong>2. Bind local identity</strong>
            <p>Attach this browser session and create the local contact record.</p>
          </div>
          <div className="timeline-step">
            <strong>3. Verify safety number</strong>
            <p>Confirm matching values before decryption is marked trusted.</p>
          </div>
        </article>

        <article className="panel terminal-panel">
          <div className="terminal-header">
            <p className="panel-label">Sample envelope</p>
            <span className="terminal-tag">encoded payload</span>
          </div>
          <code className="code-block">{JSON.stringify(sampleMessage, null, 2)}</code>
        </article>
      </section>
    </section>
  );
}
