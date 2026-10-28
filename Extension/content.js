// Content script: shows the check's progress and underlines flagged claims.
//
// Claims come back from Claude as exact quotes. Each quote is located in the
// page's text, wrapped in a DOM Range, and painted with the CSS Custom
// Highlight API, so the page's own DOM is never modified. Hovering over an
// underline shows Claude's explanation.

(() => {
  if (window.__factCheckLoaded) return;
  window.__factCheckLoaded = true;

  const RATINGS = {
    red: { highlight: "fc-red", label: "False", color: "#dc2626" },
    yellow: { highlight: "fc-yellow", label: "Misleading", color: "#d97706" },
  };

  let flagged = []; // [{ range, rating, explanation }]

  // ---------- UI (inside a shadow root so page CSS can't touch it) ----------

  const host = document.createElement("div");
  host.id = "fact-check-ui";
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483646;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .pill {
        position: fixed; right: 20px; bottom: 20px; pointer-events: auto;
        display: flex; align-items: center; gap: 10px;
        padding: 10px 14px; border-radius: 999px;
        background: #111827; color: #f9fafb;
        font: 500 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif;
        box-shadow: 0 6px 24px rgba(0,0,0,.25);
      }
      .pill[hidden] { display: none; }
      .spinner {
        width: 14px; height: 14px; border-radius: 50%;
        border: 2px solid rgba(255,255,255,.3); border-top-color: #fff;
        animation: spin .8s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
      .counts { display: flex; gap: 10px; color: #d1d5db; }
      .counts span { display: inline-flex; align-items: center; gap: 5px; }
      button {
        all: unset; cursor: pointer; color: #9ca3af; font-size: 12px;
        padding: 2px 6px; border-radius: 6px;
      }
      button:hover, button:focus-visible { color: #fff; background: rgba(255,255,255,.12); }
      .tip {
        position: fixed; max-width: 320px; pointer-events: none;
        padding: 10px 12px; border-radius: 8px;
        background: #111827; color: #f3f4f6;
        font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
        box-shadow: 0 6px 24px rgba(0,0,0,.25);
      }
      .tip[hidden] { display: none; }
      .tip b { display: block; font-size: 12px; margin-bottom: 3px; }
    </style>
    <div class="pill" hidden></div>
    <div class="tip" hidden></div>
  `;
  const pill = shadow.querySelector(".pill");
  const tip = shadow.querySelector(".tip");
  document.documentElement.appendChild(host);

  const style = document.createElement("style");
  style.textContent = `
    ::highlight(fc-red) {
      background-color: rgba(220, 38, 38, 0.12);
      text-decoration: underline wavy #dc2626 2px;
      text-underline-offset: 3px;
    }
    ::highlight(fc-yellow) {
      background-color: rgba(234, 179, 8, 0.16);
      text-decoration: underline wavy #d97706 2px;
      text-underline-offset: 3px;
    }
  `;
  document.head.appendChild(style);

  function showChecking() {
    pill.hidden = false;
    pill.innerHTML = `<div class="spinner"></div><span>Fact-checking this article…</span>`;
  }

  function showError(message) {
    pill.hidden = false;
    pill.innerHTML = `<span>Fact check failed: ${escapeHtml(message)}</span><button type="button">Close</button>`;
    pill.querySelector("button").onclick = () => { pill.hidden = true; };
  }

  function showSummary(red, yellow, missed) {
    pill.hidden = false;
    if (red + yellow === 0) {
      pill.innerHTML = `<span>No false or misleading claims found${missed ? ` (${missed} couldn't be located on the page)` : ""}</span><button type="button">Close</button>`;
    } else {
      const total = red + yellow;
      pill.innerHTML =
        `<span>${total} claim${total === 1 ? "" : "s"} flagged</span>` +
        `<span class="counts">` +
        (red ? `<span><i class="dot" style="background:${RATINGS.red.color}"></i>${red} false</span>` : "") +
        (yellow ? `<span><i class="dot" style="background:${RATINGS.yellow.color}"></i>${yellow} misleading</span>` : "") +
        (missed ? `<span>${missed} not found on page</span>` : "") +
        `</span><button type="button">Clear</button>`;
    }
    pill.querySelector("button").onclick = clearAll;
  }

  function clearAll() {
    CSS.highlights.delete(RATINGS.red.highlight);
    CSS.highlights.delete(RATINGS.yellow.highlight);
    flagged = [];
    pill.hidden = true;
    tip.hidden = true;
  }

  // ---------- Finding quotes in the page ----------

  // Characters that often differ between Claude's copy of a quote and the page.
  const CHAR_FOLD = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", " ": " " };
  const fold = (ch) => CHAR_FOLD[ch] || ch;

  // Flattens the page's visible text into one whitespace-collapsed string and
  // remembers which text node and offset each character came from.
  function indexPageText() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest("script, style, noscript, textarea, #fact-check-ui")) return NodeFilter.FILTER_REJECT;
        return node.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    let text = "";
    const map = [];
    let lastWasSpace = true;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.nodeValue;
      for (let i = 0; i < value.length; i++) {
        const ch = fold(value[i]);
        if (/\s/.test(ch)) {
          if (lastWasSpace) continue;
          text += " ";
          lastWasSpace = true;
        } else {
          text += ch;
          lastWasSpace = false;
        }
        map.push({ node, offset: i });
      }
    }
    return { text, map };
  }

  function normalizeQuote(quote) {
    return Array.from(quote).map(fold).join("").replace(/\s+/g, " ").trim();
  }

  function findRange(index, quote) {
    const q = normalizeQuote(quote);
    if (!q) return null;
    let at = index.text.indexOf(q);
    if (at === -1) at = index.text.toLowerCase().indexOf(q.toLowerCase());
    if (at === -1) return null;
    const start = index.map[at];
    const end = index.map[at + q.length - 1];
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);
    return range;
  }

  function showResults(claims) {
    clearAll();
    const index = indexPageText();
    const byRating = { red: [], yellow: [] };
    let missed = 0;
    for (const claim of claims) {
      const rating = claim.rating === "red" ? "red" : "yellow";
      const range = claim.quote ? findRange(index, claim.quote) : null;
      if (!range) { missed++; continue; }
      byRating[rating].push(range);
      flagged.push({ range, rating, explanation: claim.explanation || "" });
    }
    for (const rating of ["red", "yellow"]) {
      if (byRating[rating].length) {
        CSS.highlights.set(RATINGS[rating].highlight, new Highlight(...byRating[rating]));
      }
    }
    showSummary(byRating.red.length, byRating.yellow.length, missed);
    return flagged.length;
  }

  // ---------- Hover explanations ----------

  let pending = false;
  document.addEventListener("mousemove", (e) => {
    if (!flagged.length || pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const hit = flagged.find(({ range }) =>
        Array.from(range.getClientRects()).some(
          (r) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top - 2 && e.clientY <= r.bottom + 4
        )
      );
      if (!hit) { tip.hidden = true; return; }
      const r = RATINGS[hit.rating];
      tip.innerHTML = `<b style="color:${r.color}">${r.label}</b>${escapeHtml(hit.explanation)}`;
      tip.hidden = false;
      const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 12);
      const below = e.clientY + 22;
      const y = below + tip.offsetHeight > window.innerHeight ? e.clientY - tip.offsetHeight - 14 : below;
      tip.style.left = `${Math.max(12, x)}px`;
      tip.style.top = `${y}px`;
    });
  }, { passive: true });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- Messages from the service worker ----------

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "fc-status") {
      if (message.state === "checking") showChecking();
      else if (message.state === "error") showError(message.message || "unknown error");
      sendResponse({ ok: true });
    } else if (message.type === "fc-results") {
      const matched = showResults(message.claims || []);
      sendResponse({ matched });
    }
  });
})();
