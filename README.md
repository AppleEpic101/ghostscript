# Ghostscript

Ghostscript is a frontend-first monorepo scaffold for a privacy-focused Discord DM experience with two product surfaces:

- a Chrome extension that overlays secure messaging affordances on Discord web
- a pairing web app for invite, join, and verification flows

This repository intentionally does **not** include the real cryptography or backend yet. It provides typed contracts, deterministic mock data, and UI structure aligned with the PRD so the secure implementation can be layered in cleanly.

## Workspace

- `apps/pairing-web`: Vite + React pairing flow app
- `apps/extension`: Manifest V3 Chrome extension with popup, background worker, and Discord content script UI
- `packages/shared`: shared domain types, constants, and mock pairing state

## Getting started

1. Install dependencies:

```bash
corepack pnpm install
```

2. Run the pairing web app:

```bash
corepack pnpm dev:web
```

3. Build the extension:

```bash
corepack pnpm --filter @ghostscript/extension build
```

4. Load the unpacked extension in Chrome:
   - Open `chrome://extensions`
   - Enable Developer Mode
   - Click **Load unpacked**
   - Select `apps/extension/dist`

## Current placeholders

- Pairing is backed by deterministic local mock data.
- Trust state and invite state are simulated.
- Message decoding and secure compose flows are UI placeholders only.
- Image steganography is represented as a disabled roadmap surface.

## Product alignment

The scaffold follows the current PRD:

- text messaging is treated as the MVP
- secure image sharing is stretch-only
- pairing and safety-number verification are modeled as first-class flows
- Discord integration avoids relying on obfuscated CSS class names in its DOM queries
