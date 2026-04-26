import {
  SUPPORTED_TRANSPORT_CONFIG_IDS,
  TRANSPORT_PROTOCOL_VERSION,
  type LLMEncodingConfig,
} from "@ghostscript/shared";
import { ApiError } from "./service";
import {
  decodeRankedTextToBitstringDetailed,
  encodeBitstringAsRankedTextDetailed,
  getTransportMetadata,
  resolveEncodingConfig,
} from "./transport";
import { getModelRuntimeDiagnostics } from "./runtimeDiagnostics";

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

const MAX_PROMPT_CHARS = 12_000;
const MAX_VISIBLE_TEXT_CHARS = 4_000;
const MAX_BITSTRING_LENGTH = 131_072;

export class LlmService {
  getHealth() {
    const metadata = getTransportMetadata(undefined);

    return {
      mode: metadata.mode,
      model: metadata.modelId,
      tokenizerId: metadata.tokenizerId,
      backend: metadata.backend,
      transportProtocolVersion: TRANSPORT_PROTOCOL_VERSION,
      supportedConfigIds: SUPPORTED_TRANSPORT_CONFIG_IDS,
      configured: getModelRuntimeDiagnostics().apiConfigured,
      runtime: getModelRuntimeDiagnostics(),
    };
  }

  async encode(body: EncodeRequestBody) {
    validateEncodeRequest(body);
    const config = resolveEncodingConfig(body.config);

    try {
      const result = await encodeBitstringAsRankedTextDetailed({
        prompt: body.prompt,
        bitstring: body.bitstring,
        wordTarget: body.wordTarget,
        config,
      });

      return {
        visibleText: result.visibleText,
        mode: "rank-openai" as const,
        configId: config.configId,
        transportProtocolVersion: TRANSPORT_PROTOCOL_VERSION,
        metrics: result.metrics,
      };
    } catch (error) {
      throw mapTransportError(error);
    }
  }

  async decode(body: DecodeRequestBody) {
    validateDecodeRequest(body);
    const config = resolveEncodingConfig(body.config);

    try {
      const result = await decodeRankedTextToBitstringDetailed({
        prompt: body.prompt,
        visibleText: body.visibleText,
        config,
      });

      return {
        bitstring: result.bitstring,
        mode: "rank-openai" as const,
        configId: config.configId,
        transportProtocolVersion: TRANSPORT_PROTOCOL_VERSION,
        metrics: result.metrics,
      };
    } catch (error) {
      throw mapTransportError(error);
    }
  }
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

function mapTransportError(error: unknown) {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof Error) {
    if (error.message.includes("OPENAI_API_KEY")) {
      return new ApiError(500, error.message);
    }

    if (
      error.message.includes("merge-safe candidate tokens") ||
      error.message.includes("tokenizer") ||
      error.message.includes("Unsupported Ghostscript transport")
    ) {
      return new ApiError(502, error.message);
    }

    if (
      error.message.includes("rate limit") ||
      error.message.includes("429") ||
      error.message.includes("timeout") ||
      error.message.includes("timed out")
    ) {
      return new ApiError(503, error.message);
    }
  }

  return new ApiError(500, error instanceof Error ? error.message : "Ghostscript transport request failed.");
}
