import type {
  ConfirmVerificationRequest,
  ConfirmVerificationResponse,
  CreateInviteRequest,
  CreateInviteResponse,
  JoinInviteRequest,
  JoinInviteResponse,
  PairingIdentity,
  PublicKeyBundle,
} from "@ghostscript/shared";
import type { AuthUser } from "../auth/googleIdentity";

const DEFAULT_PAIRING_API_BASE_URL = "http://localhost:8787";

function getPairingApiBaseUrl() {
  return (
    import.meta.env.VITE_PAIRING_API_BASE_URL?.trim().replace(/\/$/, "") ??
    DEFAULT_PAIRING_API_BASE_URL
  );
}

export async function createInvite(request: CreateInviteRequest): Promise<CreateInviteResponse> {
  return requestJson<CreateInviteResponse>("/pairing/invites", request);
}

export async function joinInvite(
  inviteCode: string,
  request: JoinInviteRequest,
): Promise<JoinInviteResponse> {
  return requestJson<JoinInviteResponse>(
    `/pairing/invites/${encodeURIComponent(inviteCode)}/join`,
    request,
  );
}

export async function confirmInvite(
  inviteCode: string,
  request: ConfirmVerificationRequest,
): Promise<ConfirmVerificationResponse> {
  return requestJson<ConfirmVerificationResponse>(
    `/pairing/invites/${encodeURIComponent(inviteCode)}/confirm`,
    request,
  );
}

export function buildPairingIdentity(user: AuthUser | null): PairingIdentity {
  if (!user) {
    return {
      provider: "anonymous",
      subject: "anonymous-browser",
    };
  }

  return {
    provider: "google",
    subject: user.subject,
    email: user.email,
    emailVerified: user.emailVerified,
  };
}

export function buildDemoPublicKey(user: AuthUser | null, displayName: string): PublicKeyBundle {
  const now = new Date().toISOString();
  const seed = user ? `${user.subject}:${user.email}` : `guest:${displayName}`;
  const publicKey = textToHex(seed.padEnd(32, "_")).slice(0, 64);
  const fingerprint = publicKey
    .slice(0, 16)
    .toUpperCase()
    .match(/.{1,4}/g)
    ?.join(" ") ?? "DEMO FING ERPR INT0";

  return {
    keyId: `key_${publicKey.slice(0, 12)}`,
    algorithm: "Ed25519",
    publicKey,
    fingerprint,
    createdAt: now,
  };
}

async function requestJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${getPairingApiBaseUrl()}${path}`, {
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        `Unable to reach the pairing API at ${getPairingApiBaseUrl()}. Start \`pnpm dev:api\` and confirm apps/pairing-api/.env uses your Supabase backend secret/service-role key.`,
      );
    }

    throw error;
  }

  const payload = (await response.json().catch(() => null)) as { error?: string } | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Request failed.");
  }

  return payload as T;
}

function textToHex(value: string) {
  return Array.from(new TextEncoder().encode(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
