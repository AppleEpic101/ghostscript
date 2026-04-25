import { useEffect, useState } from "react";
import type { CreateInviteResponse } from "@ghostscript/shared";
import { useAuth } from "../auth/AuthContext";
import { AuthGate } from "../components/AuthGate";
import {
  buildDemoPublicKey,
  buildPairingIdentity,
  createInvite,
} from "../lib/pairingApi";
import {
  readStoredCreateInviteState,
  writeStoredCreateInviteState,
  writeStoredPairingSession,
} from "../lib/pairingSession";

export function CreateInviteRoute() {
  const { isAuthenticated, user } = useAuth();
  const storedState = readStoredCreateInviteState();
  const [name, setName] = useState(storedState?.inviterName ?? user?.name ?? "Ghostscript User");
  const [hasEditedName, setHasEditedName] = useState(storedState?.hasEditedName ?? false);
  const [invite, setInvite] = useState<CreateInviteResponse | null>(storedState?.invite ?? null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (user?.name && !hasEditedName) {
      setName(user.name);
    }
  }, [hasEditedName, user?.name]);

  useEffect(() => {
    writeStoredCreateInviteState({
      inviterName: name,
      hasEditedName,
      invite,
    });
  }, [hasEditedName, invite, name]);

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

  const handleCreateInvite = async () => {
    try {
      setIsSubmitting(true);
      setErrorMessage(null);
      const response = await createInvite({
        inviterIdentity: buildPairingIdentity(user),
        inviterName: name,
        publicKey: buildDemoPublicKey(user, name),
      });
      setInvite(response);
      writeStoredPairingSession({
        inviteCode: response.session.inviteCode,
        participant: response.inviter,
        session: response.session,
        verification: null,
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to create invite.");
    } finally {
      setIsSubmitting(false);
    }
  };

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
            <input
              value={name}
              onChange={(event) => {
                setHasEditedName(true);
                setName(event.target.value);
              }}
            />
          </label>
        </div>
        <div className="invite-card invite-card-featured">
          <p className="panel-label">Generated invite</p>
          <strong className="invite-code">{invite?.session.inviteCode ?? "Ready"}</strong>
          <p>
            {invite
              ? `Expires ${new Date(invite.session.expiresAt).toLocaleTimeString()}`
              : "Create an invite to mint a short-lived code."}
          </p>
          <code className="inline-code">
            {invite?.inviteUrl ?? "Waiting for invite creation"}
          </code>
          <button
            className="primary-button"
            type="button"
            onClick={handleCreateInvite}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Creating..." : "Create invite"}
          </button>
          {errorMessage ? <p>{errorMessage}</p> : null}
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
