# PRD for Ghostscript

## Summary
`PRD.md` for **Ghostscript**, a **Chrome extension** that lets paired users send end-to-end encrypted messages through **Discord web text chats** while everyone else sees only ordinary-looking natural-language cover text. The product is explicitly designed for **shared and public chat settings** such as servers and group chats, not just 1:1 direct messages.

The PRD should optimize for two things at once:
- **Trust in real security**: the hidden payload is protected by standard audited cryptography.
- **Natural visible output**: the ciphertext is transported as plausible natural-language text using the deterministic LLM encoding method defined in [CoverTextEncodingPRD.md](/Users/peyetuygtf/Projects/ghostscript/CoverTextEncodingPRD.md).

The PRD should define:
- **Core MVP**: secure text messages on Discord web across DMs, group DMs, servers, and server channels
- **Pairing model**: invite creation and joining entirely inside the extension using a short-lived `4-digit` code
- **Cover-text setup**: the inviter supplies a default cover-text topic during invite creation
- **Security language**: Ghostscript provides confidentiality and tamper resistance while making messages look like ordinary text, without claiming perfect adversarial undetectability
- **Stretch feature**: secure image sharing after text works reliably

## Key Changes To Capture In The PRD
### Product definition
- Position Ghostscript as a browser-extension privacy overlay for Discord web text chats where paired users can reveal the real plaintext while Discord and bystanders see only normal-looking cover text.
- Define the extension as the **system of record** for local identity keys, pairing state, trust state, per-contact cover-topic defaults, and per-conversation cryptographic state.
- Remove the user-facing companion website entirely. The product experience for invite creation, joining, linking, sending, and reading secure messages lives inside the extension.
- Support these Discord surfaces for MVP:
  - direct messages
  - group direct messages
  - servers
  - server channels
- Explicitly allow Ghostscript to operate in public or shared spaces where non-paired observers can read the visible cover text but cannot reveal the hidden plaintext.
- Keep MVP scope to:
  - Discord web on desktop Chrome
  - text messages
  - extension-native invite creation and code entry
  - automatic local encryption plus LLM-based natural-language transport encoding
- Keep secure images as a **stretch feature after text MVP**, not equal-scope MVP.
- Explicitly exclude for v1:
  - mobile
  - multi-device sync
  - perfect steganographic undetectability
  - compatibility across different model families or tokenizers for the same encoded message
  - a separate user-facing website

### Security architecture
- Lock the PRD to standard crypto for confidentiality, not custom sentence-level reversible encryption.
- Use:
  - `X25519` for key agreement
  - `HKDF-SHA-256` for key derivation
  - `XChaCha20-Poly1305` for authenticated encryption, implemented through a browser-safe library such as `libsodium.js`
  - `Ed25519` fingerprints for local identity and contact binding
  - `Argon2id` for wrapping local private keys with a passphrase
- Require explicit counter-based nonces for text-message encryption:
  - derive the initial `192-bit` XChaCha20-Poly1305 nonce base during the authenticated `X25519` + `HKDF-SHA-256` handshake
  - maintain a synchronized per-contact or per-conversation message counter locally on each side
  - transmit a compact `msg_id` so both sides derive the full nonce locally
- State clearly that the **LLM encoding layer is transport only**:
  - plaintext is encrypted first
  - the encrypted bitstream is then encoded into natural-language tokens
  - decryption authority comes from the cryptographic payload, not from the semantics of the visible sentence
- Require the backend to store only:
  - public keys
  - invite/session state
  - encrypted metadata if needed
- Require the backend to never store:
  - plaintext messages
  - conversation secrets
  - unwrapped private keys
  - plaintext image payloads
- Treat the `4-digit` invite code as a rendezvous token, not a cryptographic secret. The actual security boundary is the locally held key material and the derived shared session.
- Require fail-closed behavior:
  - if transport decoding does not produce a valid Ghostscript frame, the message remains ordinary visible cover text
  - if a valid frame is reconstructed but `Poly1305` authentication fails, the client must not render partial plaintext
  - the UI must render a `Tampered/Corrupted` state only when framed Ghostscript content fails verification, not for ordinary non-Ghostscript messages
- Keep Signal-style ratcheting as roadmap, not MVP.

### Pairing and onboarding
- Define onboarding as an **extension-only flow**:
  - inviter opens Ghostscript
  - inviter enters a default cover-text topic in a setup text box
  - extension creates a short-lived `4-digit` numeric invite code
  - inviter shares that code out of band
  - joiner enters the code inside Ghostscript
  - extension links the two users and persists the paired relationship locally
- The invite-time topic becomes the default cover-topic seed for that paired connection until the user explicitly changes it later.
- Treat successful code entry as sufficient trust for MVP. Do not require Safety Number, Hash Word, QR, or third-party account verification in the initial version.
- Require the invite service to enforce:
  - short expiry
  - single-use semantics
  - aggressive rate limiting / abuse throttling because the code space is only `10,000` combinations
- Require secure operations to remain possible after pairing even if no website is open, because there is no website in the user flow.

### Text-message extension flow
- Require a **secure Ghostscript compose box** as an in-DOM injected overlay near or replacing the native Discord composer. Users must not type protected plaintext directly into Discord’s native input when sending a secure message.
- Outgoing text flow:
  - extension avoids brittle hardcoded Discord CSS classes and instead relies on structural or attribute-based selectors where possible
  - user writes plaintext in the Ghostscript overlay
  - extension selects the active paired recipient or paired sender context for the current Discord thread
  - extension loads the saved default cover-topic seed for that paired relationship and may combine it with recent conversation context to keep visible output plausible
  - extension builds a bounded context window from:
    - locally cached recent messages
    - currently rendered Discord DOM messages
    - controlled upward scrolling when more context is needed and time limits allow
  - extension may compress plaintext with `zlib/deflate` via `fflate` when the payload exceeds a configured threshold such as `64 bytes`
  - extension encrypts locally and constructs a message envelope containing protocol version, sender identifier, message counter, ciphertext, and authentication tag
  - extension converts the encrypted bitstream into natural-language output using the rank-selection encoding method from [CoverTextEncodingPRD.md](/Users/peyetuygtf/Projects/ghostscript/CoverTextEncodingPRD.md)
  - only the generated natural-language message is inserted into Discord
  - insertion into Discord must use `insertText`-style editor-compatible events so Discord’s editor state updates correctly and the send action remains native
- The LLM transport encoding contract must require:
  - identical model weights or checkpoint family, tokenizer, and inference configuration on both encoder and decoder sides
  - deterministic candidate-pool construction at every token step
  - deterministic tie-breaking, such as ascending token ID when probabilities tie
  - exclusion of special tokens and any token classes blocked by the shared encoding config
  - merge-safe token selection so detokenization and retokenization reproduce the same token sequence
  - a configured `bits per step` parameter `n`
  - a deterministic fallback rule when the candidate pool is smaller than `2^n`
  - an explicit payload-length strategy so the decoder knows when to stop emitting bits
- Preferred defaults for the PRD:
  - fallback strategy: **reduce bits for this step**
  - payload termination strategy: **encode a length header before payload bits**
- The PRD should treat model/version drift as a protocol compatibility issue:
  - encoded text is only guaranteed to decode under the same pinned model/tokenizer/config
  - future model upgrades require explicit versioning and rollout planning
- Incoming text flow:
  - extension observes Discord messages using resilient DOM selectors
  - for messages authored by paired contacts, the extension may opportunistically attempt Ghostscript decoding in the background
  - if no valid Ghostscript frame is recovered, the message remains visible as ordinary cover text with no tamper alert
  - if a valid frame is recovered and decrypts successfully, the extension renders the real plaintext in an extension-controlled overlay
  - the extension must not write recoverable plaintext back into Discord’s readable page DOM
  - if a valid frame is recovered but authentication fails, the extension renders a `Tampered/Corrupted` state
- Include trust/status states:
  - unpaired
  - invite-pending
  - paired
  - locked
  - tampered/decryption-failed

### Cover-text behavior and public claims
- The visible message inserted into Discord should read like ordinary natural-language text appropriate to the surrounding conversation and the pair’s default topic seed.
- The product should explicitly say the goal is to make secure messages look like plausible normal chat messages in shared spaces.
- The PRD must not promise that Ghostscript is impossible to detect by a determined analyst. It should instead say:
  - Discord and ordinary observers see only normal-looking text
  - plaintext recovery requires the paired extension state plus the matching cryptographic and model configuration
  - Ghostscript aims for plausible visible deniability in normal chat use, not mathematically provable invisibility

### Image stretch feature
- Define secure-image support as a **stretch feature** after text is solid.
- Keep the image design based on:
  - local encryption of the secret image
  - benign PNG carriers
  - extraction and decryption on the receiving side
- Remove any dependency on a website or website-managed state from the image story.
- Keep these image ideas out of v1 and in roadmap/research:
  - deep-learning “hide image in image” networks
  - generative innocent-image synthesis
  - reversible semantic remapping of one photo into another

## Public Interfaces And Types To Define In The PRD
- Extension/local types:
  - `IdentityKey`
  - `InviteCode`
  - `ActivePairingState`
  - `PairedContact`
  - `ConversationState`
  - `TrustStatus`
  - `CoverTopicProfile`
  - `LLMEncodingConfig`
  - `ConversationContextWindow`
  - `ConversationContextSummary`
  - `EncodedGhostscriptMessage`
  - `MessageEnvelope`
  - `StegoImageEnvelope`
- `InviteCode` should capture:
  - `code: string`
  - `format: '4-digit'`
  - expiration timestamp
  - single-use status
- `CoverTopicProfile` should capture:
  - the user-entered default topic text
  - optional tone/style hints if the product later exposes them
  - when the topic was last updated
  - which paired contact it applies to
- `LLMEncodingConfig` should capture:
  - pinned model identifier
  - pinned tokenizer identifier or version
  - `temperature`
  - `p_min`
  - `bitsPerStep`
  - excluded token set
  - fallback strategy
  - tie-break rule
  - payload termination strategy
- `ConversationContextWindow` should capture:
  - conversation id
  - source breakdown (`cache`, `visible-dom`, `history-scroll`)
  - ordered recent messages with sender role and text
  - whether the history window is partial because limits were reached
- `ConversationContextSummary` should capture:
  - dominant topic
  - current subtopic
  - tone/mood
  - stylistic cues safe to reuse in visible cover text
- `MessageEnvelope` should capture:
  - `v` for protocol version
  - `sender_id`
  - `msg_id`
  - `ct` for ciphertext
  - `tag` for `Poly1305` authentication
  - any framing metadata needed before LLM transport encoding
- `EncodedGhostscriptMessage` should capture:
  - the visible natural-language text inserted into Discord
  - the pinned encoding config identifier used to produce it
  - deterministic framing metadata sufficient for the receiver to reproduce the bitstream and validate compatibility
- Image envelope fields should capture:
  - protocol version
  - image mode (`png-lsb-v1`)
  - sender key id
  - full `24-byte` random nonce
  - encrypted payload length
  - ciphertext
  - integrity tag

## Backend And API Requirements
- Define the backend as extension support infrastructure only, not a user-facing product surface.
- Required capabilities:
  - mint short-lived `4-digit` invite codes
  - bind a joiner to an inviter’s live invite session
  - exchange public-key material or session bootstrap data needed by the extension
  - expire, revoke, or invalidate used invites
  - apply abuse controls appropriate to a tiny code space
- Representative endpoints the PRD should define:
  - `POST /pairing/invites`
  - `POST /pairing/invites/{code}/join`
  - `POST /pairing/invites/{code}/confirm`
  - `POST /pairing/reset`
- The backend must not become a message relay or plaintext holder for MVP secure text.

## Test Plan
- Pair two fresh users entirely from the extension and confirm a `4-digit` invite code is created and consumed successfully.
- Verify invite codes expire quickly, cannot be reused, and are protected by rate limiting / abuse throttling.
- Verify the inviter’s topic box becomes the default cover-topic seed for that paired contact until changed.
- Verify secure send/receive works in:
  - direct messages
  - group direct messages
  - servers
  - server channels
- Verify plaintext never appears in Discord’s native composer or readable page DOM during the secure flow.
- Verify Discord only receives ordinary-looking natural-language text for secure text messages.
- Verify the receiver can reconstruct the encoded bitstream, recover the message envelope, and decrypt the original plaintext locally.
- Verify decoding fails closed when:
  - ciphertext or tag is tampered with
  - the pinned model or tokenizer does not match
  - the message was encoded under a different transport config
- Verify the fallback rule behaves correctly when the candidate pool is smaller than `2^n`.
- Verify model/version compatibility is surfaced clearly rather than producing silent corruption.
- Verify messages from unpaired users remain ordinary visible chat text with no false positive secure reveal.
- Verify messages from paired users that do not reconstruct into a valid Ghostscript frame remain plain visible text instead of being mislabeled as tampered.
- Verify unpaired observers in shared chats only see the visible cover text and cannot trigger plaintext reveal.
- For images, validate end-to-end PNG round-trip through Discord upload/download before promising the feature in demo.
- For images, verify extraction with the wrong key or a transformed carrier fails closed.

## Assumptions And Defaults
- `PRD.md` is the only deliverable for implementation mode.
- The PRD should read like a polished hackathon product spec, not an academic crypto paper.
- Text is the core MVP.
- Secure-image stego is a stretch feature after text works reliably.
- There is no user-facing website in the product flow.
- A backend service may still exist behind the extension for invite-code exchange and key/session coordination.
- The invite code is exactly `4 numeric digits`.
- Successful code entry is sufficient trust for MVP.
- The invite-time topic persists as the default cover-topic seed for that paired relationship until changed.
- The authoritative text transport-layer specification is [CoverTextEncodingPRD.md](/Users/peyetuygtf/Projects/ghostscript/CoverTextEncodingPRD.md).
- The preferred encoding defaults are:
  - fallback rule: reduce bits for the current step
  - payload termination: length header
- Ghostscript provides confidentiality and tamper resistance while making messages look like ordinary text to Discord and bystanders, but it does not claim perfect adversarial undetectability or protection against compromised endpoints.
