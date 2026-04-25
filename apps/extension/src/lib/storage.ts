function getChromeStorage() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return null;
  }

  return chrome.storage.local;
}

export async function readStorageValue<T>(key: string): Promise<T | null> {
  const storage = getChromeStorage();

  if (!storage) {
    const rawValue = window.localStorage.getItem(key);

    if (!rawValue) {
      return null;
    }

    return JSON.parse(rawValue) as T;
  }

  return new Promise<T | null>((resolve, reject) => {
    storage.get([key], (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve((result[key] as T | undefined) ?? null);
    });
  });
}

export async function writeStorageValue<T>(key: string, value: T) {
  const storage = getChromeStorage();

  if (!storage) {
    window.localStorage.setItem(key, JSON.stringify(value));
    return;
  }

  await new Promise<void>((resolve, reject) => {
    storage.set({ [key]: value }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}

export async function removeStorageValue(key: string) {
  const storage = getChromeStorage();

  if (!storage) {
    window.localStorage.removeItem(key);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    storage.remove(key, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}

export async function clearStorageValues() {
  const storage = getChromeStorage();

  if (!storage) {
    window.localStorage.clear();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    storage.clear(() => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}
