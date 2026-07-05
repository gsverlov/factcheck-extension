document.getElementById("check").addEventListener("click", async () => {
  const resultDiv = document.getElementById("result");
  resultDiv.textContent = "Extracting article...";

  // Find the tab the user is currently looking at.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Inject Readability.js into that tab, then run an extraction function.
  // executeScript can run multiple files in order — first the library, then our code.
  const [injectionResult] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["Readability.js"],
  });

  // Now run a function in the page context that uses Readability to extract the article.
  const [extractionResult] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      // Clone the document so Readability doesn't destroy the real page.
      const docClone = document.cloneNode(true);
      const reader = new Readability(docClone);
      const article = reader.parse();
      return article ? article.textContent : null;
    },
  });

  const articleText = extractionResult.result;

  if (!articleText) {
    resultDiv.textContent = "Couldn't extract article text from this page.";
    return;
  }

  resultDiv.textContent = "Fact-checking...";

  // Send the real article text through the same tunnel as before.
  chrome.runtime.sendMessage(
    { action: "factCheck", text: articleText },
    (response) => {
      if (response.error) {
        resultDiv.textContent = "Error: " + response.error;
      } else {
        resultDiv.textContent = response.verdict;
      }
    }
  );
});