const DEPLOY_TOKEN_STORAGE_KEY = "ghostscript-extension-deploy-token";
const CURRENT_DEPLOY_TOKEN = import.meta.env.VITE_GHOSTSCRIPT_DEPLOY_TOKEN ?? "local-dev";

void clearStorageOnNewDeploy();

chrome.runtime.onInstalled.addListener(() => {
  console.info("Ghostscript extension scaffold installed");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ghostscript:ping") {
    sendResponse({ ok: true, source: "background" });
  }

  return true;
});

async function clearStorageOnNewDeploy() {
  const storedValues = await chrome.storage.local.get([DEPLOY_TOKEN_STORAGE_KEY]);
  const storedDeployToken = storedValues[DEPLOY_TOKEN_STORAGE_KEY];

  if (storedDeployToken === CURRENT_DEPLOY_TOKEN) {
    return;
  }

  await chrome.storage.local.clear();
  await chrome.storage.local.set({
    [DEPLOY_TOKEN_STORAGE_KEY]: CURRENT_DEPLOY_TOKEN,
  });

  console.info("Cleared extension storage for fresh deploy.");
}
