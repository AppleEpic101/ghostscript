import type { EncodedGhostscriptMessage, GhostscriptThreadMessage } from "@ghostscript/shared";
import type { GhostscriptConversationState } from "./ghostscriptState";

export function filterPromptMessages(
  messages: GhostscriptThreadMessage[],
  conversation: Pick<GhostscriptConversationState, "confirmedEncodedMessages" | "decodedMessages" | "pendingSend">,
) {
  const knownCoverTexts = collectKnownCoverTexts(conversation);

  if (knownCoverTexts.size === 0) {
    return messages;
  }

  return messages.filter((message) => !knownCoverTexts.has(normalizeMessageText(message.text)));
}

export function countFilteredPromptMessages(
  messages: GhostscriptThreadMessage[],
  conversation: Pick<GhostscriptConversationState, "confirmedEncodedMessages" | "decodedMessages" | "pendingSend">,
) {
  return messages.length - filterPromptMessages(messages, conversation).length;
}

export function collectKnownCoverTexts(
  conversation: Pick<GhostscriptConversationState, "confirmedEncodedMessages" | "decodedMessages" | "pendingSend">,
) {
  const texts = new Set<string>();

  for (const message of conversation.confirmedEncodedMessages ?? []) {
    addEncodedVisibleText(texts, message);
  }

  for (const decodedMessage of Object.values(conversation.decodedMessages ?? {})) {
    if (decodedMessage.visibleText) {
      texts.add(normalizeMessageText(decodedMessage.visibleText));
    }
    addEncodedVisibleText(texts, decodedMessage.encodedMessage ?? null);
  }

  if (conversation.pendingSend?.expectedCoverText) {
    texts.add(normalizeMessageText(conversation.pendingSend.expectedCoverText));
  }

  return texts;
}

function addEncodedVisibleText(store: Set<string>, message: EncodedGhostscriptMessage | null) {
  if (message?.visibleText) {
    store.add(normalizeMessageText(message.visibleText));
  }
  if (message?.submittedText) {
    store.add(normalizeMessageText(message.submittedText));
  }
}

function normalizeMessageText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
