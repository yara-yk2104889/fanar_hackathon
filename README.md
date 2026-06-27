# Dhākira — ذاكرة
## Lebanese Oral-History Archive

Dhākira ("memory" in Arabic) is a bilingual web platform for preserving oral histories and  photographs from Lebanese villages. Contributors upload interview videos or photos; the system automatically transcribes, translates, fact-checks, and places each memory on a map of Lebanon organised by administrative district (cadaster).

---

## Problem Statement

Lebanon's rural memory, the oral traditions, local histories, and knowledge of its villages, is disappearing as older generations pass on. There is no searchable archive, and current efforts to solve this face three problems:

1. **Dialect gap.** Lebanese Arabic is not Modern Standard Arabic. Most transcription and translation models do not fully understand it.
2. **False place attribution.** Speakers mention food names, TV program names, and regional nicknames that sound like place names but are not. Some existing routing places memories on the wrong village or no village at all.
3. **Unverified claims.** Oral histories contain factual statements about borders, traditions, and dates which should be checked against public record, while personal testimony must never be altered.

---

## Solution Architecture

UPLOAD
  │
  ├─ VIDEO ──► pipeline.py ──► refine_agents.py ──► evidence_agent.py
  │
  └─ PHOTO ──► photo_agents.py
                    │
                    ▼
              server.py (FastAPI)
                    │
              data/
              ├── interviews/{cadaster_id}/
              └── photos/{cadaster_id}/
                    │
                    ▼
              search_engine.py ◄── frontend
```

### Backend
- **FastAPI** server (`server.py`)
- All pipeline modules are imported at request time
- Uploaded files are written to `uploads/`, processed, then moved to permanent storage at `data/interviews/{cadaster_id}/` or `data/photos/{cadaster_id}/`
- Each record is stored as a JSON file; an in-memory index maps cadaster IDs to record paths

### Frontend
- React + TypeScript with Mapbox GL for the map
- MapLibre renders 1,627 Lebanese cadaster polygons coloured by memory density
- Clicking a district opens a side panel with interview and photo tabs

### Geographic Data
- Lebanese Admin-3 GeoJSON with 1,627 cadaster (district) entries
- Each entry has `name_en`, `name_ar`, `adm3_pcode`, and centroid coordinates
- Used for routing, place validation, and map rendering

---

## Video Pipeline (`pipeline.py` + `refine_agents.py`)

```
[1] Transcribe      Fanar-Aura-STT-LF-1     Arabic speech → timed segments
[MOD] Moderate      Fanar-Guard-2            Safety gate before quota spend
[2] Chunk           Python                   Group segments into ~150-word chunks
[3] Translate       Fanar-Shaheen-MT-1       Raw Arabic chunk → draft English
[4] Refine          Fanar-C-2-27B            Clean Arabic + improve translation
[5] Extract         Fanar-C-2-27B            Places, people, themes, keywords per segment
[6] Summarize       Fanar-C-2-27B            Bilingual 2–4 sentence summary
[+] Validate        Place-Validation Agent   Filter false place names (see Agents)
[+] Route           Cadaster match           Map confirmed places to district
```

---

## Photo Pipeline (`photo_agents.py`)

```
[1] Describe    Fanar-Oryx-IVU-2    1–2 sentence factual caption (uses contributor caption as hint)
[2] Inspect     Fanar-Oryx-IVU-2    Scene type, features, architecture, Arabic text visible, era
[3] Tag         Fanar-C-2-27B       5–10 bilingual searchable tags
[4] Verify      Oryx-IVU-2          Visual authenticity check (AI-generated? anachronisms?)
                Fanar-C-2-27B       Caption/year consistency check
                Fanar-Guard-2       Content moderation
[+] Validate    Place-Validation Agent   Same agent as video pipeline
```

**Verify step.** Three independent checks are combined into a single `accept / flag / reject` decision:
- `reject` if visual verdict is "reject" or Guard-2 fails
- `flag` if visual is "suspicious" or caption has major conflict
- `accept` only if all three pass

All four steps have independent try/except blocks. If one fails, the photo is saved with whatever data succeeded; verify failure defaults to `flag` for manual review.

---

## Agentic Workflow Design

### Agent 1 — Transcript Refiner (`refine_segment`)
**Type:** Single tool call with structured output  
**Model:** Fanar-C-2-27B  
**Input:** Raw STT Arabic + draft English translation  
**Output:** Cleaned Arabic, improved English, corrections list with confidence levels, unrecoverable spans  
**Behaviour:** The model is instructed to fix dialect mishearings and handle untranslatable cultural terms (e.g. saj, dabke, namliyeh) by transliterating and glossing them rather than forcing a literal translation. Every correction is logged with `high / medium / low` confidence.

---

### Agent 2 — Place Validator (`validate_places`)
**Type:** Three-step tool-using agent  
**Model:** Fanar-C-2-27B + cadaster database tool  
**Trigger:** Every upload (video and photo)

```
Step 1 (LLM)    Filter candidates
                C-2-27B reads all extracted strings and drops obvious non-places:
                food items, TV program names, household objects, country-level regions

Step 2 (Tool)   Cadaster lookup — pure Python, no API call
                _cadaster_lookup() fuzzy-searches 1,627 Lebanese Admin-3 entries
                Scoring: exact=3, word-boundary prefix or Arabic substring=2, substring=1
                Returns top 3 matches per candidate

Step 3 (LLM)    Confirm + anchor
                C-2-27B sees the lookup results and decides which candidates are
                confirmed Lebanese localities, then picks the single routing anchor
```

---

### Agent 3 — Evidence Verifier (`verify_interview`)
**Type:** ReAct loop with tool use, capped at 4 tool calls per claim  
**Model:** Fanar-C-2-27B (reasoning), Fanar-Sadiq (grounded retrieval)  
**Trigger:** Automatically after every video upload

**Claim extraction (no LLM).** Claims are derived from the pipeline's already-extracted metadata — no additional API call:
- One place claim per unique locality in `summary.places` + `segment.places`
- One content claim per segment that has places/themes + English text
- Country names and common Arabic nouns filtered via blocklist
- Capped at 6 total claims per interview

**Verification per claim:**

*Place claims* — cadaster fast-path (no LLM):
```
_cadaster_lookup(place_name) → score ≥ 2 → confirmed
                             → no match  → no_public_record
```

*Content/cultural claims* — ReAct loop:
```
while tool_calls < 4:
    LLM writes: ACTION: tool_name
                ARGS: {"key": "value"}
    Python parses and executes tool
    Result fed back to LLM as TOOL RESULT message
    LLM calls finish_verdict → loop exits

On cap hit: _force_verdict() asks C-2-27B to decide from accumulated context
On any API failure: returns no_public_record gracefully, never crashes
```

**Tools available in the loop:**
- `search_knowledge(query)` → Fanar-Sadiq grounded retrieval with source citations
- `lookup_cadaster(place_name)` → pure Python cadaster search

**Verdicts:**
- `confirmed` — credible source supports the claim
- `partially_supported` — some evidence aligns, not fully
- `no_public_record` — no evidence found (explicitly NOT "false"; noted as such)
- `contradicted` — only when a named source directly refutes

The `no_public_record` verdict has special significance: for hyper-local place and structure claims, it flags the interview as a potentially sole surviving account of that memory.

---

## Fanar Models Used

| Model | Role | Timeout |
|---|---|---|
| Fanar-Aura-STT-LF-1 | Lebanese-dialect Arabic speech-to-text | 120s |
| Fanar-Shaheen-MT-1 | Arabic → English translation | 90s |
| Fanar-C-2-27B | Reasoning: refine, extract, summarise, validate, route, ReAct loop | 90–120s |
| Fanar-Guard-2 | Content moderation (0–5 scale, threshold 3.5) | 30s |
| Fanar-Oryx-IVU-2 | Photo vision: describe, inspect, verify | 120s |
| Fanar-Sadiq | Grounded retrieval with source citations | 90s |
| Fanar-Embed-1 | Vector embeddings for semantic search | 60s |

**Embedding fallback.** The search engine probes Fanar-Embed-1 at startup. If unavailable, it falls back to `paraphrase-multilingual-MiniLM-L12-v2` via sentence-transformers. If that is also unavailable, it falls back to keyword-only OR-matching.

---

## Search (`search_engine.py`)

The search index is built lazily on first query and cached in memory. It indexes:
- Each interview **segment** individually, with its English text, Arabic text, places, themes, and keywords
- Each photo, with its AI-generated description and bilingual tags

Queries run against both English and Arabic fields simultaneously. With Fanar-Embed-1 or a sentence-transformer, results are ranked by cosine similarity. Without an embedding backend, results are ranked by fraction of query terms matched.

---

## Recommendations for Future Fanar Improvements
