import os
import sys
import json
import re
import base64
import mimetypes
import requests
from dotenv import load_dotenv
from refine_agents import validate_places

load_dotenv()
sys.stdout.reconfigure(encoding="utf-8")

FANAR_KEY = os.getenv("FANAR_API_KEY")
BASE = "https://api.fanar.qa/v1"
AUTH_JSON = {"Authorization": f"Bearer {FANAR_KEY}", "Content-Type": "application/json"}

VISION_MODEL = "Fanar-Oryx-IVU-2" 
REASON_MODEL = "Fanar-C-2-27B"


# ── Shared helpers ──────────────────────────────────────────────────────────

def _parse_json(raw: str) -> dict:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        return json.loads(m.group()) if m else {"_raw": raw}


def _encode_image(image_path: str) -> tuple:
    mime, _ = mimetypes.guess_type(image_path)
    mime = mime or "image/jpeg"
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")
    return b64, mime


def _vision(image_path: str, prompt: str, timeout: int = 60) -> str:
    """Call Fanar-Oryx-IVU-2 with an image + text prompt. Retries on 429 with backoff."""
    import time
    b64, mime = _encode_image(image_path)
    payload = {
        "model": VISION_MODEL,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                {"type": "text", "text": prompt},
            ],
        }],
    }
    waits = [15, 30]
    for attempt, wait in enumerate([0] + waits):
        if wait:
            print(f"      [rate limit] waiting {wait}s (attempt {attempt})...")
            time.sleep(wait)
        resp = requests.post(f"{BASE}/chat/completions", headers=AUTH_JSON, json=payload, timeout=timeout)
        if resp.status_code == 429:
            if attempt < len(waits):
                continue
            raise RuntimeError("QUOTA_EXHAUSTED: Fanar vision API quota exceeded — try again later.")
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


def _vision_json(image_path: str, prompt: str, timeout: int = 60) -> dict:
    return _parse_json(_vision(image_path, prompt, timeout))


def _chat_json(system: str, user: str, timeout: int = 60) -> dict:
    resp = requests.post(
        f"{BASE}/chat/completions",
        headers=AUTH_JSON,
        json={
            "model": REASON_MODEL,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        },
        timeout=timeout,
    )
    resp.raise_for_status()
    raw = resp.json()["choices"][0]["message"]["content"]
    return _parse_json(raw)


SAFETY_THRESHOLD = 3.5  # Fanar-Guard-2 returns 0–5; higher = safer. Harmful ~0.9, benign ~4.6+.

def _moderate(text: str) -> dict:
    """Run Fanar-Guard-2 moderation on text. Fails open so no contribution is silently lost."""
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
    except Exception:
        return {"passed": True, "note": "Fanar-Guard-2 unavailable — flagged for manual review"}


# ── Agent 1: Describe ───────────────────────────────────────────────────────

DESCRIBE_PROMPT_BASE = """Write a 1–2 sentence caption for this photo, like the caption under a newspaper image.
State what is shown and where/when if visible. Be factual and concise — no lists, no speculation."""

DESCRIBE_PROMPT_WITH_CAPTION = """The contributor provided this caption: "{caption}"

Write a 1–2 sentence factual description of this photo that builds on the contributor's caption above.
Do not contradict it. Do not speculate beyond what is visible or stated. Be concise."""

def describe_photo(image_path: str, contributor_caption: str = None) -> str:
    if contributor_caption and contributor_caption.strip():
        prompt = DESCRIBE_PROMPT_WITH_CAPTION.format(caption=contributor_caption.strip())
    else:
        prompt = DESCRIBE_PROMPT_BASE
    return _vision(image_path, prompt)


# ── Agent 2: Locate ─────────────────────────────────────────────────────────

LOCATE_PROMPT = """You are a Lebanese geography and architecture expert.
Look at this photo and identify every visual clue about WHERE in Lebanon it might be
and WHEN it was taken. Consider: coastal vs mountain vs southern plains vs Bekaa valley,
architectural style (Ottoman, French mandate, brutalist, vernacular stone), vegetation
(cedar, olive, banana, tobacco), signage language and script, clothing, vehicle models,
electricity infrastructure, and any landmarks.

Return ONLY valid JSON — no markdown:
{
  "inferred_region": "South Lebanon | Mount Lebanon | North Lebanon | Bekaa | Beirut | unknown",
  "inferred_locality": "most specific place name you can confidently suggest, or null",
  "era_estimate": "decade or range e.g. 1960s, 1970s-1980s, or unknown",
  "location_clues": ["each visual clue that points to this location"],
  "era_clues": ["each visual clue that points to this era"],
  "confidence": "high | medium | low",
  "notes": "any ambiguity or alternative reading worth flagging"
}"""

def locate_photo(image_path: str) -> dict:
    """Infer region, locality, and era from visual features. Clearly AI-inferred, not contributor data."""
    result = _vision_json(image_path, LOCATE_PROMPT)
    result.setdefault("inferred_region", "unknown")
    result.setdefault("inferred_locality", None)
    result.setdefault("era_estimate", "unknown")
    result.setdefault("location_clues", [])
    result.setdefault("era_clues", [])
    result.setdefault("confidence", "low")
    loc = result.get("inferred_locality")
    if isinstance(loc, str) and loc.lower() in ("null", "none", "unknown", ""):
        result["inferred_locality"] = None
    return result


# ── Agent 3: Inspector ──────────────────────────────────────────────────────

INSPECT_PROMPT = """Analyse this photo and return ONLY valid JSON — no markdown, no explanation.
{
  "scene_type": "village | urban | landscape | interior | ceremony | portrait | other",
  "setting": "brief phrase describing the setting",
  "features": ["notable visual elements — objects, structures, activities"],
  "people_present": "none | yes-unidentifiable | yes-identifiable",
  "architecture": "description of any buildings or structures, or null",
  "arabic_text_seen": ["exact Arabic text visible in the image, if any"],
  "vegetation_landscape": "description of natural surroundings, or null",
  "estimated_era": "e.g. 1940s-1950s, 1970s, 2000s, unknown",
  "cultural_markers": ["objects, clothing, or practices that anchor this to a specific culture or period"],
  "notes": "anything unusual or worth flagging for a human reviewer"
}"""

def inspect_photo(image_path: str) -> dict:
    result = _vision_json(image_path, INSPECT_PROMPT)
    result.setdefault("scene_type", "other")
    result.setdefault("features", [])
    result.setdefault("arabic_text_seen", [])
    result.setdefault("cultural_markers", [])
    result.setdefault("estimated_era", "unknown")
    return result


# ── Agent 4: Verifier ───────────────────────────────────────────────────────

VERIFY_VISUAL_PROMPT = """You are a photo verification agent for an oral-history archive.
Look at this photo and check for:
1. Signs of AI generation: impossible geometry, wrong hands/fingers, unnatural symmetry,
   inconsistent lighting, text that dissolves into noise.
2. Obvious anachronisms: modern objects (smartphones, recent cars, LED signs) that contradict
   an earlier claimed era.
3. Anything that would make this photo inappropriate for a public cultural archive.

Return ONLY valid JSON — no markdown:
{
  "ai_generation_signs": ["specific observations, or empty list"],
  "anachronisms": ["specific observations, or empty list"],
  "content_concerns": ["specific observations, or empty list"],
  "visual_verdict": "clean | suspicious | reject"
}"""

VERIFY_CONSISTENCY_SYS = """You are a verification agent for an oral-history photo archive.
You receive a photo's AI-generated description, the contributor's own caption, and their
claimed year. Cross-check for inconsistencies. Be conservative: if something is merely
unusual (not impossible), flag it rather than reject. Only reject on clear contradictions.
Return ONLY valid JSON — no markdown:
{
  "caption_consistent": true,
  "year_consistent": true,
  "inconsistencies": ["list any specific contradictions found"],
  "consistency_verdict": "consistent | minor_issues | major_conflict"
}"""

def verify_photo(image_path: str, description: str, inspector: dict,
                 contributor_caption: str, claimed_year: str) -> dict:
    """Visual + logical + moderation check. Returns decision: accept | flag | reject."""

    # Visual check via vision model
    visual = _vision_json(image_path, VERIFY_VISUAL_PROMPT)

    # Logical consistency check via text model
    user_text = (
        f"AI-generated description:\n{description}\n\n"
        f"Contributor's caption: {contributor_caption or '(none provided)'}\n"
        f"Contributor's claimed year: {claimed_year or '(none provided)'}\n"
        f"Inspector notes: {inspector.get('notes', '')}"
    )
    consistency = _chat_json(VERIFY_CONSISTENCY_SYS, user_text)

    # FanarGuard moderation on the description text
    moderation = _moderate(description)

    # Combine into a single decision
    visual_verdict = visual.get("visual_verdict", "clean")
    consistency_verdict = consistency.get("consistency_verdict", "consistent")
    mod_passed = moderation.get("passed", True)

    if visual_verdict == "reject" or not mod_passed:
        decision, confidence = "reject", "high"
    elif visual_verdict == "suspicious" or consistency_verdict == "major_conflict":
        decision, confidence = "flag", "high"
    elif visual_verdict == "clean" and consistency_verdict == "consistent" and mod_passed:
        decision, confidence = "accept", "high"
    else:
        # minor issues or any uncertainty → flag for human
        decision, confidence = "flag", "medium"

    reasons = (
        visual.get("ai_generation_signs", [])
        + visual.get("anachronisms", [])
        + visual.get("content_concerns", [])
        + consistency.get("inconsistencies", [])
        + moderation.get("flagged_categories", [])
    )

    return {
        "decision": decision,
        "confidence": confidence,
        "reasons": reasons,
        "moderation_passed": mod_passed,
        "visual_verdict": visual_verdict,
        "consistency_verdict": consistency_verdict,
    }


# ── Agent 4: Tagger ─────────────────────────────────────────────────────────

TAG_SYS = """You are tagging a photo for a bilingual Lebanese cultural-memory archive.
Produce simple, searchable tags — the kind of words someone would actually type into a search box.
Think: place names, broad topics, time period, what's in the scene. No niche technical terms.
5–10 tags max. Keep each tag 1–3 words.
Return ONLY valid JSON — no markdown:
{
  "tags_en": ["tag1", "tag2", ...],
  "tags_ar": ["وسم1", "وسم2", ...]
}"""

def tag_photo(description: str, inspector: dict) -> dict:
    user_text = (
        f"Description:\n{description}\n\n"
        f"Scene type: {inspector.get('scene_type')}\n"
        f"Features: {inspector.get('features')}\n"
        f"Architecture: {inspector.get('architecture')}\n"
        f"Cultural markers: {inspector.get('cultural_markers')}\n"
        f"Estimated era: {inspector.get('estimated_era')}"
    )
    result = _chat_json(TAG_SYS, user_text)
    result.setdefault("tags_en", [])
    result.setdefault("tags_ar", [])
    return result


# ── Main orchestrator ───────────────────────────────────────────────────────

def process_photo(
    image_path: str,
    contributor_name: str = None,
    claimed_village: str = None,
    claimed_year: str = None,
    contributor_caption: str = None,
    cadaster_geojson: str = None,
):
    print(f"\n{'='*60}\nPHOTO PIPELINE: {image_path}\n{'='*60}")

    # Step 1: Describe
    print("\n[1/4] Describing...")
    description = describe_photo(image_path, contributor_caption)
    print(f"      {description[:200]}...")

    # Step 2: Inspect
    print("\n[2/4] Inspecting...")
    inspector = inspect_photo(image_path)
    print(f"      scene={inspector.get('scene_type')} | era={inspector.get('estimated_era')}")
    print(f"      features={inspector.get('features')}")

    # Step 3: Tag
    print("\n[3/4] Tagging...")
    tags = tag_photo(description, inspector)
    print(f"      tags_en={tags['tags_en']}")
    print(f"      tags_ar={tags['tags_ar']}")

    # Step 4: Verify
    print("\n[4/4] Verifying...")
    verification = verify_photo(image_path, description, inspector, contributor_caption, claimed_year)
    print(f"      decision={verification['decision']} | confidence={verification['confidence']}")
    if verification["reasons"]:
        print(f"      reasons={verification['reasons']}")

    # Place (uses text model — contributor village is the sole anchor)
    routing = None
    if cadaster_geojson and os.path.exists(cadaster_geojson):
        print("\n[+] Placing...")
        context_places = inspector.get("arabic_text_seen", [])
        val = validate_places(claimed_village, context_places, description[:1000])
        # Contributor's typed village always goes first; don't let the LLM discard it
        if claimed_village:
            extras = [p for p in (val.get("lebanese_localities") or []) if p != claimed_village]
            anchor = [claimed_village] + extras
        elif val.get("primary_anchor"):
            anchor = [val["primary_anchor"]]
        else:
            anchor = []
        print(f"      anchor={anchor} | validate_places primary={val.get('primary_anchor')}")

        if anchor:
            from pipeline import load_cadasters, route
            cadasters = load_cadasters(cadaster_geojson)
            routing = route(anchor, [], cadasters)
            routing["place_validation"] = val
            print(f"      status={routing.get('status')} | cadaster={routing.get('cadaster_name_en', 'N/A')}")
        else:
            routing = {"status": "no_anchor", "note": "no village provided by contributor"}
    else:
        print("\n[+] Placing... skipped (no GeoJSON path provided)")

    # Assemble record
    status_map = {"accept": "published", "flag": "needs_review", "reject": "rejected"}
    status = status_map.get(verification["decision"], "needs_review")

    record = {
        "contributor": contributor_name,
        "claimed_village": claimed_village,
        "claimed_year": claimed_year,
        "contributor_caption": contributor_caption,
        "image_path": image_path,
        "description": description,
        "inspector": inspector,
        "verification": verification,
        "tags_en": tags["tags_en"],
        "tags_ar": tags["tags_ar"],
        "routing": routing,
        "status": status,
    }

    out = image_path.rsplit(".", 1)[0] + "_photo_output.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(record, f, ensure_ascii=False, indent=2)
    print(f"\nSaved → {out}")
    return record


# ── Test: run all images in pictures_test/ ──────────────────────────────────

if __name__ == "__main__":
    import glob

    images = sorted(glob.glob(r"pictures_test\*.jpg") + glob.glob(r"pictures_test\*.jpeg") + glob.glob(r"pictures_test\*.png"))
    print(f"Found {len(images)} image(s): {images}")

    import time
    for i, img in enumerate(images):
        try:
            process_photo(
                image_path=img,
                contributor_name=None,
                claimed_village=None,
                claimed_year=None,
                contributor_caption=None,
                cadaster_geojson="lbn_admin_boundaries.geojson/lbn_adminpoints.geojson",
            )
        except RuntimeError as e:
            if "QUOTA_EXHAUSTED" in str(e):
                print(f"\n[SKIPPED] {img} — vision quota exhausted. Wait and re-run.")
                break
            raise
        print()
        if i < len(images) - 1:
            time.sleep(5)
