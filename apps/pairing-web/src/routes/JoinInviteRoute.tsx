import { useEffect, useState } from "react";
import { mockJoinInvite } from "@ghostscript/shared";
import { useAuth } from "../auth/AuthContext";
import { AuthGate } from "../components/AuthGate";
import { StatusPill } from "../components/StatusPill";

export function JoinInviteRoute() {
  const { isAuthenticated, user } = useAuth();
  const [inviteCode, setInviteCode] = useState("GHOST-4827");
  const [joinerName, setJoinerName] = useState(user?.name ?? "");

  useEffect(() => {
    if (user?.name && !joinerName) {
      setJoinerName(user.name);
    }
  }, [joinerName, user?.name]);

  const response = mockJoinInvite({ inviteCode, joinerName });

  if (!isAuthenticated) {
    return (
      <AuthGate
        title="Sign in to join an invite."
        description="Joining a session binds the current browser to a Google-backed identity before verification."
      >
        <article className="panel detail-strip">
          <div>
            <p className="panel-label">Identity binding</p>
            <p>The joined session uses your signed-in profile as the local browser identity.</p>
          </div>
          <div>
            <p className="panel-label">Next step</p>
            <p>After joining, the contact remains paired but unverified until the safety number matches.</p>
          </div>
        </article>
      </AuthGate>
    );
  }

  return (
    <section className="panel-grid single-column">
      <article className="panel split-panel">
        <div className="split-copy">
          <p className="panel-label">Join invite</p>
          <h2>Attach a browser identity to the pairing session.</h2>
          <p>
            Add the local display name and connect this browser session to the
            invite before verification.
          </p>
        </div>
        <div className="stack-note">
          <span className="note-kicker">Phase 02</span>
          <p>The contact is paired, but not yet verified.</p>
        </div>
      </article>

      <article className="panel">
        <div className="field-row">
          <label className="field">
            <span>Invite code</span>
            <input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} />
          </label>
          <label className="field">
            <span>Display name</span>
            <input value={joinerName} onChange={(event) => setJoinerName(event.target.value)} />
          </label>
        </div>
        <div className="invite-card">
          <p className="panel-label">Session preview</p>
          <strong>{response.contact.displayName || "Name pending"}</strong>
          <p>{user?.email}</p>
          <p>Joined {new Date(response.joinedAt).toLocaleTimeString()}</p>
          <StatusPill status={response.contact.trustStatus} />
        </div>
      </article>
    </section>
  );
}
