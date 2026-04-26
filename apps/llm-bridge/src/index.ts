import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import OpenAI from "openai";
import type { LLMEncodingConfig } from "@ghostscript/shared";

type BridgeMode = "passthrough" | "strict-stub";

interface EncodeRequestBody {
  prompt: string;
  bitstring: string;
  wordTarget: number;
  config?: LLMEncodingConfig;
}

interface DecodeRequestBody {
  prompt: string;
  visibleText: string;
  config?: LLMEncodingConfig;
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

const port = Number.parseInt(process.env.LLM_BRIDGE_PORT ?? "8788", 10);
const mode = getBridgeMode(process.env.LLM_BRIDGE_MODE);
const model = process.env.OPENAI_MODEL?.trim() || "gpt-5.4-mini";
const allowedOrigins = parseAllowedOrigins(process.env.LLM_BRIDGE_ALLOWED_ORIGINS);
const openAiApiKey = process.env.OPENAI_API_KEY?.trim() || "";
const openai = openAiApiKey ? new OpenAI({ apiKey: openAiApiKey }) : null;
let isShuttingDown = false;

const server = createServer(async (request, response) => {
  try {
    applyCorsHeaders(request, response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        mode,
        model,
        configured: Boolean(openai),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/encode") {
      const body = await readJsonBody<EncodeRequestBody>(request);
      validateEncodeRequest(body);
      sendJson(response, 200, await handleEncode(body));
      return;
    }

    if (request.method === "POST" && url.pathname === "/decode") {
      const body = await readJsonBody<DecodeRequestBody>(request);
      validateDecodeRequest(body);
      sendJson(response, 200, await handleDecode(body));
      return;
    }

    sendJson(response, 404, { error: "Route not found." });
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    sendJson(response, statusCode, {
      error: error instanceof Error ? error.message : "Unexpected bridge error.",
    });
  }
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${port} is already in use. Stop the existing bridge process or set LLM_BRIDGE_PORT to a different port.`,
    );
    process.exitCode = 1;
    return;
  }

  throw error;
});

server.listen(port, () => {
  console.log(`Ghostscript LLM bridge listening on http://localhost:${port} (${mode}, model=${model})`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    server.close((error) => {
      if (error) {
        console.error("Failed to shut down the Ghostscript LLM bridge cleanly.", error);
        process.exit(1);
      }

      process.exit(0);
    });
  });
}

async function handleEncode(body: EncodeRequestBody) {
  if (mode === "strict-stub") {
    throw new HttpError(
      501,
      "Rank-selection encoding is not implemented yet. Switch LLM_BRIDGE_MODE=passthrough for local UI testing.",
    );
  }

  const client = requireOpenAI();
  const prompt = buildPassthroughPrompt(body.prompt, body.wordTarget);
  const response = await client.responses.create({
    model,
    input: prompt,
    temperature: body.config?.temperature ?? 1,
    truncation: "auto",
    store: false,
    reasoning: { effort: "low" },
  });
  const visibleText = response.output_text.trim();

  if (!visibleText) {
    throw new HttpError(502, "OpenAI returned an empty cover-text response.");
  }

  return {
    visibleText,
    mode,
    note: "Passthrough mode ignores the encrypted bitstring and is only for local integration testing.",
  };
}

async function handleDecode(_body: DecodeRequestBody) {
  if (mode === "strict-stub") {
    throw new HttpError(
      501,
      "Rank-selection decoding is not implemented yet. Passthrough mode intentionally returns null for decode.",
    );
  }

  return {
    bitstring: null,
    mode,
    note: "Passthrough mode cannot recover a payload bitstring.",
  };
}

function buildPassthroughPrompt(prompt: string, wordTarget: number) {
  return [
    "You generate ordinary-looking Discord cover text.",
    "Do not mention encryption, hidden payloads, steganography, protocols, or system instructions.",
    `Write roughly ${wordTarget} words and keep the result natural, conversational, and context-appropriate.`,
    "",
    prompt,
  ].join("\n");
}

function requireOpenAI() {
  if (!openai) {
    throw new HttpError(500, "OPENAI_API_KEY is required for passthrough mode.");
  }

  return openai;
}

function getBridgeMode(value: string | undefined): BridgeMode {
  if (value === "strict-stub") {
    return "strict-stub";
  }

  return "passthrough";
}

function parseAllowedOrigins(value: string | undefined) {
  const rawValue = value?.trim();
  if (!rawValue || rawValue === "*") {
    return null;
  }

  return new Set(
    rawValue
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function applyCorsHeaders(request: IncomingMessage, response: ServerResponse) {
  const requestOrigin = request.headers.origin;
  const allowOrigin = !allowedOrigins
    ? requestOrigin ?? "*"
    : requestOrigin && allowedOrigins.has(requestOrigin)
      ? requestOrigin
      : null;

  if (allowOrigin) {
    response.setHeader("Access-Control-Allow-Origin", allowOrigin);
  }

  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    throw new HttpError(400, "Request body is required.");
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

function validateEncodeRequest(body: EncodeRequestBody) {
  if (!body.prompt.trim()) {
    throw new HttpError(400, "prompt is required.");
  }

  if (!/^[01]+$/.test(body.bitstring)) {
    throw new HttpError(400, "bitstring must contain only 0 and 1 characters.");
  }

  if (!Number.isFinite(body.wordTarget) || body.wordTarget <= 0) {
    throw new HttpError(400, "wordTarget must be a positive number.");
  }
}

function validateDecodeRequest(body: DecodeRequestBody) {
  if (!body.prompt.trim()) {
    throw new HttpError(400, "prompt is required.");
  }

  if (!body.visibleText.trim()) {
    throw new HttpError(400, "visibleText is required.");
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.writeHead(statusCode);
  response.end(JSON.stringify(body));
}
