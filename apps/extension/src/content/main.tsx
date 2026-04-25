import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { TRUST_STATUS_LABELS, type OverlayMessageState, type PairedContact, type VaultState } from "@ghostscript/shared";
import {
  extractMessageText,
  findDiscordComposerAnchor,
  findDiscordMessageRows,
  getActiveConversationId,
  getActiveConversationLabel,
  getDiscordMessageId,
  insertIntoDiscordComposer,
  isDiscordDirectMessageRoute,
} from "../lib/discord";
import { deriveSessionSecrets, decryptTextMessage, encryptTextMessage } from "../lib/crypto";
import { buildFallbackCoverText, decodeEnvelopeFromText, encodeEnvelopeIntoCoverText, zeroWidthStegoCodec } from "../lib/messages";
import { getConversationState, getPrimaryContact, readExtensionState, updateConversationState } from "../lib/pairingStore";
import { getInviteSessionStatus } from "../lib/pairingApi";
import { clearStorageValues } from "../lib/storage";
import { getRuntimeVaultState, getUnlockedIdentity, initializeIdentityVault, lockIdentityVault, unlockIdentityVault } from "../lib/vault";
import overlayStyles from "./styles.css?inline";

const shadowRoots = new WeakMap<HTMLElement, ShadowRoot>();
const overlayHosts = new WeakMap<HTMLElement, HTMLElement>();
const SESSION_SYNC_POLL_MS = 3000;

function GhostscriptOverlay() {
  const [vaultState, setVaultState] = useState<VaultState>("uninitialized");
  const [conversationLabel, setConversationLabel] = useState("this DM");
  const [contact, setContact] = useState<PairedContact | null>(null);
  const [plaintext, setPlaintext] = useState("");
  const [coverText, setCoverText] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  async function refreshState() {
    const [nextVaultState, nextContact] = await Promise.all([
      getRuntimeVaultState(),
      getPrimaryContact(),
    ]);

    setVaultState(nextVaultState);
    setConversationLabel(getActiveConversationLabel());
    setContact(nextContact);
  }

  useEffect(() => {
    void refreshState();

    const interval = window.setInterval(() => {
      void refreshState();
    }, 1500);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let requestInFlight = false;

    const syncActivePairing = async () => {
      if (requestInFlight) {
        return;
      }

      const extensionState = await readExtensionState();
      const activePairing = extensionState.activePairing;

      if (!activePairing || activePairing.session.status === "invalidated") {
        return;
      }

      requestInFlight = true;

      try {
        const response = await getInviteSessionStatus(activePairing.inviteCode);

        if (cancelled || response.session.status !== "invalidated") {
          return;
        }

        await clearStorageValues();
        lockIdentityVault();
        setStatusMessage("The connection was ended from the other side.");
        setPlaintext("");
        setCoverText("");
        await refreshState();
      } catch {
        // The popup surfaces pairing API errors. The overlay only needs to drop state once invalidated.
      } finally {
        requestInFlight = false;
      }
    };

    void syncActivePairing();
    const interval = window.setInterval(() => {
      void syncActivePairing();
    }, SESSION_SYNC_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void scanVisibleMessages();
    }, 1200);

    void scanVisibleMessages();

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  async function handleUnlock() {
    setErrorMessage(null);
    setStatusMessage(null);

    if (!passphrase.trim()) {
      setErrorMessage("Enter a passphrase first.");
      return;
    }

    try {
      if (vaultState === "uninitialized") {
        await initializeIdentityVault(passphrase);
        setStatusMessage("Secure identity created and unlocked.");
      } else {
        await unlockIdentityVault(passphrase);
        setStatusMessage("Secure identity unlocked.");
      }

      setPassphrase("");
      await refreshState();
      await scanVisibleMessages();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to unlock local keys.");
    }
  }

  async function handleLock() {
    lockIdentityVault();
    setStatusMessage("Local key material locked.");
    setErrorMessage(null);
    await refreshState();
    await scanVisibleMessages();
  }

  async function handleOpenOptions() {
    await chrome.runtime.openOptionsPage();
  }

  async function handleSend() {
    const conversationId = getActiveConversationId();

    if (!conversationId) {
      setErrorMessage("Open a Discord 1:1 DM first.");
      return;
    }

    if (!contact) {
      setErrorMessage("Pair a contact in Ghostscript settings before sending.");
      return;
    }

    if (contact.trustStatus !== "verified") {
      setErrorMessage("Finish safety-number verification before secure send.");
      return;
    }

    if (!plaintext.trim()) {
      setErrorMessage("Secure plaintext is required.");
      return;
    }

    if (!contact.publicKey) {
      setErrorMessage("Paired contact is missing public key material.");
      return;
    }

    const unlockedIdentity = await getUnlockedIdentity();

    if (!unlockedIdentity || !unlockedIdentity.identity.publicKey || !unlockedIdentity.identity.senderId) {
      setErrorMessage("Unlock your local identity before sending.");
      return;
    }

    setIsSending(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const conversation = await getConversationState(conversationId, contact);
      const nextMessageId = (conversation.sendCounter ?? 0) + 1;
      const secrets = await deriveSessionSecrets(
        unlockedIdentity.privateKey,
        contact.publicKey.publicKey,
        unlockedIdentity.identity.fingerprint,
        contact.publicKey.fingerprint,
      );
      const envelope = await encryptTextMessage({
        messageKey: secrets.messageKey,
        nonceBase: secrets.nonceBase,
        plaintext: plaintext.trim(),
        msgId: nextMessageId,
        senderId: unlockedIdentity.identity.senderId,
      });
      const finalCoverText = coverText.trim() || buildFallbackCoverText(plaintext, contact.displayName || conversationLabel);
      const outboundMessage = encodeEnvelopeIntoCoverText(finalCoverText, envelope);

      if (outboundMessage.length > 2000) {
        throw new Error("Cover text and hidden payload exceed Discord's 2000 character limit.");
      }

      insertIntoDiscordComposer(outboundMessage);

      await updateConversationState(conversationId, (current) => ({
        ...current,
        contactId: contact.id,
        trustStatus: contact.trustStatus,
        canDecrypt: true,
        locked: false,
        lastMessageId: nextMessageId,
        sendCounter: nextMessageId,
      }));

      setPlaintext("");
      setCoverText("");
      setStatusMessage("Secure message inserted into Discord.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Secure send failed.");
    } finally {
      setIsSending(false);
    }
  }

  const trustLabel = contact ? TRUST_STATUS_LABELS[contact.trustStatus] : "Unpaired";
  const canSend = Boolean(contact && contact.trustStatus === "verified" && vaultState === "unlocked");

  return (
    <>
      <style>{overlayStyles}</style>
      <section className="ghostscript-card" aria-label="Ghostscript secure overlay">
        <div className="ghostscript-topline">
          <div>
            <p className="ghostscript-eyebrow">Ghostscript secure compose</p>
            <h2 className="ghostscript-title">Protected DM flow</h2>
          </div>
          <span className="ghostscript-pill">{trustLabel}</span>
        </div>

        <p className="ghostscript-copy">
          Plaintext stays inside Ghostscript. Discord only receives cover text plus the hidden secure payload.
        </p>

        <div className="ghostscript-grid">
          <label className="ghostscript-field">
            <span>Secure plaintext</span>
            <textarea
              className="ghostscript-textarea"
              placeholder={`Write the real message for ${conversationLabel}.`}
              value={plaintext}
              onChange={(event) => setPlaintext(event.target.value)}
            />
          </label>

          <label className="ghostscript-field">
            <span>Manual cover text (optional)</span>
            <textarea
              className="ghostscript-textarea ghostscript-textarea--compact"
              placeholder="Leave blank to use the fallback cover-text template."
              value={coverText}
              onChange={(event) => setCoverText(event.target.value)}
            />
          </label>
        </div>

        <div className="ghostscript-status-row">
          <span>Contact</span>
          <strong>{contact?.displayName || "No verified pairing yet"}</strong>
          <span>Vault</span>
          <strong>{vaultState}</strong>
        </div>

        {vaultState !== "unlocked" ? (
          <div className="ghostscript-lockbox">
            <label className="ghostscript-field">
              <span>{vaultState === "uninitialized" ? "Create a passphrase" : "Unlock passphrase"}</span>
              <input
                className="ghostscript-input"
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                placeholder={vaultState === "uninitialized" ? "Create a passphrase" : "Unlock local keys"}
              />
            </label>
            <button className="ghostscript-button" type="button" onClick={() => void handleUnlock()}>
              {vaultState === "uninitialized" ? "Create secure identity" : "Unlock keys"}
            </button>
          </div>
        ) : (
          <div className="ghostscript-actions">
            <button className="ghostscript-button ghostscript-button--secondary" type="button" onClick={handleLock}>
              Lock keys
            </button>
            <button
              className="ghostscript-button ghostscript-button--secondary"
              type="button"
              onClick={() => setCoverText(buildFallbackCoverText(plaintext, contact?.displayName || conversationLabel))}
            >
              Use fallback cover text
            </button>
            <button className="ghostscript-button" type="button" disabled={!canSend || isSending} onClick={() => void handleSend()}>
              {isSending ? "Sending..." : "Send secure message"}
            </button>
          </div>
        )}

        {!contact ? (
          <div className="ghostscript-callout">
            <p>Ghostscript is unpaired for this DM. Finish pairing and verification before secure send or decrypt.</p>
            <button className="ghostscript-button ghostscript-button--secondary" type="button" onClick={() => void handleOpenOptions()}>
              Open pairing settings
            </button>
          </div>
        ) : null}

        {statusMessage ? <p className="ghostscript-feedback ghostscript-feedback--success">{statusMessage}</p> : null}
        {errorMessage ? <p className="ghostscript-feedback ghostscript-feedback--error">{errorMessage}</p> : null}
      </section>
    </>
  );
}

async function scanVisibleMessages() {
  if (!isDiscordDirectMessageRoute()) {
    return;
  }

  const state = await readExtensionState();
  const unlockedIdentity = await getUnlockedIdentity();
  const rows = findDiscordMessageRows();

  for (const row of rows) {
    const text = extractMessageText(row);

    if (!text || !zeroWidthStegoCodec.hasPayload(text)) {
      continue;
    }

    const messageId = getDiscordMessageId(row);

    try {
      const { envelope } = decodeEnvelopeFromText(text);

      if (envelope.senderId === unlockedIdentity?.identity.senderId) {
        continue;
      }

      const contact = state.contacts.find((candidate) => candidate.senderId === envelope.senderId) ?? null;

      if (!contact || !contact.publicKey) {
        renderMessageOverlay(row, {
          state: "pair-required",
          title: "Encrypted Message: Click to Pair",
          body: "A valid Ghostscript payload was detected, but this browser does not have the shared key for it yet.",
        });
        continue;
      }

      if (!unlockedIdentity?.identity.publicKey) {
        renderMessageOverlay(row, {
          state: "locked",
          title: "Ghostscript locked",
          body: "Unlock your local key vault to reveal this message.",
        });
        continue;
      }

      const conversationId = getActiveConversationId() ?? contact.id;
      const conversation = await getConversationState(conversationId, contact);

      if ((conversation.receiveWatermark ?? 0) >= envelope.msgId) {
        renderMessageOverlay(row, {
          state: "tampered",
          title: "Replay blocked",
          body: "This secure payload reuses an old message counter and was not rendered.",
        });
        continue;
      }

      const secrets = await deriveSessionSecrets(
        unlockedIdentity.privateKey,
        contact.publicKey.publicKey,
        unlockedIdentity.identity.fingerprint,
        contact.publicKey.fingerprint,
      );
      const plaintext = await decryptTextMessage({
        envelope,
        messageKey: secrets.messageKey,
        nonceBase: secrets.nonceBase,
      });

      renderMessageOverlay(row, {
        state: "plain",
        title: "Ghostscript plaintext",
        body: plaintext,
      });

      await updateConversationState(conversationId, (current) => ({
        ...current,
        contactId: contact.id,
        trustStatus: contact.trustStatus,
        canDecrypt: true,
        locked: false,
        receiveWatermark: envelope.msgId,
        lastProcessedDiscordMessageId: messageId,
      }));
    } catch (error) {
      renderMessageOverlay(row, {
        state: "tampered",
        title: "Tampered / corrupted",
        body: error instanceof Error ? error.message : "The secure payload failed validation.",
      });
    }
  }
}

function renderMessageOverlay(
  row: HTMLElement,
  options: {
    state: OverlayMessageState;
    title: string;
    body: string;
  },
) {
  let host = overlayHosts.get(row);

  if (!host) {
    host = document.createElement("div");
    host.setAttribute("data-ghostscript-message-host", "true");
    row.appendChild(host);
    overlayHosts.set(row, host);
  }

  const shadowRoot = ensureShadowRoot(host);
  shadowRoot.replaceChildren();

  const styleElement = document.createElement("style");
  styleElement.textContent = overlayStyles;

  const panel = document.createElement("section");
  panel.className = `ghostscript-inline ghostscript-inline--${options.state}`;

  const title = document.createElement("strong");
  title.className = "ghostscript-inline__title";
  title.textContent = options.title;

  const body = document.createElement("p");
  body.className = "ghostscript-inline__body";
  body.textContent = options.body;

  panel.append(title, body);
  shadowRoot.append(styleElement, panel);
}

function ensureShadowRoot(host: HTMLElement) {
  const existing = shadowRoots.get(host);

  if (existing) {
    return existing;
  }

  const shadowRoot = host.attachShadow({ mode: "closed" });
  shadowRoots.set(host, shadowRoot);
  return shadowRoot;
}

let composeRoot: ReactDOM.Root | null = null;

function mountOverlay() {
  if (!isDiscordDirectMessageRoute()) {
    return;
  }

  const anchor = findDiscordComposerAnchor();

  if (!anchor) {
    return;
  }

  let host = document.getElementById("ghostscript-root");

  if (!host) {
    host = document.createElement("div");
    host.id = "ghostscript-root";
    host.setAttribute("data-ghostscript-root", "true");
    const parent = anchor.parentElement ?? document.body;
    parent.insertAdjacentElement("beforebegin", host);
  }

  const shadowRoot = ensureShadowRoot(host);

  if (!composeRoot) {
    composeRoot = ReactDOM.createRoot(shadowRoot);
  }

  composeRoot.render(
    <React.StrictMode>
      <GhostscriptOverlay />
    </React.StrictMode>,
  );
}

const observer = new MutationObserver(() => {
  mountOverlay();
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

mountOverlay();
