# Fact Check

A Chrome extension that fact-checks the article you're reading. Click the toolbar button (or press **Alt+Shift+F**) and it underlines claims Claude flags as **false (red)** or **misleading (yellow)**. Hover over an underline to see why.

## How it works

```
Article page ─► Readability.js ─► service worker ─► native messaging ─► Python host ─► Claude
                (pulls out the     (background.js)   (Chrome talks to    (host.py,
                 article text)                        a local process)    Agent SDK)
                                                                              │
Underlines + hover explanations ◄── content.js ◄──────── flagged claims ◄─────┘
```

1. **Extract.** `background.js` injects [Readability.js](https://github.com/mozilla/readability) into the page and pulls out just the article text.
2. **Bridge.** Chrome extensions can't run Python, so the text goes over [native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) to `NativeHost/host.py`, a small program Chrome starts on your computer.
3. **Check.** The host sends the article to Claude through the [Claude Agent SDK](https://docs.claude.com/en/docs/agent-sdk/overview) and asks for each false or misleading claim as an exact quote, a red or yellow rating, and a one-to-two-sentence explanation.
4. **Show.** `content.js` finds each quote in the page text and paints it with the [CSS Custom Highlight API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API), so the page's own DOM is never modified. Hovering over a highlighted range shows its explanation.

## Setup

### 1. Load the extension

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick the `Extension` folder.
3. Copy the extension's ID from its card.

### 2. Set up the native host

```bash
cd NativeHost
python -m venv venv
# Windows: venv\Scripts\activate    macOS/Linux: source venv/bin/activate
pip install claude-agent-sdk
```

The host uses the Claude Agent SDK, so it needs Claude access set up on your machine. See the [Agent SDK docs](https://docs.claude.com/en/docs/agent-sdk/overview) for authentication.

Edit `NativeHost/manifest.json`:

- `path`: the absolute path to `run_host.bat` (Windows) or `run_host.sh` (macOS/Linux). Update the paths inside `run_host.bat` too.
- `allowed_origins`: `chrome-extension://<your extension ID>/`

Then register the manifest with Chrome:

- **Windows:** add a registry key `HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.factcheck.host` whose default value is the full path to `manifest.json`.
- **macOS:** copy `manifest.json` to `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.factcheck.host.json`.
- **Linux:** copy `manifest.json` to `~/.config/google-chrome/NativeMessagingHosts/com.factcheck.host.json`.

On macOS/Linux, make the launcher executable: `chmod +x NativeHost/run_host.sh`.

### 3. Use it

Open an article and click the extension's toolbar button. A pill in the corner shows progress, then a summary of how many claims were flagged. **Clear** removes the underlines.

## Project structure

```
Extension/
  manifest.json    # MV3 manifest: toolbar action, Alt+Shift+F shortcut
  background.js    # runs a check: extract text, call the host, send results to the page
  content.js       # status pill, quote matching, highlights, hover explanations
  Readability.js   # Mozilla's article extractor
NativeHost/
  host.py          # native messaging host: asks Claude, returns flagged claims as JSON
  run_host.bat     # Windows launcher
  run_host.sh      # macOS/Linux launcher
  manifest.json    # native host manifest (edit paths and extension ID)
```

## Limits

- Very long articles are trimmed to the first 60,000 characters before checking.
- A quote has to appear in the page text (ignoring whitespace, curly quotes and dashes) to be underlined. If Claude paraphrases instead of quoting, that claim is counted in the summary as not found.
