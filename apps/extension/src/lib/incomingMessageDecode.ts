import type {
  GhostscriptThreadMessage,
  LLMEncodingConfig,
  SupportedTransportConfigId,
} from "@ghostscript/shared";
import { deserializeEnvelopeFromBitstring } from "./bitstream";
import type { SessionCryptoMaterial } from "./crypto";
import { buildConversationPrompt, type DecodeVisibleTextParams } from "./llmBridge";

export type IncomingMessageDecodeResult =
  | {
      status: "decoded";
      plaintext: string;
      promptFingerprint: string;
      configId: SupportedTransportConfigId;
    }
  | {
      status: "tampered";
      plaintext: null;
      promptFingerprint: string;
      configId: SupportedTransportConfigId;
    };

export async function attemptIncomingMessageDecode(params: {
  visibleText: string;
  coverTopic: string;
  historyWindows: GhostscriptThreadMessage[][];
  material: SessionCryptoMaterial;
  encodingConfigs: readonly LLMEncodingConfig[];
  defaultConfigId: SupportedTransportConfigId;
  decodeBitstring: (params: DecodeVisibleTextParams) => Promise<string | null>;
  decryptEnvelope: (envelope: ReturnType<typeof deserializeEnvelopeFromBitstring>, material: SessionCryptoMaterial) => Promise<string>;
  fingerprintPrompt: (prompt: string) => Promise<string>;
}) {
  let tamperedPromptFingerprint: string | null = null;
  let tamperedConfigId: SupportedTransportConfigId = params.defaultConfigId;

  for (const historyWindow of params.historyWindows) {
    const prompt = buildConversationPrompt({
      coverTopic: params.coverTopic,
      messages: historyWindow,
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
      } catch {
        continue;
      }

      if (!bitstring) {
        continue;
      }

      try {
        const envelope = deserializeEnvelopeFromBitstring(bitstring);
        const plaintext = await params.decryptEnvelope(envelope, params.material);
        return {
          status: "decoded" as const,
          plaintext,
          promptFingerprint,
          configId: encodingConfig.configId,
        };
      } catch {
        try {
          deserializeEnvelopeFromBitstring(bitstring);
          tamperedPromptFingerprint ??= promptFingerprint;
          tamperedConfigId = encodingConfig.configId;
        } catch {
          continue;
        }
      }
    }
  }

  if (!tamperedPromptFingerprint) {
    return null;
  }

  return {
    status: "tampered" as const,
    plaintext: null,
    promptFingerprint: tamperedPromptFingerprint,
    configId: tamperedConfigId,
  };
}
