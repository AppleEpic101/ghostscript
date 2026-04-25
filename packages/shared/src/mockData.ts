import { PROTOCOL_VERSION } from "./constants";
import type {
  ConfirmVerificationRequest,
  ConfirmVerificationResponse,
  CreateInviteRequest,
  CreateInviteResponse,
  EncodedGhostscriptMessage,
  JoinInviteRequest,
  JoinInviteResponse,
  PairingParticipant,
  PairingSession,
  PublicKeyBundle,
  ResetPairingResponse,
  VerificationState,
  PairingSessionSnapshot,
} from "./types";

const mockIdentity = {
  id: "id_ghost_alice",
  algorithm: "Ed25519" as const,
  publicKey: "Z2hvc3RzY3JpcHQtZGVtby1wdWJsaWMta2V5",
  fingerprint: "9E7A 6C1D 14BF 44F0",
  senderId: "ed25519:9e7a6c1d",
  createdAt: "2026-04-24T17:00:00.000Z",
  wrappedPrivateKey: "demo-wrapped-private-key",
  wrapSalt: "demo-wrap-salt",
  wrapNonce: "demo-wrap-nonce",
};

const mockContact = {
  id: "contact_placeholder",
  displayName: "",
  discordHandle: "",
  participantId: "participant_joiner_01",
  publicKey: undefined,
  senderId: "ed25519:12ab34cd",
  verifiedAt: null,
  trustStatus: "paired-unverified" as const,
  safetyNumber: "4921 1108 6627 5529 8891 0142",
  hashWords: ["cedar", "orbit", "signal", "cobalt"],
  pairedAt: "2026-04-24T18:05:00.000Z",
};

const mockConversation = {
  conversationId: "dm_ghostscript_discord_01",
  contactId: mockContact.id,
  trustStatus: mockContact.trustStatus,
  canDecrypt: false,
  lastMessageId: 12,
  sendCounter: 12,
  receiveWatermark: 11,
  sharedSecretRef: "shared-secret-demo",
  lastProcessedDiscordMessageId: "discord-message-demo",
  locked: false,
  imageStegoEnabled: false,
};

const mockMessage: EncodedGhostscriptMessage = {
  v: PROTOCOL_VERSION,
  senderId: "ed25519:9e7a6c1d",
  msgId: 13,
  coverText: "Wednesday notes are in the usual place.",
  codec: "base16-zero-width-v1",
  tag: "9f2d1a54f17d93b35b5cd57f50ec3b7e",
  ct: "d4f17f0e1a5d1fbc0c91",
};

const mockPublicKey: PublicKeyBundle = {
  keyId: "key_ghost_alice",
  algorithm: "Ed25519",
  publicKey: "Z2hvc3RzY3JpcHQtZGVtby1wdWJsaWMta2V5",
  fingerprint: mockIdentity.fingerprint,
  createdAt: mockIdentity.createdAt,
};

const mockSession: PairingSession = {
  id: "session_ghost_01",
  inviteCode: "GHOST-4827",
  status: "paired-unverified",
  inviterId: "participant_inviter_01",
  joinerId: "participant_joiner_01",
  expiresAt: "2026-04-24T21:30:00.000Z",
  joinedAt: "2026-04-24T19:05:00.000Z",
  verifiedAt: null,
  invalidatedAt: null,
  createdAt: "2026-04-24T18:00:00.000Z",
};

const mockInviter: PairingParticipant = {
  id: mockSession.inviterId,
  sessionId: mockSession.id,
  role: "inviter",
  displayName: "Ghost Alice",
  identity: {
    provider: "google",
    subject: "alice-subject",
    email: "alice@example.com",
    emailVerified: true,
  },
  publicKey: mockPublicKey,
  confirmedAt: "2026-04-24T19:12:00.000Z",
  createdAt: mockSession.createdAt,
};

const mockVerification: VerificationState = {
  safetyNumber: mockContact.safetyNumber,
  hashWords: mockContact.hashWords,
  inviterConfirmedAt: mockInviter.confirmedAt,
  joinerConfirmedAt: null,
  bothConfirmed: false,
  verifiedAt: null,
};

export const mockPairingSnapshot: PairingSessionSnapshot = {
  identity: mockIdentity,
  contact: mockContact,
  conversation: mockConversation,
  sampleMessage: mockMessage,
};

export function mockCreateInvite(
  request: CreateInviteRequest,
): CreateInviteResponse {
  const slug = request.inviterName.toLowerCase().replace(/\s+/g, "-") || "ghost";
  const inviteCode = `${slug.slice(0, 5)}-4827`.toUpperCase();

  return {
    session: {
      ...mockSession,
      inviteCode,
      status: "pending",
      joinerId: null,
      joinedAt: null,
    },
    inviter: {
      ...mockInviter,
      displayName: request.inviterName,
      identity: request.inviterIdentity,
      publicKey: request.publicKey,
      confirmedAt: null,
    },
    inviteUrl: `https://ghostscript.app/invite/${inviteCode}`,
  };
}

export function mockJoinInvite(request: JoinInviteRequest): JoinInviteResponse {
  return {
    session: mockSession,
    inviter: mockInviter,
    joiner: {
      id: mockSession.joinerId ?? "participant_joiner_01",
      sessionId: mockSession.id,
      role: "joiner",
      displayName: request.joinerName,
      identity: request.joinerIdentity,
      publicKey: request.publicKey,
      confirmedAt: null,
      createdAt: "2026-04-24T19:05:00.000Z",
    },
    verification: mockVerification,
  };
}

export function mockConfirmVerification(
  request: ConfirmVerificationRequest,
): ConfirmVerificationResponse {
  return {
    session: {
      ...mockSession,
      status: "verified",
      verifiedAt: "2026-04-24T19:10:00.000Z",
    },
    participant: {
      ...mockInviter,
      id: request.participantId,
      confirmedAt: "2026-04-24T19:10:00.000Z",
    },
    counterpart: {
      id: mockSession.joinerId ?? "participant_joiner_01",
      sessionId: mockSession.id,
      role: "joiner",
      displayName: "Ghost Bob",
      identity: {
        provider: "google",
        subject: "bob-subject",
        email: "bob@example.com",
        emailVerified: true,
      },
      publicKey: {
        ...mockPublicKey,
        keyId: "key_ghost_bob",
        fingerprint: "12AB 34CD 56EF 7890",
      },
      confirmedAt: "2026-04-24T19:10:00.000Z",
      createdAt: "2026-04-24T19:05:00.000Z",
    },
    verification: {
      ...mockVerification,
      joinerConfirmedAt: "2026-04-24T19:10:00.000Z",
      bothConfirmed: true,
      verifiedAt: "2026-04-24T19:10:00.000Z",
    },
    trustStatus: "verified",
  };
}

export function mockResetPairing(): ResetPairingResponse {
  return {
    session: {
      ...mockSession,
      status: "invalidated",
      invalidatedAt: "2026-04-24T19:20:00.000Z",
    },
  };
}
