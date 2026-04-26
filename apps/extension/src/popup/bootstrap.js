const root = document.getElementById("root");

function renderLoadError() {
  if (!root) {
    return;
  }

  const style = document.createElement("style");
  style.textContent = `
    :root {
      color-scheme: dark;
      font-family: "gg sans", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
      background: #313338;
      color: #dbdee1;
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
      background: #2b2d31;
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
    }

    .popup-load-error-card h1 {
      margin: 0 0 10px;
      font-size: 22px;
      line-height: 1.1;
      color: #ffffff;
    }

    .popup-load-error-card p {
      margin: 0;
      color: #b5bac1;
      font-size: 14px;
      line-height: 1.5;
    }

    .popup-load-error-card p + p {
      margin-top: 10px;
    }

    .popup-load-error-card code {
      font-family: "SFMono-Regular", Consolas, monospace;
      font-size: 13px;
      background: #1e1f22;
      padding: 2px 4px;
      border-radius: 3px;
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
