import { PROTOCOL_VERSION } from "./constants";
import type {
  ConfirmVerificationRequest,
  ConfirmVerificationResponse,
  CreateInviteRequest,
  CreateInviteResponse,
  EncodedGhostscriptMessage,
  JoinInviteRequest,
  JoinInviteResponse,
  PairingSessionSnapshot,
} from "./types";

const mockIdentity = {
  id: "id_ghost_alice",
  algorithm: "Ed25519" as const,
  fingerprint: "9E7A 6C1D 14BF 44F0",
  createdAt: "2026-04-24T17:00:00.000Z",
};

const mockContact = {
  id: "contact_placeholder",
  displayName: "",
  discordHandle: "",
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
    inviteCode,
    expiresAt: "2026-04-24T21:30:00.000Z",
    inviteUrl: `https://ghostscript.app/invite/${inviteCode}`,
  };
}

export function mockJoinInvite(request: JoinInviteRequest): JoinInviteResponse {
  return {
    inviteCode: request.inviteCode.toUpperCase(),
    joinedAt: "2026-04-24T19:05:00.000Z",
    contact: {
      ...mockContact,
      displayName: request.joinerName,
    },
  };
}

export function mockConfirmVerification(
  request: ConfirmVerificationRequest,
): ConfirmVerificationResponse {
  return {
    inviteCode: request.inviteCode.toUpperCase(),
    verifiedAt: "2026-04-24T19:10:00.000Z",
    trustStatus: "verified",
  };
}
