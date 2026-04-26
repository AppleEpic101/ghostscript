const MODEL_DEVICE_OVERRIDE = process.env.GHOSTSCRIPT_MODEL_DEVICE?.trim().toLowerCase() ?? "";

type SupportedDevice = "auto" | "gpu" | "cpu" | "webgpu" | "cuda" | "dml" | "coreml";

export interface ModelRuntimeDiagnostics {
  deviceOverride: string | null;
  candidateDevices: SupportedDevice[];
}

export function getModelRuntimeDiagnostics(): ModelRuntimeDiagnostics {
  return {
    deviceOverride: MODEL_DEVICE_OVERRIDE || null,
    candidateDevices: resolveCandidateDevices(),
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
