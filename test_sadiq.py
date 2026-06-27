"""
test_sadiq.py — standalone test for Fanar-Sadiq grounded retrieval.
Usage: python test_sadiq.py
       python test_sadiq.py "your claim here"
"""

import os
import sys
import json
import requests
from dotenv import load_dotenv

load_dotenv()

KEY  = os.getenv("FANAR_API_KEY")
BASE = "https://api.fanar.qa/v1"
AUTH = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

SYS = """You are a fact-checking assistant. The user gives you a claim.
Your job: find evidence that supports or contradicts it, and cite your sources.

Return ONLY valid JSON — no markdown:
{
  "verdict": "supported | contradicted | no_public_record",
  "summary": "one paragraph summarising what sources say about this claim",
  "sources": [
    {"title": "source name or publication", "url": "url or null", "relevance": "how this source relates to the claim"}
  ]
}
If you cannot find anything relevant, set verdict to no_public_record and sources to [].
Never invent sources."""


def check(claim: str) -> dict:
    resp = requests.post(
        f"{BASE}/chat/completions",
        headers=AUTH,
        json={
            "model": "Fanar-Sadiq",
            "messages": [
                {"role": "system", "content": SYS},
                {"role": "user",   "content": claim},
            ],
        },
        timeout=90,
    )
    resp.raise_for_status()
    raw = resp.json()["choices"][0]["message"]["content"]
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"_raw": raw}


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
        print(f"\n{'='*60}")
        print(f"CLAIM: {claim}")
        print("="*60)
        result = check(claim)
        print(f"Verdict : {result.get('verdict', '?')}")
        print(f"Summary : {result.get('summary', result.get('_raw', ''))}")
        sources = result.get("sources", [])
        if sources:
            print(f"Sources :")
            for s in sources:
                print(f"  - {s.get('title')}")
                if s.get("url"):
                    print(f"    {s.get('url')}")
                print(f"    {s.get('relevance')}")
        else:
            print("Sources : none found")


if __name__ == "__main__":
    main()
