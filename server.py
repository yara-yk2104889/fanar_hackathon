"""
server.py — FastAPI backend for Dhākira oral-history archive.

Run:
    uvicorn server:app --reload --port 8000

Requires: pip install fastapi uvicorn python-multipart

Set FANAR_API_KEY in .env — it NEVER reaches the browser.
Uploads:  uploads/           (temp, deleted after processing)
Records:  data/interviews/   and  data/photos/   (indexed by cadaster)
Index:    data/index.json
"""

import os
import sys
import json
import uuid
import shutil
import requests
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# ── Import pipelines at startup (no API calls at import time) ─────────────────
from pipeline import run_pipeline
from photo_agents import process_photo

try:
    import search_engine
    _SEARCH_AVAILABLE = True
except ImportError:
    _SEARCH_AVAILABLE = False
    print("[server] search_engine not available (numpy missing?)", file=sys.stderr)

load_dotenv()
sys.stdout.reconfigure(encoding="utf-8")

FANAR_KEY = os.getenv("FANAR_API_KEY")
BASE      = "https://api.fanar.qa/v1"
AUTH_JSON = {"Authorization": f"Bearer {FANAR_KEY}", "Content-Type": "application/json"}

CADASTER_GEOJSON = "lbn_admin_boundaries.geojson/lbn_adminpoints.geojson"
SAFETY_THRESHOLD = 0.5   # handles both binary (0/1) and continuous scores

UPLOADS_DIR    = Path("uploads")
DATA_DIR       = Path("data")
INTERVIEWS_DIR = DATA_DIR / "interviews"
PHOTOS_DIR     = DATA_DIR / "photos"
INDEX_PATH     = DATA_DIR / "index.json"

for _d in (UPLOADS_DIR, INTERVIEWS_DIR, PHOTOS_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="Dhākira API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # tighten before production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Index helpers ─────────────────────────────────────────────────────────────

def _load_index() -> dict:
    if INDEX_PATH.exists():
        with open(INDEX_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {}


def _save_index(index: dict) -> None:
    with open(INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)


def _index_record(cadaster_id: str, kind: str, path: str) -> None:
    index = _load_index()
    entry = index.setdefault(cadaster_id, {"interviews": [], "photos": []})
    if path not in entry.get(kind, []):
        entry.setdefault(kind, []).append(path)
    _save_index(index)


# ── Moderation gate ───────────────────────────────────────────────────────────

def moderation_gate(text: str) -> dict:
    """
    Call Fanar-Guard-2. Gates ONLY on `safety`.
    `cultural_awareness` is recorded as metadata but NEVER used to block content.

    Fails OPEN: if the moderation endpoint errors, record goes to needs_review
    so no contribution is silently lost.
    """
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
        data   = resp.json()
        safety = data.get("safety")
        ca     = data.get("cultural_awareness")
        # Handle binary (0/1) and continuous scores uniformly
        passed = (float(safety) >= SAFETY_THRESHOLD) if safety is not None else True
        return {"passed": passed, "safety": safety, "cultural_awareness": ca}
    except Exception as exc:
        print(f"[moderation] error: {exc}", file=sys.stderr)
        return {
            "passed": False,
            "safety": None,
            "cultural_awareness": None,
            "error": str(exc),
        }


# ── Disk save helpers ─────────────────────────────────────────────────────────

def _save_interview(record: dict, uid: str) -> tuple[str, str]:
    cadaster_id = (record.get("routing") or {}).get("cadaster_id") or "unrouted"
    out_dir = INTERVIEWS_DIR / str(cadaster_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = str(out_dir / f"{uid}_output.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(record, f, ensure_ascii=False, indent=2)
    return cadaster_id, path


def _save_photo(record: dict, uid: str) -> tuple[str, str]:
    cadaster_id = (record.get("routing") or {}).get("cadaster_id") or "unrouted"
    out_dir = PHOTOS_DIR / str(cadaster_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = str(out_dir / f"{uid}_photo_output.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(record, f, ensure_ascii=False, indent=2)
    return cadaster_id, path


# ── POST /api/contribute/interview ────────────────────────────────────────────

def contribute_interview(
    file: UploadFile = File(...),
    contributor:     Optional[str] = Form(None),
    claimed_village: Optional[str] = Form(None),
    claimed_year:    Optional[str] = Form(None),
):
    """
    Multipart: file (audio/video), contributor, claimed_village, claimed_year.
    Runs the full pipeline (transcribe → translate → refine → extract → summarize → route).
    Pipeline is slow (~30 s – 2 min); the response arrives when it completes.
    """
    uid = uuid.uuid4().hex
    ext = Path(file.filename or "upload.mp4").suffix or ".mp4"
    upload_path = UPLOADS_DIR / f"{uid}{ext}"

    with open(upload_path, "wb") as fh:
        shutil.copyfileobj(file.file, fh)

    try:
        record = run_pipeline(
            video_path=str(upload_path),
            contributor_name=contributor or "Anonymous",
            claimed_village=claimed_village or None,
            claimed_year=claimed_year or None,
            cadaster_geojson=CADASTER_GEOJSON,
        )

        gate = moderation_gate(record.get("full_arabic_transcript", ""))
        record["moderation"] = {
            "safety":             gate["safety"],
            "cultural_awareness": gate["cultural_awareness"],
        }

        routing_status = (record.get("routing") or {}).get("status", "needs_review")
        if not gate["passed"] or routing_status not in ("matched", "agent_routed"):
            record["status"] = "needs_review"
        else:
            record["status"] = "published"

        cadaster_id, path = _save_interview(record, uid)
        _index_record(cadaster_id, "interviews", path)
        if _SEARCH_AVAILABLE:
            search_engine._INDEX_BUILT = False

        return record

    except RuntimeError as exc:
        if "QUOTA_EXHAUSTED" in str(exc):
            raise HTTPException(503, "Fanar API quota exhausted — please try again later.")
        raise HTTPException(500, str(exc))
    except Exception as exc:
        raise HTTPException(500, str(exc))
    finally:
        upload_path.unlink(missing_ok=True)


# Register as a sync endpoint (FastAPI runs sync defs in thread pool, safe for blocking calls)
app.post("/api/contribute/interview")(contribute_interview)


# ── POST /api/contribute/photo ────────────────────────────────────────────────

def contribute_photo(
    image:           UploadFile      = File(...),
    contributor:     Optional[str]   = Form(None),
    claimed_village: Optional[str]   = Form(None),
    caption:         Optional[str]   = Form(None),
    year:            Optional[str]   = Form(None),
):
    """
    Multipart: image, contributor, claimed_village, caption, year.
    Runs vision describe + inspect + verify + tag pipeline.
    """
    uid = uuid.uuid4().hex
    ext = Path(image.filename or "upload.jpg").suffix or ".jpg"
    upload_path = UPLOADS_DIR / f"{uid}{ext}"

    with open(upload_path, "wb") as fh:
        shutil.copyfileobj(image.file, fh)

    try:
        record = process_photo(
            image_path=str(upload_path),
            contributor_name=contributor or "Anonymous",
            claimed_village=claimed_village or None,
            claimed_year=year or None,
            contributor_caption=caption or None,
            cadaster_geojson=CADASTER_GEOJSON,
        )

        # process_photo already runs FanarGuard internally.
        # We run it again here only to capture cultural_awareness as metadata.
        gate = moderation_gate(record.get("description", ""))
        record["moderation"] = {
            "safety":             gate["safety"],
            "cultural_awareness": gate["cultural_awareness"],
        }
        if not gate["passed"]:
            record["status"] = "needs_review"

        cadaster_id, path = _save_photo(record, uid)
        _index_record(cadaster_id, "photos", path)
        if _SEARCH_AVAILABLE:
            search_engine._INDEX_BUILT = False

        return record

    except RuntimeError as exc:
        if "QUOTA_EXHAUSTED" in str(exc):
            raise HTTPException(503, "Vision API quota exhausted — please try again later.")
        raise HTTPException(500, str(exc))
    except Exception as exc:
        raise HTTPException(500, str(exc))
    finally:
        upload_path.unlink(missing_ok=True)


app.post("/api/contribute/photo")(contribute_photo)


# ── GET /api/place/{cadaster_id} ──────────────────────────────────────────────

@app.get("/api/place/{cadaster_id}")
def get_place(cadaster_id: str):
    """Return all published interviews and photos for a cadaster."""
    index = _load_index()
    entry = index.get(cadaster_id, {})

    interviews, photos = [], []

    data_abs = DATA_DIR.resolve()

    for path in entry.get("interviews", []):
        try:
            with open(path, encoding="utf-8") as f:
                rec = json.load(f)
            if rec.get("status") == "published":
                rec["_file_path"] = Path(path).resolve().relative_to(data_abs).as_posix()
                interviews.append(rec)
        except Exception:
            pass

    for path in entry.get("photos", []):
        try:
            with open(path, encoding="utf-8") as f:
                rec = json.load(f)
            if rec.get("status") in ("published", "accept"):
                rec["_file_path"] = Path(path).resolve().relative_to(data_abs).as_posix()
                photos.append(rec)
        except Exception:
            pass

    return {"cadaster_id": cadaster_id, "interviews": interviews, "photos": photos}


# ── GET /api/places ───────────────────────────────────────────────────────────

@app.get("/api/places")
def get_places():
    """Return cadaster IDs that have any indexed content (for map highlighting)."""
    index = _load_index()
    places = []
    for cadaster_id, entry in index.items():
        n_i = len(entry.get("interviews", []))
        n_p = len(entry.get("photos", []))
        if n_i + n_p > 0:
            places.append({
                "cadaster_id":     cadaster_id,
                "interview_count": n_i,
                "photo_count":     n_p,
            })
    return {"places": places}


# ── DELETE /api/memory ────────────────────────────────────────────────────────

@app.delete("/api/memory")
def delete_memory(body: dict):
    """Delete an interview or photo record by its relative path."""
    rel_path = (body.get("path") or "").strip()
    if not rel_path or ".." in rel_path:
        raise HTTPException(400, "Invalid path")

    target   = (DATA_DIR / rel_path).resolve()
    data_abs = DATA_DIR.resolve()
    try:
        target.relative_to(data_abs)    # raises ValueError if outside DATA_DIR
    except ValueError:
        raise HTTPException(403, "Path outside data directory")

    if not target.exists():
        raise HTTPException(404, "Memory not found")

    target.unlink()

    # Remove from index (stored paths may be relative or absolute, compare resolved)
    index = _load_index()
    changed = False
    for entry in index.values():
        for kind in ("interviews", "photos"):
            before = entry.get(kind, [])
            after  = [p for p in before if Path(p).resolve() != target]
            if len(after) != len(before):
                entry[kind] = after
                changed = True
    if changed:
        _save_index(index)

    if _SEARCH_AVAILABLE:
        search_engine._INDEX_BUILT = False

    return {"deleted": rel_path}


# ── POST /api/search ──────────────────────────────────────────────────────────

@app.post("/api/search")
def api_search(body: dict):
    """Bilingual semantic search over all pipeline outputs."""
    if not _SEARCH_AVAILABLE:
        raise HTTPException(501, "Search engine not available (install numpy).")
    query = (body.get("query") or "").strip()
    if not query:
        raise HTTPException(400, "'query' is required")
    result = search_engine.search(query, records_dir=str(DATA_DIR))
    return result
