import { AutoModelForCausalLM, AutoTokenizer } from "@huggingface/transformers";
import { resolveCandidateDevices } from "./runtimeDiagnostics";

type SupportedDevice = "auto" | "gpu" | "cpu" | "webgpu" | "cuda" | "dml" | "coreml";

interface LoadedCausalLmContext {
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
  model: Awaited<ReturnType<typeof AutoModelForCausalLM.from_pretrained>>;
  device: SupportedDevice;
}

export async function loadCausalLmContext(modelId: string): Promise<LoadedCausalLmContext> {
  const tokenizer = await AutoTokenizer.from_pretrained(modelId);
  const candidateDevices = resolveCandidateDevices();
  const failures: string[] = [];

  for (const device of candidateDevices) {
    try {
      const modelOptions = getModelLoadOptions(device);
      const model = await AutoModelForCausalLM.from_pretrained(modelId, { device, ...modelOptions });
      const fileLabel = modelOptions.model_file_name ? ` (${modelOptions.model_file_name})` : "";
      console.info(`[ghostscript] Loaded ${modelId} using device "${device}"${fileLabel}.`);

      return {
        tokenizer,
        model,
        device,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${device}: ${message}`);
      console.warn(`[ghostscript] Unable to load ${modelId} using device "${device}": ${message}`);
    }
  }

  throw new Error(
    `Failed to load ${modelId} on any supported device. Attempts: ${failures.join(" | ") || "none"}.`,
  );
}
function getModelLoadOptions(device: SupportedDevice) {
  if (device === "coreml") {
    // CoreML fails on Xenova/distilgpt2's merged decoder because the merged graph expects
    // zero-length past_key_values tensors during the first pass. The plain decoder_model
    // avoids that cache-prefill path and runs correctly on Apple Silicon.
    return {
      model_file_name: "decoder_model",
    } as const;
  }

  return {};
}
