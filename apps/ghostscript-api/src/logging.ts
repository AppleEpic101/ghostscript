export function logTerminalEvent(source: string, event: string, details: Record<string, unknown>) {
  console.log(
    "[Ghostscript Terminal]",
    JSON.stringify({
      ts: new Date().toISOString(),
      source,
      event,
      details,
    }),
  );
}

export function getErrorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    };
  }

  return {
    name: "NonError",
    message: String(error),
    stack: null,
  };
}
