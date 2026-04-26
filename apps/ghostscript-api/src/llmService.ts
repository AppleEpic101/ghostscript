import OpenAI from "openai";
import type { LLMEncodingConfig } from "@ghostscript/shared";
import { ApiError } from "./service";

type BridgeMode = "passthrough" | "strict-stub";

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
const model = process.env.OPENAI_MODEL?.trim() || "gpt-5.4-mini";
const openAiApiKey = process.env.OPENAI_API_KEY?.trim() || "";
const openai = openAiApiKey ? new OpenAI({ apiKey: openAiApiKey }) : null;

export class LlmService {
  getHealth() {
    return {
      mode,
      model,
      configured: Boolean(openai),
    };
  }

  async encode(body: EncodeRequestBody) {
    validateEncodeRequest(body);

    if (mode === "strict-stub") {
      throw new ApiError(
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

    if (mode === "strict-stub") {
      throw new ApiError(
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
    throw new ApiError(500, "OPENAI_API_KEY is required for passthrough mode.");
  }

  return openai;
}

function getBridgeMode(value: string | undefined): BridgeMode {
  if (value === "strict-stub") {
    return "strict-stub";
  }

  return "passthrough";
}

function validateEncodeRequest(body: EncodeRequestBody) {
  if (!body.prompt.trim()) {
    throw new ApiError(400, "prompt is required.");
  }

  if (!/^[01]+$/.test(body.bitstring)) {
    throw new ApiError(400, "bitstring must contain only 0 and 1 characters.");
  }

  if (!Number.isFinite(body.wordTarget) || body.wordTarget <= 0) {
    throw new ApiError(400, "wordTarget must be a positive number.");
  }
}

function validateDecodeRequest(body: DecodeRequestBody) {
  if (!body.prompt.trim()) {
    throw new ApiError(400, "prompt is required.");
  }

  if (!body.visibleText.trim()) {
    throw new ApiError(400, "visibleText is required.");
  }
}
