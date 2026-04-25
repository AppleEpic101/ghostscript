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

2. Configure Google sign-in for the pairing web app:

```bash
cp apps/pairing-web/.env.example apps/pairing-web/.env.local
```

Then set `VITE_GOOGLE_CLIENT_ID` to a Google Identity Services web client ID that includes your local Vite origin, such as `http://localhost:5173`.

3. Configure the pairing API:

```bash
cp apps/pairing-api/.env.example apps/pairing-api/.env
```

Then update:

- `SUPABASE_URL` with your project URL
- `SUPABASE_SERVICE_ROLE_KEY` with your backend secret/service-role key

Do not use a Supabase `sb_publishable_...` key here. The pairing API writes directly to Supabase and needs the server-side privileged key.

4. Run the pairing API:

```bash
corepack pnpm dev:api
```

5. Run the pairing web app in a second terminal:

```bash
corepack pnpm dev:web
```

6. Build the extension:

```bash
corepack pnpm --filter @ghostscript/extension build
```

7. Load the unpacked extension in Chrome:
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
