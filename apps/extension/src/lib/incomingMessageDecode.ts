import type {
  ConversationContextWindow,
  LLMEncodingConfig,
} from "@ghostscript/shared";
import type { SupportedTransportConfigId } from "@ghostscript/shared";
import { type DecodeVisibleTextParams } from "./llmBridge";
import { buildDecoderPrompt } from "./promptBuilder";

export type IncomingMessageDecodeResult =
  {
    status: "decoded";
    plaintext: string;
    promptFingerprint: string;
    configId: SupportedTransportConfigId;
  };

export async function attemptIncomingMessageDecode(params: {
  visibleText: string;
  coverTopic: string;
  historyWindows: ConversationContextWindow[];
  encodingConfigs: readonly LLMEncodingConfig[];
  decodeBitstring: (params: DecodeVisibleTextParams) => Promise<string | null>;
  decodePlaintext: (bitstring: string) => string;
  fingerprintPrompt: (prompt: string) => Promise<string>;
  onAttempt?: (event: {
    outcome: "decoded" | "invalid-payload" | "no-bitstring" | "bridge-error";
    configId: SupportedTransportConfigId;
    historyWindowSize: number;
    error?: string;
  }) => void;
}) {
  for (const historyWindow of params.historyWindows) {
    const prompt = buildDecoderPrompt({
      coverTopic: params.coverTopic,
      contextWindow: historyWindow,
    });
    const promptFingerprint = await params.fingerprintPrompt(prompt);

    for (const encodingConfig of params.encodingConfigs) {
      let bitstring: string | null = null;
      try {
        bitstring = await params.decodeBitstring({
          visibleText: params.visibleText,
          prompt,
          config: encodingConfig,
        });
      } catch (error) {
        params.onAttempt?.({
          outcome: "bridge-error",
          configId: encodingConfig.configId,
          historyWindowSize: historyWindow.messages.length,
          error: error instanceof Error ? error.message : "Unknown decode bridge error.",
        });
        continue;
      }

      if (!bitstring) {
        params.onAttempt?.({
          outcome: "no-bitstring",
          configId: encodingConfig.configId,
          historyWindowSize: historyWindow.messages.length,
        });
        continue;
      }

      try {
        const plaintext = params.decodePlaintext(bitstring);
        params.onAttempt?.({
          outcome: "decoded",
          configId: encodingConfig.configId,
          historyWindowSize: historyWindow.messages.length,
        });
        return {
          status: "decoded" as const,
          plaintext,
          promptFingerprint,
          configId: encodingConfig.configId,
        };
      } catch (error) {
        params.onAttempt?.({
          outcome: "invalid-payload",
          configId: encodingConfig.configId,
          historyWindowSize: historyWindow.messages.length,
          error: error instanceof Error ? error.message : "Unknown plaintext decode failure.",
        });
        continue;
      }
    }
  }

  return null;
}
