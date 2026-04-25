export interface GoogleIdTokenPayload {
  aud: string;
  email: string;
  email_verified?: boolean;
  exp: number;
  family_name?: string;
  given_name?: string;
  iat?: number;
  iss: string;
  name: string;
  picture?: string;
  sub: string;
}

export interface AuthUser {
  email: string;
  emailVerified: boolean;
  expiresAt: number;
  familyName?: string;
  givenName?: string;
  issuedAt?: number;
  name: string;
  picture?: string;
  subject: string;
}

interface GoogleCredentialResponse {
  credential: string;
  select_by: string;
}

interface GoogleButtonConfig {
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "large" | "medium" | "small";
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  width?: number;
}

interface GoogleAccountsId {
  disableAutoSelect: () => void;
  initialize: (configuration: {
    callback: (response: GoogleCredentialResponse) => void;
    client_id: string;
    context?: "signin" | "signup" | "use";
    ux_mode?: "popup" | "redirect";
  }) => void;
  renderButton: (element: HTMLElement, options: GoogleButtonConfig) => void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: GoogleAccountsId;
      };
    };
  }
}

const GOOGLE_IDENTITY_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

let googleScriptPromise: Promise<void> | null = null;

function decodeBase64UrlSegment<T>(segment: string): T {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const decoded = atob(normalized + padding);
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as T;
}

export function parseGoogleCredential(credential: string): AuthUser {
  const [, payloadSegment] = credential.split(".");

  if (!payloadSegment) {
    throw new Error("The Google credential is missing its token payload.");
  }

  const payload = decodeBase64UrlSegment<GoogleIdTokenPayload>(payloadSegment);

  if (!payload.email || !payload.name || !payload.sub || !payload.exp) {
    throw new Error("The Google credential payload is incomplete.");
  }

  return {
    email: payload.email,
    emailVerified: Boolean(payload.email_verified),
    expiresAt: payload.exp * 1000,
    familyName: payload.family_name,
    givenName: payload.given_name,
    issuedAt: payload.iat ? payload.iat * 1000 : undefined,
    name: payload.name,
    picture: payload.picture,
    subject: payload.sub,
  };
}

export function isStoredAuthUserValid(user: AuthUser | null): user is AuthUser {
  return Boolean(user && user.expiresAt > Date.now());
}

export function loadGoogleIdentityScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  if (window.google?.accounts?.id) {
    return Promise.resolve();
  }

  if (googleScriptPromise) {
    return googleScriptPromise;
  }

  googleScriptPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${GOOGLE_IDENTITY_SCRIPT_SRC}"]`,
    );

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("Failed to load the Google Identity Services script.")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = GOOGLE_IDENTITY_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load the Google Identity Services script."));
    document.head.appendChild(script);
  });

  return googleScriptPromise;
}

export async function initializeGoogleIdentity(options: {
  callback: (response: GoogleCredentialResponse) => void;
  clientId: string;
}): Promise<void> {
  await loadGoogleIdentityScript();

  window.google?.accounts.id.initialize({
    callback: options.callback,
    client_id: options.clientId,
    context: "signin",
    ux_mode: "popup",
  });
}

export function renderGoogleSignInButton(
  element: HTMLElement,
  options: GoogleButtonConfig = {},
): void {
  if (!window.google?.accounts.id) {
    throw new Error("Google Identity Services is not ready yet.");
  }

  element.innerHTML = "";

  window.google.accounts.id.renderButton(element, {
    size: "large",
    text: "signin_with",
    theme: "outline",
    width: 280,
    ...options,
  });
}

export function disableGoogleAutoSelect(): void {
  window.google?.accounts.id.disableAutoSelect();
}
