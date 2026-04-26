const DEPLOY_TOKEN_STORAGE_KEY = "ghostscript-extension-deploy-token";
const CURRENT_DEPLOY_TOKEN = import.meta.env.VITE_GHOSTSCRIPT_DEPLOY_TOKEN ?? "local-dev";

void storeDeployToken();

chrome.runtime.onInstalled.addListener(() => {
  console.info("Ghostscript extension installed");
});

async function storeDeployToken() {
  const storedValues = await chrome.storage.local.get([DEPLOY_TOKEN_STORAGE_KEY]);
  const storedDeployToken = storedValues[DEPLOY_TOKEN_STORAGE_KEY];

  if (storedDeployToken === CURRENT_DEPLOY_TOKEN) {
    return;
  }

  await chrome.storage.local.set({
    [DEPLOY_TOKEN_STORAGE_KEY]: CURRENT_DEPLOY_TOKEN,
  });
}
