import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { FEATURE_FLAGS } from "@ghostscript/shared";
import { LandingRoute } from "./routes/LandingRoute";
import { CreateInviteRoute } from "./routes/CreateInviteRoute";
import { JoinInviteRoute } from "./routes/JoinInviteRoute";
import { VerifyRoute } from "./routes/VerifyRoute";
import { ensureFreshDeployStorage } from "./lib/pairingSession";

type ThemePreference = "light" | "dark" | "system";
type AppliedTheme = Exclude<ThemePreference, "system">;
type HeaderDisclosure = "theme" | "mobile-nav";

const navItems = [
  { to: "/", label: "Overview" },
  { to: "/create", label: "Create invite" },
  { to: "/join", label: "Join invite" },
  { to: "/verify", label: "Verify" },
];

const THEME_STORAGE_KEY = "ghostscript-theme";

function getStoredThemePreference(): ThemePreference {
  if (typeof window === "undefined") {
    return "system";
  }

  ensureFreshDeployStorage();
  const storedPreference = window.localStorage.getItem(THEME_STORAGE_KEY);

  if (
    storedPreference === "light" ||
    storedPreference === "dark" ||
    storedPreference === "system"
  ) {
    return storedPreference;
  }

  return "system";
}

function getSystemTheme(): AppliedTheme {
  if (typeof window === "undefined") {
    return "dark";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 7h16M4 12h16M4 17h16"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ThemeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3v2.3M12 18.7V21M5.64 5.64l1.62 1.62M16.74 16.74l1.62 1.62M3 12h2.3M18.7 12H21M5.64 18.36l1.62-1.62M16.74 7.26l1.62-1.62"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
      <circle cx="12" cy="12" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function App() {
  const location = useLocation();
  const [themePreference, setThemePreference] = useState<ThemePreference>(getStoredThemePreference);
  const [systemTheme, setSystemTheme] = useState<AppliedTheme>(getSystemTheme);
  const [openDisclosure, setOpenDisclosure] = useState<HeaderDisclosure | null>(null);

  const appliedTheme = themePreference === "system" ? systemTheme : themePreference;
  const themeMenuOpen = openDisclosure === "theme";
  const mobileNavOpen = openDisclosure === "mobile-nav";

  const toggleDisclosure = (disclosure: HeaderDisclosure) => {
    setOpenDisclosure((currentDisclosure) =>
      currentDisclosure === disclosure ? null : disclosure,
    );
  };

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = (event?: MediaQueryListEvent) => {
      setSystemTheme(event?.matches ?? mediaQuery.matches ? "dark" : "light");
    };

    updateTheme();
    mediaQuery.addEventListener("change", updateTheme);

    return () => {
      mediaQuery.removeEventListener("change", updateTheme);
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
  }, [themePreference]);

  useEffect(() => {
    document.documentElement.dataset.theme = appliedTheme;
    document.documentElement.style.colorScheme = appliedTheme;
  }, [appliedTheme]);

  useEffect(() => {
    setOpenDisclosure(null);
  }, [location.pathname]);

  useEffect(() => {
    if (!openDisclosure) {
      return;
    }

    const closeDisclosureOnOutsideClick = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      if (target.closest("[data-header-disclosure]")) {
        return;
      }

      setOpenDisclosure(null);
    };

    document.addEventListener("pointerdown", closeDisclosureOnOutsideClick);

    return () => {
      document.removeEventListener("pointerdown", closeDisclosureOnOutsideClick);
    };
  }, [openDisclosure]);

  return (
    <div className="shell" data-theme={appliedTheme}>
      <div className="shell-bg shell-bg-primary" />
      <div className="shell-bg shell-bg-secondary" />
      <div className="shell-grid" />

      <header className="app-header">
        <div className="header-bar">
          <div className="brand-lockup brand-lockup-compact">
            <img src="/logo-mark.png" alt="" className="brand-mark" />
            <div>
              <p className="eyebrow">Ghostscript</p>
              <strong className="brand-title">Pairing web</strong>
              <p className="brand-subtitle">Trusted Discord conversations</p>
            </div>
          </div>

          <nav className="nav nav-desktop" aria-label="Primary">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="header-actions">
            <div className="theme-menu" data-header-disclosure>
              <button
                type="button"
                className="icon-button"
                aria-haspopup="menu"
                aria-expanded={themeMenuOpen}
                aria-label={`Theme: ${themePreference}`}
                onClick={() => toggleDisclosure("theme")}
              >
                <ThemeIcon />
              </button>
              {themeMenuOpen ? (
                <div className="theme-popover" role="menu" aria-label="Theme selection">
                  {(["light", "dark", "system"] as const).map((themeOption) => (
                    <button
                      key={themeOption}
                      type="button"
                      role="menuitemradio"
                      aria-checked={themePreference === themeOption}
                      className={
                        themePreference === themeOption
                          ? "theme-option theme-option-active"
                          : "theme-option"
                      }
                      onClick={() => {
                        setThemePreference(themeOption);
                        setOpenDisclosure(null);
                      }}
                    >
                      <span>{themeOption}</span>
                      {themeOption === "system" ? (
                        <small>{systemTheme}</small>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <button
              type="button"
              className="icon-button nav-toggle"
              data-header-disclosure
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-nav"
              aria-label="Toggle navigation"
              onClick={() => toggleDisclosure("mobile-nav")}
            >
              <MenuIcon />
            </button>
          </div>
        </div>

        <div
          id="mobile-nav"
          className={mobileNavOpen ? "mobile-nav mobile-nav-open" : "mobile-nav"}
          data-header-disclosure
        >
          <nav className="nav nav-mobile" aria-label="Mobile primary">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="main-panel">
        <div className="top-note">
          <div>
            <p className="eyebrow">Pairing flow</p>
            <p className="lede">
              Invite exchange, local identity binding, and safety-number verification stay
              visible here. Transport and decryption remain in the extension.
            </p>
          </div>
          <div className="surface-note">
            <p className="panel-label">Availability</p>
            <strong>Ready from this browser</strong>
            <p className="lede">
              Create invites, join sessions, and confirm safety numbers without a separate
              sign-in step.
            </p>
          </div>
        </div>

        <div className="content-shell">
          <Routes>
            <Route path="/" element={<LandingRoute />} />
            <Route path="/create" element={<CreateInviteRoute />} />
            <Route path="/join" element={<JoinInviteRoute />} />
            <Route path="/verify" element={<VerifyRoute />} />
          </Routes>

          <section className="surface-note surface-note-bottom">
            <p className="panel-label">Surface notes</p>
            <div className="flag-card">
              <span>Text MVP</span>
              <strong>{FEATURE_FLAGS.textMvp ? "Enabled" : "Disabled"}</strong>
              <span>Image stretch</span>
              <strong>{FEATURE_FLAGS.imageStretchDisabled ? "Roadmap" : "Enabled"}</strong>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
