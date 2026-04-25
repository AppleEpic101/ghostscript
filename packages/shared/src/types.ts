export type TrustStatus =
  | "unpaired"
  | "paired-unverified"
  | "verified"
  | "locked"
  | "tampered/decryption-failed";

export type PairingSessionStatus =
  | "pending"
  | "paired-unverified"
  | "verified"
  | "invalidated";

export type ParticipantRole = "inviter" | "joiner";

export interface PairingIdentity {
  provider: "google" | "anonymous";
  subject: string;
  email?: string;
  emailVerified?: boolean;
}

export interface PublicKeyBundle {
  keyId: string;
  algorithm: "Ed25519";
  publicKey: string;
  fingerprint: string;
  createdAt: string;
}

export interface IdentityKey {
  id: string;
  algorithm: "Ed25519";
  fingerprint: string;
  createdAt: string;
}

export interface PairedContact {
  id: string;
  displayName: string;
  discordHandle: string;
  trustStatus: TrustStatus;
  safetyNumber: string;
  hashWords: string[];
  pairedAt: string;
}

export interface ConversationState {
  conversationId: string;
  contactId: string;
  trustStatus: TrustStatus;
  canDecrypt: boolean;
  lastMessageId: number;
  locked: boolean;
  imageStegoEnabled: boolean;
}

export interface EncodedGhostscriptMessage {
  v: number;
  senderId: string;
  msgId: number;
  coverText: string;
  codec: "base16-zero-width-v1";
  tag: string;
  ct: string;
}

export interface CreateInviteRequest {
  inviterName: string;
  inviterIdentity: PairingIdentity;
  publicKey: PublicKeyBundle;
}

export interface PairingSession {
  id: string;
  inviteCode: string;
  status: PairingSessionStatus;
  inviterId: string;
  joinerId: string | null;
  expiresAt: string;
  joinedAt: string | null;
  verifiedAt: string | null;
  invalidatedAt: string | null;
  createdAt: string;
}

export interface PairingParticipant {
  id: string;
  sessionId: string;
  role: ParticipantRole;
  displayName: string;
  identity: PairingIdentity;
  publicKey: PublicKeyBundle;
  confirmedAt: string | null;
  createdAt: string;
}

export interface VerificationState {
  safetyNumber: string;
  hashWords: string[];
  inviterConfirmedAt: string | null;
  joinerConfirmedAt: string | null;
  bothConfirmed: boolean;
  verifiedAt: string | null;
}

export interface CreateInviteResponse {
  session: PairingSession;
  inviter: PairingParticipant;
  inviteUrl: string;
}

export interface JoinInviteRequest {
  joinerName: string;
  joinerIdentity: PairingIdentity;
  publicKey: PublicKeyBundle;
}

export interface JoinInviteResponse {
  session: PairingSession;
  inviter: PairingParticipant;
  joiner: PairingParticipant;
  verification: VerificationState;
}

export interface ConfirmVerificationRequest {
  participantId: string;
}

export interface ConfirmVerificationResponse {
  session: PairingSession;
  participant: PairingParticipant;
  verification: VerificationState;
  trustStatus: Extract<TrustStatus, "paired-unverified" | "verified">;
}

export interface PublicKeyLookupResponse {
  participantId: string;
  sessionId: string;
  sessionStatus: PairingSessionStatus;
  publicKey: PublicKeyBundle;
}

export interface ResetPairingRequest {
  inviteCode?: string;
  participantId?: string;
}

export interface ResetPairingResponse {
  session: PairingSession;
}

export interface PairingSessionSnapshot {
  identity: IdentityKey;
  contact: PairedContact;
  conversation: ConversationState;
  sampleMessage: EncodedGhostscriptMessage;
}
