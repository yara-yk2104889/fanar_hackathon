import json
from evidence_agent import extract_claims

with open("namliyeh_clip_output.json", encoding="utf-8") as f:
    iv = json.load(f)

out = extract_claims(iv)
claims = out["checkable_claims"]
print(f"Claims generated: {len(claims)}\n")
for i, c in enumerate(claims, 1):
    print(f"[{i}] type={c['type']}")
    print(f"     EN: {c['claim_en'][:100]}")
    print(f"     AR: {c['claim_ar'][:60]}")
    print()
