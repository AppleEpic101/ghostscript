export type TrustStatus =
  | "unpaired"
  | "paired-unverified"
  | "verified"
  | "locked"
  | "tampered/decryption-failed";

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
}

export interface CreateInviteResponse {
  inviteCode: string;
  expiresAt: string;
  inviteUrl: string;
}

export interface JoinInviteRequest {
  inviteCode: string;
  joinerName: string;
}

export interface JoinInviteResponse {
  inviteCode: string;
  joinedAt: string;
  contact: PairedContact;
}

export interface ConfirmVerificationRequest {
  inviteCode: string;
  confirmedBy: string;
}

export interface ConfirmVerificationResponse {
  inviteCode: string;
  verifiedAt: string;
  trustStatus: Extract<TrustStatus, "verified">;
}

export interface PairingSessionSnapshot {
  identity: IdentityKey;
  contact: PairedContact;
  conversation: ConversationState;
  sampleMessage: EncodedGhostscriptMessage;
}
