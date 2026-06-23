import os
import sys
import json
import re
import glob
import requests
import numpy as np
from dotenv import load_dotenv

load_dotenv()
sys.stdout.reconfigure(encoding="utf-8")

FANAR_KEY = os.getenv("FANAR_API_KEY")
BASE = "https://api.fanar.qa/v1"
AUTH_JSON = {"Authorization": f"Bearer {FANAR_KEY}", "Content-Type": "application/json"}
REASON_MODEL = "Fanar-C-2-27B"

# Module-level cache — built once per process, reused across all queries
_INDEX: list = []
_VECTORS = None     # np.ndarray (n, dim) or None if no embedding backend
_EMBED_FN = None    # callable(list[str]) → np.ndarray, or None
_INDEX_BUILT = False


# ── Shared helpers ──────────────────────────────────────────────────────────

def _parse_json(raw: str) -> dict:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        return json.loads(m.group()) if m else {"_raw": raw}


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
    return _parse_json(resp.json()["choices"][0]["message"]["content"])


# ── Step 1: Index builder ──────────────────────────────────────────────────

def _item_text(item: dict) -> str:
    """All searchable text for one item, joined into a single string."""
    parts = [item["text_en"], item["text_ar"]] + item["keywords"]
    return " ".join(p for p in parts if p)


def build_index(records_dir: str) -> list:
    """
    Scan records_dir recursively for all pipeline output JSONs and return
    a unified list of normalized searchable items.
    """
    items = []

    # Interview outputs: *_output.json  (skip *_photo_output.json)
    for path in glob.glob(os.path.join(records_dir, "**", "*_output.json"), recursive=True):
        if "_photo_output" in os.path.basename(path):
            continue
        with open(path, encoding="utf-8") as f:
            record = json.load(f)
        cadaster = (record.get("routing") or {}).get("cadaster_name_en", "")
        for i, seg in enumerate(record.get("segments", [])):
            keywords = list(dict.fromkeys(
                seg.get("keywords_en", []) +
                seg.get("keywords_ar", []) +
                seg.get("themes", []) +
                seg.get("places", [])
            ))
            items.append({
                "type": "interview_segment",
                "id": f"{os.path.basename(path)}::seg{i}",
                "cadaster": cadaster,
                "text_en": seg.get("english", ""),
                "text_ar": seg.get("arabic", ""),
                "keywords": keywords,
                "timestamp": [seg.get("start"), seg.get("end")],
                "source": {
                    "file": path,
                    "contributor": record.get("contributor"),
                    "claimed_village": record.get("claimed_village"),
                    "claimed_year": record.get("claimed_year"),
                    "segment_index": i,
                    "places": seg.get("places", []),
                    "people": seg.get("people", []),
                    "themes": seg.get("themes", []),
                },
            })

    # Photo outputs: *_photo_output.json
    for path in glob.glob(os.path.join(records_dir, "**", "*_photo_output.json"), recursive=True):
        with open(path, encoding="utf-8") as f:
            record = json.load(f)
        cadaster = (record.get("routing") or {}).get("cadaster_name_en", "")
        items.append({
            "type": "photo",
            "id": os.path.basename(path),
            "cadaster": cadaster,
            "text_en": record.get("description", ""),
            "text_ar": "",
            "keywords": list(dict.fromkeys(
                record.get("tags_en", []) + record.get("tags_ar", [])
            )),
            "timestamp": None,
            "source": {
                "file": path,
                "image_path": record.get("image_path"),
                "contributor": record.get("contributor"),
                "claimed_village": record.get("claimed_village"),
                "claimed_year": record.get("claimed_year"),
                "inferred_locality": record.get("inferred_locality"),
                "inferred_region": record.get("inferred_region"),
                "era_estimate": record.get("era_estimate"),
                "status": record.get("status"),
            },
        })

    n_int = sum(1 for it in items if it["type"] == "interview_segment")
    n_ph  = sum(1 for it in items if it["type"] == "photo")
    print(f"[index] {n_int} interview segment(s) + {n_ph} photo(s) = {len(items)} items")
    return items


# ── Step 2: Embedding backends ─────────────────────────────────────────────

def _probe_fanar_embeddings() -> bool:
    """Return True if Fanar exposes a working /v1/embeddings endpoint."""
    try:
        resp = requests.post(
            f"{BASE}/embeddings",
            headers=AUTH_JSON,
            json={"model": "Fanar-Embed-1", "input": "test"},
            timeout=10,
        )
        return resp.status_code == 200
    except Exception:
        return False


def _fanar_embed(texts: list) -> np.ndarray:
    resp = requests.post(
        f"{BASE}/embeddings",
        headers=AUTH_JSON,
        json={"model": "Fanar-Embed-1", "input": texts},
        timeout=60,
    )
    resp.raise_for_status()
    data = sorted(resp.json()["data"], key=lambda x: x["index"])
    return np.array([d["embedding"] for d in data], dtype=np.float32)


def _init_embedder():
    """Probe Fanar → try sentence-transformers → fall back to keyword-only."""
    global _EMBED_FN
    if _probe_fanar_embeddings():
        _EMBED_FN = lambda texts: _fanar_embed(texts if isinstance(texts, list) else [texts])
        print("[embedder] Fanar /v1/embeddings active")
        return
    try:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")
        _EMBED_FN = lambda texts: _model.encode(
            texts if isinstance(texts, list) else [texts], convert_to_numpy=True
        )
        print("[embedder] sentence-transformers loaded (paraphrase-multilingual-MiniLM-L12-v2)")
    except ImportError:
        _EMBED_FN = None
        print("[embedder] no embedding backend available — using keyword search")


def _cosine_scores(query_vec: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    q = query_vec.flatten()
    q = q / (np.linalg.norm(q) + 1e-9)
    m = matrix / (np.linalg.norm(matrix, axis=1, keepdims=True) + 1e-9)
    return m @ q


# ── Keyword fallback ────────────────────────────────────────────────────────

def _keyword_retrieve(terms: list, items: list, top_k: int) -> list:
    """OR-match across all item text; score = fraction of terms found."""
    if not terms:
        return []
    scored = []
    for item in items:
        haystack = _item_text(item).lower()
        hits = sum(1 for t in terms if t.lower() in haystack)
        if hits:
            scored.append((item, hits / len(terms)))
    scored.sort(key=lambda x: -x[1])
    return scored[:top_k]


# ── Step 3a: Query expansion ────────────────────────────────────────────────

EXPAND_SYS = """You are a bilingual Arabic-English assistant for a Lebanese oral-history archive.
Expand the user's search query with related terms in BOTH English and Arabic —
synonyms, related concepts, Lebanese cultural terms, relevant place names.
Return ONLY valid JSON — no markdown:
{
  "terms_en": ["term1", "term2", ...],
  "terms_ar": ["مصطلح1", "مصطلح2", ...]
}"""


def _expand_query(query: str) -> dict:
    out = _chat_json(EXPAND_SYS, f"Query: {query}")
    out.setdefault("terms_en", [query])
    out.setdefault("terms_ar", [])
    return out


# ── Step 3b: Re-ranker ──────────────────────────────────────────────────────

RERANK_SYS = """You are a relevance judge for a Lebanese oral-history archive.
Given a user query and candidate items, keep only the genuinely relevant ones.
For each item you keep, write a short "why_matched" (1 line, use the language of the query).
Drop candidates that match only superficially or by coincidence.
Return ONLY valid JSON — no markdown:
{
  "results": [
    {"id": "...", "why_matched": "..."},
    ...
  ]
}"""


def _rerank(query: str, candidates: list) -> list:
    """Ask Fanar-C-2-27B to prune false matches and explain each kept result."""
    if not candidates:
        return []
    summaries = [
        {
            "id": item["id"],
            "type": item["type"],
            "cadaster": item["cadaster"],
            "preview": (item["text_en"] or item["text_ar"])[:200],
            "keywords": item["keywords"][:10],
        }
        for item, _ in candidates
    ]
    user_text = (
        f"Query: {query}\n\n"
        f"Candidates:\n{json.dumps(summaries, ensure_ascii=False, indent=2)}"
    )
    out = _chat_json(RERANK_SYS, user_text, timeout=90)
    kept = {r["id"]: r.get("why_matched", "") for r in out.get("results", [])}
    id_map = {item["id"]: (item, score) for item, score in candidates}
    return [
        (id_map[rid][0], id_map[rid][1], why)
        for rid, why in kept.items()
        if rid in id_map
    ]


# ── Public API ──────────────────────────────────────────────────────────────

def prepare(records_dir: str = "."):
    """Build the index and embed all items. Call once; cached for the process lifetime."""
    global _INDEX, _VECTORS, _INDEX_BUILT
    _INDEX = build_index(records_dir)
    _init_embedder()
    if _EMBED_FN is not None and _INDEX:
        print(f"[embedder] Embedding {len(_INDEX)} items...")
        _VECTORS = _EMBED_FN([_item_text(it) for it in _INDEX])
    else:
        _VECTORS = None
    _INDEX_BUILT = True


def search(query: str, records_dir: str = ".", top_k: int = 10) -> dict:
    """
    Bilingual semantic search over all pipeline outputs.

    Flow:
      1. Expand query with Fanar-C-2-27B (Arabic + English synonyms)
      2. Retrieve top candidates — cosine similarity if embeddings available, keyword otherwise
      3. Re-rank and explain with Fanar-C-2-27B
      4. Return grouped results: { photos, interview_moments }

    Interview results include [start, end] timestamps for direct deep-linking.
    """
    global _INDEX, _VECTORS

    if not _INDEX_BUILT:
        prepare(records_dir)

    print(f"\n[search] {query!r}")

    # Step 1: Expand
    print("  [1/3] Expanding query...")
    expanded = _expand_query(query)
    print(f"        en={expanded['terms_en']}")
    print(f"        ar={expanded['terms_ar']}")
    all_terms = expanded["terms_en"] + expanded["terms_ar"]

    # Step 2: Retrieve
    print("  [2/3] Retrieving candidates...")
    top_n = min(top_k * 3, 30)
    if _VECTORS is not None:
        q_vec = _EMBED_FN([" ".join(all_terms)])
        scores = _cosine_scores(q_vec, _VECTORS)
        top_idx = np.argsort(scores)[::-1][:top_n]
        candidates = [(_INDEX[i], float(scores[i])) for i in top_idx if scores[i] > 0.1]
    else:
        candidates = _keyword_retrieve(all_terms, _INDEX, top_n)
    print(f"        {len(candidates)} candidate(s)")

    # Step 3: Re-rank
    print("  [3/3] Re-ranking with Fanar...")
    ranked = _rerank(query, candidates)[:top_k]
    print(f"        {len(ranked)} result(s) after re-rank")

    # Group by type
    photos, moments = [], []
    for item, score, why in ranked:
        if item["type"] == "photo":
            photos.append({
                "id": item["id"],
                "cadaster": item["cadaster"],
                "image_path": item["source"].get("image_path"),
                "description": item["text_en"],
                "tags_en": [k for k in item["keywords"] if re.search(r"[a-zA-Z]", k)],
                "tags_ar": [k for k in item["keywords"] if re.search(r"[؀-ۿ]", k)],
                "inferred_locality": item["source"].get("inferred_locality"),
                "era_estimate": item["source"].get("era_estimate"),
                "contributor": item["source"].get("contributor"),
                "status": item["source"].get("status"),
                "why_matched": why,
                "score": round(score, 3),
            })
        else:
            ts = item["timestamp"]
            moments.append({
                "id": item["id"],
                "cadaster": item["cadaster"],
                "snippet": item["text_en"][:300],
                "snippet_ar": item["text_ar"][:300],
                "timestamp": ts,
                "themes": item["source"].get("themes", []),
                "places": item["source"].get("places", []),
                "contributor": item["source"].get("contributor"),
                "why_matched": why,
                "score": round(score, 3),
            })

    return {
        "query": query,
        "expanded": expanded,
        "photos": photos,
        "interview_moments": moments,
    }


# ── Test ────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    prepare(".")

    for q in ["olive tree", "صور", "wedding"]:
        result = search(q)
        print(f"\n{'='*60}\nQUERY: {result['query']!r}")
        print(f"EXPANDED: en={result['expanded']['terms_en']}")
        print(f"          ar={result['expanded']['terms_ar']}")

        print(f"\n--- Photos ({len(result['photos'])}) ---")
        for p in result["photos"]:
            print(f"  [{p['score']:.3f}] {p.get('cadaster') or '—'} | {p.get('image_path', '')}")
            print(f"          {p['why_matched']}")

        print(f"\n--- Interview Moments ({len(result['interview_moments'])}) ---")
        for m in result["interview_moments"]:
            ts = m["timestamp"]
            ts_str = f"{ts[0]:.1f}–{ts[1]:.1f}s" if ts and None not in ts else "N/A"
            print(f"  [{m['score']:.3f}] {m.get('cadaster') or '—'} @ {ts_str}")
            print(f"          {m['why_matched']}")
            print(f"          {m['snippet'][:120]}...")
        print()
