import { useState } from "react";
import { mockCreateInvite } from "@ghostscript/shared";

export function CreateInviteRoute() {
  const [name, setName] = useState("Ghostscript User");
  const invite = mockCreateInvite({ inviterName: name });

  return (
    <section className="panel-grid single-column">
      <article className="panel">
        <p className="panel-label">Create invite</p>
        <h2>Start a short-lived pairing session</h2>
        <label className="field">
          <span>Inviter display name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="invite-card">
          <strong>{invite.inviteCode}</strong>
          <p>Expires {new Date(invite.expiresAt).toLocaleTimeString()}</p>
          <code>{invite.inviteUrl}</code>
        </div>
      </article>
    </section>
  );
}
