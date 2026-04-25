import { useState } from "react";
import { mockCreateInvite } from "@ghostscript/shared";

export function CreateInviteRoute() {
  const [name, setName] = useState("Ghostscript User");
  const invite = mockCreateInvite({ inviterName: name });

  return (
    <section className="panel-grid single-column">
      <article className="panel split-panel">
        <div className="split-copy">
          <p className="panel-label">Create invite</p>
          <h2>Start a short-lived pairing session.</h2>
          <p>
            Generate a readable invite code to share with the other person.
          </p>
          <label className="field">
            <span>Inviter display name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
        </div>
        <div className="invite-card invite-card-featured">
          <p className="panel-label">Generated invite</p>
          <strong className="invite-code">{invite.inviteCode}</strong>
          <p>Expires {new Date(invite.expiresAt).toLocaleTimeString()}</p>
          <code className="inline-code">{invite.inviteUrl}</code>
        </div>
      </article>

      <article className="panel detail-strip">
        <div>
          <p className="panel-label">Readable codes</p>
          <p>Codes are easy to share while still pointing to a single pairing session.</p>
        </div>
        <div>
          <p className="panel-label">Trust boundary</p>
          <p>Creating an invite does not verify the contact. That happens later.</p>
        </div>
      </article>
    </section>
  );
}
