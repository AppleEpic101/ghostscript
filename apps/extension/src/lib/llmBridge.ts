import {
  DEFAULT_TRANSPORT_CONFIG_ID,
  SUPPORTED_TRANSPORT_CONFIG_IDS,
  TRANSPORT_PROTOCOL_VERSION,
  type GhostscriptThreadMessage,
  type LLMEncodingConfig,
  type SupportedTransportConfigId,
} from "@ghostscript/shared";
import { getGhostscriptApiBaseUrl } from "./apiBaseUrl";

const DEFAULT_ENCODING_CONFIG: LLMEncodingConfig = {
  configId: DEFAULT_TRANSPORT_CONFIG_ID,
  provider: "ghostscript-bridge",
  modelId: "ghostscript-rank-lm-v1",
  tokenizerId: "ghostscript-word-tokenizer-v1",
  transportBackend: "rank-local-v1",
  temperature: 1,
  pMin: 0.001,
  bitsPerStep: 3,
  excludedTokenSet: ["<|endoftext|>", "<s>", "</s>"],
  fallbackStrategy: "reduce-bits",
  tieBreakRule: "token-id-ascending",
  payloadTerminationStrategy: "length-header",
  contextTruncationStrategy: "tail",
  maxContextTokens: 512,
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
  config: LLMEncodingConfig;
}

export function getDefaultEncodingConfig() {
  return DEFAULT_ENCODING_CONFIG;
}

export function getSupportedEncodingConfigs() {
  return SUPPORTED_TRANSPORT_CONFIG_IDS.map((configId) => getEncodingConfigById(configId));
}

export async function encodeBitstringAsCoverText(params: EncodeRequest) {
  const response = await requestBridgeJson<EncodeResponse>("/encode", params);
  return response.visibleText.trim();
}

export async function decodeCoverTextToBitstring(params: DecodeVisibleTextParams) {
  const response = await requestBridgeJson<DecodeResponse>("/decode", {
    visibleText: params.visibleText,
    prompt: params.prompt,
    config: params.config,
  });

  return response.bitstring;
}

export function buildConversationPrompt(params: {
  coverTopic: string;
  messages: GhostscriptThreadMessage[];
}) {
  const orderedLines = params.messages.map(
    (message) => `${message.authorUsername}: ${message.text.replace(/\s+/g, " ").trim()}`,
  );

  return [
    `Cover text topic: ${params.coverTopic}`,
    "Use the paired Discord chat history below to stay on-topic.",
    "",
    orderedLines.join("\n"),
  ]
    .filter(Boolean)
    .join("\n");
}

export async function fingerprintTransportPrompt(prompt: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(prompt));
  return Array.from(new Uint8Array(digest).slice(0, 12), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function getTransportProtocolVersion() {
  return TRANSPORT_PROTOCOL_VERSION;
}

function getEncodingConfigById(configId: SupportedTransportConfigId) {
  switch (configId) {
    case DEFAULT_TRANSPORT_CONFIG_ID:
      return DEFAULT_ENCODING_CONFIG;
  }

  throw new Error(`Unsupported Ghostscript transport config: ${configId}`);
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
    if (error instanceof TypeError) {
      throw new Error(
        `Unable to reach the Ghostscript API at ${baseUrl}. Confirm the configured endpoint is reachable and reload the extension if its URL changed.`,
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
