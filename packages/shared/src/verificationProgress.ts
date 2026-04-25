import type { ParticipantRole, VerificationState } from "./types";

export type VerificationProgressState =
  | "waiting-for-both"
  | "you-verified-waiting"
  | "other-verified-waiting"
  | "both-verified";

export interface VerificationProgress {
  state: VerificationProgressState;
  localConfirmed: boolean;
  counterpartConfirmed: boolean;
  bothConfirmed: boolean;
}

export function deriveVerificationProgress(
  participantRole: ParticipantRole,
  verification: VerificationState | null,
): VerificationProgress {
  const inviterConfirmed = Boolean(verification?.inviterConfirmedAt);
  const joinerConfirmed = Boolean(verification?.joinerConfirmedAt);
  const bothConfirmed = Boolean(verification?.bothConfirmed);
  const localConfirmed =
    participantRole === "inviter" ? inviterConfirmed : joinerConfirmed;
  const counterpartConfirmed =
    participantRole === "inviter" ? joinerConfirmed : inviterConfirmed;

  if (bothConfirmed) {
    return {
      state: "both-verified",
      localConfirmed,
      counterpartConfirmed,
      bothConfirmed,
    };
  }

  if (localConfirmed) {
    return {
      state: "you-verified-waiting",
      localConfirmed,
      counterpartConfirmed,
      bothConfirmed,
    };
  }

  if (counterpartConfirmed) {
    return {
      state: "other-verified-waiting",
      localConfirmed,
      counterpartConfirmed,
      bothConfirmed,
    };
  }

  return {
    state: "waiting-for-both",
    localConfirmed,
    counterpartConfirmed,
    bothConfirmed,
  };
}
