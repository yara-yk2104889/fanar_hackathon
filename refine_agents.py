"""
refine_agents.py

Two correction/validation agents that slot into your existing pipeline.

    refine_segment()   fixes dialect mis-hearings + cultural-term mistranslation
  Agent 2  validate_places()  decides which "places" are real Lebanese localities

Both use Fanar-C-2-27B. Import these into pipeline.py (see the wiring notes at the bottom).
"""

import os
import re
import json
import requests
from dotenv import load_dotenv

load_dotenv()

FANAR_KEY = os.getenv("FANAR_API_KEY")
BASE = "https://api.fanar.qa/v1"
AUTH_JSON = {"Authorization": f"Bearer {FANAR_KEY}", "Content-Type": "application/json"}
MODEL = "Fanar-C-2-27B"


def _chat_json(system: str, user: str, timeout: int = 60) -> dict:
    """Call Fanar chat and parse a JSON object out of the reply."""
    resp = requests.post(
        f"{BASE}/chat/completions",
        headers=AUTH_JSON,
        json={"model": MODEL, "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]},
        timeout=timeout,
    )
    resp.raise_for_status()
    raw = resp.json()["choices"][0]["message"]["content"]
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        return json.loads(m.group()) if m else {"_raw": raw}


# ──────────────────────────────────────────────────────────────────────────
# Agent 1 — Refiner: fixes transcription errors + retranslates
# ──────────────────────────────────────────────────────────────────────────
REFINE_SYS = """You are a Lebanese-dialect transcription editor for an oral-history archive.
You receive a RAW speech-to-text Arabic segment (which may contain errors) and a DRAFT
English translation (which may be wrong).

Do three things:
1. Produce a CLEANED Arabic version. Fix spelling mistakes, grammatical errors, and
   mishearings using context and your knowledge of Lebanese dialect and culture.
   Do NOT invent or add content. If a span is genuinely unrecoverable, keep it as-is
   and list it under low_confidence_spans.
2. Produce a faithful English translation of the CLEANED Arabic. Transliterate cultural
   terms and gloss them in brackets rather than literal-translating them.
3. List every correction you made, each with a confidence level.

Return ONLY valid JSON — no markdown, no explanation:
{
  "arabic_clean": "...",
  "english": "...",
  "corrections": [{"from": "...", "to": "...", "confidence": "high|medium|low"}],
  "low_confidence_spans": ["unrecoverable Arabic spans, if any"]
}"""

def refine_segment(raw_arabic: str, draft_english: str = "") -> dict:
    """Clean the Arabic and fix the translation. Returns arabic_clean, english, corrections."""
    user = f"RAW Arabic (speech-to-text):\n{raw_arabic}\n\nDRAFT English:\n{draft_english}"
    out = _chat_json(REFINE_SYS, user)
    out.setdefault("arabic_clean", raw_arabic)
    out.setdefault("english", draft_english)
    out.setdefault("corrections", [])
    out.setdefault("low_confidence_spans", [])
    return out


# ──────────────────────────────────────────────────────────────────────────
# Agent 2 — Place Validator (tool-using): keeps only real Lebanese localities
# ──────────────────────────────────────────────────────────────────────────

# Step 1 prompt: filter out obvious non-places before hitting the cadaster tool
VALIDATE_FILTER_SYS = """You are a Lebanese geography expert for an oral-history archive.

From the candidate strings, identify which ones MIGHT be specific Lebanese place names
(villages, towns, cities, localities, named neighbourhoods). Be inclusive — if unsure, include it.

EXCLUDE only strings that are clearly not place names:
- household objects (e.g. "namliyeh" = a traditional food-storage cupboard)
- food items, dishes, crops
- TV programs, book titles, brand names
- country-level or very broad regions ("Lebanon", "Palestine", "Syria", "the South")
- roles or job titles

Return ONLY valid JSON — no markdown:
{
  "place_candidates": ["strings that might be Lebanese localities"],
  "rejected": [{"name": "...", "reason": "food_or_object|country_or_region|program_or_title|other"}]
}"""

# Step 3 prompt: decide from lookup results which candidates are confirmed localities
VALIDATE_ANCHOR_SYS = """You are a Lebanese geography expert for an oral-history archive.

You receive place-name candidates and the results of looking each one up in Lebanon's
official cadaster (Admin-3) boundary database. Use the lookup results as ground truth:
if a name has cadaster matches, it is a real Lebanese locality; if not, treat it with caution.

Your job: confirm which candidates are real Lebanese localities and pick the single best
routing anchor for this interview.

Return ONLY valid JSON — no markdown:
{
  "candidates": [
    {
      "name": "...",
      "type": "lebanese_locality|country_or_region|object_or_food|program_or_title|other",
      "is_place": true,
      "cadaster_match": "matched cadaster name or null"
    }
  ],
  "lebanese_localities": ["confirmed locality names"],
  "primary_anchor": "the single best locality to route to, or null",
  "reason": "one sentence"
}"""


def _cadaster_lookup(name: str, cadasters: list) -> list:
    """
    Tool: search the cadaster list for a place name.
    Returns up to 3 best matches with their IDs and names.
    Score: 3=exact, 2=word-boundary prefix or Arabic substring, 1=substring, 0=no match.
    """
    p = name.strip().lower()
    if not p:
        return []
    results = []
    for cad in cadasters:
        n_en = (cad.get("name_en") or "").strip().lower()
        n_ar = (cad.get("name_ar") or "").strip()
        score = 0
        if p == n_en:
            score = 3
        elif n_en.startswith(p + " ") or p.startswith(n_en + " "):
            score = 2
        elif p in n_en or n_en in p:
            score = 1
        if score < 2 and p in n_ar:
            score = 2
        if score > 0:
            results.append({
                "id": cad["id"],
                "name_en": cad["name_en"],
                "name_ar": cad["name_ar"],
                "score": score,
            })
    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:3]


def validate_places(claimed_village: str, extracted_places: list,
                    context: str = "", cadasters: list = None) -> dict:
    """
    Filter extracted 'places' to real Lebanese localities and pick the routing anchor.

    When cadasters are provided, runs as a three-step tool-using agent:
      Step 1 (LLM)  — filter candidate strings to likely place names
      Step 2 (tool) — look each up in the cadaster database
      Step 3 (LLM)  — confirm localities and pick anchor, informed by tool results

    When cadasters are not provided, falls back to a single LLM call.
    """
    cands = []
    if claimed_village:
        cands.append(claimed_village)
    for p in extracted_places:
        if p not in cands:
            cands.append(p)

    if not cadasters:
        # Fallback: single LLM call, no tool access
        VALIDATE_FALLBACK_SYS = """You are a Lebanese geography expert helping an oral-history archive route memories.
You receive candidate strings that an extractor labelled as "places". Some are NOT real
geographic places (e.g. "Namliyeh" is a TV-program name and a food-storage cupboard, not a town).
Exclude household objects, foods, broad regions, or program names. List only specific Lebanese localities.
Return ONLY valid JSON — no markdown:
{
  "candidates": [{"name": "...", "type": "lebanese_locality|country_or_region|object_or_food|program_or_title|other", "is_place": true}],
  "lebanese_localities": ["specific localities only"],
  "primary_anchor": "the single best locality or null",
  "reason": "one sentence"
}"""
        user = f"Candidate strings: {cands}\n\nInterview context (Arabic):\n{context[:1500]}"
        out = _chat_json(VALIDATE_FALLBACK_SYS, user)
        out.setdefault("lebanese_localities", [])
        out.setdefault("primary_anchor", None)
        out.setdefault("candidates", [])
        return out

    # ── Step 1: LLM filters candidates to likely place names ──────────────────
    step1_user = (
        f"Candidate strings: {cands}\n\n"
        f"Interview context (Arabic):\n{context[:1500]}"
    )
    step1 = _chat_json(VALIDATE_FILTER_SYS, step1_user)
    place_candidates = step1.get("place_candidates", cands)
    step1_rejected = step1.get("rejected", [])

    # ── Step 2: Tool — look up each candidate in the cadaster database ─────────
    tool_results = {}
    for name in place_candidates:
        matches = _cadaster_lookup(name, cadasters)
        tool_results[name] = matches
        status = f"{len(matches)} match(es): {[m['name_en'] for m in matches]}" if matches else "no match"
        print(f"      [cadaster tool] '{name}' → {status}")

    # ── Step 3: LLM confirms localities from lookup results ────────────────────
    tool_context = json.dumps(tool_results, ensure_ascii=False, indent=2)
    step3_user = (
        f"Original candidates: {cands}\n\n"
        f"Pre-filter kept: {place_candidates}\n"
        f"Pre-filter rejected: {step1_rejected}\n\n"
        f"Cadaster database lookup results:\n{tool_context}\n\n"
        f"Interview context (Arabic):\n{context[:800]}"
    )
    out = _chat_json(VALIDATE_ANCHOR_SYS, step3_user)
    out.setdefault("lebanese_localities", [])
    out.setdefault("primary_anchor", None)
    out.setdefault("candidates", [])
    out["_tool_calls"] = {"cadaster_lookup": tool_results}
    return out


# ──────────────────────────────────────────────────────────────────────────
# HOW TO WIRE INTO pipeline.py
# ──────────────────────────────────────────────────────────────────────────
#
#   from refine_agents import refine_segment, validate_places
#
# (A) In the translate + extract loop, refine BEFORE extracting so extraction
#     runs on the cleaned text, and keep the raw for provenance:
#
#       draft_en   = translate(seg["arabic"])          # Shaheen, as before
#       ref        = refine_segment(seg["arabic"], draft_en)
#       seg["arabic_raw"]   = seg["arabic"]            # keep the original
#       seg["arabic"]       = ref["arabic_clean"]      # cleaned text downstream
#       seg["english"]      = ref["english"]
#       seg["corrections"]  = ref["corrections"]
#       meta = extract(seg["arabic"], seg["english"])  # extract on cleaned text
#
# (B) Replace the anchor logic, just before route():
#
#       context = " ".join(s["arabic"] for s in segments[:4])
#       val     = validate_places(claimed_village, all_places, context)
#       anchor  = ([val["primary_anchor"]] if val.get("primary_anchor")
#                  else val.get("lebanese_localities")
#                  or list(dict.fromkeys(all_places)))
#       routing = route(anchor, segments, cadasters)
#       routing["place_validation"] = val              # store for transparency
#
# Result on your Namliyeh clip: the validator drops "Namliyeh" (program/object),
# sets primary_anchor = "Bint Jbeil", and route() places it correctly.
# Tip: you no longer need to pass claimed_village="Namliyeh" — but if you do,
# the validator now handles it gracefully instead of mis-routing.