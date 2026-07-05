const HOST_NAME = "com.factcheck.host";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "factCheck") {
    chrome.runtime.sendNativeMessage(
      HOST_NAME,
      { text: request.text },
      (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      }
    );
    return true; // keep the message channel open for the async response
  }
});