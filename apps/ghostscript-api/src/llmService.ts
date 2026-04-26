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
  const topic = coverTopic.trim();
  return [
    "You generate one ordinary-looking Discord message.",
    "The message is only cover text and should read like a real casual DM between two people who already know each other.",
    "Do not mention encryption, hidden text, steganography, protocols, or instructions.",
    "Use plain chat language. No lists, titles, summaries, or explanations.",
    "Sound natural, specific, and a little varied instead of generic or assistant-like.",
    "Match the rhythm of an ongoing conversation: react to the recent messages, add a detail, opinion, question, or small pivot.",
    "It is okay to drift naturally into a nearby topic if that feels human, as long as the message still makes sense as a reply in the same chat.",
    "Avoid cliches like 'sounds good', 'for now', 'vibe', 'circle back', or anything that reads templated.",
    "Keep it to one or two sentences and under 30 words unless the recent chat clearly runs longer.",
    `Loose topic to draw from: ${topic}`,
    recentMessages.length > 0
      ? `Recent chat history:\n${recentMessages.join("\n")}\n\nWrite the next single message in that conversation.`
      : "Write the first casual message in that conversation, sounding like a real person rather than a generic placeholder.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildTemplateCoverText(coverTopic: string, recentMessages: string[]) {
  const normalizedTopic = normalizeTopic(coverTopic);
  const recentTail = recentMessages[recentMessages.length - 1]?.replace(/^.*?:\s*/, "").trim() ?? "";
  const priorTail = recentMessages[recentMessages.length - 2]?.replace(/^.*?:\s*/, "").trim() ?? "";
  const recentHook = pickRecentHook(recentTail, priorTail);
  const pivot = pickTopicPivot(normalizedTopic);
  const closer = pickCloser(recentTail);

  return [recentHook, pivot, closer].filter(Boolean).join(" ");
}

function normalizeTopic(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function pickRecentHook(recentTail: string, priorTail: string) {
  const seed = (recentTail || priorTail).replace(/[.!?]+$/g, "");
  if (!seed) {
    return "I keep thinking about that for some reason.";
  }

  const compact = truncateAtWordBoundary(seed, 52);
  const lower = compact.charAt(0).toLowerCase() + compact.slice(1);

  return [
    `Honestly ${lower} kind of sent me.`,
    `Wait, ${lower} is still stuck in my head.`,
    `Okay but ${lower} is weirdly making more sense now.`,
  ][hashString(seed) % 3];
}

function pickTopicPivot(topic: string) {
  const pivots = [
    `It also made me think about ${topic} again.`,
    `Now I kind of want to veer into ${topic} for a second.`,
    `Which somehow loops back to ${topic}.`,
    `Anyway that pulls me back to ${topic}.`,
  ];

  return pivots[hashString(topic) % pivots.length];
}

function pickCloser(recentTail: string) {
  const options = recentTail.endsWith("?")
    ? [
      "I feel like that would make the whole thing more fun.",
      "That would probably make the conversation way less boring.",
      "I could actually see that turning into a whole tangent.",
    ]
    : [
      "Now I'm curious where you'd take that next.",
      "It feels like that could spiral into a much better side topic.",
      "That kind of makes me want the next part of the story.",
    ];

  return options[hashString(recentTail || options[0]) % options.length];
}

function truncateAtWordBoundary(value: string, limit: number) {
  if (value.length <= limit) {
    return value;
  }

  const truncated = value.slice(0, limit).trimEnd();
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 16 ? truncated.slice(0, lastSpace) : truncated).trimEnd();
}

function hashString(value: string) {
  let hash = 0;

  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash;
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
