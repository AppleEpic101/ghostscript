const DEFAULT_MODEL_ID = process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim() || "";
const MODEL_DEVICE_OVERRIDE = process.env.GHOSTSCRIPT_MODEL_DEVICE?.trim().toLowerCase() ?? "";

type SupportedDevice = "auto" | "gpu" | "cpu" | "webgpu" | "cuda" | "dml" | "coreml";

export interface ModelRuntimeDiagnostics {
  apiConfigured: boolean;
  modelId: string;
  tokenizerId: string;
  provider: "openai";
}

export function getModelRuntimeDiagnostics(): ModelRuntimeDiagnostics {
  return {
    apiConfigured: OPENAI_API_KEY.length > 0,
    modelId: DEFAULT_MODEL_ID,
    tokenizerId: "o200k_base-v1",
    provider: "openai",
  };
}

export function resolveCandidateDevices(): SupportedDevice[] {
  const override = normalizeDeviceAlias(MODEL_DEVICE_OVERRIDE);
  if (override) {
    return dedupeDevices([override, ...getPlatformPreferredDevices()]);
  }

  return getPlatformPreferredDevices();
}

function getPlatformPreferredDevices(): SupportedDevice[] {
  switch (process.platform) {
    case "darwin":
      return ["cpu", "coreml", "webgpu"];
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
