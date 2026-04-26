export type PairingStatus = "invite-pending" | "paired" | "invalidated";

export interface InviteCode {
  code: string;
  format: "4-digit";
  expiresAt: string;
  consumed: boolean;
}

export interface PairingSession {
  id: string;
  invite: InviteCode;
  status: PairingStatus;
  inviterId: string;
  joinerId: string | null;
  createdAt: string;
  joinedAt: string | null;
  invalidatedAt: string | null;
}

export type ParticipantRole = "inviter" | "joiner";

export interface PairingParticipant {
  id: string;
  sessionId: string;
  role: ParticipantRole;
  displayName: string;
  createdAt: string;
}

export interface PairedContact {
  id: string;
  sessionId: string;
  displayName: string;
  pairedAt: string;
  defaultCoverTopic: string;
  inviteCode: string;
  status: Extract<PairingStatus, "paired" | "invalidated">;
}

export interface ActivePairingState {
  inviteCode: string;
  status: PairingStatus;
  session: PairingSession;
  localParticipant: PairingParticipant;
  counterpart: PairingParticipant | null;
  defaultCoverTopic: string | null;
}

export interface PopupDraftState {
  inviteCode: string;
}

export interface ExtensionState {
  profile: {
    discordUsername: string;
  } | null;
  activePairing: ActivePairingState | null;
  contacts: PairedContact[];
  drafts: PopupDraftState | null;
}

export interface CreateInviteRequest {
  inviterName: string;
  coverTopic: string;
}

export interface CreateInviteResponse {
  session: PairingSession;
  inviter: PairingParticipant;
  coverTopic: string;
}

export interface JoinInviteRequest {
  joinerName: string;
}

export interface JoinInviteResponse {
  session: PairingSession;
  inviter: PairingParticipant;
  joiner: PairingParticipant;
  coverTopic: string;
}

export interface InviteSessionStatusResponse {
  session: PairingSession;
  inviter: PairingParticipant | null;
  joiner: PairingParticipant | null;
  coverTopic: string | null;
}

export interface ResetPairingRequest {
  inviteCode: string;
}

export interface ResetPairingResponse {
  session: PairingSession;
}
