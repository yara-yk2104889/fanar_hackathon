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

# Places to skip — countries, occupied territories, and common Arabic nouns that
# the pipeline mistakenly tags as places.
_PLACE_BLOCKLIST = {
    # Countries / regions — not Lebanese localities
    "لبنان", "فلسطين", "فلسطين المحتلة", "سوريا", "الأردن", "إسرائيل",
    "Lebanon", "Palestine", "Occupied Palestine", "Syria", "Jordan", "Israel",
    # Common nouns that slip through
    "البيت", "المنزل", "القرية", "المدينة", "المنطقة",
}

def _is_country_or_region(place: str) -> bool:
    """True if the place name looks like a country or broad region, not a Lebanese locality."""
    p = place.strip()
    if p in _PLACE_BLOCKLIST:
        return True
    lower = p.lower()
    # Parenthetical form like "Bint Jbeil (Lebanon)" is fine; bare "Lebanon" is not
    if lower in ("lebanon", "palestine", "syria", "jordan") and "(" not in p:
        return True
    # Phrases like "Southern Border Region (Lebanon/Palestine)"
    if "border region" in lower or "occupied" in lower:
        return True
    return False


def extract_claims(interview: dict) -> dict:
    """Step 1: derive checkable factual claims from pipeline metadata — no LLM call.

    Generates:
    - One place claim per unique extracted Lebanese locality (verified by cadaster)
    - One content claim per segment that has both places/themes and English text
    Caps at 6 total claims to keep API usage predictable.
    """
    claims: list = []
    seen: set = set()

    summary  = interview.get("summary") or {}
    segments = interview.get("segments") or []

    # Collect all places in order: summary first, then per-segment
    all_places = list(dict.fromkeys(
        (summary.get("places") or []) +
        [p for seg in segments for p in (seg.get("places") or [])]
    ))

    for place in all_places:
        if not place or place in seen:
            continue
        if _is_country_or_region(place):
            continue
        seen.add(place)
        claims.append({
            "claim_en": f"{place} is a location in Lebanon.",
            "claim_ar": f"يقع {place} في لبنان.",
            "type": "place",
        })

    # One content claim per segment with English text + at least one place or theme
    for seg in segments:
        if len(claims) >= 6:
            break
        english = (seg.get("english") or "").strip()
        arabic  = (seg.get("arabic")  or "").strip()
        places  = seg.get("places")  or []
        themes  = seg.get("themes")  or []
        if not english or (not places and not themes):
            continue
        key = english[:60]
        if key in seen:
            continue
        seen.add(key)
        ctype = "place" if places else "cultural_tradition"
        claims.append({
            "claim_en": english[:400],
            "claim_ar": arabic[:400],
            "type": ctype,
        })

    return {
        "checkable_claims": claims,
        "testimony_excluded_count": 0,
    }


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
        out = _chat_json(GROUNDED_SYS, question, model=GROUNDED, timeout=90)
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
    out = _chat_json(JUDGE_SYS, user, timeout=90)
    out.setdefault("verdict",    "no_public_record")
    out.setdefault("confidence", "low")
    out.setdefault("source",     None)
    out.setdefault("note",       "")
    return out


# ── Agent infrastructure ─────────────────────────────────────────────────────

MAX_TOOL_CALLS = 4  # per claim; prevents runaway loops burning quota

REACT_SYS = """You are a careful fact-checker for a Lebanese oral-history archive.
Investigate the claim step by step, then call finish_verdict.

Available tools:
  search_knowledge(query)           — query knowledge base with source citations
  lookup_cadaster(place_name)       — look up a place in Lebanon's cadaster database
  finish_verdict(verdict, confidence, note, source) — submit your final verdict

To call a tool write EXACTLY (one tool per response):
  ACTION: tool_name
  ARGS: {"key": "value"}

Verdicts: confirmed | partially_supported | no_public_record | contradicted
- "no_public_record" is NOT "false"
- "contradicted" only if a source directly refutes the claim
- You MUST call finish_verdict to complete"""


def _cadaster_lookup(place_name: str, cadasters: list) -> list:
    """Search cadaster list for a place name. Returns up to 3 best matches."""
    p = place_name.strip().lower()
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
            results.append({"id": cad["id"], "name_en": cad["name_en"], "name_ar": cad["name_ar"], "score": score})
    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:3]


def _run_tool(name: str, args: dict, cadasters: list) -> str:
    """Execute a tool call and return the result as a JSON string."""
    if name == "search_knowledge":
        result = _retrieve_grounded(args.get("query", ""))
        return json.dumps(result, ensure_ascii=False)
    if name == "lookup_cadaster":
        matches = _cadaster_lookup(args.get("place_name", ""), cadasters)
        if matches:
            return json.dumps(matches, ensure_ascii=False)
        return json.dumps({"matches": [], "note": "No cadaster matches found."})
    return json.dumps({"error": f"Unknown tool: {name}"})


def _force_verdict(claim_en: str, claim_ar: str, messages: list) -> dict:
    """Force a verdict from accumulated context when MAX_TOOL_CALLS is hit."""
    FORCE_SYS = """You are a fact-checker. Based on the evidence gathered so far, give your best verdict.
Return ONLY valid JSON — no markdown:
{"verdict": "confirmed|partially_supported|no_public_record|contradicted", "confidence": "high|medium|low", "source": "url or null", "note": "one neutral sentence"}"""

    context_parts = [
        f"{m['role'].upper()}: {str(m.get('content') or '')[:300]}"
        for m in messages
        if m.get("content") and m.get("role") in ("assistant", "tool", "user")
    ]
    user_text = f"Claim (EN): {claim_en}\nClaim (AR): {claim_ar}\n\nEvidence gathered:\n" + "\n".join(context_parts[-6:])
    out = _chat_json(FORCE_SYS, user_text)
    out.setdefault("verdict",    "no_public_record")
    out.setdefault("confidence", "low")
    out.setdefault("source",     None)
    out.setdefault("note",       "Verdict forced after reaching maximum tool calls.")
    out["forced"] = True
    return out



def _agent_loop_react(claim_en: str, claim_ar: str, ctype: str, cadasters: list) -> dict:
    """
    ReAct text-parsing fallback when native function calling is unavailable.
    LLM writes ACTION:/ARGS: blocks; capped at MAX_TOOL_CALLS per claim.
    """
    messages = [
        {"role": "system", "content": REACT_SYS},
        {"role": "user", "content": (
            f"Claim (English): {claim_en}\n"
            f"Claim (Arabic): {claim_ar}\n"
            f"Type: {ctype}\n\n"
            "Investigate this claim. Start by choosing a tool."
        )},
    ]
    tool_calls_used = 0

    while tool_calls_used < MAX_TOOL_CALLS:
        resp = requests.post(
            f"{BASE}/chat/completions",
            headers=AUTH_JSON,
            json={"model": MODEL, "messages": messages},
            timeout=90,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]
        messages.append({"role": "assistant", "content": content})

        action_m = re.search(r"ACTION:\s*(\w+)", content)
        args_m   = re.search(r"ARGS:\s*(\{.*?\})", content, re.DOTALL)
        if not action_m:
            break

        fn_name = action_m.group(1).strip()
        try:
            fn_args = json.loads(args_m.group(1)) if args_m else {}
        except Exception:
            fn_args = {}

        if fn_name == "finish_verdict":
            print(f"         [agent:react] finish after {tool_calls_used} tool call(s)")
            return {
                "verdict":         fn_args.get("verdict", "no_public_record"),
                "confidence":      fn_args.get("confidence", "low"),
                "source":          fn_args.get("source"),
                "note":            fn_args.get("note", ""),
                "tool_calls_used": tool_calls_used,
                "forced":          False,
            }

        result = _run_tool(fn_name, fn_args, cadasters)
        print(f"         [agent:react:{fn_name}] → {result[:80]}")
        tool_calls_used += 1
        messages.append({
            "role": "user",
            "content": f"TOOL RESULT:\n{result}\n\nContinue your investigation or call finish_verdict.",
        })

    print(f"         [agent:react] cap hit ({MAX_TOOL_CALLS}) — forcing verdict")
    verdict = _force_verdict(claim_en, claim_ar, messages)
    verdict["tool_calls_used"] = tool_calls_used
    return verdict


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


def verify_interview(interview_record: dict, cadasters: list = None) -> dict:
    """
    Agent-based fact-checker. Returns a NEW dict (deep copy) with two new keys:
      - "evidence":         list of per-claim verdicts
      - "evidence_summary": verdict counts + metadata

    Per claim, runs a ReAct agent loop (native function calling → ReAct text
    fallback → direct judge fallback). Capped at MAX_TOOL_CALLS per claim.
    The original record is never mutated.
    """
    result    = copy.deepcopy(interview_record)
    cadasters = cadasters or []

    # ── Step 1: extract claims ────────────────────────────────────────────────
    print("\n[1/3] Extracting checkable factual claims...")
    claims_data = extract_claims(result)
    claims      = claims_data.get("checkable_claims", [])
    testimony_n = claims_data.get("testimony_excluded_count", 0)
    print(f"      {len(claims)} checkable claims | {testimony_n} testimony statements excluded")

    if not claims:
        result["evidence"]         = []
        result["evidence_summary"] = _build_evidence_summary([], testimony_n)
        return result

    # ── Steps 2+3: agent loop per claim ──────────────────────────────────────
    print(f"\n[2+3/3] Agent fact-checking ({len(claims)} claims, max {MAX_TOOL_CALLS} tool calls each)...")
    evidence_list = []

    for i, claim in enumerate(claims):
        claim_en = claim.get("claim_en", "")
        claim_ar = claim.get("claim_ar", "")
        ctype    = claim.get("type", "unknown")
        print(f"\n  [{i+1}/{len(claims)}] [{ctype}] {claim_en[:80]}")

        verdict = None

        # Fast path: place claims resolved via cadaster lookup — no LLM call needed
        if ctype == "place" and cadasters:
            place_name = claim_en.split(" is a location")[0].strip()
            matches = _cadaster_lookup(place_name, cadasters)
            best = matches[0] if matches else None
            if best and best["score"] >= 2:
                verdict = {
                    "verdict": "confirmed",
                    "confidence": "high",
                    "source": f"Lebanese cadaster (ID: {best['id']})",
                    "note": f"Matched to '{best['name_en']}' ({best['name_ar']}) in the Lebanese administrative database.",
                    "tool_calls_used": 1,
                    "forced": False,
                }
            else:
                verdict = {
                    "verdict": "no_public_record",
                    "confidence": "medium",
                    "source": None,
                    "note": "Not found in the Lebanese cadaster — may be a region name or spelling variant.",
                    "tool_calls_used": 1,
                    "forced": False,
                }
            print(f"         [cadaster] {verdict['verdict']} | match={best}")

        if verdict is None:
            try:
                verdict = _agent_loop_react(claim_en, claim_ar, ctype, cadasters)
            except Exception as exc:
                print(f"         [react] failed ({exc.__class__.__name__}) — marking unchecked")
                try:
                    evidence = retrieve_evidence(claim_en)
                    verdict  = judge_claim(claim_en, claim_ar, evidence)
                except Exception as exc2:
                    print(f"         [judge] also failed ({exc2.__class__.__name__}) — API unavailable")
                    verdict = {
                        "verdict": "no_public_record",
                        "confidence": "low",
                        "source": None,
                        "note": "Could not verify — Fanar API unavailable during processing.",
                        "tool_calls_used": 0,
                        "forced": True,
                    }
                verdict.setdefault("tool_calls_used", 0)
                verdict.setdefault("forced", False)

        print(
            f"         verdict={verdict['verdict']} ({verdict['confidence']}) "
            f"| tools={verdict.get('tool_calls_used', '?')} forced={verdict.get('forced', False)}"
        )

        entry = {
            "claim_en":            claim_en,
            "claim_ar":            claim_ar,
            "type":                ctype,
            "verdict":             verdict.get("verdict", "no_public_record"),
            "confidence":          verdict.get("confidence", "low"),
            "source":              verdict.get("source"),
            "note":                verdict.get("note", ""),
            "tool_calls_used":     verdict.get("tool_calls_used", 0),
            "forced":              verdict.get("forced", False),
            "possibly_sole_record": _is_possibly_sole_record(claim, verdict),
        }
        evidence_list.append(entry)

    # ── Step 4: attach ────────────────────────────────────────────────────────
    result["evidence"]         = evidence_list
    result["evidence_summary"] = _build_evidence_summary(evidence_list, testimony_n)
    return result


# ── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    path = sys.argv[1] if len(sys.argv) > 1 else "namliyeh_clip_output.json"

    print(f"\n{'='*60}")
    print(f"EVIDENCE AGENT  →  {path}")
    print(f"{'='*60}")

    # Load cadasters for the geographic lookup tool
    cadasters: list = []
    CADASTER_PATH = "lbn_admin_boundaries.geojson/lbn_adminpoints.geojson"
    if os.path.exists(CADASTER_PATH):
        try:
            with open(CADASTER_PATH, encoding="utf-8") as f:
                gj = json.load(f)
            for feat in gj.get("features", []):
                p   = feat["properties"]
                cid = p.get("adm3_pcode") or p.get("adm3_name")
                if cid:
                    cadasters.append({"id": str(cid), "name_en": p.get("name", ""), "name_ar": p.get("name1", "")})
            print(f"Loaded {len(cadasters)} cadasters")
        except Exception as e:
            print(f"Could not load cadasters: {e}")

    with open(path, encoding="utf-8") as f:
        interview = json.load(f)

    enriched = verify_interview(interview, cadasters=cadasters)

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
