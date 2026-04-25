import { NavLink, Route, Routes } from "react-router-dom";
import { FEATURE_FLAGS } from "@ghostscript/shared";
import { LandingRoute } from "./routes/LandingRoute";
import { CreateInviteRoute } from "./routes/CreateInviteRoute";
import { JoinInviteRoute } from "./routes/JoinInviteRoute";
import { VerifyRoute } from "./routes/VerifyRoute";

const navItems = [
  { to: "/", label: "Overview" },
  { to: "/create", label: "Create invite" },
  { to: "/join", label: "Join invite" },
  { to: "/verify", label: "Verify" },
];

export function App() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <p className="eyebrow">Ghostscript</p>
        <h1>Pairing control plane for trusted Discord DMs.</h1>
        <p className="lede">
          The web app handles invite exchange and safety-number verification.
          Secure message transport remains in the extension.
        </p>
        <nav className="nav">
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
        <div className="flag-card">
          <span>Text MVP</span>
          <strong>{FEATURE_FLAGS.textMvp ? "Enabled in scaffold" : "Disabled"}</strong>
          <span>Image stretch</span>
          <strong>
            {FEATURE_FLAGS.imageStretchDisabled ? "Roadmap placeholder" : "Enabled"}
          </strong>
        </div>
      </aside>
      <main className="main-panel">
        <Routes>
          <Route path="/" element={<LandingRoute />} />
          <Route path="/create" element={<CreateInviteRoute />} />
          <Route path="/join" element={<JoinInviteRoute />} />
          <Route path="/verify" element={<VerifyRoute />} />
        </Routes>
      </main>
    </div>
  );
}
