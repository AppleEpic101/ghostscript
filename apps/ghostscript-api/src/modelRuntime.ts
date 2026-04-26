import { AutoModelForCausalLM, AutoTokenizer } from "@huggingface/transformers";

const MODEL_DEVICE_OVERRIDE = process.env.GHOSTSCRIPT_MODEL_DEVICE?.trim().toLowerCase() ?? "";

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
      const model = await AutoModelForCausalLM.from_pretrained(modelId, { device });
      console.info(`[ghostscript] Loaded ${modelId} using device "${device}".`);

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

function resolveCandidateDevices(): SupportedDevice[] {
  const override = normalizeDeviceAlias(MODEL_DEVICE_OVERRIDE);
  if (override) {
    return dedupeDevices([override, ...getPlatformPreferredDevices()]);
  }

  return getPlatformPreferredDevices();
}

function getPlatformPreferredDevices(): SupportedDevice[] {
  switch (process.platform) {
    case "darwin":
      // Transformers.js/ONNX Runtime Node uses CoreML on macOS rather than PyTorch's MPS backend.
      return ["coreml", "webgpu", "cpu"];
    case "win32":
      return ["dml", "webgpu", "cpu"];
    case "linux":
      return process.arch === "x64" ? ["cuda", "webgpu", "cpu"] : ["webgpu", "cpu"];
    default:
      return ["cpu"];
  }
}

function normalizeDeviceAlias(value: string): SupportedDevice | null {
  switch (value) {
    case "":
      return null;
    case "mps":
      return "coreml";
    case "auto":
    case "gpu":
    case "cpu":
    case "webgpu":
    case "cuda":
    case "dml":
    case "coreml":
      return value;
    default:
      console.warn(
        `[ghostscript] Ignoring unsupported GHOSTSCRIPT_MODEL_DEVICE="${value}". Falling back to platform detection.`,
      );
      return null;
  }
}

function dedupeDevices(devices: SupportedDevice[]) {
  return Array.from(new Set(devices));
}
