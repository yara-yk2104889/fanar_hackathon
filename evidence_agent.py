"""
evidence_agent.py
Verifies factual claims extracted from Lebanese oral-history interviews against
public sources.  Attaches verdicts ALONGSIDE the original record — nothing is
ever overwritten.

Main entry-point:
    result = verify_interview(interview_record)

Designed to match the style of pipeline.py / refine_agents.py:
  - plain `requests`, Bearer auth
  - all prompts end with "Return ONLY valid JSON"
  - json.loads() + regex {.*} fallback everywhere
  - bilingual (Arabic + English) throughout
"""

import os
import re
import json
import copy
import requests
from dotenv import load_dotenv

load_dotenv()

FANAR_KEY = os.getenv("FANAR_API_KEY")
BASE      = "https://api.fanar.qa/v1"
AUTH_JSON = {"Authorization": f"Bearer {FANAR_KEY}", "Content-Type": "application/json"}
MODEL     = "Fanar-C-2-27B"        # reasoning model used for Steps 1 & 3
GROUNDED  = "Fanar-Sadiq"          # attribution / grounded-answer model for Step 2a


# ── Shared helper ────────────────────────────────────────────────────────────

def _chat_json(system: str, user: str, model: str = MODEL, timeout: int = 90) -> dict:
    """POST to /chat/completions, parse JSON from the reply (with regex fallback)."""
    resp = requests.post(
        f"{BASE}/chat/completions",
        headers=AUTH_JSON,
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ],
        },
        timeout=timeout,
    )
    resp.raise_for_status()
    raw = resp.json()["choices"][0]["message"]["content"]
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        return json.loads(m.group()) if m else {"_raw": raw}


# ── Step 1 — Extract checkable factual claims ────────────────────────────────

EXTRACT_SYS = """You are an archivist for a Lebanese cultural heritage project.
Your task: read a transcript (Arabic + English) and identify ALL checkable
factual claims — things that could in principle be corroborated by a public
source. Be INCLUSIVE, not strict. Err on the side of extracting more claims.

CHECKABLE (extract all of these):
- Geographic facts: place names, border descriptions, regional locations
  ("Bint Jbeil is on the border between Lebanon and Palestine")
- Administrative facts: whether somewhere is a city, town, village, district
- Historical facts: dates, durations, named events, documented periods
- Cultural / traditional facts: craft traditions, foods, practices described as
  belonging to a place or region ("saj bread is a southern Lebanese tradition")
- Health or nutritional claims ("saj is healthier than white bread")
- Descriptive facts about local programs, institutions, or organisations
  ("the program has been running for 5 years")

NOT CHECKABLE (exclude entirely): pure personal feelings, purely subjective
preferences with no factual anchor ("I love this village"),
first-person emotional memories with no verifiable element.
These are TESTIMONY — sacred, not falsifiable. Do NOT include them.

When in doubt: INCLUDE the claim. A false positive (checking something minor) is
better than a false negative (missing a verifiable geographic or cultural fact).

Return ONLY valid JSON — no markdown, no explanation:
{
  "checkable_claims": [
    {
      "claim_en": "English statement of the factual claim",
      "claim_ar": "Arabic statement of the same claim",
      "type": "place|date|event|structure|historical_fact|cultural_tradition|health_claim|administrative"
    }
  ],
  "testimony_excluded_count": <integer>
}"""

def extract_claims(interview: dict) -> dict:
    """Step 1: extract checkable factual claims from the interview transcript."""
    arabic  = interview.get("full_arabic_transcript", "")
    english = interview.get("full_english_transcript", "")

    user = (
        f"Arabic transcript:\n{arabic[:4000]}\n\n"
        f"English transcript:\n{english[:4000]}"
    )
    out = _chat_json(EXTRACT_SYS, user, timeout=120)
    out.setdefault("checkable_claims", [])
    out.setdefault("testimony_excluded_count", 0)
    return out


# ── Step 2a — Fanar Sadiq grounded retrieval ────────────────────────────────

GROUNDED_SYS = """You are a factual-question-answering assistant that always
cites your sources.  Answer the question factually and concisely, and list
every source URL or publication title you used.
Return ONLY valid JSON — no markdown:
{
  "answer": "...",
  "sources": [{"title": "...", "url": "..."}],
  "has_useful_answer": true
}
If you cannot find reliable information, set has_useful_answer to false and
return empty sources."""

def _retrieve_grounded(claim_en: str) -> dict:
    """Query Fanar-Sadiq for a grounded answer with source citations."""
    question = (
        f"Is the following factual claim accurate? Provide evidence and cite sources.\n"
        f"Claim: {claim_en}"
    )
    try:
        out = _chat_json(GROUNDED_SYS, question, model=GROUNDED, timeout=60)
    except Exception as exc:
        print(f"    [grounded] error: {exc}")
        out = {"has_useful_answer": False, "answer": "", "sources": []}
    out.setdefault("has_useful_answer", False)
    out.setdefault("answer", "")
    out.setdefault("sources", [])
    return out


# ── Step 2b — Web-search fallback ────────────────────────────────────────────

def _retrieve_web(claim_en: str) -> dict:
    """
    Fallback: use Fanar chat to summarise what a web search would yield.
    (Swap this for a real search API — e.g. Bing or SerpAPI — when available.)
    """
    WEB_SYS = """You are a research assistant.  Given a factual claim about
Lebanese history, geography, or culture, summarise what reliable public sources
(Wikipedia, academic papers, news archives, government records) say about it.
Be specific about sources.
Return ONLY valid JSON — no markdown:
{
  "answer": "...",
  "sources": [{"title": "...", "url": "..."}],
  "has_useful_answer": true
}
If you truly cannot find anything relevant, set has_useful_answer to false."""

    question = (
        f"Summarise what public sources say about this claim:\n{claim_en}\n\n"
        f"Focus on Lebanon, especially southern Lebanon, if relevant."
    )
    try:
        out = _chat_json(WEB_SYS, question, model=MODEL, timeout=90)
    except Exception as exc:
        print(f"    [web-fallback] error: {exc}")
        out = {"has_useful_answer": False, "answer": "", "sources": []}
    out.setdefault("has_useful_answer", False)
    out.setdefault("answer", "")
    out.setdefault("sources", [])
    return out


# ── Step 2 — Retrieve evidence (tries grounded first, falls back to web) ─────

def retrieve_evidence(claim_en: str, backend: str = "auto") -> dict:
    """
    backend: "grounded" | "web" | "auto" (try grounded, fall back to web)
    Returns {"answer": ..., "sources": [...], "backend_used": ..., "has_useful_answer": ...}
    """
    if backend in ("grounded", "auto"):
        result = _retrieve_grounded(claim_en)
        if result.get("has_useful_answer"):
            result["backend_used"] = "fanar_sadiq"
            return result
        if backend == "grounded":
            result["backend_used"] = "fanar_sadiq"
            return result

    # Web fallback
    result = _retrieve_web(claim_en)
    result["backend_used"] = "web_fallback"
    return result


# ── Step 3 — Judge claim against evidence ────────────────────────────────────

JUDGE_SYS = """You are a careful, humble fact-checker for a Lebanese oral-history archive.
Your job: compare a factual claim to retrieved evidence and return a verdict.

Verdict options:
  "confirmed"           — credible source clearly supports the claim
  "partially_supported" — some evidence aligns but not fully
  "no_public_record"    — no evidence found (does NOT mean the claim is false —
                          many local memories are simply not in public databases)
  "contradicted"        — only when a credible source clearly disagrees

CRITICAL RULES:
- "no_public_record" is NOT "false". Say so in the note.
- "contradicted" only if a named credible source directly refutes the claim.
- Be humble. A claim about a small southern-Lebanese village may have no online
  trace and still be completely true — say so.
- Keep the note neutral (one sentence, no opinion).

Return ONLY valid JSON — no markdown:
{
  "verdict": "confirmed|partially_supported|no_public_record|contradicted",
  "confidence": "high|medium|low",
  "source": "URL or source name, or null",
  "note": "one neutral sentence"
}"""

def judge_claim(claim_en: str, claim_ar: str, evidence: dict) -> dict:
    """Step 3: judge one claim against retrieved evidence."""
    evidence_text = evidence.get("answer", "") or "No evidence retrieved."
    sources_text  = json.dumps(evidence.get("sources", []), ensure_ascii=False)

    user = (
        f"Claim (English): {claim_en}\n"
        f"Claim (Arabic):  {claim_ar}\n\n"
        f"Retrieved evidence:\n{evidence_text}\n\n"
        f"Sources:\n{sources_text}"
    )
    out = _chat_json(JUDGE_SYS, user, timeout=60)
    out.setdefault("verdict",    "no_public_record")
    out.setdefault("confidence", "low")
    out.setdefault("source",     None)
    out.setdefault("note",       "")
    return out


# ── Possibly-sole-record flag ────────────────────────────────────────────────

_LOCAL_TYPES = {"place", "structure", "event"}

def _is_possibly_sole_record(claim: dict, verdict: dict) -> bool:
    """
    True when:
    - claim type is place / structure / event (hyper-local)
    - verdict is no_public_record
    These are the memories with no surviving public trace — most valuable for
    an endangered-heritage archive.
    """
    return (
        claim.get("type") in _LOCAL_TYPES
        and verdict.get("verdict") == "no_public_record"
    )


# ── Step 4 — Attach evidence to interview record ─────────────────────────────

def _build_evidence_summary(evidence_list: list, testimony_excluded: int) -> dict:
    counts = {
        "confirmed": 0,
        "partially_supported": 0,
        "no_public_record": 0,
        "contradicted": 0,
    }
    sole_record_count = 0
    for e in evidence_list:
        v = e.get("verdict", "no_public_record")
        counts[v] = counts.get(v, 0) + 1
        if e.get("possibly_sole_record"):
            sole_record_count += 1

    return {
        "verdict_counts":          counts,
        "total_claims_checked":    len(evidence_list),
        "testimony_excluded_count": testimony_excluded,
        "possibly_sole_record_count": sole_record_count,
    }


def verify_interview(interview_record: dict, backend: str = "auto") -> dict:
    """
    Main entry-point.  Returns a NEW dict (deep copy) with two new keys added:
      - "evidence":         list of {claim + verdict + source + note + ...}
      - "evidence_summary": verdict counts + metadata
    The original record is never mutated.
    """
    result = copy.deepcopy(interview_record)

    # ── Step 1 ───────────────────────────────────────────────────────────────
    print("\n[1/3] Extracting checkable factual claims...")
    claims_data = extract_claims(result)
    claims      = claims_data.get("checkable_claims", [])
    testimony_n = claims_data.get("testimony_excluded_count", 0)
    print(f"      {len(claims)} checkable claims | {testimony_n} testimony statements excluded")

    if not claims:
        result["evidence"]         = []
        result["evidence_summary"] = _build_evidence_summary([], testimony_n)
        return result

    # ── Steps 2 + 3 (per claim) ──────────────────────────────────────────────
    print(f"\n[2+3/3] Retrieving evidence & judging ({len(claims)} claims)...")
    evidence_list = []

    for i, claim in enumerate(claims):
        claim_en = claim.get("claim_en", "")
        claim_ar = claim.get("claim_ar", "")
        ctype    = claim.get("type", "unknown")
        print(f"\n  [{i+1}/{len(claims)}] [{ctype}] {claim_en[:80]}")

        # Step 2 — retrieve
        evidence = retrieve_evidence(claim_en, backend=backend)
        print(f"         backend={evidence['backend_used']} | useful={evidence['has_useful_answer']}")

        # Step 3 — judge
        verdict  = judge_claim(claim_en, claim_ar, evidence)
        print(f"         verdict={verdict['verdict']} ({verdict['confidence']}) | {verdict['note'][:60]}")

        # Build entry (claim + verdict, sources preserved alongside)
        entry = {
            "claim_en":            claim_en,
            "claim_ar":            claim_ar,
            "type":                ctype,
            "verdict":             verdict["verdict"],
            "confidence":          verdict["confidence"],
            "source":              verdict["source"],
            "note":                verdict["note"],
            "backend_used":        evidence["backend_used"],
            "raw_sources":         evidence.get("sources", []),
            "possibly_sole_record": _is_possibly_sole_record(claim, verdict),
        }
        evidence_list.append(entry)

    # ── Step 4 — attach ───────────────────────────────────────────────────────
    result["evidence"]         = evidence_list
    result["evidence_summary"] = _build_evidence_summary(evidence_list, testimony_n)
    return result


# ── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    # Accept a path argument, default to the sample output
    path = sys.argv[1] if len(sys.argv) > 1 else "namliyeh_clip_output.json"

    print(f"\n{'='*60}")
    print(f"EVIDENCE AGENT  →  {path}")
    print(f"{'='*60}")

    with open(path, encoding="utf-8") as f:
        interview = json.load(f)

    enriched = verify_interview(interview, backend="auto")

    # ── Print results ────────────────────────────────────────────────────────
    print(f"\n{'─'*60}")
    print("RESULTS")
    print(f"{'─'*60}")

    summary = enriched.get("evidence_summary", {})
    counts  = summary.get("verdict_counts", {})
    print(f"\nEvidence summary:")
    print(f"  Claims checked       : {summary.get('total_claims_checked', 0)}")
    print(f"  Testimony excluded   : {summary.get('testimony_excluded_count', 0)}")
    print(f"  Confirmed            : {counts.get('confirmed', 0)}")
    print(f"  Partially supported  : {counts.get('partially_supported', 0)}")
    print(f"  No public record     : {counts.get('no_public_record', 0)}")
    print(f"  Contradicted         : {counts.get('contradicted', 0)}")
    print(f"  Possibly sole record : {summary.get('possibly_sole_record_count', 0)}")

    print(f"\n{'─'*60}")
    print("PER-CLAIM VERDICTS")
    print(f"{'─'*60}")
    for e in enriched.get("evidence", []):
        sole = "  ★ POSSIBLY SOLE RECORD" if e.get("possibly_sole_record") else ""
        print(f"\n  [{e['verdict'].upper()}] ({e['confidence']}) [{e['type']}]{sole}")
        print(f"  EN : {e['claim_en']}")
        print(f"  AR : {e['claim_ar']}")
        print(f"  src: {e['source'] or 'none'}")
        print(f"  note: {e['note']}")

    sole_records = [e for e in enriched.get("evidence", []) if e.get("possibly_sole_record")]
    if sole_records:
        print(f"\n{'─'*60}")
        print(f"★  POSSIBLY SOLE RECORDS  ({len(sole_records)} found)")
        print("   These memories have no surviving public trace.")
        print(f"{'─'*60}")
        for e in sole_records:
            print(f"\n  • {e['claim_en']}")
            print(f"    {e['claim_ar']}")
            print(f"    note: {e['note']}")

    # ── Save enriched output ─────────────────────────────────────────────────
    out_path = path.replace("_output.json", "_evidence.json")
    if out_path == path:
        out_path = path.rsplit(".", 1)[0] + "_evidence.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(enriched, f, ensure_ascii=False, indent=2)
    print(f"\nSaved → {out_path}")
