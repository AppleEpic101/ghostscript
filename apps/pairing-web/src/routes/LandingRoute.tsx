import { useAuth } from "../auth/AuthContext";
import { GoogleSignInButton } from "../components/GoogleSignInButton";
import { mockPairingSnapshot } from "@ghostscript/shared";
import { StatusPill } from "../components/StatusPill";

export function LandingRoute() {
  const { isAuthenticated, user } = useAuth();
  const { identity, contact, conversation, sampleMessage } = mockPairingSnapshot;

  return (
    <section className="route-stack">
      <article className="hero-panel panel">
        <div className="hero-copy">
          <p className="panel-label">Overview</p>
          <h2>Pair a contact, verify the safety number, then unlock trusted decryption.</h2>
          <p>
            This flow covers invite creation, identity binding, and safety-number
            verification before the extension treats a conversation as trusted.
          </p>
        </div>
        <div className="hero-aside">
          <div className="hero-stat">
            <span>Signed in</span>
            <strong>{isAuthenticated ? user?.email : "Not yet connected"}</strong>
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

      {!isAuthenticated ? (
        <article className="panel auth-inline-panel">
          <div className="auth-inline-copy">
            <p className="panel-label">Before you pair</p>
            <h3>Sign in with Google to bind the browser to an email identity.</h3>
            <p>
              This demo uses your Google account profile to personalize the pairing flow and
              gate invite actions to an authenticated browser session.
            </p>
          </div>
          <GoogleSignInButton />
        </article>
      ) : null}

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
            <strong>2. Bind identity</strong>
            <p>Attach a browser session and create the local contact record.</p>
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
