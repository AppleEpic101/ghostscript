import type {
  CreateInviteRequest,
  CreateInviteResponse,
  InviteSessionStatusResponse,
  JoinInviteRequest,
  JoinInviteResponse,
  PairingParticipant,
  PairingSession,
  ResetPairingRequest,
  ResetPairingResponse,
} from "@ghostscript/shared";
import { supabase } from "./supabase";

const INVITE_TTL_MS = 15 * 60 * 1000;

interface ParticipantRecord {
  id: string;
  session_id: string;
  role: "inviter" | "joiner";
  display_name: string;
  identity_public_key: string | null;
  created_at: string;
}

interface PairingSessionRecord {
  id: string;
  invite_code: string;
  invite_format: "4-digit";
  cover_topic: string;
  status: "invite-pending" | "paired" | "invalidated";
  inviter_id: string;
  joiner_id: string | null;
  invite_consumed: boolean;
  created_at: string;
  expires_at: string;
  joined_at: string | null;
  invalidated_at: string | null;
  inviter: ParticipantRecord | null;
  joiner: ParticipantRecord | null;
}

interface InviteCodeRpcResponse {
  invite_code: string;
}

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export class PairingService {
  async createInvite(request: CreateInviteRequest): Promise<CreateInviteResponse> {
    validateDisplayName(request.inviterName, "inviterName");
    validateCoverTopic(request.coverTopic);
    validateIdentityPublicKey(request.identityPublicKey);

    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
    const { data, error } = await supabase.rpc("create_pairing_invite", {
      inviter_name_input: request.inviterName.trim(),
      cover_topic_input: request.coverTopic.trim(),
      identity_public_key_input: request.identityPublicKey.trim(),
      expires_at_input: expiresAt,
    });

    if (error) {
      throw mapSupabaseError(error.message);
    }

    const inviteCode = getInviteCodeFromRpc(data);
    const record = await this.getRequiredRecord(inviteCode);

    if (!record.inviter) {
      throw new ApiError(500, "Created invite is missing inviter data.");
    }

    return {
      session: mapSession(record),
      inviter: mapParticipant(record.inviter),
      coverTopic: record.cover_topic,
    };
  }

  async joinInvite(inviteCode: string, request: JoinInviteRequest): Promise<JoinInviteResponse> {
    validateInviteCode(inviteCode);
    validateDisplayName(request.joinerName, "joinerName");
    validateIdentityPublicKey(request.identityPublicKey);

    const { error } = await supabase.rpc("claim_pairing_invite", {
      invite_code_input: inviteCode.trim(),
      joiner_name_input: request.joinerName.trim(),
      identity_public_key_input: request.identityPublicKey.trim(),
    });

    if (error) {
      throw mapSupabaseError(error.message);
    }

    const record = await this.getRequiredRecord(inviteCode);

    if (!record.inviter || !record.joiner) {
      throw new ApiError(500, "Joined invite is missing participant data.");
    }

    return {
      session: mapSession(record),
      inviter: mapParticipant(record.inviter),
      joiner: mapParticipant(record.joiner),
      coverTopic: record.cover_topic,
    };
  }

  async getInviteSessionStatus(inviteCode: string): Promise<InviteSessionStatusResponse> {
    validateInviteCode(inviteCode);

    const record = await this.getRequiredRecord(inviteCode);

    return {
      session: mapSession(record),
      inviter: record.inviter ? mapParticipant(record.inviter) : null,
      joiner: record.joiner ? mapParticipant(record.joiner) : null,
      coverTopic: record.cover_topic,
    };
  }

  async resetPairing(request: ResetPairingRequest): Promise<ResetPairingResponse> {
    validateInviteCode(request.inviteCode);

    const record = await this.getRequiredRecord(request.inviteCode);
    const invalidatedAt = new Date().toISOString();

    const { error } = await supabase
      .from("pairing_sessions")
      .update({
        status: "invalidated",
        invalidated_at: invalidatedAt,
      })
      .eq("id", record.id);

    if (error) {
      throw mapSupabaseError(error.message);
    }

    return {
      session: {
        ...mapSession(record),
        status: "invalidated",
        invalidatedAt,
      },
    };
  }

  private async getRequiredRecord(inviteCode: string): Promise<PairingSessionRecord> {
    const record = await loadPairingRecord(inviteCode);

    if (!record) {
      throw new ApiError(404, "Invite code not found.");
    }

    return expireIfNeeded(record);
  }
}

async function loadPairingRecord(inviteCode: string): Promise<PairingSessionRecord | null> {
  const { data, error } = await supabase
    .from("pairing_sessions")
    .select(
      `
        id,
        invite_code,
        invite_format,
        cover_topic,
        status,
        inviter_id,
        joiner_id,
        invite_consumed,
        created_at,
        expires_at,
        joined_at,
        invalidated_at,
        inviter:pairing_participants!pairing_sessions_inviter_fk (
          id,
          session_id,
          role,
          display_name,
          identity_public_key,
          created_at
        ),
        joiner:pairing_participants!pairing_sessions_joiner_fk (
          id,
          session_id,
          role,
          display_name,
          identity_public_key,
          created_at
        )
      `,
    )
    .eq("invite_code", inviteCode)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error.message);
  }

  return (data as PairingSessionRecord | null) ?? null;
}

async function expireIfNeeded(record: PairingSessionRecord): Promise<PairingSessionRecord> {
  if (record.status === "invalidated") {
    return record;
  }

  if (new Date(record.expires_at).getTime() > Date.now()) {
    return record;
  }

  const invalidatedAt = record.invalidated_at ?? new Date().toISOString();
  const { error } = await supabase
    .from("pairing_sessions")
    .update({
      status: "invalidated",
      invalidated_at: invalidatedAt,
    })
    .eq("id", record.id);

  if (error) {
    throw mapSupabaseError(error.message);
  }

  return {
    ...record,
    status: "invalidated",
    invalidated_at: invalidatedAt,
  };
}

function mapSession(record: PairingSessionRecord): PairingSession {
  return {
    id: record.id,
    invite: {
      code: record.invite_code,
      format: record.invite_format,
      expiresAt: record.expires_at,
      consumed: record.invite_consumed,
    },
    status: record.status,
    inviterId: record.inviter_id,
    joinerId: record.joiner_id,
    createdAt: record.created_at,
    joinedAt: record.joined_at,
    invalidatedAt: record.invalidated_at,
  };
}

function mapParticipant(record: ParticipantRecord): PairingParticipant {
  return {
    id: record.id,
    sessionId: record.session_id,
    role: record.role,
    displayName: record.display_name,
    identityPublicKey: record.identity_public_key,
    createdAt: record.created_at,
  };
}

function getInviteCodeFromRpc(data: unknown): string {
  if (!Array.isArray(data) || data.length === 0) {
    throw new ApiError(500, "Invite creation did not return an invite code.");
  }

  const [row] = data as InviteCodeRpcResponse[];

  if (!row?.invite_code) {
    throw new ApiError(500, "Invite creation did not return an invite code.");
  }

  return row.invite_code;
}

function mapSupabaseError(message: string) {
  switch (message) {
    case "Invite code not found.":
      return new ApiError(404, message);
    case "This invite has already been used.":
    case "This invite is no longer valid.":
      return new ApiError(409, message);
    case "This invite has expired.":
      return new ApiError(410, message);
    case "Unable to mint a unique invite code.":
      return new ApiError(500, message);
    default:
      return new ApiError(500, message || "Unexpected Supabase error.");
  }
}

function validateInviteCode(inviteCode: string) {
  if (!/^\d{4}$/.test(inviteCode.trim())) {
    throw new ApiError(400, "Invite codes must be 4 digits.");
  }
}

function validateDisplayName(value: string, fieldName: string) {
  if (!value.trim()) {
    throw new ApiError(400, `${fieldName} is required.`);
  }
}

function validateCoverTopic(value: string) {
  if (!value.trim()) {
    throw new ApiError(400, "coverTopic is required.");
  }
}

function validateIdentityPublicKey(value: string) {
  if (!value.trim()) {
    throw new ApiError(400, "identityPublicKey is required.");
  }
}
