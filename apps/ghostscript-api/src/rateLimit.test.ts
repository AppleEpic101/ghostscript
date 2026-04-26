import test from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { createRateLimiter, getRateLimitRule } from "./rateLimit";

test("join invite rate limiting is stricter than create invite and returns 429 once exceeded", () => {
  const limiter = createRateLimiter();
  const request = createRequest("203.0.113.10", "POST");

  for (let index = 0; index < 6; index += 1) {
    limiter.enforce(request, "/pairing/invites/1234/join", 0);
  }

  assert.throws(
    () => limiter.enforce(request, "/pairing/invites/1234/join", 0),
    (error: unknown) => isApiErrorWithStatus(error, 429),
  );
});

test("rate limits reset after the configured window elapses", () => {
  const limiter = createRateLimiter();
  const request = createRequest("198.51.100.20", "POST");
  const rule = getRateLimitRule("POST", "/pairing/invites");
  assert.ok(rule);

  for (let index = 0; index < (rule?.maxRequests ?? 0); index += 1) {
    limiter.enforce(request, "/pairing/invites", 0);
  }

  limiter.enforce(request, "/pairing/invites", (rule?.windowMs ?? 0) + 1);
});

function createRequest(ipAddress: string, method: string) {
  return {
    method,
    headers: {
      "x-forwarded-for": `${ipAddress}, 10.0.0.1`,
    },
    socket: {
      remoteAddress: "127.0.0.1",
    },
  } as unknown as IncomingMessage;
}

function isApiErrorWithStatus(error: unknown, statusCode: number) {
  return (
    error instanceof Error &&
    "statusCode" in error &&
    typeof (error as { statusCode?: unknown }).statusCode === "number" &&
    (error as { statusCode: number }).statusCode === statusCode
  );
}
