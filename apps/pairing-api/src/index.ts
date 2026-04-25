import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { URL } from "node:url";
import { fileURLToPath } from "node:url";
import type {
  ConfirmVerificationRequest,
  CreateInviteRequest,
  JoinInviteRequest,
  ResetPairingRequest,
} from "@ghostscript/shared";
import { ApiError, PairingService } from "./service";

loadLocalEnvFiles();

const port = Number.parseInt(process.env.PAIRING_API_PORT ?? "8787", 10);
const appBaseUrl = process.env.PAIRING_APP_BASE_URL ?? "http://localhost:5173";
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    "Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
}

if (supabaseServiceRoleKey.startsWith("sb_publishable_")) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY is using a Supabase publishable key. Replace it with the backend secret/service-role key from your Supabase project settings.",
  );
}

const pairingService = new PairingService({
  appBaseUrl,
  supabaseKey: supabaseServiceRoleKey,
  supabaseUrl,
});

const server = createServer(async (request, response) => {
  try {
    applyCorsHeaders(response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const pathname = url.pathname;

    if (request.method === "GET" && pathname === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && pathname === "/pairing/invites") {
      const body = await readJsonBody<CreateInviteRequest>(request);
      const result = await pairingService.createInvite(body);
      sendJson(response, 201, result);
      return;
    }

    const inviteStatusMatch = pathname.match(/^\/pairing\/invites\/([^/]+)$/);
    if (request.method === "GET" && inviteStatusMatch) {
      const inviteCode = decodeURIComponent(inviteStatusMatch[1] ?? "");
      const result = await pairingService.getInviteSessionStatus(inviteCode);
      sendJson(response, 200, result);
      return;
    }

    const joinMatch = pathname.match(/^\/pairing\/invites\/([^/]+)\/join$/);
    if (request.method === "POST" && joinMatch) {
      const inviteCode = decodeURIComponent(joinMatch[1] ?? "");
      const body = await readJsonBody<JoinInviteRequest>(request);
      const result = await pairingService.joinInvite(inviteCode, body);
      sendJson(response, 200, result);
      return;
    }

    const confirmMatch = pathname.match(/^\/pairing\/invites\/([^/]+)\/confirm$/);
    if (request.method === "POST" && confirmMatch) {
      const inviteCode = decodeURIComponent(confirmMatch[1] ?? "");
      const body = await readJsonBody<ConfirmVerificationRequest>(request);
      const result = await pairingService.confirmInvite(inviteCode, body);
      sendJson(response, 200, result);
      return;
    }

    const publicKeyMatch = pathname.match(/^\/users\/([^/]+)\/public-key$/);
    if (request.method === "GET" && publicKeyMatch) {
      const participantId = decodeURIComponent(publicKeyMatch[1] ?? "");
      const result = await pairingService.lookupPublicKey(participantId);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && pathname === "/pairing/reset") {
      const body = await readJsonBody<ResetPairingRequest>(request);
      const result = await pairingService.resetPairing(body);
      sendJson(response, 200, result);
      return;
    }

    sendJson(response, 404, {
      error: "Route not found.",
    });
  } catch (error) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    sendJson(response, statusCode, {
      error: message,
    });
  }
});

server.listen(port, () => {
  console.log(`Ghostscript pairing API listening on http://localhost:${port}`);
});

function applyCorsHeaders(response: ServerResponse) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    throw new ApiError(400, "Request body is required.");
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new ApiError(400, "Request body must be valid JSON.");
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.writeHead(statusCode);
  response.end(JSON.stringify(body));
}

function loadLocalEnvFiles() {
  const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

  for (const relativePath of [".env.local", ".env"]) {
    const envPath = resolve(apiDir, relativePath);

    if (!existsSync(envPath)) {
      continue;
    }

    const source = readFileSync(envPath, "utf8");

    for (const line of source.split(/\r?\n/)) {
      const trimmedLine = line.trim();

      if (!trimmedLine || trimmedLine.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmedLine.indexOf("=");

      if (separatorIndex <= 0) {
        continue;
      }

      const key = trimmedLine.slice(0, separatorIndex).trim();

      if (!key || process.env[key] !== undefined) {
        continue;
      }

      const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
      const value = normalizeEnvValue(rawValue);
      process.env[key] = value;
    }
  }
}

function normalizeEnvValue(value: string) {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
