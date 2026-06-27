"""
evidence_agent.py
Verifies factual claims extracted from Lebanese oral-history interviews against
public sources. Attaches verdicts ALONGSIDE the original record — nothing is
ever overwritten.

Main entry-point:
    result = verify_interview(interview_record)
"""

import os
import re
import json
import copy
import requests
from dotenv import load_dotenv

load_dotenv()


class InconsistencyError(Exception):
    """Raised when the evidence agent finds a high-confidence contradiction."""
    pass


FANAR_KEY = os.getenv("FANAR_API_KEY")
BASE      = "https://api.fanar.qa/v1"
AUTH_JSON = {"Authorization": f"Bearer {FANAR_KEY}", "Content-Type": "application/json"}
MODEL     = "Fanar-C-2-27B"


# ── Shared helpers ────────────────────────────────────────────────────────────

def _chat_json(system: str, user: str, model: str = MODEL, timeout: int = 90) -> dict:
    """POST to Fanar /chat/completions, parse JSON from the reply (with regex fallback)."""
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


# ── Step 1 — Extract checkable factual claims ─────────────────────────────────

# Places to skip — countries, occupied territories, and common Arabic nouns that
# the pipeline mistakenly tags as places.
_PLACE_BLOCKLIST = {
    # Countries / territories
    "لبنان", "فلسطين", "فلسطين المحتلة", "سوريا", "الأردن", "إسرائيل",
    "مصر", "العراق", "السعودية", "تركيا", "إيران",
    "Lebanon", "Palestine", "Occupied Palestine", "Syria", "Jordan", "Israel",
    "Egypt", "Iraq", "Saudi Arabia", "Turkey", "Iran", "Kuwait", "UAE",
    # Common Arabic nouns that slip through
    "البيت", "المنزل", "القرية", "المدينة", "المنطقة",
}

_COUNTRY_NAMES_LOWER = {
    "lebanon", "palestine", "syria", "jordan", "israel",
    "egypt", "iraq", "saudi arabia", "turkey", "iran", "kuwait", "uae",
}

def _is_country_or_region(place: str) -> bool:
    p = place.strip()
    if p in _PLACE_BLOCKLIST:
        return True
    lower = p.lower()
    if lower in _COUNTRY_NAMES_LOWER and "(" not in p:
        return True
    if "border region" in lower or "occupied" in lower:
        return True
    return False


def extract_claims(interview: dict) -> dict:
    """Derive checkable factual claims from pipeline metadata — no LLM call."""
    claims: list = []
    seen: set = set()

    summary  = interview.get("summary") or {}
    segments = interview.get("segments") or []

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


# ── Step 2 — OpenAI web search retrieval ─────────────────────────────────────

def _retrieve_openai_web(claim_en: str) -> dict:
    """
    Use OpenAI's web search tool to find evidence for a claim.
    Returns {"answer": str, "sources": [{title, url}], "has_useful_answer": bool}
    """
    openai_key = os.getenv("OPENAI_API_KEY")
    if not openai_key:
        return {"has_useful_answer": False, "answer": "OpenAI API key not set.", "sources": []}

    try:
        from openai import OpenAI as _OpenAI
        client = _OpenAI(api_key=openai_key)

        prompt = (
            f"Is this factual claim accurate? Search the web and provide evidence.\n"
            f"Claim: {claim_en}\n\n"
            f"Focus especially on Lebanese history, geography, and culture if relevant."
        )

        response = client.responses.create(
            model="gpt-4o-mini",
            tools=[{"type": "web_search_preview"}],
            input=prompt,
        )

        text = ""
        sources = []
        seen_urls: set = set()

        for block in response.output:
            content_parts = getattr(block, "content", None) or []
            for part in content_parts:
                if hasattr(part, "text"):
                    text += part.text
                for ann in (getattr(part, "annotations", None) or []):
                    url = getattr(ann, "url", None)
                    if url and url not in seen_urls:
                        seen_urls.add(url)
                        sources.append({
                            "title": getattr(ann, "title", None) or url,
                            "url": url,
                        })
            # fallback: direct .text attribute
            if not content_parts and hasattr(block, "text"):
                text += block.text

        return {
            "answer": text.strip(),
            "sources": sources,
            "has_useful_answer": bool(text.strip()),
        }

    except Exception as exc:
        print(f"    [openai-web] error: {exc}")
        return {"has_useful_answer": False, "answer": "", "sources": []}


def retrieve_evidence(claim_en: str) -> dict:
    """Retrieve web evidence for a claim via OpenAI web search."""
    result = _retrieve_openai_web(claim_en)
    result["backend_used"] = "openai_web"
    return result


# ── Step 3 — Judge claim against evidence ─────────────────────────────────────

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
    """Step 3: judge one claim against retrieved evidence using Fanar-C-2-27B."""
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


# ── Possibly-sole-record flag ─────────────────────────────────────────────────

_LOCAL_TYPES = {"place", "structure", "event"}

def _is_possibly_sole_record(claim: dict, verdict: dict) -> bool:
    return (
        claim.get("type") in _LOCAL_TYPES
        and verdict.get("verdict") == "no_public_record"
    )


# ── Step 4 — Attach evidence to interview record ──────────────────────────────

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
        "verdict_counts":             counts,
        "total_claims_checked":       len(evidence_list),
        "testimony_excluded_count":   testimony_excluded,
        "possibly_sole_record_count": sole_record_count,
    }


def verify_interview(interview_record: dict, cadasters: list = None) -> dict:
    """
    Agent-based fact-checker. Returns a deep copy of the interview with two new keys:
      - "evidence":         list of per-claim verdicts (each includes a "sources" list)
      - "evidence_summary": verdict counts + metadata

    Claim verification uses OpenAI web search. Only confirmed/partially_supported
    verdicts will have non-empty sources lists.
    """
    result    = copy.deepcopy(interview_record)
    cadasters = cadasters or []

    print("\n[1/3] Extracting checkable factual claims...")
    claims_data = extract_claims(result)
    claims      = claims_data.get("checkable_claims", [])
    testimony_n = claims_data.get("testimony_excluded_count", 0)
    print(f"      {len(claims)} checkable claims | {testimony_n} testimony statements excluded")

    if not claims:
        result["evidence"]         = []
        result["evidence_summary"] = _build_evidence_summary([], testimony_n)
        return result

    print(f"\n[2+3/3] Agent fact-checking ({len(claims)} claims via OpenAI web search)...")
    evidence_list = []

    for i, claim in enumerate(claims):
        claim_en = claim.get("claim_en", "")
        claim_ar = claim.get("claim_ar", "")
        ctype    = claim.get("type", "unknown")
        print(f"\n  [{i+1}/{len(claims)}] [{ctype}] {claim_en[:80]}")

        verdict = None

        # Fast path: place claims resolved via cadaster — only when there's a strong match.
        # If no good match, fall through to OpenAI web search.
        if ctype == "place" and cadasters and " is a location in Lebanon" in claim_en:
            place_name = claim_en.split(" is a location")[0].strip()
            matches = _cadaster_lookup(place_name, cadasters)
            best = matches[0] if matches else None
            if best and best["score"] >= 2:
                verdict = {
                    "verdict":    "confirmed",
                    "confidence": "high",
                    "source":     f"Lebanese cadaster (ID: {best['id']})",
                    "sources":    [{"title": f"Lebanese cadaster — {best['name_en']} ({best['name_ar']})", "url": None}],
                    "note":       f"Matched to '{best['name_en']}' ({best['name_ar']}) in the Lebanese administrative database.",
                    "tool_calls_used": 1,
                    "forced": False,
                }
                print(f"         [cadaster] confirmed | match={best}")
            else:
                print(f"         [cadaster] no strong match (best={best}) — falling through to web search")

        if verdict is None:
            try:
                print(f"         [openai-web] searching...")
                evidence = retrieve_evidence(claim_en)
                print(f"         [openai-web] got {len(evidence.get('sources', []))} source(s)")
                j = judge_claim(claim_en, claim_ar, evidence)
                verdict = {
                    "verdict":         j.get("verdict", "no_public_record"),
                    "confidence":      j.get("confidence", "low"),
                    "source":          j.get("source"),
                    "sources":         evidence.get("sources", []),
                    "note":            j.get("note", ""),
                    "tool_calls_used": 1,
                    "forced":          False,
                }
            except Exception as exc:
                print(f"         [web+judge] failed ({exc.__class__.__name__}) — marking unchecked")
                verdict = {
                    "verdict":    "no_public_record",
                    "confidence": "low",
                    "source":     None,
                    "sources":    [],
                    "note":       "Could not verify — API unavailable during processing.",
                    "tool_calls_used": 0,
                    "forced": True,
                }

        print(
            f"         verdict={verdict['verdict']} ({verdict['confidence']}) "
            f"| tools={verdict.get('tool_calls_used', '?')} forced={verdict.get('forced', False)} "
            f"| sources={len(verdict.get('sources', []))}"
        )

        entry = {
            "claim_en":             claim_en,
            "claim_ar":             claim_ar,
            "type":                 ctype,
            "verdict":              verdict.get("verdict", "no_public_record"),
            "confidence":           verdict.get("confidence", "low"),
            "source":               verdict.get("source"),
            "sources":              verdict.get("sources", []),
            "note":                 verdict.get("note", ""),
            "tool_calls_used":      verdict.get("tool_calls_used", 0),
            "forced":               verdict.get("forced", False),
            "possibly_sole_record": _is_possibly_sole_record(claim, verdict),
        }
        evidence_list.append(entry)

    result["evidence"]         = evidence_list
    result["evidence_summary"] = _build_evidence_summary(evidence_list, testimony_n)
    return result


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    path = sys.argv[1] if len(sys.argv) > 1 else "namliyeh_clip_output.json"

    print(f"\n{'='*60}")
    print(f"EVIDENCE AGENT  →  {path}")
    print(f"{'='*60}")

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
        for s in e.get("sources", []):
            print(f"    ↳ {s.get('title')} — {s.get('url') or 'no url'}")

    out_path = path.replace("_output.json", "_evidence.json")
    if out_path == path:
        out_path = path.rsplit(".", 1)[0] + "_evidence.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(enriched, f, ensure_ascii=False, indent=2)
    print(f"\nSaved → {out_path}")
