# PRD for Ghostscript, Including Secure Images

## Summary
`PRD.md` for **Ghostscript**, a **Chrome extension + lightweight pairing web app** that brings end-to-end encrypted messaging to **Discord web 1:1 DMs**. The PRD should optimize for **judge trust in security**: use **standard audited cryptography** for the real protection, and treat innocent-looking text or images as a **camouflage/transport layer**, not the security primitive.

The PRD should define:
- **Core MVP**: secure text messages in Discord DMs
- **High-priority stretch**: secure image sharing via benign-looking PNG attachments
- **Pairing model**: both users install the extension and verify each other via **Safety Number / Hash Word comparison** (QR codes are excluded as the MVP is scoped to Desktop Chrome)
- **Security language**: replace “military-style encryption” with “modern audited cryptography”

## Key Changes To Capture In The PRD
### Product definition
- Position Ghostscript as a browser-extension privacy overlay for Discord DMs where paired users see real plaintext, while Discord and observers only see cover text or benign-looking image attachments.
- Keep MVP scope to:
  - Discord web on desktop Chrome
  - 1:1 DMs only
  - Text messages
  - Manual secure pairing
- Add image support as a **stretch feature after text MVP**, not equal-scope MVP.
- Explicitly exclude for v1:
  - Group chats
  - Mobile
  - Multi-device sync
  - Perfect undetectability
  - Deep-learning image-to-image hiding in production
- Allow AI-generated natural-language cover text as an optional usability layer for text messages, but keep it explicitly non-authoritative: the secure payload remains the encrypted Unicode steganographic suffix, and decryption must never depend on the semantic content of the generated prose.

### Security architecture
- Lock the PRD to standard crypto, not custom reversible “sentence encryption.”
- Use:
  - `X25519` for key agreement
  - `HKDF-SHA-256` for key derivation
  - `XChaCha20-Poly1305` for authenticated encryption, implemented through a browser-safe library such as `libsodium.js` because browser `SubtleCrypto` does not natively expose XChaCha20-Poly1305 on MDN’s supported list
  - `Ed25519` fingerprints/signatures for identity verification
  - `Argon2id` for wrapping local private keys with a passphrase
- Require explicit counter-based nonces for text-message encryption:
  - derive the initial `192-bit` XChaCha20-Poly1305 nonce base during the authenticated `X25519` + `HKDF-SHA-256` handshake
  - maintain a synchronized per-conversation counter locally on each side
  - Transmit a 4-byte msg_id to derive the 24-byte nonce locally, saving 20 bytes of payload space compared to a standard XChaCha20 nonce.
  - do not transmit the full `24-byte` nonce inside the steganographic payload, in order to conserve Discord message budget
- Require the backend to store only:
  - public keys
  - pairing invite/session state
  - encrypted metadata if needed
- Require the backend to never store:
  - plaintext messages
  - plaintext images
  - conversation secrets
  - unwrapped private keys
- Require fail-closed decryption behavior:
  - if `Poly1305` authentication fails, the client must not attempt to render or recover partial plaintext
  - the UI must render a `Tampered/Corrupted` state for the affected message or asset
- Keep Signal-style ratcheting as roadmap, not MVP.

### Text-message extension flow
- Require a **secure Ghostscript compose box** (an in-DOM injected React component that hovers near or replaces the native Discord text input, rather than living isolated inside the extension popup) instead of typing secrets into Discord’s native input.
- Outgoing text flow:
  - extension must avoid hardcoded, obfuscated Discord CSS classes (e.g., `.messageContent_ab12c`) and instead rely on structural or attribute-based DOM selectors (e.g., `[role="textbox"]`, `data-list-item-id`) to survive Discord UI updates
  - user writes plaintext in extension UI
  - user can choose either:
    - manual cover text entry
    - automatic AI-generated cover text
  - when automatic cover text is enabled, the extension generates benign-looking cover prose locally or via a privacy-reviewed API path using user-provided style controls for:
    - tone
    - context
    - speaking style
  - default AI cover-text preset must be `casual SMS bro tone over Discord`
  - extension compresses plaintext with `zlib/deflate` via `fflate` whenever the plaintext payload exceeds `64 bytes`
  - extension encrypts locally
  - encrypted bytes are encoded with a Base-16 steganographic alphabet using an exact array of safe, non-printing Unicode characters (U+200B, U+200C, U+200D, U+2060, U+2061, U+2062, U+2063, U+2064, U+206A, U+206B, U+206C, U+206D, U+206E, U+206F, U+FEFF, and U+FFA0) which are appended to the generated Cover Text, yielding 4 bits per character and a 1:2 byte-to-character expansion ratio suitable for Discord’s `2,000-character` cap
  - only cover text is inserted into Discord
  - insertion into Discord must use `document.execCommand('insertText')` or equivalent `InputEvent` simulation so the React/Slate.js editor state updates correctly and the `Send` button is activated
  - if AI generation is unavailable, rate-limited, rejected by policy, or times out, the compose flow must fall back to either a deterministic local cover-text template or manual user-authored cover text without blocking secure send
- Incoming text flow:
  - extension detects Ghostscript messages using resilient structural or attribute-based DOM selectors (avoiding obfuscated classes)
  - decodes and decrypts locally
  - renders plaintext in an extension-controlled overlay
  - does not write recoverable plaintext back into Discord’s page DOM
  - **Edge Case**: If the extension detects a valid Ghostscript steganographic signature but lacks the required shared key, it must overlay the cover text with an interactive "Encrypted Message: Click to Pair" button.
- Include trust/status states:
  - unpaired
  - paired-unverified
  - verified
  - locked
  - tampered/decryption-failed

### Image stretch feature
- Define secure-image support as **encrypted image steganography inside benign PNG attachments**, not true semantic image transformation.
- PRD should state clearly that the system does **not** turn one meaningful image into another through “magic reversal”; instead it:
  - compresses and encrypts the secret image
  - embeds the encrypted payload inside a benign-looking cover PNG
  - extracts and decrypts it on the other side
- Lock the stretch design to:
  - **PNG attachments only**
  - **lossless round-trip required**
  - **randomized LSB embedding in RGB channels**, keyed per conversation
  - exact payload format with protocol version, full 24-byte random nonce, ciphertext length, and integrity check
- Define sender flow for images:
  - user selects secret image
  - extension locally downsizes/compresses it to a bounded size budget
  - extension encrypts the image bytes
  - extension embeds encrypted bytes into a user-selected or bundled benign PNG cover image
  - extension uploads the stego PNG as the Discord attachment
- Define receiver flow for images:
  - extension detects a Ghostscript-compatible attachment
  - fetches the original attachment bytes from the `cdn.discordapp.com` source rather than Discord preview proxies, in order to bypass lossy `WebP`/`JPEG` transformations
  - extracts payload from PNG pixel data
  - decrypts locally
  - renders the real image in an overlay or secure preview panel
- Set concrete stretch constraints so the spec is implementable:
  - cover image must be PNG and at least `1024x1024`
  - embed in **1 LSB per RGB channel**
  - secret image is auto-resized to max `512px` on the long edge
  - compressed plaintext image budget is capped at `128 KB` before encryption
  - exact-byte preservation is required; if the carrier is transformed, extraction fails closed
- Add a validation requirement in the PRD: verify experimentally whether Discord’s upload/download path preserves original PNG bytes well enough for this mode. If it does not, image stego remains demo-only or moves to fallback transport.
- Keep these image ideas out of v1 and in roadmap/research:
  - deep-learning “hide image in image” networks
  - generative innocent-image synthesis
  - reversible semantic remapping of one photo into another

### Pairing web app
- Define the web app as a **key exchange and verification service**, not a message relay.
- Required flows:
  - create invite code
  - join invite by entering the invite code inside Ghostscript
  - exchange public keys
  - display Safety Number / Hash Word
  - mark pairing verified after both users confirm
- Keep onboarding simple:
  - both users install the extension
  - the inviter shares a short-lived invite code out of band
  - the joiner opens Ghostscript and manually enters that code
  - both must verify the safety code before decryption is marked trusted
- Require short-lived pairing sessions and TLS.

## Public Interfaces And Types To Define In The PRD
- Extension/local types:
  - `IdentityKey`
  - `PairedContact`
  - `ConversationState`
  - `TrustStatus`
  - `CoverTextStyle`
  - `StegoCodec`
  - `EncodedGhostscriptMessage`
  - `StegoImageEnvelope`
- `CoverTextStyle` definition:
  - `mode: 'manual' | 'ai-generated'`
  - `tone: string`
  - `context: string`
  - `speakingStyle: string`
  - `presetId?: string`
  - default preset values should resolve to casual SMS bro tone suitable for Discord DMs
- `StegoCodec` module definition:
  - `encode(bytes: Uint8Array): string`
  - `decode(text: string): Uint8Array`
  - Base-16 alphabet backed by `16` specific non-printing Unicode characters (U+200B, U+200C, U+200D, U+2060, U+2061, U+2062, U+2063, U+2064, U+206A, U+206B, U+206C, U+206D, U+206E, U+206F, U+FEFF, and U+FFA0) appended to cover text.
  - deterministic codec metadata sufficient to validate message framing and version compatibility
- Text envelope fields via `MessageEnvelope`:
  - `v` for protocol version
  - `sender_id` (a truncated Ed25519 fingerprint so the receiving extension knows which public key to use for decryption)
  - `msg_id` for the synchronized message counter used to derive the local nonce
  - `tag` for the `16-byte` `Poly1305` MAC
  - `ct` for ciphertext
  - codec metadata
- Image envelope fields:
  - protocol version
  - image mode (`png-lsb-v1`)
  - sender key id
  - full 24-byte random nonce
  - encrypted payload length
  - ciphertext
  - integrity tag
  - optional cover profile id
- Backend endpoints:
  - `POST /pairing/invites` to mint a short-lived human-readable invite code
  - `POST /pairing/invites/{code}/join`
  - `POST /pairing/invites/{code}/confirm`
  - `GET /users/{id}/public-key`
  - `POST /pairing/reset`

## Test Plan
- Pair two fresh users and confirm matching conversation secrets only after verification.
- Verify pairing succeeds when the joiner manually enters a valid invite code inside Ghostscript.
- Verify invite codes are short-lived and rejected after expiration or reuse.
- Verify Discord only receives cover text for secure text messages.
- Verify both manual and AI-generated cover text flows successfully carry the same encrypted payload.
- Verify users can set tone, context, and speaking style for AI cover text and that the default preset is casual SMS bro tone for Discord DMs.
- Verify plaintext text never appears in Discord’s native composer or readable page DOM in the secure flow.
- Send valid Ghostscript text and confirm successful local decode/decrypt.
- Tamper with any message field and verify integrity failure.
- Replay a prior TEXT message and verify replay detection (Note: Replay protection is explicitly excluded for Image steganography to minimize state synchronization complexity).
- Lock the extension and confirm local keys remain unusable until passphrase unlock.
- Simulate AI cover-text generation failure and verify send falls back cleanly without exposing plaintext or dropping the message.
- For images, validate end-to-end PNG round-trip through Discord upload/download before promising the feature in demo.
- Embed, send, receive, extract, and decrypt a bounded secret image from a benign PNG carrier.
- Attempt extraction with the wrong key or a transformed carrier and verify fail-closed behavior with no partial reveal.

## Assumptions And Defaults
- `PRD.md` is the only deliverable for implementation mode.
- The PRD should read like a polished hackathon product spec, not an academic crypto paper.
- Text is the core MVP.
- Secure-image stego is a flagship **stretch feature** after text works reliably.
- The recommended browser crypto implementation for the extension is `libsodium.js`/WASM for XChaCha20-Poly1305 and Argon2id, while standard browser APIs can still be used where appropriate.
- AI-generated cover text is a convenience layer for message camouflage and tone-matching, not part of the cryptographic trust model or decoding contract.
- The PRD should explicitly say Ghostscript provides **confidentiality and tamper resistance**, not invisibility against all steganalysis or protection against compromised endpoints.
