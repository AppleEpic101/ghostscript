import { useEffect, useRef, useState } from "react";
import type {
  CreateInviteResponse,
  InviteSessionStatusResponse,
  PairingSession,
} from "@ghostscript/shared";
import { useNavigate } from "react-router-dom";
import {
  buildDemoPublicKey,
  buildPairingIdentity,
  createInvite,
  getInviteSessionStatus,
} from "../lib/pairingApi";
import {
  getOrCreateAnonymousSubject,
  readStoredCreateInviteState,
  writeStoredCreateInviteState,
  writeStoredPairingSession,
} from "../lib/pairingSession";

const INVITE_STATUS_POLL_MS = 3000;

function toInviteStatusResponse(invite: CreateInviteResponse): InviteSessionStatusResponse {
  return {
    session: invite.session,
    inviter: invite.inviter,
    joiner: null,
    verification: null,
  };
}

function isExpired(session: PairingSession) {
  return new Date(session.expiresAt).getTime() <= Date.now();
}

export function CreateInviteRoute() {
  const navigate = useNavigate();
  const storedState = readStoredCreateInviteState();
  const anonymousSubject = getOrCreateAnonymousSubject();
  const [name, setName] = useState(storedState?.inviterName ?? "Ghostscript User");
  const [hasEditedName, setHasEditedName] = useState(storedState?.hasEditedName ?? false);
  const [invite, setInvite] = useState<CreateInviteResponse | null>(storedState?.invite ?? null);
  const [inviteStatus, setInviteStatus] = useState<InviteSessionStatusResponse | null>(
    storedState?.invite ? toInviteStatusResponse(storedState.invite) : null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const pollingRequestInFlight = useRef(false);

  useEffect(() => {
    writeStoredCreateInviteState({
      inviterName: name,
      hasEditedName,
      invite,
    });
  }, [hasEditedName, invite, name]);

  useEffect(() => {
    const inviteCode = inviteStatus?.session.inviteCode;

    if (!inviteCode || !inviteStatus?.inviter) {
      setIsPolling(false);
      return;
    }

    if (inviteStatus.session.status !== "pending" || isExpired(inviteStatus.session)) {
      setIsPolling(false);
      return;
    }

    let cancelled = false;

    const pollInviteStatus = async () => {
      if (pollingRequestInFlight.current) {
        return;
      }

      pollingRequestInFlight.current = true;
      setIsPolling(true);

      try {
        const nextStatus = await getInviteSessionStatus(inviteCode);

        if (cancelled) {
          return;
        }

        setInviteStatus(nextStatus);

        if (nextStatus.inviter) {
          writeStoredPairingSession({
            inviteCode: nextStatus.session.inviteCode,
            participant: nextStatus.inviter,
            session: nextStatus.session,
            verification: nextStatus.verification,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : "Unable to refresh invite status.");
        }
      } finally {
        pollingRequestInFlight.current = false;

        if (!cancelled) {
          setIsPolling(false);
        }
      }
    };

    void pollInviteStatus();
    const intervalId = window.setInterval(() => {
      void pollInviteStatus();
    }, INVITE_STATUS_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      pollingRequestInFlight.current = false;
      setIsPolling(false);
    };
  }, [
    inviteStatus?.inviter,
    inviteStatus?.session.expiresAt,
    inviteStatus?.session.inviteCode,
    inviteStatus?.session.status,
  ]);

  const handleCreateInvite = async () => {
    try {
      setIsSubmitting(true);
      setErrorMessage(null);
      const response = await createInvite({
        inviterIdentity: buildPairingIdentity(anonymousSubject),
        inviterName: name,
        publicKey: buildDemoPublicKey(anonymousSubject, name),
      });
      setInvite(response);
      setInviteStatus(toInviteStatusResponse(response));
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

  const activeSession = inviteStatus?.session ?? invite?.session ?? null;
  const inviteAccepted = Boolean(inviteStatus?.joiner) && activeSession?.status !== "pending";
  const inviteExpired =
    activeSession !== null && isExpired(activeSession) && activeSession.status === "pending";
  const inviteInvalidated = activeSession?.status === "invalidated";
  const showWaitingState =
    activeSession !== null && !inviteAccepted && !inviteExpired && !inviteInvalidated;
  const createButtonLabel =
    inviteExpired || inviteInvalidated
      ? "Create new invite"
      : isSubmitting
        ? "Creating..."
        : "Create invite";

  return (
    <section className="panel-grid single-column">
      <article className="panel split-panel">
        <div className="split-copy">
          <p className="panel-label">Create invite</p>
          <h2>Start a short-lived pairing session.</h2>
          <p>
            Generate a readable invite code to share from this browser before the
            recipient joins and verifies the safety number.
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
          {showWaitingState ? (
            <div className="invite-status-box invite-status-box-waiting">
              <p className="invite-status-title">Waiting for the other person to accept this invitation.</p>
              <p>
                Share the invite code or link from this browser. This page will update automatically
                when they join.
              </p>
              <p className="invite-status-meta">
                {isPolling
                  ? "Checking for acceptance..."
                  : `Checking every ${INVITE_STATUS_POLL_MS / 1000} seconds.`}
              </p>
            </div>
          ) : null}
          {inviteAccepted ? (
            <div className="invite-status-box invite-status-box-success">
              <p className="invite-status-title">Other user accepted the invitation.</p>
              <p>
                {inviteStatus?.joiner?.displayName
                  ? `${inviteStatus.joiner.displayName} joined this pairing session.`
                  : "The second participant joined this pairing session."}
              </p>
              <button
                className="primary-button"
                type="button"
                onClick={() => navigate("/verify")}
              >
                Continue to verification
              </button>
            </div>
          ) : null}
          {inviteExpired ? (
            <div className="invite-status-box invite-status-box-warning">
              <p className="invite-status-title">This invitation expired before anyone accepted it.</p>
              <p>Create a new invite to start another pairing attempt.</p>
            </div>
          ) : null}
          {inviteInvalidated ? (
            <div className="invite-status-box invite-status-box-warning">
              <p className="invite-status-title">This invitation is no longer active.</p>
              <p>Create a new invite to continue pairing from this browser.</p>
            </div>
          ) : null}
          <button
            className="primary-button"
            type="button"
            onClick={handleCreateInvite}
            disabled={isSubmitting}
          >
            {createButtonLabel}
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
          <p className="panel-label">Local identity</p>
          <p>Stored anonymously in this browser for demo pairing flows.</p>
        </div>
      </article>
    </section>
  );
}
