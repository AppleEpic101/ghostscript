chrome.runtime.onInstalled.addListener(() => {
  console.info("Ghostscript extension scaffold installed");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ghostscript:ping") {
    sendResponse({ ok: true, source: "background" });
  }

  return true;
});
