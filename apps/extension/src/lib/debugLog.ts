import { getGhostscriptApiBaseUrl } from "./apiBaseUrl";

export function logGhostscriptDebug(
  source: string,
  event: string,
  details: Record<string, unknown> = {},
) {
  const payload = {
    ts: new Date().toISOString(),
    source,
    event,
    details,
  };

  console.info(`[Ghostscript][${source}] ${event}`, details);

  if (typeof window === "undefined" || typeof fetch !== "function") {
    return;
  }

  let baseUrl = "";
  try {
    baseUrl = getGhostscriptApiBaseUrl();
  } catch {
    return;
  }

  void fetch(`${baseUrl}/debug-log`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }).catch(() => {
    // Best-effort logging only. The in-page console log remains available even if the bridge is down.
  });
}
