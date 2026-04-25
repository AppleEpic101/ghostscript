import { useEffect, useRef, useState } from "react";
import {
  deriveVerificationProgress,
  mockPairingSnapshot,
  type InviteSessionStatusResponse,
  type TrustStatus,
} from "@ghostscript/shared";
import { StatusPill } from "../components/StatusPill";
import { getInviteSessionStatus } from "../lib/pairingApi";
import {
  readStoredPairingSession,
  writeStoredPairingSession,
  type StoredPairingSession,
} from "../lib/pairingSession";

const OVERVIEW_STATUS_POLL_MS = 3000;

export function LandingRoute() {
  const [storedSession, setStoredSession] = useState(readStoredPairingSession);
  const [inviteStatus, setInviteStatus] = useState<InviteSessionStatusResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const pollingRequestInFlight = useRef(false);
  const { identity, contact, sampleMessage } = mockPairingSnapshot;
  const verificationProgress = storedSession
    ? deriveVerificationProgress(storedSession.participant.role, storedSession.verification)
    : null;
  const trustStatus = deriveTrustStatus(storedSession);
  const displayName = getOverviewDisplayName(storedSession, inviteStatus) ?? contact.displayName;
  const handle = getOverviewHandle(storedSession, inviteStatus) ?? contact.discordHandle;
  const overviewFingerprint = storedSession?.participant.publicKey.fingerprint ?? identity.fingerprint;
  const pairedAt =
    storedSession?.verification?.verifiedAt ??
    storedSession?.session.joinedAt ??
    storedSession?.participant.createdAt ??
    contact.pairedAt;
  const protocolReady = trustStatus === "verified";
  const stepCards = getStepCards(storedSession, verificationProgress, isPolling);

  useEffect(() => {
    setStoredSession(readStoredPairingSession());
  }, []);

  useEffect(() => {
    if (!storedSession) {
      setInviteStatus(null);
      setIsPolling(false);
      return;
    }

    if (
      storedSession.session.status === "verified" ||
      storedSession.session.status === "invalidated"
    ) {
      setIsPolling(false);
      return;
    }

    let cancelled = false;

    const pollStatus = async () => {
      if (pollingRequestInFlight.current) {
        return;
      }

      pollingRequestInFlight.current = true;
      setIsPolling(true);

      try {
        const response = await getInviteSessionStatus(storedSession.inviteCode);

        if (cancelled) {
          return;
        }

        setInviteStatus(response);
        const nextStoredSession = toStoredPairingSession(storedSession, response);
        writeStoredPairingSession(nextStoredSession);
        setStoredSession(nextStoredSession);
        setErrorMessage(null);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : "Unable to refresh overview state.");
        }
      } finally {
        pollingRequestInFlight.current = false;

        if (!cancelled) {
          setIsPolling(false);
        }
      }
    };

    void pollStatus();
    const intervalId = window.setInterval(() => {
      void pollStatus();
    }, OVERVIEW_STATUS_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      pollingRequestInFlight.current = false;
      setIsPolling(false);
    };
  }, [storedSession]);

  return (
    <section className="route-stack">
      <article className="hero-panel panel">
        <div className="hero-copy">
          <p className="panel-label">Overview</p>
          <h2>Track join, verification, and trusted status from one overview.</h2>
          <p>
            This page now reflects the live three-step pairing flow so both people can see
            whether the session is waiting to join, waiting on verification, or fully trusted.
          </p>
        </div>
        <div className="hero-aside">
          <div className="hero-stat">
            <span>Session</span>
            <strong>{storedSession?.inviteCode ?? "No active invite yet"}</strong>
          </div>
          <div className="hero-stat">
            <span>Protocol</span>
            <strong>v{sampleMessage.v}</strong>
          </div>
          <div className="hero-stat">
            <span>User status</span>
            <strong>{getUserStatusLabel(storedSession, verificationProgress)}</strong>
          </div>
          <div className="hero-stat">
            <span>Current trust</span>
            <StatusPill status={trustStatus} />
          </div>
        </div>
      </article>

      <section className="panel-grid">
        <article className="panel dossier-panel">
          <p className="panel-label">Contact dossier</p>
          <div className="identity-row">
            <div>
              <h3>{displayName || "Awaiting other user"}</h3>
              <p>{handle || "@pending"}</p>
            </div>
            <StatusPill status={trustStatus} />
          </div>
          <dl className="metric-list">
            <div>
              <dt>Fingerprint</dt>
              <dd>{overviewFingerprint}</dd>
            </div>
            <div>
              <dt>Paired at</dt>
              <dd>{new Date(pairedAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Verification</dt>
              <dd>{getVerificationSummary(verificationProgress)}</dd>
            </div>
          </dl>
        </article>

        <article className="panel">
          <p className="panel-label">Conversation state</p>
          <dl className="metric-list">
            <div>
              <dt>Decrypt ready</dt>
              <dd>{protocolReady ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt>Progress refresh</dt>
              <dd>{storedSession ? (isPolling ? "Checking now" : "Live polling") : "Idle"}</dd>
            </div>
            <div>
              <dt>Session state</dt>
              <dd>{storedSession?.session.status ?? "Not started"}</dd>
            </div>
          </dl>
          {errorMessage ? (
            <div className="invite-status-box invite-status-box-warning">
              <p className="invite-status-title">Unable to refresh live progress.</p>
              <p>{errorMessage}</p>
            </div>
          ) : null}
        </article>

        <article className="panel timeline-panel">
          <p className="panel-label">Three-step progress</p>
          {stepCards.map((step) => (
            <div key={step.title} className={`timeline-step timeline-step-${step.state}`}>
              <span className="timeline-step-state">{step.badge}</span>
              <strong>{step.title}</strong>
              <p>{step.body}</p>
            </div>
          ))}
        </article>

        <article className="panel terminal-panel">
          <div className="terminal-header">
            <p className="panel-label">Sample envelope</p>
            <span className="terminal-tag">encoded payload</span>
          </div>
          <code className="code-block">{JSON.stringify(sampleMessage, null, 2)}</code>
        </article>
      </section>
    </section>
  );
}

function deriveTrustStatus(session: StoredPairingSession | null): TrustStatus {
  if (!session) {
    return "unpaired";
  }

  if (session.session.status === "verified" || session.verification?.bothConfirmed) {
    return "verified";
  }

  if (session.session.status === "paired-unverified") {
    return "paired-unverified";
  }

  return "unpaired";
}

function toStoredPairingSession(
  storedSession: StoredPairingSession,
  response: InviteSessionStatusResponse,
): StoredPairingSession {
  return {
    inviteCode: storedSession.inviteCode,
    participant:
      storedSession.participant.role === "inviter"
        ? (response.inviter ?? storedSession.participant)
        : (response.joiner ?? storedSession.participant),
    session: response.session,
    verification: response.verification,
  };
}

function getOverviewDisplayName(
  storedSession: StoredPairingSession | null,
  inviteStatus: InviteSessionStatusResponse | null,
) {
  if (!storedSession) {
    return null;
  }

  if (storedSession.participant.role === "inviter") {
    return inviteStatus?.joiner?.displayName ?? "Awaiting joiner identity";
  }

  return inviteStatus?.inviter?.displayName ?? storedSession.participant.displayName;
}

function getOverviewHandle(
  storedSession: StoredPairingSession | null,
  inviteStatus: InviteSessionStatusResponse | null,
) {
  if (!storedSession) {
    return null;
  }

  const counterpart =
    storedSession.participant.role === "inviter" ? inviteStatus?.joiner : inviteStatus?.inviter;

  return counterpart?.identity.email ?? counterpart?.displayName ?? null;
}

function getUserStatusLabel(
  storedSession: StoredPairingSession | null,
  verificationProgress: ReturnType<typeof deriveVerificationProgress> | null,
) {
  if (!storedSession) {
    return "No pairing started";
  }

  if (storedSession.session.status === "pending") {
    return "Waiting for join";
  }

  if (verificationProgress?.state === "you-verified-waiting") {
    return "You verified, waiting";
  }

  if (verificationProgress?.state === "other-verified-waiting") {
    return "Other user verified";
  }

  if (verificationProgress?.state === "both-verified") {
    return "Both verified";
  }

  return "Joined, verify next";
}

function getVerificationSummary(
  verificationProgress: ReturnType<typeof deriveVerificationProgress> | null,
) {
  if (!verificationProgress) {
    return "Not started";
  }

  switch (verificationProgress.state) {
    case "waiting-for-both":
      return "Waiting on both";
    case "you-verified-waiting":
      return "Waiting on other user";
    case "other-verified-waiting":
      return "Other user ready";
    case "both-verified":
      return "Complete";
  }
}

function getStepCards(
  storedSession: StoredPairingSession | null,
  verificationProgress: ReturnType<typeof deriveVerificationProgress> | null,
  isPolling: boolean,
) {
  const stepOneDone = Boolean(storedSession);
  const stepTwoDone = Boolean(
    storedSession &&
      (storedSession.session.status === "paired-unverified" ||
        storedSession.session.status === "verified"),
  );
  const stepThreeDone = Boolean(
    storedSession &&
      (storedSession.session.status === "verified" || verificationProgress?.bothConfirmed),
  );

  return [
    {
      title: "1. Start session",
      body: stepOneDone
        ? `Invite ${storedSession?.inviteCode} is recorded in this browser.`
        : "Create or join an invite to start tracking pairing progress here.",
      badge: stepOneDone ? "Done" : "Pending",
      state: stepOneDone ? "complete" : "pending",
    },
    {
      title: "2. Other user joins",
      body: stepTwoDone
        ? "Both users are paired in the same session and can move to verification."
        : isPolling
          ? "Waiting for the other user to join this invite now."
          : "The invite is active, but the other user has not joined yet.",
      badge: stepTwoDone ? "Done" : "Waiting",
      state: stepTwoDone ? "complete" : "active",
    },
    {
      title: "3. Both verify",
      body: stepThreeDone
        ? "Both sides marked verified, so trusted decryption is ready to go."
        : verificationProgress?.state === "you-verified-waiting"
          ? "Your side is confirmed. The other user still needs to mark verified."
          : verificationProgress?.state === "other-verified-waiting"
            ? "The other user already marked verified. Finish your side to complete trust."
            : "Compare the safety number and have both people mark verified.",
      badge: stepThreeDone ? "Ready" : "Pending",
      state: stepThreeDone ? "complete" : "pending",
    },
  ];
}
