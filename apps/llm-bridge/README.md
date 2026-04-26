# Ghostscript LLM Bridge

Local bridge service for the extension's `/encode` and `/decode` calls.

## Modes

- `passthrough`
  - Calls OpenAI directly and returns plausible cover text for UI smoke testing.
  - Ignores the encrypted bitstring for output generation.
  - `/decode` always returns `null`.
  - Not protocol-correct and not suitable for real Ghostscript messaging.
- `strict-stub`
  - Exposes the real API contract but returns `501` until rank-selection encoding is implemented.

## Setup

1. Copy `.env.example` to `.env`.
2. Set `OPENAI_API_KEY`.
3. Run `pnpm --filter @ghostscript/llm-bridge dev`.

## Endpoints

- `GET /health`
- `POST /encode`
- `POST /decode`

## Notes

This scaffold is intentionally honest about the current implementation gap: the OpenAI plumbing is real, but the deterministic rank-selection encoder/decoder is still TODO.
