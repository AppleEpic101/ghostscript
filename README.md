# Ghostscript

Ghostscript is a Chrome extension for Discord Web that lets two paired people exchange end-to-end encrypted messages hidden inside ordinary-looking chat text. To everyone else in the conversation, the message looks like a normal Discord post. To the paired recipient, Ghostscript can reveal the real private message inside the extension.

The project is designed for shared spaces, not just private chats. That includes Discord direct messages, group DMs, servers, and server channels. The goal is simple: protect the real message while making the visible message blend naturally into the conversation.

## What Ghostscript Does

Ghostscript acts as a privacy layer on top of Discord Web.

- Paired users type private text into a Ghostscript compose box, not directly into Discord.
- Ghostscript encrypts that private text locally on the device.
- The encrypted payload is turned into plausible natural-language cover text.
- Discord only receives the visible cover text.
- A paired recipient can decode and reveal the real plaintext inside the extension.

Everyone else, including Discord itself, sees only the ordinary-looking visible message.

## Product Goals

Ghostscript is trying to do two things at the same time:

- Provide real message confidentiality using standard, well-known cryptography.
- Make the visible output read like ordinary chat text instead of obvious ciphertext.

The product does not claim perfect invisibility against a determined analyst. The promise is more practical than absolute: normal observers and platforms see believable chat text, while only paired users with the right local state can recover the real message.

## MVP Scope

The first version focuses on a narrow but complete experience:

- Discord Web on desktop Chrome
- Secure text messages
- Pairing and invite flows entirely inside the extension
- Local encryption before transport
- Natural-language encoding for the visible Discord message

Supported Discord surfaces for MVP:

- Direct messages
- Group direct messages
- Servers
- Server channels

Out of scope for v1:

- Mobile
- Multi-device sync
- Perfect steganographic undetectability
- Compatibility across different model families or tokenizers for the same encoded message
- A separate user-facing website

Secure image sharing is planned only as a stretch feature after text messaging works reliably.

## How Pairing Works

Ghostscript uses an extension-only pairing flow.

1. The inviter opens the extension.
2. The inviter enters a default cover-text topic.
3. Ghostscript creates a short-lived 4-digit invite code.
4. The inviter shares that code out of band.
5. The joiner enters the code inside Ghostscript.
6. The extension links the two users and stores that paired relationship locally.

That invite-time topic becomes the default seed for future visible cover text between the pair until one of them changes it.

For MVP, successful code entry is enough to establish trust. The first version does not require safety numbers, QR verification, hash words, or third-party account checks.

Because the code space is tiny, the invite service must enforce:

- Short expiration
- Single-use invites
- Strong rate limiting and abuse throttling

The 4-digit code is only a rendezvous mechanism. It is not the actual secret protecting messages.

## Sending a Secure Message

Ghostscript injects its own secure compose experience into Discord. Users should never type protected plaintext into Discord’s native composer when sending a secure message.

The outgoing flow works like this:

1. The user writes the real message in the Ghostscript overlay.
2. Ghostscript identifies the active paired context for that Discord thread.
3. It loads the saved default cover-topic seed for that paired contact.
4. It may also use recent chat context to help the visible output sound natural.
5. If the message is large enough, it may compress it.
6. It encrypts the message locally.
7. It wraps the encrypted payload in a message envelope.
8. It converts that encrypted bitstream into natural-language text.
9. Only the visible generated text is inserted into Discord.

Insertion into Discord should happen in a way that keeps Discord’s own editor and send behavior working normally.

## Receiving a Secure Message

Ghostscript watches Discord messages and can try decoding messages from paired contacts in the background.

- If a message is just normal visible text, it stays that way.
- If Ghostscript successfully reconstructs and verifies a hidden payload, it reveals the true plaintext in an extension-controlled overlay.
- If a hidden payload is detected but fails authenticity checks, Ghostscript shows a `Tampered/Corrupted` state.

The extension should never write recoverable plaintext back into Discord’s readable page DOM.

## Trust and Status States

Ghostscript needs clear user-visible states:

- `unpaired`
- `invite-pending`
- `paired`
- `locked`
- `tampered/decryption-failed`

## Cover Text Behavior

The visible Discord message should look like ordinary language that fits the current conversation and the pair’s chosen topic seed.

Ghostscript aims for plausible, natural cover text in shared chat spaces, but it does not promise that hidden use is impossible to detect. Its public claim should be more careful:

- Discord and bystanders see only normal-looking text.
- Recovering the hidden plaintext requires the paired extension state plus matching cryptographic and model configuration.
- The goal is plausible visible deniability in everyday chat use, not mathematically guaranteed invisibility.

## Security Model

Ghostscript uses standard cryptography for confidentiality and message integrity. The language around security should stay grounded: the language model is only a transport layer for turning encrypted bits into natural-looking text. It is not what makes the message secure.

In practical terms:

- Messages are encrypted before they are encoded into cover text.
- Only paired users with the right keys and matching configuration can decrypt them.
- If decoding fails or message authentication fails, Ghostscript should fail closed and not reveal partial plaintext.

The planned building blocks are:

- X25519 for shared secret agreement
- HKDF-SHA-256 for key derivation
- XChaCha20-Poly1305 for authenticated encryption
- Ed25519 fingerprints for local identity and contact binding
- Argon2id for protecting local private keys with a passphrase

For text messages, Ghostscript uses counter-based nonces derived during the authenticated handshake, along with a compact message identifier so each side can derive the full nonce locally.

Signal-style ratcheting is a roadmap item, not part of the MVP.

## Natural-Language Encoding Layer

Ghostscript’s cover-text generation depends on a deterministic encoding and decoding setup. In plain terms, both sides need to agree on the exact same model family, tokenizer, and decoding configuration or the hidden message may not decode correctly.

The transport contract includes:

- Matching model weights or checkpoint family
- Matching tokenizer and inference configuration
- Deterministic candidate-pool construction at every token step
- Deterministic tie-breaking
- Exclusion of blocked or special tokens
- Merge-safe token selection so tokenization remains stable
- A shared bits-per-step setting
- A fallback rule for moments when the available candidate pool is too small
- A clear way to know when the hidden payload ends

Preferred defaults:

- Fallback strategy: reduce bits for that step
- Payload termination strategy: encode a length header before the payload bits

Model or tokenizer drift should be treated as a compatibility problem, not as a silent failure mode.

## Local State the Extension Owns

The extension is the system of record for:

- Local identity keys
- Pairing state
- Trust state
- Per-contact cover-topic defaults
- Per-conversation cryptographic state

This information lives in the extension experience, not in a user-facing website.

## Backend Responsibilities

The backend exists only to support the extension. It is not meant to be a user-facing product surface and it is not a message relay for MVP text messaging.

Its responsibilities are:

- Mint short-lived 4-digit invite codes
- Bind joiners to active invite sessions
- Exchange public-key material or bootstrap data needed for pairing
- Expire, revoke, or invalidate used invites
- Apply abuse protections suited to a very small code space

Representative API endpoints:

- `POST /pairing/invites`
- `POST /pairing/invites/{code}/join`
- `POST /pairing/invites/{code}/confirm`
- `POST /pairing/reset`

The backend must never store:

- Plaintext messages
- Conversation secrets
- Unwrapped private keys
- Plaintext image payloads

It may store only what is needed to support pairing, such as public keys, invite state, session state, and encrypted metadata if necessary.

## Core Data Concepts

The product spec defines a set of important concepts the system should model:

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

Some of the most important details those types should capture:

- Invite codes should include the code itself, 4-digit format, expiration, and whether they have been used.
- Cover-topic profiles should track the user’s chosen default topic, future style hints, update time, and paired contact.
- Encoding configs should pin the model, tokenizer, transport settings, fallback behavior, and payload termination strategy.
- Conversation context should track which conversation is being used, where context came from, the recent message window, and whether history is partial.
- Context summaries should capture topic, subtopic, tone, and style cues safe to reuse in visible text.
- Message envelopes should include protocol version, sender identifier, message identifier, ciphertext, authentication tag, and any framing metadata required before transport encoding.
- Encoded messages should include the visible text, the encoding configuration identifier, and enough framing metadata for the receiver to reproduce the bitstream and validate compatibility.
- Image envelopes should include protocol version, image mode, sender key identifier, nonce, encrypted payload length, ciphertext, and integrity tag.

## Stretch Feature: Secure Images

Secure image support belongs in the roadmap, not the MVP.

The intended direction is:

- Encrypt the secret image locally
- Hide it inside a benign PNG carrier
- Let the receiver extract and decrypt it locally

Not part of v1:

- Deep-learning image-in-image hiding
- Generative innocent-image synthesis
- Reversible semantic remapping of one photo into another

Any image work should first prove that a PNG can survive Discord upload and download without breaking extraction.

## Expected Behavior on Failure

Ghostscript should fail closed.

- If decoding does not produce a valid Ghostscript frame, the message stays ordinary visible text.
- If a frame is recovered but authentication fails, no partial plaintext should be shown.
- `Tampered/Corrupted` should appear only when Ghostscript content was actually detected but failed verification.
- Messages from unpaired users should remain normal chat text with no false secure reveal.
- Messages from paired users that are just ordinary text should stay ordinary text and should not be mislabeled as tampered.

## Test Expectations

The project should validate the full secure-text flow end to end.

That includes:

- Creating and consuming 4-digit invite codes entirely from the extension
- Confirming invite expiration, single-use behavior, and rate limiting
- Verifying that the inviter’s topic becomes the default cover-topic seed
- Testing secure send and receive across DMs, group DMs, servers, and server channels
- Confirming plaintext never appears in Discord’s native composer or readable DOM
- Confirming Discord only receives ordinary-looking cover text
- Verifying that paired recipients can reconstruct, decode, and decrypt the original message locally
- Verifying fail-closed behavior for tampering, config mismatches, and model/tokenizer incompatibility
- Verifying the fallback rule when the candidate pool is too small
- Verifying that compatibility issues are surfaced clearly instead of silently corrupting messages
- Confirming that unpaired observers cannot reveal plaintext in shared chats

For image work, tests should only be promised after successful end-to-end PNG round-trip validation and wrong-key failure testing.

## Project Positioning

Ghostscript should read like a polished hackathon product with a serious approach to privacy. It is a browser-extension privacy overlay for Discord Web, built for people who want secure text hidden inside normal-looking conversation without relying on a separate website or exposing plaintext to the platform.
