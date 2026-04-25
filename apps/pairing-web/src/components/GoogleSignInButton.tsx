import { useEffect, useRef } from "react";
import { useAuth } from "../auth/AuthContext";
import { renderGoogleSignInButton } from "../auth/googleIdentity";

export function GoogleSignInButton() {
  const { errorMessage, status } = useAuth();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (status !== "ready" || !containerRef.current) {
      return;
    }

    try {
      renderGoogleSignInButton(containerRef.current);
    } catch {
      // The provider exposes the user-facing error state when initialization fails.
    }
  }, [status]);

  if (status === "loading") {
    return <p className="auth-helper">Loading Google sign-in…</p>;
  }

  if (status === "missing-client-id") {
    return (
      <p className="auth-helper">
        Add <code className="inline-code">VITE_GOOGLE_CLIENT_ID</code> to enable Google sign-in.
      </p>
    );
  }

  if (status === "error") {
    return <p className="auth-helper">{errorMessage ?? "Google sign-in is unavailable right now."}</p>;
  }

  return <div ref={containerRef} className="google-signin-slot" aria-live="polite" />;
}
