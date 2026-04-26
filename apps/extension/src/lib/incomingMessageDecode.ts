import { deserializeEnvelopeFromBitstring } from "./bitstream";
import { decompressBitstringFromTransport } from "./bitCompression";
import type { SessionCryptoMaterial } from "./crypto";
import { extractInvisiblePayload } from "./invisibleTransport";

export type IncomingMessageDecodeResult =
  | {
      status: "decoded";
      plaintext: string;
      visibleText: string;
    }
  | {
      status: "tampered";
      plaintext: null;
      visibleText: string;
    };

export async function attemptIncomingMessageDecode(params: {
  messageText: string;
  material: SessionCryptoMaterial;
  decryptEnvelope: (envelope: ReturnType<typeof deserializeEnvelopeFromBitstring>, material: SessionCryptoMaterial) => Promise<string>;
}) {
  const extracted = extractInvisiblePayload(params.messageText);
  if (!extracted) {
    return null;
  }

  try {
    const envelope = deserializeEnvelopeFromBitstring(await decompressBitstringFromTransport(extracted.bitstring));
    const plaintext = await params.decryptEnvelope(envelope, params.material);

    return {
      status: "decoded" as const,
      plaintext,
      visibleText: extracted.visibleText,
    };
  } catch {
    return {
      status: "tampered" as const,
      plaintext: null,
      visibleText: extracted.visibleText,
    };
  }
}
