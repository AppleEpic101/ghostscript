import { useEffect, useState } from "react";
import type { JoinInviteResponse } from "@ghostscript/shared";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AuthGate } from "../components/AuthGate";
import { StatusPill } from "../components/StatusPill";
import { buildDemoPublicKey, buildPairingIdentity, joinInvite } from "../lib/pairingApi";
import { writeStoredPairingSession } from "../lib/pairingSession";

export function JoinInviteRoute() {
  const { isAuthenticated, user } = useAuth();
  const [searchParams] = useSearchParams();
  const [inviteCode, setInviteCode] = useState(searchParams.get("code") ?? "GHOST-4827");
  const [joinerName, setJoinerName] = useState(user?.name ?? "");
  const [hasEditedJoinerName, setHasEditedJoinerName] = useState(false);
  const [response, setResponse] = useState<JoinInviteResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (user?.name && !hasEditedJoinerName) {
      setJoinerName(user.name);
    }
  }, [hasEditedJoinerName, user?.name]);

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

  const handleJoinInvite = async () => {
    try {
      setIsSubmitting(true);
      setErrorMessage(null);
      const nextResponse = await joinInvite(inviteCode.toUpperCase(), {
        joinerIdentity: buildPairingIdentity(user),
        joinerName,
        publicKey: buildDemoPublicKey(user, joinerName),
      });
      setResponse(nextResponse);
      writeStoredPairingSession({
        inviteCode: nextResponse.session.inviteCode,
        participant: nextResponse.joiner,
        session: nextResponse.session,
        verification: nextResponse.verification,
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to join invite.");
    } finally {
      setIsSubmitting(false);
    }
  };

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
            <input
              value={joinerName}
              onChange={(event) => {
                setHasEditedJoinerName(true);
                setJoinerName(event.target.value);
              }}
            />
          </label>
        </div>
        <div className="invite-card">
          <p className="panel-label">Session preview</p>
          <strong>{response?.joiner.displayName || "Name pending"}</strong>
          <p>{user?.email}</p>
          <p>
            {response?.session.joinedAt
              ? `Joined ${new Date(response.session.joinedAt).toLocaleTimeString()}`
              : "Waiting to join this invite"}
          </p>
          <StatusPill status={response?.session.status === "verified" ? "verified" : "paired-unverified"} />
          <button
            className="primary-button"
            type="button"
            onClick={handleJoinInvite}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Joining..." : "Join invite"}
          </button>
          {errorMessage ? <p>{errorMessage}</p> : null}
        </div>
      </article>
    </section>
  );
}
