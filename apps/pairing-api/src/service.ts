import { createHash, randomInt } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  ConfirmVerificationRequest,
  ConfirmVerificationResponse,
  CreateInviteRequest,
  CreateInviteResponse,
  JoinInviteRequest,
  JoinInviteResponse,
  PairingIdentity,
  PairingParticipant,
  PairingSession,
  PairingSessionStatus,
  ParticipantRole,
  PublicKeyBundle,
  PublicKeyLookupResponse,
  ResetPairingRequest,
  ResetPairingResponse,
  VerificationState,
} from "@ghostscript/shared";

const HASH_WORDS = [
  "cedar",
  "orbit",
  "signal",
  "cobalt",
  "harbor",
  "ember",
  "atlas",
  "iris",
  "topaz",
  "lumen",
  "solace",
  "echo",
  "vector",
  "zephyr",
  "marble",
  "fern",
];

interface PairingSessionRow {
  id: string;
  invite_code: string;
  status: PairingSessionStatus;
  inviter_id: string | null;
  joiner_id: string | null;
  expires_at: string;
  joined_at: string | null;
  verified_at: string | null;
  invalidated_at: string | null;
  created_at: string;
}

interface PairingParticipantRow {
  id: string;
  session_id: string;
  role: ParticipantRole;
  display_name: string;
  identity_provider: PairingIdentity["provider"];
  identity_subject: string;
  identity_email: string | null;
  identity_email_verified: boolean;
  public_key_key_id: string;
  public_key_algorithm: PublicKeyBundle["algorithm"];
  public_key_value: string;
  public_key_fingerprint: string;
  public_key_created_at: string;
  confirmed_at: string | null;
  created_at: string;
}

export class ApiError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class PairingService {
  private readonly supabase: SupabaseClient;
  private readonly appBaseUrl: string;

  constructor(options: {
    appBaseUrl: string;
    supabaseKey: string;
    supabaseUrl: string;
  }) {
    this.appBaseUrl = options.appBaseUrl.replace(/\/$/, "");
    this.supabase = createClient(options.supabaseUrl, options.supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  async createInvite(request: CreateInviteRequest): Promise<CreateInviteResponse> {
    validateDisplayName(request.inviterName, "inviterName");
    validateIdentity(request.inviterIdentity);
    validatePublicKey(request.publicKey);

    const inviteCode = await this.generateInviteCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const { data: sessionRow, error: sessionError } = await this.supabase
      .from("pairing_sessions")
      .insert({
        invite_code: inviteCode,
        status: "pending",
        expires_at: expiresAt,
      })
      .select("*")
      .single<PairingSessionRow>();

    if (sessionError || !sessionRow) {
      throw new ApiError(500, "Unable to create pairing session.");
    }

    const { data: inviterRow, error: inviterError } = await this.supabase
      .from("pairing_participants")
      .insert(
        this.toParticipantInsert(sessionRow.id, "inviter", request.inviterName, request.inviterIdentity, request.publicKey),
      )
      .select("*")
      .single<PairingParticipantRow>();

    if (inviterError || !inviterRow) {
      throw new ApiError(500, "Unable to create inviter record.");
    }

    const { data: updatedSession, error: updateSessionError } = await this.supabase
      .from("pairing_sessions")
      .update({
        inviter_id: inviterRow.id,
      })
      .eq("id", sessionRow.id)
      .select("*")
      .single<PairingSessionRow>();

    if (updateSessionError || !updatedSession) {
      throw new ApiError(500, "Unable to finalize pairing session.");
    }

    return {
      session: mapSession(updatedSession),
      inviter: mapParticipant(inviterRow),
      inviteUrl: `${this.appBaseUrl}/join?code=${inviteCode}`,
    };
  }

  async joinInvite(inviteCode: string, request: JoinInviteRequest): Promise<JoinInviteResponse> {
    validateInviteCode(inviteCode);
    validateDisplayName(request.joinerName, "joinerName");
    validateIdentity(request.joinerIdentity);
    validatePublicKey(request.publicKey);

    const sessionBundle = await this.getSessionBundleByInviteCode(inviteCode);
    const session = sessionBundle.session;
    assertJoinable(session);

    if (sessionBundle.joiner) {
      throw new ApiError(409, "This invite has already been used.");
    }

    const { data: joinerRow, error: joinerError } = await this.supabase
      .from("pairing_participants")
      .insert(
        this.toParticipantInsert(
          session.id,
          "joiner",
          request.joinerName,
          request.joinerIdentity,
          request.publicKey,
        ),
      )
      .select("*")
      .single<PairingParticipantRow>();

    if (joinerError || !joinerRow) {
      throw new ApiError(500, "Unable to attach the joiner to this invite.");
    }

    const joinedAt = new Date().toISOString();
    const { data: updatedSession, error: updateSessionError } = await this.supabase
      .from("pairing_sessions")
      .update({
        joiner_id: joinerRow.id,
        joined_at: joinedAt,
        status: "paired-unverified",
      })
      .eq("id", session.id)
      .is("joiner_id", null)
      .select("*")
      .single<PairingSessionRow>();

    if (updateSessionError || !updatedSession) {
      throw new ApiError(409, "This invite was claimed by another joiner.");
    }

    const inviter = sessionBundle.inviter;

    if (!inviter) {
      throw new ApiError(500, "The invite is missing its inviter record.");
    }

    return {
      session: mapSession(updatedSession),
      inviter: mapParticipant(inviter),
      joiner: mapParticipant(joinerRow),
      verification: deriveVerificationState(inviter, joinerRow, updatedSession.verified_at),
    };
  }

  async confirmInvite(
    inviteCode: string,
    request: ConfirmVerificationRequest,
  ): Promise<ConfirmVerificationResponse> {
    validateInviteCode(inviteCode);

    const sessionBundle = await this.getSessionBundleByInviteCode(inviteCode);
    const { inviter, joiner, session } = sessionBundle;

    if (!inviter || !joiner) {
      throw new ApiError(409, "Both participants must join before verification can start.");
    }

    assertConfirmable(session);

    const participant = [inviter, joiner].find(
      (candidate) => candidate.id === request.participantId,
    );

    if (!participant) {
      throw new ApiError(404, "Participant not found for this invite.");
    }

    let confirmedParticipant = participant;

    if (!participant.confirmed_at) {
      const { data: updatedParticipant, error: updateParticipantError } = await this.supabase
        .from("pairing_participants")
        .update({
          confirmed_at: new Date().toISOString(),
        })
        .eq("id", participant.id)
        .select("*")
        .single<PairingParticipantRow>();

      if (updateParticipantError || !updatedParticipant) {
        throw new ApiError(500, "Unable to record pairing confirmation.");
      }

      confirmedParticipant = updatedParticipant;
    }

    const nextInviter = confirmedParticipant.role === "inviter" ? confirmedParticipant : inviter;
    const nextJoiner = confirmedParticipant.role === "joiner" ? confirmedParticipant : joiner;
    const bothConfirmed = Boolean(nextInviter.confirmed_at && nextJoiner.confirmed_at);

    let nextSession = session;

    if (bothConfirmed && session.status !== "verified") {
      const verifiedAt = new Date().toISOString();
      const { data: verifiedSession, error: verifyError } = await this.supabase
        .from("pairing_sessions")
        .update({
          status: "verified",
          verified_at: verifiedAt,
        })
        .eq("id", session.id)
        .select("*")
        .single<PairingSessionRow>();

      if (verifyError || !verifiedSession) {
        throw new ApiError(500, "Unable to finalize pairing verification.");
      }

      nextSession = verifiedSession;
    }

    const verification = deriveVerificationState(
      nextInviter,
      nextJoiner,
      nextSession.verified_at,
    );
    const counterpart =
      confirmedParticipant.role === "inviter"
        ? mapParticipant(nextJoiner)
        : mapParticipant(nextInviter);

    return {
      session: mapSession(nextSession),
      participant: mapParticipant(confirmedParticipant),
      counterpart,
      verification,
      trustStatus: verification.bothConfirmed ? "verified" : "paired-unverified",
    };
  }

  async lookupPublicKey(participantId: string): Promise<PublicKeyLookupResponse> {
    const { data: participantRow, error: participantError } = await this.supabase
      .from("pairing_participants")
      .select("*")
      .eq("id", participantId)
      .single<PairingParticipantRow>();

    if (participantError || !participantRow) {
      throw new ApiError(404, "Participant not found.");
    }

    const { data: sessionRow, error: sessionError } = await this.supabase
      .from("pairing_sessions")
      .select("*")
      .eq("id", participantRow.session_id)
      .single<PairingSessionRow>();

    if (sessionError || !sessionRow) {
      throw new ApiError(404, "Pairing session not found.");
    }

    return {
      participantId: participantRow.id,
      sessionId: sessionRow.id,
      sessionStatus: sessionRow.status,
      publicKey: mapPublicKey(participantRow),
    };
  }

  async resetPairing(request: ResetPairingRequest): Promise<ResetPairingResponse> {
    let sessionRow: PairingSessionRow | null = null;

    if (request.inviteCode) {
      sessionRow = await this.getRequiredSessionByInviteCode(request.inviteCode);
    } else if (request.participantId) {
      const { data: participantRow, error: participantError } = await this.supabase
        .from("pairing_participants")
        .select("*")
        .eq("id", request.participantId)
        .single<PairingParticipantRow>();

      if (participantError || !participantRow) {
        throw new ApiError(404, "Participant not found.");
      }

      const { data: linkedSession, error: sessionError } = await this.supabase
        .from("pairing_sessions")
        .select("*")
        .eq("id", participantRow.session_id)
        .single<PairingSessionRow>();

      if (sessionError || !linkedSession) {
        throw new ApiError(404, "Pairing session not found.");
      }

      sessionRow = linkedSession;
    } else {
      throw new ApiError(400, "Provide either inviteCode or participantId.");
    }

    if (!sessionRow) {
      throw new ApiError(404, "Pairing session not found.");
    }

    const { data: updatedSession, error: updateError } = await this.supabase
      .from("pairing_sessions")
      .update({
        status: "invalidated",
        invalidated_at: new Date().toISOString(),
      })
      .eq("id", sessionRow.id)
      .select("*")
      .single<PairingSessionRow>();

    if (updateError || !updatedSession) {
      throw new ApiError(500, "Unable to invalidate pairing session.");
    }

    return {
      session: mapSession(updatedSession),
    };
  }

  private async generateInviteCode(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const inviteCode = `GHOST-${randomInt(1000, 10000)}`;
      const existing = await this.getOptionalSessionByInviteCode(inviteCode);

      if (!existing) {
        return inviteCode;
      }
    }

    throw new ApiError(500, "Unable to mint a unique invite code.");
  }

  private async getSessionBundleByInviteCode(inviteCode: string) {
    const session = await this.getRequiredSessionByInviteCode(inviteCode);
    const { data: participantRows, error: participantError } = await this.supabase
      .from("pairing_participants")
      .select("*")
      .eq("session_id", session.id)
      .returns<PairingParticipantRow[]>();

    if (participantError) {
      throw new ApiError(500, "Unable to load pairing participants.");
    }

    return {
      session,
      inviter: participantRows?.find((participant) => participant.role === "inviter") ?? null,
      joiner: participantRows?.find((participant) => participant.role === "joiner") ?? null,
    };
  }

  private async getRequiredSessionByInviteCode(inviteCode: string): Promise<PairingSessionRow> {
    const data = await this.getOptionalSessionByInviteCode(inviteCode);

    if (!data) {
      throw new ApiError(404, "Invite code not found.");
    }

    return data;
  }

  private async getOptionalSessionByInviteCode(inviteCode: string): Promise<PairingSessionRow | null> {
    const { data, error } = await this.supabase
      .from("pairing_sessions")
      .select("*")
      .eq("invite_code", inviteCode)
      .maybeSingle<PairingSessionRow>();

    if (error) {
      throw new ApiError(500, "Unable to load pairing session.");
    }

    return data;
  }

  private toParticipantInsert(
    sessionId: string,
    role: ParticipantRole,
    displayName: string,
    identity: PairingIdentity,
    publicKey: PublicKeyBundle,
  ) {
    return {
      session_id: sessionId,
      role,
      display_name: displayName,
      identity_provider: identity.provider,
      identity_subject: identity.subject,
      identity_email: identity.email ?? null,
      identity_email_verified: Boolean(identity.emailVerified),
      public_key_key_id: publicKey.keyId,
      public_key_algorithm: publicKey.algorithm,
      public_key_value: publicKey.publicKey,
      public_key_fingerprint: publicKey.fingerprint,
      public_key_created_at: publicKey.createdAt,
    };
  }
}

function mapSession(row: PairingSessionRow): PairingSession {
  return {
    id: row.id,
    inviteCode: row.invite_code,
    status: row.status,
    inviterId: row.inviter_id ?? "",
    joinerId: row.joiner_id,
    expiresAt: row.expires_at,
    joinedAt: row.joined_at,
    verifiedAt: row.verified_at,
    invalidatedAt: row.invalidated_at,
    createdAt: row.created_at,
  };
}

function mapPublicKey(row: PairingParticipantRow): PublicKeyBundle {
  return {
    keyId: row.public_key_key_id,
    algorithm: row.public_key_algorithm,
    publicKey: row.public_key_value,
    fingerprint: row.public_key_fingerprint,
    createdAt: row.public_key_created_at,
  };
}

function mapParticipant(row: PairingParticipantRow): PairingParticipant {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    displayName: row.display_name,
    identity: {
      provider: row.identity_provider,
      subject: row.identity_subject,
      email: row.identity_email ?? undefined,
      emailVerified: row.identity_email_verified,
    },
    publicKey: mapPublicKey(row),
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
  };
}

function deriveVerificationState(
  inviter: PairingParticipantRow,
  joiner: PairingParticipantRow,
  verifiedAt: string | null,
): VerificationState {
  const material = [inviter.public_key_value, joiner.public_key_value].sort().join(":");
  const digest = createHash("sha256").update(material).digest();
  const digits = Array.from(digest.slice(0, 12), (value) => (value % 10).toString()).join("");
  const groupedDigits = digits.match(/.{1,4}/g)?.join(" ") ?? digits;
  const hashWords = Array.from(digest.slice(12, 16), (value) => HASH_WORDS[value % HASH_WORDS.length]);

  return {
    safetyNumber: groupedDigits,
    hashWords,
    inviterConfirmedAt: inviter.confirmed_at,
    joinerConfirmedAt: joiner.confirmed_at,
    bothConfirmed: Boolean(inviter.confirmed_at && joiner.confirmed_at),
    verifiedAt,
  };
}

function validateInviteCode(inviteCode: string) {
  if (!/^[A-Z0-9-]{6,20}$/.test(inviteCode)) {
    throw new ApiError(400, "Invite code format is invalid.");
  }
}

function validateDisplayName(value: string, fieldName: string) {
  if (!value.trim()) {
    throw new ApiError(400, `${fieldName} is required.`);
  }
}

function validateIdentity(identity: PairingIdentity) {
  if (!identity.subject.trim()) {
    throw new ApiError(400, "Identity subject is required.");
  }
}

function validatePublicKey(publicKey: PublicKeyBundle) {
  if (!publicKey.publicKey.trim() || !publicKey.fingerprint.trim() || !publicKey.keyId.trim()) {
    throw new ApiError(400, "Public key payload is incomplete.");
  }
}

function assertJoinable(session: PairingSessionRow) {
  if (session.invalidated_at || session.status === "invalidated") {
    throw new ApiError(409, "This pairing session has been invalidated.");
  }

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    throw new ApiError(410, "This invite has expired.");
  }

  if (session.joiner_id) {
    throw new ApiError(409, "This invite has already been used.");
  }

  if (session.status === "verified") {
    throw new ApiError(409, "This invite has already been verified.");
  }
}

function assertConfirmable(session: PairingSessionRow) {
  if (session.invalidated_at || session.status === "invalidated") {
    throw new ApiError(409, "This pairing session has been invalidated.");
  }

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    throw new ApiError(410, "This invite has expired.");
  }

  if (session.status === "pending") {
    throw new ApiError(409, "Both participants must join before verification can start.");
  }
}
