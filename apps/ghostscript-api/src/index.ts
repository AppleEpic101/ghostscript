import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import type {
  CreateInviteRequest,
  JoinInviteRequest,
  ResetPairingRequest,
} from "@ghostscript/shared";
import { LlmService, type DecodeRequestBody, type EncodeRequestBody } from "./llmService";
import { createRateLimiter } from "./rateLimit";
import { ApiError, PairingService } from "./service";

const port = Number.parseInt(process.env.GHOSTSCRIPT_API_PORT ?? "8787", 10);
const rateLimiter = createRateLimiter();
const pairingService = new PairingService();
const llmService = new LlmService();
let isShuttingDown = false;

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
    rateLimiter.enforce(request, pathname);

    if (request.method === "GET" && pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        llm: llmService.getHealth(),
      });
      return;
    }

    if (request.method === "POST" && pathname === "/encode") {
      const body = await readJsonBody<EncodeRequestBody>(request);
      console.log("[Ghostscript Terminal]", JSON.stringify({
        ts: new Date().toISOString(),
        source: "api",
        event: "encode-route",
        details: {
          promptLength: body.prompt.length,
          bitstringLength: body.bitstring.length,
          wordTarget: body.wordTarget,
          configId: body.config.configId,
        },
      }));
      sendJson(response, 200, await llmService.encode(body));
      return;
    }

    if (request.method === "POST" && pathname === "/decode") {
      const body = await readJsonBody<DecodeRequestBody>(request);
      console.log("[Ghostscript Terminal]", JSON.stringify({
        ts: new Date().toISOString(),
        source: "api",
        event: "decode-route",
        details: {
          promptLength: body.prompt.length,
          visibleText: body.visibleText,
          visibleTextLength: body.visibleText.length,
          configId: body.config.configId,
        },
      }));
      sendJson(response, 200, await llmService.decode(body));
      return;
    }

    if (request.method === "POST" && pathname === "/debug-log") {
      const body = await readJsonBody<unknown>(request);
      console.log("[Ghostscript Terminal]", JSON.stringify(body));
      sendJson(response, 202, { ok: true });
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

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${port} is already in use. Stop the existing Ghostscript API process or set GHOSTSCRIPT_API_PORT to a different port.`,
    );
    process.exitCode = 1;
    return;
  }

  throw error;
});

server.listen(port, () => {
  console.log(`Ghostscript API listening on port ${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    server.close((error) => {
      if (error) {
        console.error("Failed to shut down Ghostscript API cleanly.", error);
        process.exit(1);
      }

      process.exit(0);
    });
  });
}

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
