import type {
  ConfirmVerificationRequest,
  ConfirmVerificationResponse,
  CreateInviteRequest,
  CreateInviteResponse,
  InviteSessionStatusResponse,
  JoinInviteRequest,
  JoinInviteResponse,
} from "@ghostscript/shared";

const DEFAULT_PAIRING_API_BASE_URL = "http://localhost:8787";

function getPairingApiBaseUrl() {
  return (
    import.meta.env.VITE_PAIRING_API_BASE_URL?.trim().replace(/\/$/, "") ??
    DEFAULT_PAIRING_API_BASE_URL
  );
}

export async function createInvite(request: CreateInviteRequest) {
  return requestJson<CreateInviteResponse>("/pairing/invites", request);
}

export async function getInviteSessionStatus(inviteCode: string) {
  return requestJson<InviteSessionStatusResponse>(
    `/pairing/invites/${encodeURIComponent(inviteCode)}`,
    undefined,
    "GET",
  );
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

async function requestJson<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${getPairingApiBaseUrl()}${path}`, {
      method,
      headers:
        body === undefined
          ? undefined
          : {
              "Content-Type": "application/json",
            },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        `Unable to reach the pairing API at ${getPairingApiBaseUrl()}. Confirm the local stack is running and reload the unpacked extension if its API URL changed.`,
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
