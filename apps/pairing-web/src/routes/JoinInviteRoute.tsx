import { useEffect, useState } from "react";
import type { JoinInviteResponse } from "@ghostscript/shared";
import { useSearchParams } from "react-router-dom";
import { StatusPill } from "../components/StatusPill";
import { buildDemoPublicKey, buildPairingIdentity, joinInvite } from "../lib/pairingApi";
import {
  getOrCreateAnonymousSubject,
  readStoredJoinInviteState,
  writeStoredJoinInviteState,
  writeStoredPairingSession,
} from "../lib/pairingSession";

export function JoinInviteRoute() {
  const [searchParams] = useSearchParams();
  const storedState = readStoredJoinInviteState();
  const anonymousSubject = getOrCreateAnonymousSubject();
  const queryInviteCode = searchParams.get("code");
  const [inviteCode, setInviteCode] = useState(
    queryInviteCode ?? storedState?.inviteCode ?? "GHOST-4827",
  );
  const [joinerName, setJoinerName] = useState(storedState?.joinerName ?? "Ghostscript User");
  const [hasEditedJoinerName, setHasEditedJoinerName] = useState(
    storedState?.hasEditedJoinerName ?? false,
  );
  const [response, setResponse] = useState<JoinInviteResponse | null>(storedState?.response ?? null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!queryInviteCode) {
      return;
    }

    setInviteCode(queryInviteCode);
  }, [queryInviteCode]);

  useEffect(() => {
    writeStoredJoinInviteState({
      inviteCode,
      joinerName,
      hasEditedJoinerName,
      response,
    });
  }, [hasEditedJoinerName, inviteCode, joinerName, response]);

  const handleJoinInvite = async () => {
    try {
      setIsSubmitting(true);
      setErrorMessage(null);
      const nextResponse = await joinInvite(inviteCode.toUpperCase(), {
        joinerIdentity: buildPairingIdentity(anonymousSubject),
        joinerName,
        publicKey: buildDemoPublicKey(anonymousSubject, joinerName),
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
          <h2>Attach a local identity to the pairing session.</h2>
          <p>
            Enter the invite code and local display name to accept the inviter&apos;s pending
            session before both sides verify the safety number.
          </p>
        </div>
        <div className="stack-note">
          <span className="note-kicker">Phase 02</span>
          <p>Accepting the invitation pairs this browser immediately, but verification still comes next.</p>
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
          <p>Anonymous local participant</p>
          <p>
            {response?.session.joinedAt
              ? `Joined ${new Date(response.session.joinedAt).toLocaleTimeString()}`
              : "Waiting to join this invite"}
          </p>
          <StatusPill status={response?.session.status === "verified" ? "verified" : "paired-unverified"} />
          {response ? (
            <div className="invite-status-box invite-status-box-success">
              <p className="invite-status-title">Invitation accepted.</p>
              <p>Both people are now paired. Next, verify the safety number on each side.</p>
            </div>
          ) : null}
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
