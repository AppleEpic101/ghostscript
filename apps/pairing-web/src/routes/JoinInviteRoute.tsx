import { useState } from "react";
import { mockJoinInvite } from "@ghostscript/shared";
import { StatusPill } from "../components/StatusPill";

export function JoinInviteRoute() {
  const [inviteCode, setInviteCode] = useState("GHOST-4827");
  const [joinerName, setJoinerName] = useState("");
  const response = mockJoinInvite({ inviteCode, joinerName });

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
          <p>{response.contact.discordHandle || "@discord-handle"}</p>
          <p>Joined {new Date(response.joinedAt).toLocaleTimeString()}</p>
          <StatusPill status={response.contact.trustStatus} />
        </div>
      </article>
    </section>
  );
}
