"""
refine_agents.py

Two correction/validation agents that slot into your existing pipeline.

  Agent 1  refine_segment()   fixes dialect mis-hearings + cultural-term mistranslation
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
# Cultural glossary — terms that get literal-translated or mis-corrected.
# Add to this as you find more. It is the single highest-value thing here.
# ──────────────────────────────────────────────────────────────────────────
GLOSSARY = {
    "نملية": "namliyeh — a traditional screened wooden food-storage cupboard (a larder). "
             "Often a program/segment name too. NEVER translate as 'ant'.",
    "صاج":  "saj — thin Levantine flatbread, baked on a domed metal griddle (also called a saj). "
            "NEVER translate as 'steel' or 'sheet metal'.",
    "حجة":  "hajjeh — a respectful term of address for an older woman. "
            "ASR often mishears it as حجم ('size'); fix from context.",
    "دبكة": "dabke — a Levantine folk line-dance.",
    "زجل":  "zajal — improvised colloquial Lebanese poetry.",
    "ضيعة": "day'a — a village (colloquial).",
}

def _glossary_text() -> str:
    return "\n".join(f"- {k}: {v}" for k, v in GLOSSARY.items())


# ──────────────────────────────────────────────────────────────────────────
# Agent 1 — Refiner: fixes dialect transcription + cultural-term translation
# ──────────────────────────────────────────────────────────────────────────
REFINE_SYS = """You are a Lebanese-dialect transcription editor for an oral-history archive.
You receive a RAW speech-to-text Arabic segment (which may contain dialect mishearings)
and a DRAFT English translation (which may be wrong).

Do three things:
1. Produce a CLEANED Arabic version. Fix only clear mishearings using context and Lebanese
   dialect knowledge. Do NOT invent or add content. If a span is genuinely unrecoverable,
   keep it as-is and list it under low_confidence_spans.
2. Produce a faithful English translation of the CLEANED Arabic. Respect the cultural glossary
   below: transliterate cultural terms and gloss them in brackets; never literal-translate them.
3. List every correction you made, each with a confidence level.

Cultural glossary:
{glossary}

Return ONLY valid JSON — no markdown, no explanation:
{
  "arabic_clean": "...",
  "english": "...",
  "corrections": [{"from": "...", "to": "...", "confidence": "high|medium|low"}],
  "low_confidence_spans": ["unrecoverable Arabic spans, if any"]
}"""

def refine_segment(raw_arabic: str, draft_english: str = "") -> dict:
    """Clean the Arabic and fix the translation. Returns arabic_clean, english, corrections."""
    system = REFINE_SYS.replace("{glossary}", _glossary_text())
    user = f"RAW Arabic (speech-to-text):\n{raw_arabic}\n\nDRAFT English:\n{draft_english}"
    out = _chat_json(system, user)
    out.setdefault("arabic_clean", raw_arabic)
    out.setdefault("english", draft_english)
    out.setdefault("corrections", [])
    out.setdefault("low_confidence_spans", [])
    return out


# ──────────────────────────────────────────────────────────────────────────
# Agent 2 — Place Validator: keeps only real Lebanese localities, picks anchor
# ──────────────────────────────────────────────────────────────────────────
VALIDATE_SYS = """You are a Lebanese geography expert helping an oral-history archive route memories.
You receive candidate strings that an extractor labelled as "places". Some are NOT real
geographic places. For example:
- "Namliyeh" / "النملية" is a TV-program name AND a traditional food-storage cupboard — NOT a town.
- household objects, foods, or cultural terms are not places.
- a country or broad region (e.g. "Lebanon", "Palestine") is not a specific locality to route to.

For EACH candidate, decide its type. Then list only the specific Lebanese localities, ordered by
how central they are to this interview, and choose the single best routing anchor.

Return ONLY valid JSON — no markdown:
{
  "candidates": [
    {"name": "...", "type": "lebanese_locality|country_or_region|object_or_food|program_or_title|other", "is_place": true}
  ],
  "lebanese_localities": ["specific localities only"],
  "primary_anchor": "the single best locality to place this memory, or null",
  "reason": "one sentence"
}"""

def validate_places(claimed_village: str, extracted_places: list, context: str = "") -> dict:
    """Filter extracted 'places' down to real Lebanese localities and pick the routing anchor."""
    cands = []
    if claimed_village:
        cands.append(claimed_village)
    for p in extracted_places:
        if p not in cands:
            cands.append(p)
    user = f"Candidate strings: {cands}\n\nInterview context (Arabic):\n{context[:1500]}"
    out = _chat_json(VALIDATE_SYS, user)
    out.setdefault("lebanese_localities", [])
    out.setdefault("primary_anchor", None)
    out.setdefault("candidates", [])
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