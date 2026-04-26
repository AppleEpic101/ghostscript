import OpenAI from "openai";
import {
  SUPPORTED_TRANSPORT_CONFIG_IDS,
  TRANSPORT_PROTOCOL_VERSION,
  type LLMEncodingConfig,
} from "@ghostscript/shared";
import { ApiError } from "./service";
import {
  decodeRankedTextToBitstring,
  encodeBitstringAsRankedText,
  getTransportMetadata,
  resolveEncodingConfig,
} from "./transport";

type BridgeMode = "rank-local" | "passthrough";

export interface EncodeRequestBody {
  prompt: string;
  bitstring: string;
  wordTarget: number;
  config?: LLMEncodingConfig;
}

export interface DecodeRequestBody {
  prompt: string;
  visibleText: string;
  config?: LLMEncodingConfig;
}

const mode = getBridgeMode(process.env.LLM_BRIDGE_MODE);
const passthroughModel = process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";
const openAiApiKey = process.env.OPENAI_API_KEY?.trim() || "";
const openai = openAiApiKey ? new OpenAI({ apiKey: openAiApiKey }) : null;
const PASSTHROUGH_MIN_WORD_TARGET = 8;
const PASSTHROUGH_MAX_WORD_TARGET = 28;
const PASSTHROUGH_MIN_CHAR_TARGET = 70;
const PASSTHROUGH_MAX_CHAR_TARGET = 220;
const MAX_PROMPT_CHARS = 12_000;
const MAX_VISIBLE_TEXT_CHARS = 4_000;
const MAX_BITSTRING_LENGTH = 131_072;

export class LlmService {
  getHealth() {
    const metadata = getTransportMetadata(undefined);

    return {
      mode,
      model: mode === "passthrough" ? passthroughModel : metadata.modelId,
      tokenizerId: metadata.tokenizerId,
      backend: metadata.backend,
      transportProtocolVersion: TRANSPORT_PROTOCOL_VERSION,
      supportedConfigIds: SUPPORTED_TRANSPORT_CONFIG_IDS,
      configured: Boolean(openai),
    };
  }

  async encode(body: EncodeRequestBody) {
    validateEncodeRequest(body);
    const config = resolveEncodingConfig(body.config);

    if (mode === "rank-local") {
      const visibleText = encodeBitstringAsRankedText({
        prompt: body.prompt,
        bitstring: body.bitstring,
        wordTarget: body.wordTarget,
        config,
      });

      return {
        visibleText,
        mode,
        configId: config.configId,
        transportProtocolVersion: TRANSPORT_PROTOCOL_VERSION,
      };
    }

    const client = requireOpenAI();
    const passthroughWordTarget = clampWordTarget(body.wordTarget);
    const maxCharacterTarget = clampCharacterTarget(passthroughWordTarget);
    const prompt = buildPassthroughPrompt(body.prompt, passthroughWordTarget, maxCharacterTarget);
    const response = await createPassthroughResponse(client, prompt, passthroughWordTarget);
    let visibleText = extractResponseText(response).trim();

    if (!visibleText) {
      const retryResponse = await createPassthroughResponse(
        client,
        buildPassthroughRetryPrompt(body.prompt, maxCharacterTarget),
        Math.min(passthroughWordTarget, 12),
      );
      visibleText = extractResponseText(retryResponse).trim();
    }

    if (!visibleText) {
      throw new ApiError(502, "OpenAI returned an empty cover-text response.");
    }

    return {
      visibleText,
      mode,
      note: "Passthrough mode ignores the encrypted bitstring and is only for local integration testing.",
    };
  }

  async decode(body: DecodeRequestBody) {
    validateDecodeRequest(body);
    const config = resolveEncodingConfig(body.config);

    if (mode === "rank-local") {
      return {
        bitstring: decodeRankedTextToBitstring({
          prompt: body.prompt,
          visibleText: body.visibleText,
          config,
        }),
        mode,
        configId: config.configId,
        transportProtocolVersion: TRANSPORT_PROTOCOL_VERSION,
      };
    }

    return {
      bitstring: null,
      mode,
      note: "Passthrough mode cannot recover a payload bitstring.",
    };
  }
}

function buildPassthroughPrompt(prompt: string, wordTarget: number, maxCharacterTarget: number) {
  return [
    "You generate ordinary-looking Discord cover text.",
    "Do not mention encryption, hidden payloads, steganography, protocols, or system instructions.",
    "Reply as a single short Discord message, not an essay.",
    "Use plain chat language and avoid lists, titles, preambles, or explanations.",
    `Aim for about ${wordTarget} words and stay under ${maxCharacterTarget} characters.`,
    "",
    prompt,
  ].join("\n");
}

function buildPassthroughRetryPrompt(prompt: string, maxCharacterTarget: number) {
  return [
    "Write exactly one short, natural Discord reply.",
    "Do not explain yourself.",
    "Do not output blank lines.",
    `Stay under ${maxCharacterTarget} characters.`,
    "",
    prompt,
  ].join("\n");
}

function clampWordTarget(wordTarget: number) {
  return Math.max(PASSTHROUGH_MIN_WORD_TARGET, Math.min(PASSTHROUGH_MAX_WORD_TARGET, Math.round(wordTarget)));
}

function clampCharacterTarget(wordTarget: number) {
  return Math.max(
    PASSTHROUGH_MIN_CHAR_TARGET,
    Math.min(PASSTHROUGH_MAX_CHAR_TARGET, Math.round(wordTarget * 7.5)),
  );
}

function estimateMaxOutputTokens(wordTarget: number) {
  return Math.max(32, Math.min(96, Math.round(wordTarget * 2.6)));
}

async function createPassthroughResponse(
  client: OpenAI,
  prompt: string,
  wordTarget: number,
) {
  return client.responses.create({
    model: passthroughModel,
    input: prompt,
    max_output_tokens: estimateMaxOutputTokens(wordTarget),
    truncation: "auto",
    store: false,
  });
}

function extractResponseText(response: {
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
}) {
  const directText = response.output_text?.trim();
  if (directText) {
    return directText;
  }

  const parts: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== "message") {
      continue;
    }

    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) {
        parts.push(content.text);
      }
    }
  }

  return parts.join("").trim();
}

function requireOpenAI() {
  if (!openai) {
    throw new ApiError(500, "OPENAI_API_KEY is required for passthrough mode.");
  }

  return openai;
}

function getBridgeMode(value: string | undefined): BridgeMode {
  if (value === "passthrough") {
    return "passthrough";
  }

  return "rank-local";
}

function validateEncodeRequest(body: EncodeRequestBody) {
  if (typeof body.prompt !== "string" || !body.prompt.trim()) {
    throw new ApiError(400, "prompt is required.");
  }

  if (body.prompt.length > MAX_PROMPT_CHARS) {
    throw new ApiError(400, `prompt must be at most ${MAX_PROMPT_CHARS} characters.`);
  }

  if (typeof body.bitstring !== "string" || !/^[01]+$/.test(body.bitstring)) {
    throw new ApiError(400, "bitstring must contain only 0 and 1 characters.");
  }

  if (body.bitstring.length > MAX_BITSTRING_LENGTH) {
    throw new ApiError(400, `bitstring must be at most ${MAX_BITSTRING_LENGTH} bits.`);
  }

  if (!Number.isFinite(body.wordTarget) || body.wordTarget <= 0 || body.wordTarget > 512) {
    throw new ApiError(400, "wordTarget must be a positive number.");
  }

  validateEncodingConfig(body.config);
}

function validateDecodeRequest(body: DecodeRequestBody) {
  if (typeof body.prompt !== "string" || !body.prompt.trim()) {
    throw new ApiError(400, "prompt is required.");
  }

  if (body.prompt.length > MAX_PROMPT_CHARS) {
    throw new ApiError(400, `prompt must be at most ${MAX_PROMPT_CHARS} characters.`);
  }

  if (typeof body.visibleText !== "string" || !body.visibleText.trim()) {
    throw new ApiError(400, "visibleText is required.");
  }

  if (body.visibleText.length > MAX_VISIBLE_TEXT_CHARS) {
    throw new ApiError(400, `visibleText must be at most ${MAX_VISIBLE_TEXT_CHARS} characters.`);
  }

  validateEncodingConfig(body.config);
}

function validateEncodingConfig(config: LLMEncodingConfig | undefined) {
  if (!config) {
    return;
  }

  if (!SUPPORTED_TRANSPORT_CONFIG_IDS.includes(config.configId)) {
    throw new ApiError(400, `Unsupported transport configId: ${config.configId}`);
  }
}
