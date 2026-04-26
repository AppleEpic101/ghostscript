import type {
  CreateInviteRequest,
  CreateInviteResponse,
  InviteSessionStatusResponse,
  JoinInviteRequest,
  JoinInviteResponse,
  ResetPairingRequest,
  ResetPairingResponse,
} from "@ghostscript/shared";

const DEFAULT_GHOSTSCRIPT_API_BASE_URL = "http://localhost:8787";

function getPairingApiBaseUrl() {
  return (
    import.meta.env.VITE_GHOSTSCRIPT_API_BASE_URL?.trim().replace(/\/$/, "") ?? DEFAULT_GHOSTSCRIPT_API_BASE_URL
  );
}

export function createInvite(request: CreateInviteRequest) {
  return requestJson<CreateInviteResponse>("/pairing/invites", request);
}

export function joinInvite(inviteCode: string, request: JoinInviteRequest) {
  return requestJson<JoinInviteResponse>(`/pairing/invites/${encodeURIComponent(inviteCode)}/join`, request);
}

export function getInviteSessionStatus(inviteCode: string) {
  return requestJson<InviteSessionStatusResponse>(`/pairing/invites/${encodeURIComponent(inviteCode)}`, undefined, "GET");
}

export function resetPairing(request: ResetPairingRequest) {
  return requestJson<ResetPairingResponse>("/pairing/reset", request);
}

async function requestJson<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${getPairingApiBaseUrl()}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        `Unable to reach the Ghostscript API at ${getPairingApiBaseUrl()}. Confirm the local API is running and reload the extension if its URL changed.`,
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
