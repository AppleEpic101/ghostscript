import { useEffect, useState } from "react";
import { mockCreateInvite } from "@ghostscript/shared";
import { useAuth } from "../auth/AuthContext";
import { AuthGate } from "../components/AuthGate";

export function CreateInviteRoute() {
  const { isAuthenticated, user } = useAuth();
  const [name, setName] = useState(user?.name ?? "Ghostscript User");

  useEffect(() => {
    if (user?.name) {
      setName((currentName) =>
        currentName === "Ghostscript User" || currentName.length === 0 ? user.name : currentName,
      );
    }
  }, [user?.name]);

  const invite = mockCreateInvite({ inviterName: name });

  if (!isAuthenticated) {
    return (
      <AuthGate
        title="Sign in to create an invite."
        description="Invite creation now uses a signed-in Google identity so the session has a stable account owner."
      >
        <article className="panel detail-strip">
          <div>
            <p className="panel-label">Why sign in</p>
            <p>It gives the pairing flow a consistent human identity instead of an anonymous browser.</p>
          </div>
          <div>
            <p className="panel-label">Current behavior</p>
            <p>Once signed in, your Google profile name pre-fills the inviter display name.</p>
          </div>
        </article>
      </AuthGate>
    );
  }

  return (
    <section className="panel-grid single-column">
      <article className="panel split-panel">
        <div className="split-copy">
          <p className="panel-label">Create invite</p>
          <h2>Start a short-lived pairing session.</h2>
          <p>
            Generate a readable invite code to share with the other person from your signed-in browser.
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
          <p className="panel-label">Signed-in owner</p>
          <p>{user?.email}</p>
        </div>
      </article>
    </section>
  );
}
