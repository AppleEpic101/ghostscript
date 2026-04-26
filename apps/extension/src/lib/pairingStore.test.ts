import test from "node:test";
import assert from "node:assert/strict";
import { readExtensionState, storeAiModeEnabled } from "./pairingStore";

test("readExtensionState defaults aiModeEnabled to true for legacy storage", async () => {
  installWindowStorage();

  const state = await readExtensionState();

  assert.equal(state.aiModeEnabled, true);
});

test("storeAiModeEnabled persists the toggle state", async () => {
  installWindowStorage();

  await storeAiModeEnabled(false);
  const state = await readExtensionState();
  assert.equal(state.aiModeEnabled, false);

  await storeAiModeEnabled(true);
  const nextState = await readExtensionState();
  assert.equal(nextState.aiModeEnabled, true);
});

function installWindowStorage() {
  const storage = new Map<string, string>();
  const localStorage = {
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
    clear() {
      storage.clear();
    },
  };

  Object.assign(globalThis, {
    window: {
      localStorage,
    },
  });
}
