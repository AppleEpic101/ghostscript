import type {
  ConfirmVerificationRequest,
  ConfirmVerificationResponse,
  CreateInviteRequest,
  CreateInviteResponse,
  InviteSessionStatusResponse,
  JoinInviteRequest,
  JoinInviteResponse,
  PairingIdentity,
  PublicKeyBundle,
} from "@ghostscript/shared";

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

export async function getInviteSessionStatus(
  inviteCode: string,
): Promise<InviteSessionStatusResponse> {
  return requestJson<InviteSessionStatusResponse>(
    `/pairing/invites/${encodeURIComponent(inviteCode)}`,
    undefined,
    "GET",
  );
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

export function buildPairingIdentity(subject: string): PairingIdentity {
  return {
    provider: "anonymous",
    subject,
  };
}

export function buildDemoPublicKey(subject: string, displayName: string): PublicKeyBundle {
  const now = new Date().toISOString();
  const seed = `${subject}:${displayName}`;
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

async function requestJson<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${getPairingApiBaseUrl()}${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers:
        body === undefined
          ? undefined
          : {
              "Content-Type": "application/json",
            },
      method,
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
