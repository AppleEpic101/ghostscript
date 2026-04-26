import type { IncomingMessage } from "node:http";
import { ApiError } from "./service";

interface RateLimitRule {
  name: string;
  maxRequests: number;
  windowMs: number;
}

export function createRateLimiter() {
  const store = new Map<string, { windowStartedAt: number; count: number }>();

  return {
    enforce(request: IncomingMessage, pathname: string, now = Date.now()) {
      const rule = getRateLimitRule(request.method ?? "GET", pathname);
      if (!rule) {
        return;
      }

      const clientId = getClientAddress(request);
      const key = `${rule.name}:${clientId}`;
      const current = store.get(key);

      if (!current || now - current.windowStartedAt >= rule.windowMs) {
        store.set(key, {
          windowStartedAt: now,
          count: 1,
        });
        pruneRateLimitStore(store, now);
        return;
      }

      if (current.count >= rule.maxRequests) {
        throw new ApiError(429, "Too many requests. Try again later.");
      }

      current.count += 1;
      store.set(key, current);
    },
  };
}

export function getRateLimitRule(method: string, pathname: string): RateLimitRule | null {
  if (method === "POST" && pathname === "/pairing/invites") {
    return {
      name: "create-invite",
      maxRequests: 10,
      windowMs: 15 * 60 * 1000,
    };
  }

  if (method === "POST" && /^\/pairing\/invites\/[^/]+\/join$/.test(pathname)) {
    return {
      name: "join-invite",
      maxRequests: 6,
      windowMs: 15 * 60 * 1000,
    };
  }

  if (method === "GET" && /^\/pairing\/invites\/[^/]+$/.test(pathname)) {
    return {
      name: "invite-status",
      maxRequests: 90,
      windowMs: 5 * 60 * 1000,
    };
  }

  if (method === "POST" && pathname === "/pairing/reset") {
    return {
      name: "reset-pairing",
      maxRequests: 20,
      windowMs: 10 * 60 * 1000,
    };
  }

  return null;
}

function getClientAddress(request: IncomingMessage) {
  const forwardedFor = request.headers["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const firstForwardedAddress = forwardedValue?.split(",")[0]?.trim();

  if (firstForwardedAddress) {
    return firstForwardedAddress;
  }

  return request.socket.remoteAddress ?? "unknown";
}

function pruneRateLimitStore(
  store: Map<string, { windowStartedAt: number; count: number }>,
  now: number,
) {
  if (store.size <= 512) {
    return;
  }

  for (const [key, value] of store.entries()) {
    if (now - value.windowStartedAt >= 60 * 60 * 1000) {
      store.delete(key);
    }
  }
}
