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
  username: string;
  transportPublicKey: string | null;
  signingPublicKey: string | null;
  identityFingerprint: string | null;
  createdAt: string;
}

export interface PairedContact {
  id: string;
  sessionId: string;
  username: string;
  pairedAt: string;
  defaultCoverTopic: string;
  inviteCode: string;
  status: Extract<PairingStatus, "paired" | "invalidated">;
  transportPublicKey?: string | null;
  signingPublicKey?: string | null;
  identityFingerprint?: string | null;
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

export interface PublicIdentity {
  transportPublicKey: string;
  signingPublicKey: string;
  identityFingerprint: string;
}

export interface CreateInviteRequest {
  inviterName: string;
  coverTopic: string;
  identity: PublicIdentity;
}

export interface CreateInviteResponse {
  session: PairingSession;
  inviter: PairingParticipant;
  coverTopic: string;
}

export interface JoinInviteRequest {
  joinerName: string;
  identity: PublicIdentity;
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

export type PendingSendStatus =
  | "idle"
  | "encoding"
  | "awaiting-discord-confirm"
  | "confirmed"
  | "failed"
  | "deleted-due-to-race";

export type TransportProtocolVersion = 2;
export type SupportedTransportConfigId = "ghostscript-openai-v2";

export interface EncodedGhostscriptMessage {
  visibleText: string;
  configId: SupportedTransportConfigId;
  modelId: string;
  tokenizerId: string;
  transportBackend: string;
  msgId: number;
  estimatedWordTarget: number;
  transportProtocolVersion: TransportProtocolVersion;
  promptFingerprint: string;
}

export interface LLMEncodingConfig {
  configId: SupportedTransportConfigId;
  provider: string;
  modelId: string;
  tokenizerId: string;
  transportBackend: string;
  bitsPerStep: number;
  excludedTokenSet: string[];
  fallbackStrategy: "reduce-bits";
  tieBreakRule: "token-id-ascending";
  payloadTerminationStrategy: "length-header";
  contextTruncationStrategy: "tail";
  maxContextTokens: number;
}

export interface MessageEnvelope {
  v: TransportProtocolVersion;
  senderId: string;
  msgId: number;
  ciphertext: string;
  authTag: string | null;
  payloadBitLength: number;
}

export interface GhostscriptThreadMessage {
  threadId: string;
  discordMessageId: string;
  authorUsername: string;
  snowflakeTimestamp: string;
  text: string;
  direction: "incoming" | "outgoing" | "other";
}

export interface ConversationContextWindow {
  threadId: string;
  messages: GhostscriptThreadMessage[];
  truncated: boolean;
  maxMessages: number;
  maxChars: number;
}
