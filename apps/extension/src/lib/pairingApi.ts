import type {
  ConfirmVerificationRequest,
  ConfirmVerificationResponse,
  CreateInviteRequest,
  CreateInviteResponse,
  JoinInviteRequest,
  JoinInviteResponse,
} from "@ghostscript/shared";

const DEFAULT_PAIRING_API_BASE_URL = "http://localhost:8787";

function getPairingApiBaseUrl() {
  return DEFAULT_PAIRING_API_BASE_URL;
}

export async function createInvite(request: CreateInviteRequest) {
  return requestJson<CreateInviteResponse>("/pairing/invites", request);
}

export async function joinInvite(inviteCode: string, request: JoinInviteRequest) {
  return requestJson<JoinInviteResponse>(
    `/pairing/invites/${encodeURIComponent(inviteCode)}/join`,
    request,
  );
}

export async function confirmInvite(inviteCode: string, request: ConfirmVerificationRequest) {
  return requestJson<ConfirmVerificationResponse>(
    `/pairing/invites/${encodeURIComponent(inviteCode)}/confirm`,
    request,
  );
}

async function requestJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${getPairingApiBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Request failed.");
  }

  return payload as T;
}
