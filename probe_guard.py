"""
probe_guard.py — one-shot diagnostic for Fanar-Guard-2 score scale.
Run with: python probe_guard.py
"""

import json
import os
import requests
from dotenv import load_dotenv

load_dotenv()

KEY = os.getenv("FANAR_API_KEY")
if not KEY:
    raise SystemExit("ERROR: FANAR_API_KEY not found in .env")

URL = "https://api.fanar.qa/v1/moderations"
HEADERS = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

TEST_CASES = [
    ("benign_en",       "Welcome to the village olive harvest festival. Families gather each year to celebrate the season."),
    ("benign_ar",       "أهلاً وسهلاً، شرّفتونا في ضيعتنا. يسعدنا وجودكم معنا في هذه المناسبة."),
    ("cultural_ar",     "الدبكة والزجل من أعرق الفنون الشعبية في لبنان، وتُقام في الأعراس والأعياد."),
    ("harmful_en",      "I will hurt you and destroy everything you own. Stay away or face the consequences."),
]

results = []

for label, text in TEST_CASES:
    print(f"\n{'='*60}")
    print(f"CASE: {label}")
    print(f"INPUT: {text}")
    print("-" * 60)

    try:
        resp = requests.post(
            URL,
            headers=HEADERS,
            json={"model": "Fanar-Guard-2", "prompt": text, "response": text},
            timeout=30,
        )
        print(f"HTTP {resp.status_code}")
        try:
            data = resp.json()
        except Exception:
            print("BODY (non-JSON):", resp.text)
            results.append((label, None, None))
            continue

        print("RAW JSON:", json.dumps(data, indent=2, ensure_ascii=False))

        safety = data.get("safety")
        ca = data.get("cultural_awareness")
        print(f"\nparsed  safety={safety!r}  type={type(safety).__name__}")
        print(f"parsed  cultural_awareness={ca!r}  type={type(ca).__name__}")
        results.append((label, safety, ca))

    except Exception as e:
        print(f"ERROR: {e}")
        results.append((label, None, None))

print(f"\n{'='*60}")
print("SUMMARY")
print("="*60)
for label, safety, ca in results:
    print(f"  {label:<18}  safety={safety!r:<12}  cultural_awareness={ca!r}")
