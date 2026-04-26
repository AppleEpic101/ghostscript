import {
  DEFAULT_TRANSPORT_CONFIG_ID,
  SUPPORTED_TRANSPORT_CONFIG_IDS,
  TRANSPORT_PROTOCOL_VERSION,
  type ConversationContextWindow,
  type GhostscriptThreadMessage,
  type LLMEncodingConfig,
  type SupportedTransportConfigId,
} from "@ghostscript/shared";
import { getGhostscriptApiBaseUrl } from "./apiBaseUrl";
import { logGhostscriptDebug } from "./debugLog";
import { buildConversationPrompt as buildCanonicalConversationPrompt } from "./promptBuilder";

const DEFAULT_ENCODING_CONFIG: LLMEncodingConfig = {
  configId: DEFAULT_TRANSPORT_CONFIG_ID,
  provider: "ghostscript-bridge",
  modelId: "xenova-distilgpt2-v1",
  tokenizerId: "gpt2-tokenizer-v1",
  transportBackend: "local-gpt2-top4-v1",
  bitsPerStep: 2,
  excludedTokenSet: ["<|endoftext|>", "<s>", "</s>"],
  fallbackStrategy: "reduce-bits",
  tieBreakRule: "token-id-ascending",
  payloadTerminationStrategy: "length-header",
  contextTruncationStrategy: "tail",
  maxContextTokens: 512,
};
const BRIDGE_REQUEST_TIMEOUT_MS = 180_000;

interface EncodeRequest {
  prompt: string;
  bitstring: string;
  wordTarget: number;
  config: LLMEncodingConfig;
}

interface EncodeResponse {
  visibleText: string;
}

interface DecodeResponse {
  bitstring: string | null;
}

export interface DecodeVisibleTextParams {
  visibleText: string;
  prompt: string;
  config: LLMEncodingConfig;
}

export function getDefaultEncodingConfig() {
  return DEFAULT_ENCODING_CONFIG;
}

export function getSupportedEncodingConfigs() {
  return SUPPORTED_TRANSPORT_CONFIG_IDS.map((configId) => getEncodingConfigById(configId));
}

export function buildConversationPrompt(params: {
  coverTopic: string;
  messages?: GhostscriptThreadMessage[];
  contextWindow?: ConversationContextWindow;
  wordTarget?: number;
  replyTurn?: string;
}) {
  const contextWindow = params.contextWindow ?? {
    threadId: params.messages?.[0]?.threadId ?? "",
    messages: params.messages ?? [],
    truncated: false,
    maxMessages: 18,
    maxChars: 3200,
  };

  return buildCanonicalConversationPrompt({
    coverTopic: params.coverTopic,
    contextWindow,
    wordTarget: params.wordTarget ?? 16,
    replyTurn: params.replyTurn ?? "",
  });
}

export async function encodeBitstringAsCoverText(params: EncodeRequest) {
  logGhostscriptDebug("llm-bridge", "encode-request-start", {
    configId: params.config.configId,
    prompt: params.prompt,
    promptLength: params.prompt.length,
    bitstringLength: params.bitstring.length,
    wordTarget: params.wordTarget,
  });
  const response = await requestBridgeJson<EncodeResponse>("/encode", params);
  logGhostscriptDebug("llm-bridge", "encode-request-complete", {
    configId: params.config.configId,
    visibleText: response.visibleText,
    visibleTextLength: response.visibleText.length,
  });
  return response.visibleText.trim();
}

export async function decodeCoverTextToBitstring(params: DecodeVisibleTextParams) {
  logGhostscriptDebug("llm-bridge", "decode-request-start", {
    configId: params.config.configId,
    prompt: params.prompt,
    promptLength: params.prompt.length,
    visibleText: params.visibleText,
    visibleTextLength: params.visibleText.length,
  });
  const response = await requestBridgeJson<DecodeResponse>("/decode", {
    visibleText: params.visibleText,
    prompt: params.prompt,
    config: params.config,
  });

  logGhostscriptDebug("llm-bridge", "decode-request-complete", {
    configId: params.config.configId,
    bitstringLength: response.bitstring?.length ?? 0,
    recoveredBitstring: response.bitstring,
  });

  return response.bitstring;
}

export async function fingerprintTransportPrompt(prompt: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(prompt));
  return Array.from(new Uint8Array(digest).slice(0, 12), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function getTransportProtocolVersion() {
  return TRANSPORT_PROTOCOL_VERSION;
}

export function __internal_getBridgeTimeoutMessage(path: string, timeoutMs: number) {
  const seconds = Math.round(timeoutMs / 1000);
  if (path === "/encode") {
    return `Ghostscript timed out while generating cover text after ${seconds} seconds. The local model may have stalled or the API may have crashed.`;
  }

  return `Ghostscript API request to ${path} timed out after ${seconds} seconds. The local model may have stalled or the API may have crashed.`;
}

export function __internal_getBridgeUnreachableMessage(baseUrl: string) {
  return `Unable to reach the Ghostscript API at ${baseUrl}. Confirm the configured endpoint is reachable, then reload the extension if its URL changed or the API just restarted.`;
}

function getEncodingConfigById(configId: SupportedTransportConfigId) {
  switch (configId) {
    case DEFAULT_TRANSPORT_CONFIG_ID:
      return DEFAULT_ENCODING_CONFIG;
  }

  throw new Error(`Unsupported Ghostscript transport config: ${configId}`);
}

export async function __internal_requestBridgeJson<T>(
  baseUrl: string,
  path: string,
  body: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  let response: Response;
  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort();
  }, BRIDGE_REQUEST_TIMEOUT_MS);

  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: abortController.signal,
    });
  } catch (error) {
    logGhostscriptDebug("llm-bridge", "request-failed", {
      path,
      error: error instanceof Error ? error.message : "Unknown fetch failure.",
    });
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(__internal_getBridgeTimeoutMessage(path, BRIDGE_REQUEST_TIMEOUT_MS));
    }

    if (error instanceof TypeError) {
      throw new Error(__internal_getBridgeUnreachableMessage(baseUrl));
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const payload = (await response.json().catch(() => null)) as { error?: string } | null;

  if (!response.ok) {
    logGhostscriptDebug("llm-bridge", "request-rejected", {
      path,
      status: response.status,
      error: payload?.error ?? "Ghostscript LLM bridge request failed.",
    });
    throw new Error(payload?.error ?? "Ghostscript LLM bridge request failed.");
  }

  return payload as T;
}

async function requestBridgeJson<T>(path: string, body: unknown): Promise<T> {
  return __internal_requestBridgeJson(getGhostscriptApiBaseUrl(), path, body);
}
