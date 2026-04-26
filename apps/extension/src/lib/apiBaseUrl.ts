const LOCAL_DEV_GHOSTSCRIPT_API_BASE_URL = "http://localhost:8787";

export function getGhostscriptApiBaseUrl() {
  const configuredBaseUrl = import.meta.env.VITE_GHOSTSCRIPT_API_BASE_URL?.trim();
  const resolvedBaseUrl = configuredBaseUrl || (import.meta.env.DEV ? LOCAL_DEV_GHOSTSCRIPT_API_BASE_URL : "");

  if (!resolvedBaseUrl) {
    throw new Error(
      "Ghostscript API base URL is not configured. Set VITE_GHOSTSCRIPT_API_BASE_URL before building the extension.",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(resolvedBaseUrl);
  } catch {
    throw new Error(`Ghostscript API base URL is invalid: ${resolvedBaseUrl}`);
  }

  return parsedUrl.toString().replace(/\/$/, "");
}
