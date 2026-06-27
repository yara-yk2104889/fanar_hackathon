import os
import sys
import json
import re
import requests
from dotenv import load_dotenv
from refine_agents import refine_segment, validate_places

sys.stdout.reconfigure(encoding="utf-8")

load_dotenv()

FANAR_KEY = os.getenv("FANAR_API_KEY")
BASE = "https://api.fanar.qa/v1"

AUTH = {"Authorization": f"Bearer {FANAR_KEY}"}
AUTH_JSON = {**AUTH, "Content-Type": "application/json"}

WORDS_PER_CHUNK = 150  # stay well under 4k-word translation cap

SAFETY_THRESHOLD = 3.5  # Fanar-Guard-2 returns 0–5; higher = safer. Harmful ~0.9, benign ~4.6+.

def moderation_gate(text: str) -> dict:
    """Run Fanar-Guard-2 on text. Fails open — errors set passed=True so nothing is silently lost."""
    if not text or not text.strip():
        return {"passed": True, "safety": None, "cultural_awareness": None}
    try:
        resp = requests.post(
            f"{BASE}/moderations",
            headers=AUTH_JSON,
            json={"model": "Fanar-Guard-2", "prompt": text, "response": text},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        safety = data.get("safety")
        ca = data.get("cultural_awareness")
        passed = (float(safety) >= SAFETY_THRESHOLD) if safety is not None else True
        return {"passed": passed, "safety": safety, "cultural_awareness": ca}
    except Exception as exc:
        print(f"[moderation] error: {exc}", file=sys.stderr)
        return {"passed": True, "safety": None, "cultural_awareness": None, "error": str(exc)}


# ── Step 1: Transcribe ──────────────────────────────────────────────────────

def transcribe(file_path: str) -> dict:
    with open(file_path, "rb") as f:
        resp = requests.post(
            f"{BASE}/audio/transcriptions",
            headers=AUTH,
            files={"file": (os.path.basename(file_path), f, "video/mp4")},
            data={"model": "Fanar-Aura-STT-LF-1", "format": "json"},
            timeout=120,
        )
    resp.raise_for_status()
    raw = resp.json()
    # Fanar returns {"id": "...", "json": {"segments": [...]}}
    segments = raw.get("json", {}).get("segments", [])
    full_text = " ".join(s["text"].strip() for s in segments)
    return {"id": raw.get("id"), "text": full_text, "segments": segments}


# ── Step 2: Chunk raw STT segments ─────────────────────────────────────────

def chunk_segments(raw_segments: list) -> list:
    chunks, buf_text, buf_words = [], [], 0
    chunk_start = chunk_end = None

    for seg in raw_segments:
        words = len(seg["text"].split())
        if chunk_start is None:
            chunk_start = seg["start_time"]
        buf_text.append(seg["text"].strip())
        buf_words += words
        chunk_end = seg["end_time"]

        if buf_words >= WORDS_PER_CHUNK:
            chunks.append({"start": chunk_start, "end": chunk_end, "arabic": " ".join(buf_text)})
            buf_text, buf_words, chunk_start = [], 0, None

    if buf_text:
        chunks.append({"start": chunk_start, "end": chunk_end, "arabic": " ".join(buf_text)})

    return chunks


# ── Step 3: Translate segment ───────────────────────────────────────────────

def translate(arabic: str) -> str:
    resp = requests.post(
        f"{BASE}/translations",
        headers=AUTH_JSON,
        json={"model": "Fanar-Shaheen-MT-1", "text": arabic, "langpair": "ar-en", "preprocessing": "default"},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["text"]


# ── Step 4: Extract metadata per segment ────────────────────────────────────

EXTRACT_PROMPT = """You are a Lebanese oral history archivist.
Return ONLY valid JSON — no markdown, no explanation.
{
  "places": ["place names mentioned"],
  "people": ["person names or roles mentioned"],
  "themes": ["e.g. agriculture, displacement, marriage"],
  "keywords_ar": ["Arabic keywords"],
  "keywords_en": ["English keywords"]
}"""

def extract(arabic: str, english: str) -> dict:
    resp = requests.post(
        f"{BASE}/chat/completions",
        headers=AUTH_JSON,
        json={
            "model": "Fanar-C-2-27B",
            "messages": [
                {"role": "system", "content": EXTRACT_PROMPT},
                {"role": "user", "content": f"Arabic:\n{arabic}\n\nEnglish:\n{english}"},
            ],
        },
        timeout=60,
    )
    resp.raise_for_status()
    raw = resp.json()["choices"][0]["message"]["content"]
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        return json.loads(m.group()) if m else {"_raw": raw}


# ── Step 5: Summarize full interview ────────────────────────────────────────

SUMMARY_PROMPT = """You are a Lebanese oral history archivist.
Return ONLY valid JSON — no markdown, no explanation.
{
  "summary_en": "2–4 sentence summary in English",
  "summary_ar": "2–4 sentence summary in Arabic",
  "places": ["all places mentioned across the interview"],
  "people": ["all people mentioned"],
  "themes": ["overall themes of the interview"]
}"""

def summarize(full_arabic: str) -> dict:
    resp = requests.post(
        f"{BASE}/chat/completions",
        headers=AUTH_JSON,
        json={
            "model": "Fanar-C-2-27B",
            "messages": [
                {"role": "system", "content": SUMMARY_PROMPT},
                {"role": "user", "content": f"Full Arabic transcript:\n{full_arabic}"},
            ],
        },
        timeout=90,
    )
    resp.raise_for_status()
    raw = resp.json()["choices"][0]["message"]["content"]
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        return json.loads(m.group()) if m else {"_raw": raw}


# ── Routing: match extracted places to Lebanese cadasters ──────────────────

def load_cadasters(geojson_path: str) -> list:
    with open(geojson_path, encoding="utf-8") as f:
        data = json.load(f)
    cadasters = []
    for feat in data.get("features", []):
        p = feat["properties"]
        # Use adm3_pcode presence to identify cadaster features; avoids
        # admin_level int-vs-string type mismatch that empties the list.
        cid = p.get("adm3_pcode") or p.get("adm3_name")
        if not cid:
            continue
        cadasters.append({
            "id": cid,
            "name_en": p.get("name", ""),
            "name_ar": p.get("name1", ""),
        })
    return cadasters


ROUTE_PROMPT = """You are routing a Lebanese oral history interview to the correct Lebanese cadaster (Admin-3).
Given candidate cadasters and interview context, pick the best match.
Return ONLY valid JSON:
{"cadaster_id": "...", "cadaster_name_en": "...", "confidence": "high|medium|low", "reason": "one sentence"}
If no cadaster fits well, set confidence to "low" and cadaster_id to null."""

def _match_score(place: str, name_en: str) -> int:
    """
    Score a place name against a cadaster's English name.
    3 = exact  |  2 = whole-word prefix  |  1 = substring  |  0 = no match

    "Nabatieh" vs "Nabatieh"        → 3  (exact, wins immediately)
    "Nabatieh" vs "Nabatieh El Tahta" → 1 (substring, loses to exact)
    "Bint Jbeil" vs "Bint"          → 2 (prefix word boundary)
    """
    p = place.strip().lower()
    n = (name_en or "").strip().lower()
    if not p or not n:
        return 0
    if p == n:
        return 3
    if n.startswith(p + " ") or p.startswith(n + " "):
        return 2
    if p in n or n in p:
        return 1
    return 0


def route(places: list, segments: list, cadasters: list) -> dict:
    # Score every (place, cadaster) pair; keep the best score per cadaster.
    best: dict[str, tuple[dict, int]] = {}
    for place in places:
        for cad in cadasters:
            score = _match_score(place, cad["name_en"])
            # Arabic substring match: treat as score 2 (reliable when it fires)
            if score < 2 and place in (cad["name_ar"] or ""):
                score = 2
            if score > 0:
                cid = cad["id"]
                if cid not in best or score > best[cid][1]:
                    best[cid] = (cad, score)

    if not best:
        return {"status": "no_match", "extracted_places": places}

    # Only pass candidates that achieved the highest score tier to the agent.
    # An exact match (score 3) immediately beats any substring match (score 1).
    max_score = max(s for _, s in best.values())
    candidates = [cad for cad, s in best.values() if s == max_score]

    if len(candidates) == 1:
        return {
            "status": "matched",
            "cadaster_id": candidates[0]["id"],
            "cadaster_name_en": candidates[0]["name_en"],
            "confidence": "high",
        }

    # Still ambiguous at the same score tier → agent decides
    context = "\n".join(f"[{s['start']:.1f}s] {s['arabic']}" for s in segments[:6])
    cand_list = "\n".join(f"- {c['id']}: {c['name_en']} / {c['name_ar']}" for c in candidates)

    resp = requests.post(
        f"{BASE}/chat/completions",
        headers=AUTH_JSON,
        json={
            "model": "Fanar-C-2-27B",
            "messages": [
                {"role": "system", "content": ROUTE_PROMPT},
                {
                    "role": "user",
                    "content": f"Extracted places: {places}\n\nCandidates:\n{cand_list}\n\nInterview context:\n{context}",
                },
            ],
        },
        timeout=60,
    )
    resp.raise_for_status()
    raw = resp.json()["choices"][0]["message"]["content"]
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        result = json.loads(m.group()) if m else {"_raw": raw}

    result["status"] = "agent_routed" if result.get("confidence") in ("high", "medium") else "needs_review"
    return result


# ── Main pipeline ───────────────────────────────────────────────────────────

def run_pipeline(
    video_path: str,
    contributor_name: str = None,
    claimed_village: str = None,
    claimed_year: str = None,
    cadaster_geojson: str = None,
):
    print(f"\n{'='*60}\nPIPELINE: {video_path}\n{'='*60}")

    # Step 1
    print("\n[1/5] Transcribing...")
    stt = transcribe(video_path)
    full_arabic = stt.get("text", "")
    raw_segs = stt.get("segments", [])
    print(f"      {len(full_arabic.split())} words | {len(raw_segs)} raw STT segments")
    print(f"\n--- TRANSCRIPT PREVIEW ---\n{full_arabic[:400]}...\n")

    # Moderation gate — short-circuit before spending quota on flagged content
    print("[MOD] Moderating transcript...")
    gate = moderation_gate(full_arabic)
    print(f"      safety={gate.get('safety')} passed={gate['passed']}")
    if not gate["passed"]:
        print("      [FLAGGED] Safety threshold not met — publishing with flag.")
        record = {
            "contributor": contributor_name,
            "claimed_village": claimed_village,
            "claimed_year": claimed_year,
            "status": "published",
            "flagged": True,
            "flag_reason": "safety_threshold",
            "full_arabic_transcript": full_arabic,
            "full_english_transcript": "",
            "moderation": {"safety": gate.get("safety"), "cultural_awareness": gate.get("cultural_awareness")},
            "summary": None,
            "routing": None,
            "segments": [],
        }
        out = video_path.rsplit(".", 1)[0] + "_output.json"
        with open(out, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=2)
        print(f"\nSaved → {out}")
        return record

    def _is_content_filter(exc: Exception) -> bool:
        r = getattr(exc, "response", None)
        if r is None or r.status_code != 400:
            return False
        try:
            return r.json().get("error", {}).get("code") == "content_filter"
        except Exception:
            return False

    chat_filter_partial = False

    # Step 2
    print("[2/5] Chunking...")
    segments = chunk_segments(raw_segs)
    print(f"      {len(segments)} chunks")

    # Steps 3 + 4
    print(f"\n[3+4/5] Translating + extracting ({len(segments)} segments)...")
    all_places = []
    for i, seg in enumerate(segments):
        print(f"  [{i+1}/{len(segments)}] {seg['start']:.1f}s – {seg['end']:.1f}s")
        draft_en = translate(seg["arabic"])
        try:
            ref = refine_segment(seg["arabic"], draft_en)
        except Exception as exc:
            if _is_content_filter(exc):
                print(f"      [CHAT FILTER] refine_segment skipped on segment {i+1} — using raw text.")
                ref = {"arabic_clean": seg["arabic"], "english": draft_en, "corrections": [], "low_confidence_spans": []}
                chat_filter_partial = True
            else:
                raise
        seg["arabic_raw"]   = seg["arabic"]
        seg["arabic"]       = ref["arabic_clean"]
        seg["english"]      = ref["english"]
        seg["corrections"]  = ref["corrections"]
        try:
            meta = extract(seg["arabic"], seg["english"])
        except Exception as exc:
            if _is_content_filter(exc):
                print(f"      [CHAT FILTER] extract skipped on segment {i+1} — no metadata for this segment.")
                meta = {}
                chat_filter_partial = True
            else:
                raise
        seg["places"]      = meta.get("places", [])
        seg["people"]      = meta.get("people", [])
        seg["themes"]      = meta.get("themes", [])
        seg["keywords_ar"] = meta.get("keywords_ar", [])
        seg["keywords_en"] = meta.get("keywords_en", [])
        all_places.extend(seg["places"])
        print(f"         places={seg['places']} themes={seg['themes']}")

    # Step 5
    print("\n[5/5] Summarizing...")
    try:
        summary = summarize(full_arabic)
    except Exception as exc:
        if _is_content_filter(exc):
            print("      [CHAT FILTER] summarize skipped — no AI summary for this interview.")
            summary = {}
            chat_filter_partial = True
        else:
            raise
    print(f"\n--- SUMMARY ---\n{summary.get('summary_en', summary)}\n")

    # Routing
    routing = None
    if cadaster_geojson and os.path.exists(cadaster_geojson):
        print("[+] Routing to Lebanese cadaster...")
        context = " ".join(s["arabic"] for s in segments[:4])
        cadasters = load_cadasters(cadaster_geojson)
        val = validate_places(claimed_village, all_places, context, cadasters=cadasters)
        # Always try the contributor's typed village first — do not let the
        # LLM validator discard it.  AI-extracted places are appended after.
        if claimed_village:
            extras = [p for p in (val.get("lebanese_localities") or []) if p != claimed_village]
            anchor = [claimed_village] + extras
        elif val.get("primary_anchor"):
            anchor = [val["primary_anchor"]]
        else:
            anchor = val.get("lebanese_localities") or list(dict.fromkeys(all_places))
        routing = route(anchor, segments, cadasters)
        routing["place_validation"] = val
        print(f"    status={routing.get('status')} | cadaster={routing.get('cadaster_name_en', 'N/A')}")

    full_english = " ".join(s["english"] for s in segments if s.get("english"))

    interview = {
        "contributor": contributor_name,
        "claimed_village": claimed_village,
        "claimed_year": claimed_year,
        "status": "published",
        "flagged": chat_filter_partial,
        "flag_reason": "chat_filter" if chat_filter_partial else None,
        "full_arabic_transcript": full_arabic,
        "full_english_transcript": full_english,
        "moderation": {"safety": gate.get("safety"), "cultural_awareness": gate.get("cultural_awareness")},
        "summary": summary,
        "routing": routing,
        "segments": segments,
    }

    out = video_path.rsplit(".", 1)[0] + "_output.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(interview, f, ensure_ascii=False, indent=2)
    print(f"\nSaved → {out}")
    return interview


if __name__ == "__main__":
    run_pipeline(
        video_path="namliyeh_clip.mp4",
        contributor_name="Test Contributor",
        claimed_village="none",
        claimed_year="none",
        cadaster_geojson="lbn_admin_boundaries.geojson/lbn_adminpoints.geojson",
    )
