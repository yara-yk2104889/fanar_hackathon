"""
test_openai_search.py — claim verification using OpenAI web search.
Usage: python test_openai_search.py
       python test_openai_search.py "your claim here"
"""

import os
import sys
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

PROMPT = """You are a fact-checker. The user gives you a claim.
Search the web and return:
- Whether the claim is supported, contradicted, or has no public record
- A short summary of what you found
- The sources you used

Be honest if you can't find anything. Do not invent sources."""


def check(claim: str) -> None:
    print(f"\n{'='*60}")
    print(f"CLAIM: {claim}")
    print("="*60)

    response = client.responses.create(
        model="gpt-4o-mini",
        tools=[{"type": "web_search_preview"}],
        input=f"{PROMPT}\n\nClaim: {claim}",
    )

    # Print the final text output
    for block in response.output:
        if hasattr(block, "content"):
            for part in block.content:
                if hasattr(part, "text"):
                    print(part.text)
        elif hasattr(block, "text"):
            print(block.text)


def main():
    if len(sys.argv) > 1:
        claims = [" ".join(sys.argv[1:])]
    else:
        claims = [
            "Bint Jbeil is a city in southern Lebanon near the border with Israel.",
            "Saj bread is a traditional Lebanese flatbread cooked on a convex iron griddle.",
            "Lebanon is 4 kms long",
        ]

    for claim in claims:
        check(claim)


if __name__ == "__main__":
    main()
