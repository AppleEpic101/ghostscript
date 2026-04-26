const root = document.getElementById("root");

function renderLoadError() {
  if (!root) {
    return;
  }

  const style = document.createElement("style");
  style.textContent = `
    :root {
      color-scheme: light;
      font-family: "Avenir Next", "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(237, 180, 88, 0.32), transparent 38%),
        linear-gradient(180deg, #f7efe0 0%, #efe4d0 100%);
      color: #1f2a30;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-width: 360px;
    }

    .popup-load-error {
      padding: 18px;
    }

    .popup-load-error-card {
      background: rgba(255, 251, 245, 0.9);
      border: 1px solid rgba(109, 81, 38, 0.12);
      border-radius: 18px;
      padding: 16px;
      box-shadow: 0 20px 40px rgba(92, 69, 34, 0.08);
    }

    .popup-load-error-card h1 {
      margin: 0 0 10px;
      font-size: 22px;
      line-height: 1.1;
    }

    .popup-load-error-card p {
      margin: 0;
      color: #5d4e40;
      font-size: 14px;
      line-height: 1.5;
    }

    .popup-load-error-card p + p {
      margin-top: 10px;
    }

    .popup-load-error-card code {
      font-family: "SFMono-Regular", "SFMono-Regular", Consolas, monospace;
      font-size: 13px;
    }
  `;

  document.head.appendChild(style);
  root.innerHTML = `
    <main class="popup-load-error">
      <section class="popup-load-error-card">
        <h1>Ghostscript needs the built extension bundle</h1>
        <p>Run <code>corepack pnpm --filter @ghostscript/extension build</code> or <code>corepack pnpm --filter @ghostscript/extension dev</code>.</p>
        <p>Then reload the unpacked extension from <code>apps/extension/dist</code> instead of <code>apps/extension</code>.</p>
      </section>
    </main>
  `;
}

async function bootstrap() {
  try {
    await import("./main.tsx");
  } catch (error) {
    console.error("Ghostscript popup failed to load.", error);
    renderLoadError();
  }
}

void bootstrap();
