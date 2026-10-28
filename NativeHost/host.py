"""Native messaging host for the Fact Check extension.

Chrome starts this program and talks to it over stdin/stdout. Each message is
a 4-byte little-endian length followed by that many bytes of UTF-8 JSON.

Incoming: {"text": "<article text>"}
Outgoing: {"claims": [{"quote": ..., "rating": "red" | "yellow", "explanation": ...}]}
          or {"error": "<what went wrong>"}
"""

import sys
import json
import struct
import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions

# Chrome rejects messages from a host larger than 1 MB, and very long articles
# aren't worth checking in one pass anyway.
MAX_ARTICLE_CHARS = 60_000

PROMPT = """Analyze the following article for factual accuracy. Identify claims that are FALSE or MISLEADING. Skip accurate claims entirely.

For each problematic claim, return:
- "quote": the EXACT text from the article, copied verbatim, that contains the claim. This must match the article character-for-character so it can be located on the page. Keep it short — one sentence or less when possible.
- "rating": either "red" (false/fabricated) or "yellow" (misleading, unverified, or significantly distorted)
- "explanation": a brief explanation of what's wrong, 1-2 sentences.

Return ONLY a JSON array, with no surrounding text, no markdown code fences, nothing else. If there are no problematic claims, return an empty array [].

Example format:
[
  {{"quote": "The Eiffel Tower is in Berlin", "rating": "red", "explanation": "The Eiffel Tower is in Paris, France, not Berlin, Germany."}},
  {{"quote": "Studies show this cures cancer", "rating": "yellow", "explanation": "No specific studies are cited and the claim is far stronger than current research supports."}}
]

Article:
{text}"""


def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) < 4:
        return None
    message_length = struct.unpack("<I", raw_length)[0]
    message = sys.stdin.buffer.read(message_length).decode("utf-8")
    return json.loads(message)


def send_message(obj):
    encoded = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


async def ask_claude(text):
    result_text = ""
    async for message in query(
        prompt=PROMPT.format(text=text[:MAX_ARTICLE_CHARS]),
        options=ClaudeAgentOptions(),
    ):
        if hasattr(message, "result"):
            result_text = message.result
    return result_text


def parse_claims(raw):
    """Pull the JSON array out of Claude's reply and keep only well-formed claims.

    The prompt asks for a bare array, but a stray code fence or sentence around
    it shouldn't break the extension, so parse from the first "[" to the last "]".
    """
    start, end = raw.find("["), raw.rfind("]")
    if start == -1 or end < start:
        raise ValueError("Claude's reply didn't contain a JSON array")
    items = json.loads(raw[start:end + 1])
    claims = []
    for item in items:
        if not isinstance(item, dict) or not item.get("quote"):
            continue
        claims.append({
            "quote": str(item["quote"]),
            "rating": "red" if item.get("rating") == "red" else "yellow",
            "explanation": str(item.get("explanation", "")),
        })
    return claims


def main():
    while True:
        incoming = read_message()
        if incoming is None:
            break
        try:
            text = incoming.get("text", "")
            raw = asyncio.run(ask_claude(text))
            send_message({"claims": parse_claims(raw)})
        except Exception as exc:  # report failures to the extension instead of crashing
            send_message({"error": f"{type(exc).__name__}: {exc}"})


if __name__ == "__main__":
    main()
