import type { ReactNode } from "react";
import { GoogleSignInButton } from "./GoogleSignInButton";

interface AuthGateProps {
  children: ReactNode;
  description: string;
  title: string;
}

export function AuthGate({ children, description, title }: AuthGateProps) {
  return (
    <section className="panel-grid single-column">
      <article className="panel auth-gate-panel">
        <div className="auth-gate-copy">
          <p className="panel-label">Google authentication</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <div className="auth-gate-actions">
          <GoogleSignInButton />
          <p className="auth-helper">
            We only read your Google account profile from the identity token in this frontend demo.
          </p>
        </div>
      </article>
      {children}
    </section>
  );
}
