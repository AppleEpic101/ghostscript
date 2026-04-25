import { useState } from "react";
import { mockJoinInvite } from "@ghostscript/shared";
import { StatusPill } from "../components/StatusPill";

export function JoinInviteRoute() {
  const [inviteCode, setInviteCode] = useState("GHOST-4827");
  const [joinerName, setJoinerName] = useState("");
  const response = mockJoinInvite({ inviteCode, joinerName });

  return (
    <section className="panel-grid single-column">
      <article className="panel">
        <p className="panel-label">Join invite</p>
        <h2>Bind a browser identity to the pairing session</h2>
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
          <strong>{response.contact.displayName}</strong>
          <p>{response.contact.discordHandle}</p>
          <StatusPill status={response.contact.trustStatus} />
        </div>
      </article>
    </section>
  );
}
