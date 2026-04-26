import { randomUUID } from "node:crypto";
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

const INVITE_TTL_MS = 15 * 60 * 1000;

interface PairingRecord {
  session: PairingSession;
  inviter: PairingParticipant;
  joiner: PairingParticipant | null;
  coverTopic: string;
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
  private readonly records = new Map<string, PairingRecord>();

  createInvite(request: CreateInviteRequest): CreateInviteResponse {
    validateDisplayName(request.inviterName, "inviterName");
    validateCoverTopic(request.coverTopic);

    const createdAt = new Date().toISOString();
    const code = this.generateInviteCode();
    const sessionId = randomUUID();
    const inviterId = randomUUID();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

    const session: PairingSession = {
      id: sessionId,
      invite: {
        code,
        format: "4-digit",
        expiresAt,
        consumed: false,
      },
      status: "invite-pending",
      inviterId,
      joinerId: null,
      createdAt,
      joinedAt: null,
      invalidatedAt: null,
    };

    const inviter: PairingParticipant = {
      id: inviterId,
      sessionId,
      role: "inviter",
      displayName: request.inviterName.trim(),
      createdAt,
    };

    this.records.set(code, {
      session,
      inviter,
      joiner: null,
      coverTopic: request.coverTopic.trim(),
    });

    return {
      session,
      inviter,
      coverTopic: request.coverTopic.trim(),
    };
  }

  joinInvite(inviteCode: string, request: JoinInviteRequest): JoinInviteResponse {
    validateInviteCode(inviteCode);
    validateDisplayName(request.joinerName, "joinerName");

    const record = this.getRequiredRecord(inviteCode);
    assertJoinable(record.session);

    if (record.joiner) {
      throw new ApiError(409, "This invite has already been used.");
    }

    const joinerId = randomUUID();
    const joinedAt = new Date().toISOString();
    const session: PairingSession = {
      ...record.session,
      status: "paired",
      joinerId,
      joinedAt,
      invite: {
        ...record.session.invite,
        consumed: true,
      },
    };

    const joiner: PairingParticipant = {
      id: joinerId,
      sessionId: record.session.id,
      role: "joiner",
      displayName: request.joinerName.trim(),
      createdAt: joinedAt,
    };

    const nextRecord: PairingRecord = {
      ...record,
      session,
      joiner,
    };

    this.records.set(inviteCode, nextRecord);

    return {
      session,
      inviter: record.inviter,
      joiner,
      coverTopic: record.coverTopic,
    };
  }

  getInviteSessionStatus(inviteCode: string): InviteSessionStatusResponse {
    validateInviteCode(inviteCode);

    const record = this.getRequiredRecord(inviteCode);
    const nextRecord = this.expireIfNeeded(record);

    return {
      session: nextRecord.session,
      inviter: nextRecord.inviter,
      joiner: nextRecord.joiner,
      coverTopic: nextRecord.coverTopic,
    };
  }

  resetPairing(request: ResetPairingRequest): ResetPairingResponse {
    validateInviteCode(request.inviteCode);

    const record = this.getRequiredRecord(request.inviteCode);
    const session: PairingSession = {
      ...record.session,
      status: "invalidated",
      invalidatedAt: new Date().toISOString(),
    };

    this.records.set(request.inviteCode, {
      ...record,
      session,
    });

    return { session };
  }

  private getRequiredRecord(inviteCode: string) {
    const record = this.records.get(inviteCode);

    if (!record) {
      throw new ApiError(404, "Invite code not found.");
    }

    return this.expireIfNeeded(record);
  }

  private expireIfNeeded(record: PairingRecord) {
    if (record.session.status === "invalidated") {
      return record;
    }

    if (new Date(record.session.invite.expiresAt).getTime() > Date.now()) {
      return record;
    }

    const expiredRecord: PairingRecord = {
      ...record,
      session: {
        ...record.session,
        status: "invalidated",
        invalidatedAt: record.session.invalidatedAt ?? new Date().toISOString(),
      },
    };

    this.records.set(record.session.invite.code, expiredRecord);
    return expiredRecord;
  }

  private generateInviteCode() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = Math.floor(Math.random() * 10_000)
        .toString()
        .padStart(4, "0");

      if (!this.records.has(code)) {
        return code;
      }
    }

    throw new ApiError(500, "Unable to mint a unique invite code.");
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

function assertJoinable(session: PairingSession) {
  if (session.status === "invalidated" || session.invalidatedAt) {
    throw new ApiError(409, "This invite is no longer valid.");
  }

  if (new Date(session.invite.expiresAt).getTime() <= Date.now()) {
    throw new ApiError(410, "This invite has expired.");
  }

  if (session.joinerId) {
    throw new ApiError(409, "This invite has already been used.");
  }
}
