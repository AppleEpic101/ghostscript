import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import type {
  CreateInviteRequest,
  JoinInviteRequest,
  ResetPairingRequest,
} from "@ghostscript/shared";
import { ApiError, PairingService } from "./service";

const port = Number.parseInt(process.env.PAIRING_API_PORT ?? "8787", 10);
const pairingService = new PairingService();

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
      sendJson(response, 201, await pairingService.createInvite(body));
      return;
    }

    const inviteStatusMatch = pathname.match(/^\/pairing\/invites\/([^/]+)$/);
    if (request.method === "GET" && inviteStatusMatch) {
      sendJson(
        response,
        200,
        await pairingService.getInviteSessionStatus(decodeURIComponent(inviteStatusMatch[1] ?? "")),
      );
      return;
    }

    const joinMatch = pathname.match(/^\/pairing\/invites\/([^/]+)\/join$/);
    if (request.method === "POST" && joinMatch) {
      const body = await readJsonBody<JoinInviteRequest>(request);
      sendJson(response, 200, await pairingService.joinInvite(decodeURIComponent(joinMatch[1] ?? ""), body));
      return;
    }

    if (request.method === "POST" && pathname === "/pairing/reset") {
      const body = await readJsonBody<ResetPairingRequest>(request);
      sendJson(response, 200, await pairingService.resetPairing(body));
      return;
    }

    sendJson(response, 404, { error: "Route not found." });
  } catch (error) {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    sendJson(response, statusCode, {
      error: error instanceof Error ? error.message : "Unexpected server error.",
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
