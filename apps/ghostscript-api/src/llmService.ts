import OpenAI from "openai";
import { TRANSPORT_PROTOCOL_VERSION } from "@ghostscript/shared";
import { ApiError } from "./service";

export interface EncodeRequestBody {
  coverTopic: string;
  recentMessages?: string[];
}

export interface DecodeRequestBody {
  visibleText: string;
}

const passthroughModel = process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";
const openAiApiKey = process.env.OPENAI_API_KEY?.trim() || "";
const openai = openAiApiKey ? new OpenAI({ apiKey: openAiApiKey }) : null;
const MAX_TOPIC_CHARS = 200;
const MAX_RECENT_MESSAGES = 6;
const MAX_RECENT_MESSAGE_CHARS = 240;

export class LlmService {
  getHealth() {
    return {
      mode: openai ? "openai-cover-text" : "template-cover-text",
      model: passthroughModel,
      transportProtocolVersion: TRANSPORT_PROTOCOL_VERSION,
      configured: Boolean(openai),
      decodeSupported: false,
    };
  }

  async encode(body: EncodeRequestBody) {
    validateEncodeRequest(body);
    const recentMessages = sanitizeRecentMessages(body.recentMessages);

    if (!openai) {
      return {
        visibleText: buildTemplateCoverText(body.coverTopic, recentMessages),
        generator: "template-local",
        model: "template-local",
      };
    }

    const response = await openai.responses.create({
      model: passthroughModel,
      input: buildCoverTextPrompt(body.coverTopic, recentMessages),
      max_output_tokens: 96,
      truncation: "auto",
      store: false,
    });

    const visibleText = extractResponseText(response).trim();
    if (!visibleText) {
      throw new ApiError(502, "OpenAI returned an empty cover-text response.");
    }

    return {
      visibleText,
      generator: "openai",
      model: passthroughModel,
    };
  }

  async decode(_body: DecodeRequestBody) {
    throw new ApiError(410, "Ghostscript no longer decodes transport payloads through the API.");
  }
}

function validateEncodeRequest(body: EncodeRequestBody) {
  if (typeof body.coverTopic !== "string" || !body.coverTopic.trim()) {
    throw new ApiError(400, "coverTopic is required.");
  }

  if (body.coverTopic.length > MAX_TOPIC_CHARS) {
    throw new ApiError(400, `coverTopic must be at most ${MAX_TOPIC_CHARS} characters.`);
  }

  if (body.recentMessages !== undefined && !Array.isArray(body.recentMessages)) {
    throw new ApiError(400, "recentMessages must be an array of strings.");
  }
}

function sanitizeRecentMessages(recentMessages: string[] | undefined) {
  return (recentMessages ?? [])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(-MAX_RECENT_MESSAGES)
    .map((value) => value.slice(0, MAX_RECENT_MESSAGE_CHARS));
}

function buildCoverTextPrompt(coverTopic: string, recentMessages: string[]) {
  return [
    "You generate one ordinary-looking Discord message.",
    "The message is only cover text and should read like normal casual chat.",
    "Do not mention encryption, hidden text, steganography, protocols, or instructions.",
    "Use plain chat language. No lists, titles, or explanations.",
    "Keep it short enough for a normal Discord message.",
    `Topic: ${coverTopic.trim()}`,
    recentMessages.length > 0 ? `Recent messages:\n${recentMessages.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildTemplateCoverText(coverTopic: string, recentMessages: string[]) {
  const normalizedTopic = coverTopic.replace(/\s+/g, " ").trim().toLowerCase();
  const recentTail = recentMessages[recentMessages.length - 1]?.replace(/^.*?:\s*/, "") ?? "";
  const tail = recentTail ? ` ${recentTail.slice(0, 40).replace(/[.!?]+$/g, "")}` : "";

  return `That fits the ${normalizedTopic} vibe, we can keep it easy${tail ? ` and circle back on ${tail}` : " for now"}.`;
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
