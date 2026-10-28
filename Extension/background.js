// Service worker: runs a fact check when the toolbar button (or Alt+Shift+F) is used.
//
// Flow:
//   1. Inject Readability.js and the content script into the current tab.
//   2. Pull the article text out of the page with Readability.
//   3. Send it to the local Python host over native messaging
//      (extensions can't run Python themselves, so this is the bridge).
//   4. Hand the flagged claims back to the content script, which underlines them.

const HOST_NAME = "com.factcheck.host";

chrome.action.onClicked.addListener((tab) => {
  runCheck(tab.id);
});

async function runCheck(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["Readability.js", "content.js"],
    });

    await sendToTab(tabId, { type: "fc-status", state: "checking" });
    setBadge(tabId, "…", "#6b7280");

    const [extraction] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Readability mutates the document it parses, so give it a copy.
        const article = new Readability(document.cloneNode(true)).parse();
        return article ? article.textContent : null;
      },
    });

    const articleText = extraction && extraction.result;
    if (!articleText || !articleText.trim()) {
      await sendToTab(tabId, { type: "fc-status", state: "error", message: "Couldn't find article text on this page." });
      setBadge(tabId, "!", "#b91c1c");
      return;
    }

    const response = await askHost(articleText);
    if (response.error) {
      await sendToTab(tabId, { type: "fc-status", state: "error", message: response.error });
      setBadge(tabId, "!", "#b91c1c");
      return;
    }

    const claims = Array.isArray(response.claims) ? response.claims : [];
    const shown = await sendToTab(tabId, { type: "fc-results", claims });
    const count = shown && typeof shown.matched === "number" ? shown.matched : claims.length;
    setBadge(tabId, count ? String(count) : "✓", count ? "#b91c1c" : "#15803d");
  } catch (err) {
    console.error("Fact check failed:", err);
    try {
      await sendToTab(tabId, { type: "fc-status", state: "error", message: String(err.message || err) });
    } catch (_) { /* tab may have closed */ }
    setBadge(tabId, "!", "#b91c1c");
  }
}

function askHost(text) {
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(HOST_NAME, { text }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ error: "Native host: " + chrome.runtime.lastError.message });
      } else if (!response) {
        resolve({ error: "The native host returned nothing." });
      } else {
        resolve(response);
      }
    });
  });
}

function sendToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

function setBadge(tabId, text, color) {
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setBadgeBackgroundColor({ tabId, color });
}

// Exposed so the check can be started from DevTools or a test harness.
self.runCheck = runCheck;
