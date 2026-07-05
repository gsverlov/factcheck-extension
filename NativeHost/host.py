import sys
import json
import struct
import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions

def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    message_length = struct.unpack("=I", raw_length)[0]
    message = sys.stdin.buffer.read(message_length).decode("utf-8")
    return json.loads(message)

def send_message(obj):
    encoded = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()

async def fact_check(text):
    prompt = f"""Analyze the following article for factual accuracy. Identify claims that are FALSE or MISLEADING. Skip accurate claims entirely.

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

    result_text = ""
    async for message in query(
        prompt=prompt,
        options=ClaudeAgentOptions(),
    ):
        if hasattr(message, "result"):
            result_text = message.result
    return result_text

def main():
    while True:
        incoming = read_message()
        if incoming is None:
            break
        text = incoming.get("text", "")
        verdict = asyncio.run(fact_check(text))
        send_message({"verdict": verdict})

if __name__ == "__main__":
    main()