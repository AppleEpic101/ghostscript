import type { ConversationContextWindow, GhostscriptThreadMessage } from "@ghostscript/shared";

export interface PromptBuilderParams {
  coverTopic: string;
  contextWindow: ConversationContextWindow;
  wordTarget: number;
  replyTurn: string;
}

export function buildConversationPrompt(params: PromptBuilderParams) {
  const orderedLines = params.contextWindow.messages.map(
    (message) => `${message.authorUsername}: ${message.text.replace(/\s+/g, " ").trim()}`,
  );

  return [
    `Cover text topic: ${params.coverTopic}`,
    "Reply in approximately the usual Ghostscript message length.",
    "Use only the paired Discord chat history below to stay on-topic.",
    "",
    "Paired Discord chat history:",
    orderedLines.join("\n") || "(no prior paired messages)",
    "",
    "Next Discord message:",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildDecoderPrompt(params: {
  coverTopic: string;
  contextWindow: ConversationContextWindow;
}) {
  return buildConversationPrompt({
    coverTopic: params.coverTopic,
    contextWindow: params.contextWindow,
    wordTarget: estimateWordTargetForContext(params.contextWindow.messages),
    replyTurn: "<decode-current-message>",
  });
}

export function estimateWordTarget(payloadBitLength: number, bitsPerToken: number) {
  const estimatedTokens = Math.max(12, Math.ceil(payloadBitLength / Math.max(bitsPerToken, 1)));
  return Math.max(10, Math.ceil(estimatedTokens * 0.7));
}

function estimateWordTargetForContext(messages: GhostscriptThreadMessage[]) {
  const averageMessageLength =
    messages.length === 0
      ? 18
      : Math.max(
          10,
          Math.round(
            messages.reduce((total, message) => total + message.text.split(/\s+/).filter(Boolean).length, 0) /
              messages.length,
          ),
        );

  return averageMessageLength;
}
