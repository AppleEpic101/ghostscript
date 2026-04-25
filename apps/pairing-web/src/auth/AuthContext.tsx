import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  disableGoogleAutoSelect,
  initializeGoogleIdentity,
  isStoredAuthUserValid,
  parseGoogleCredential,
  type AuthUser,
} from "./googleIdentity";

type AuthStatus = "loading" | "ready" | "missing-client-id" | "error";

interface AuthContextValue {
  errorMessage: string | null;
  isAuthenticated: boolean;
  isReady: boolean;
  status: AuthStatus;
  user: AuthUser | null;
  signOut: () => void;
}

const AUTH_STORAGE_KEY = "ghostscript-auth-user";

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredAuthUser(): AuthUser | null {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(AUTH_STORAGE_KEY);

  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as AuthUser;
    return isStoredAuthUserValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(readStoredAuthUser);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();

  const signOut = useCallback(() => {
    disableGoogleAutoSelect();
    setUser(null);
    setErrorMessage(null);
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  }, []);

  const handleCredential = useCallback((response: { credential: string }) => {
    try {
      const nextUser = parseGoogleCredential(response.credential);
      setUser(nextUser);
      setStatus("ready");
      setErrorMessage(null);
      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextUser));
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to complete Google sign-in.",
      );
    }
  }, []);

  useEffect(() => {
    if (!user) {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
      return;
    }

    if (!isStoredAuthUserValid(user)) {
      signOut();
      return;
    }

    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  }, [signOut, user]);

  useEffect(() => {
    if (user && !isStoredAuthUserValid(user)) {
      signOut();
    }
  }, [signOut, user]);

  useEffect(() => {
    if (!clientId) {
      setStatus("missing-client-id");
      setErrorMessage(null);
      return;
    }

    let cancelled = false;

    initializeGoogleIdentity({
      callback: handleCredential,
      clientId,
    })
      .then(() => {
        if (!cancelled) {
          setStatus("ready");
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setStatus("error");
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to load Google Identity Services.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, handleCredential]);

  const value = useMemo<AuthContextValue>(
    () => ({
      errorMessage,
      isAuthenticated: Boolean(user),
      isReady: status !== "loading",
      signOut,
      status,
      user,
    }),
    [errorMessage, signOut, status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return context;
}
