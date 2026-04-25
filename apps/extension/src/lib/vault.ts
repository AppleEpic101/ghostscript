import type { IdentityKey, VaultState } from "@ghostscript/shared";
import { generateIdentity, unwrapIdentityPrivateKey } from "./crypto";
import { getStoredIdentity, storeIdentity } from "./pairingStore";

let unlockedIdentity: { identity: IdentityKey; privateKey: string } | null = null;

export async function getRuntimeVaultState(): Promise<VaultState> {
  const identity = await getStoredIdentity();

  if (!identity) {
    return "uninitialized";
  }

  return unlockedIdentity ? "unlocked" : "locked";
}

export async function initializeIdentityVault(passphrase: string) {
  const existing = await getStoredIdentity();

  if (existing) {
    throw new Error("A local identity already exists.");
  }

  const generated = await generateIdentity(passphrase);
  await storeIdentity(generated.identity);
  unlockedIdentity = {
    identity: generated.identity,
    privateKey: generated.identity.wrappedPrivateKey ?? "",
  };
  unlockedIdentity = await unwrapIdentityPrivateKey(generated.identity, passphrase);
  return generated;
}

export async function unlockIdentityVault(passphrase: string) {
  const identity = await getStoredIdentity();

  if (!identity) {
    throw new Error("Create a secure identity first.");
  }

  unlockedIdentity = await unwrapIdentityPrivateKey(identity, passphrase);
  return unlockedIdentity;
}

export function lockIdentityVault() {
  unlockedIdentity = null;
}

export async function getUnlockedIdentity() {
  const identity = await getStoredIdentity();

  if (!identity || !unlockedIdentity || unlockedIdentity.identity.id !== identity.id) {
    return null;
  }

  return unlockedIdentity;
}
