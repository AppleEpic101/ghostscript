import type { GhostscriptThreadMessage, LLMEncodingConfig } from "@ghostscript/shared";

const DEFAULT_LLM_BRIDGE_BASE_URL = "http://localhost:8788";
const DEFAULT_ENCODING_CONFIG: LLMEncodingConfig = {
  configId: "ghostscript-default-v1",
  provider: "ghostscript-bridge",
  modelId: import.meta.env.VITE_GHOSTSCRIPT_LLM_MODEL?.trim() || "ghostscript-pinned-model",
  tokenizerId: import.meta.env.VITE_GHOSTSCRIPT_LLM_TOKENIZER?.trim() || "ghostscript-pinned-tokenizer",
  temperature: 1,
  pMin: 0.001,
  bitsPerStep: Number.parseInt(import.meta.env.VITE_GHOSTSCRIPT_BITS_PER_STEP ?? "3", 10),
  excludedTokenSet: ["<|endoftext|>", "<s>", "</s>"],
  fallbackStrategy: "reduce-bits",
  tieBreakRule: "token-id-ascending",
  payloadTerminationStrategy: "length-header",
};

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
}

export function getDefaultEncodingConfig() {
  return DEFAULT_ENCODING_CONFIG;
}

export async function encodeBitstringAsCoverText(params: EncodeRequest) {
  const response = await requestBridgeJson<EncodeResponse>("/encode", params);
  return response.visibleText.trim();
}

export async function decodeCoverTextToBitstring(params: DecodeVisibleTextParams) {
  const response = await requestBridgeJson<DecodeResponse>("/decode", {
    visibleText: params.visibleText,
    prompt: params.prompt,
    config: DEFAULT_ENCODING_CONFIG,
  });

  return response.bitstring;
}

export function buildConversationPrompt(params: {
  coverTopic: string;
  wordTarget: number;
  messages: GhostscriptThreadMessage[];
}) {
  const orderedLines = params.messages.map(
    (message) => `${message.authorUsername}: ${message.text.replace(/\s+/g, " ").trim()}`,
  );

  return [
    `Cover text topic: ${params.coverTopic}`,
    `Respond to this message in about ${params.wordTarget} words.`,
    "Use the chat history below between the paired Discord usernames to stay on-topic.",
    "",
    orderedLines.join("\n"),
  ]
    .filter(Boolean)
    .join("\n");
}

function getBridgeBaseUrl() {
  return import.meta.env.VITE_GHOSTSCRIPT_LLM_BASE_URL?.trim().replace(/\/$/, "") ?? DEFAULT_LLM_BRIDGE_BASE_URL;
}

async function requestBridgeJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${getBridgeBaseUrl()}${path}`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        `Unable to reach the Ghostscript LLM bridge at ${getBridgeBaseUrl()}. Confirm the service is running and the extension env vars are correct.`,
      );
    }

    throw error;
  }

  const payload = (await response.json().catch(() => null)) as { error?: string } | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Ghostscript LLM bridge request failed.");
  }

  return payload as T;
}

function buildHeaders() {
  const apiKey = import.meta.env.VITE_GHOSTSCRIPT_LLM_API_KEY?.trim();

  return {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}
