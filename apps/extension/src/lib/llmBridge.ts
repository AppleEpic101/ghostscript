import { TRANSPORT_PROTOCOL_VERSION, type ConversationContextWindow, type GhostscriptThreadMessage } from "@ghostscript/shared";
import { getGhostscriptApiBaseUrl } from "./apiBaseUrl";
import { logGhostscriptDebug } from "./debugLog";

interface GenerateCoverTextRequest {
  coverTopic: string;
  recentMessages: string[];
}

interface GenerateCoverTextResponse {
  visibleText: string;
  generator: string;
  model: string;
}

export function buildCoverTextMessages(params: {
  messages?: GhostscriptThreadMessage[];
  contextWindow?: ConversationContextWindow;
}) {
  const contextWindow = params.contextWindow ?? {
    threadId: params.messages?.[0]?.threadId ?? "",
    messages: params.messages ?? [],
    truncated: false,
    maxMessages: 18,
    maxChars: 3200,
  };

  return contextWindow.messages
    .slice(-4)
    .map((message) => `${message.authorUsername}: ${message.text.replace(/\s+/g, " ").trim()}`)
    .filter(Boolean);
}

export async function generateCoverText(params: GenerateCoverTextRequest) {
  logGhostscriptDebug("llm-bridge", "cover-text-request-start", {
    coverTopic: params.coverTopic,
    recentMessageCount: params.recentMessages.length,
  });

  const response = await requestBridgeJson<GenerateCoverTextResponse>("/encode", params);
  const visibleText = response.visibleText.trim();

  logGhostscriptDebug("llm-bridge", "cover-text-request-complete", {
    coverTopic: params.coverTopic,
    visibleText,
    visibleTextLength: visibleText.length,
    generator: response.generator,
    model: response.model,
  });

  return {
    visibleText,
    generator: response.generator,
    model: response.model,
  };
}

export function getTransportProtocolVersion() {
  return TRANSPORT_PROTOCOL_VERSION;
}

async function requestBridgeJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  const baseUrl = getGhostscriptApiBaseUrl();

  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    logGhostscriptDebug("llm-bridge", "request-failed", {
      path,
      error: error instanceof Error ? error.message : "Unknown fetch failure.",
    });
    if (error instanceof TypeError) {
      throw new Error(
        `Unable to reach the Ghostscript API at ${baseUrl}. Confirm the configured endpoint is reachable and reload the extension if its URL changed.`,
      );
    }

    throw error;
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
