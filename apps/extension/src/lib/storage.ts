function getChromeStorage() {
  try {
    if (typeof chrome === "undefined" || !chrome.runtime?.id || !chrome.storage?.local) {
      return null;
    }

    return chrome.storage.local;
  } catch {
    return null;
  }
}

function shouldUseWindowLocalStorage() {
  return typeof window !== "undefined" && (typeof chrome === "undefined" || !chrome.storage?.local);
}

function getChromeRuntimeError() {
  try {
    return chrome.runtime.lastError ? new Error(chrome.runtime.lastError.message) : null;
  } catch (error) {
    return error instanceof Error ? error : new Error("Extension context invalidated.");
  }
}

export async function readStorageValue<T>(key: string): Promise<T | null> {
  const storage = getChromeStorage();

  if (!storage) {
    if (!shouldUseWindowLocalStorage()) {
      return null;
    }

    const rawValue = window.localStorage.getItem(key);
    return rawValue ? (JSON.parse(rawValue) as T) : null;
  }

  return new Promise<T | null>((resolve, reject) => {
    try {
      storage.get([key], (result) => {
        const runtimeError = getChromeRuntimeError();
        if (runtimeError) {
          reject(runtimeError);
          return;
        }

        resolve((result[key] as T | undefined) ?? null);
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error("Failed to read extension storage."));
    }
  });
}

export async function writeStorageValue<T>(key: string, value: T) {
  const storage = getChromeStorage();

  if (!storage) {
    if (!shouldUseWindowLocalStorage()) {
      return;
    }

    window.localStorage.setItem(key, JSON.stringify(value));
    return;
  }

  await new Promise<void>((resolve, reject) => {
    try {
      storage.set({ [key]: value }, () => {
        const runtimeError = getChromeRuntimeError();
        if (runtimeError) {
          reject(runtimeError);
          return;
        }

        resolve();
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error("Failed to write extension storage."));
    }
  });
}

export async function clearStorageValues() {
  const storage = getChromeStorage();

  if (!storage) {
    if (!shouldUseWindowLocalStorage()) {
      return;
    }

    window.localStorage.clear();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    try {
      storage.clear(() => {
        const runtimeError = getChromeRuntimeError();
        if (runtimeError) {
          reject(runtimeError);
          return;
        }

        resolve();
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error("Failed to clear extension storage."));
    }
  });
}
