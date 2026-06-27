# Dhākira — ذاكرة
## Lebanese Oral-History Archive

Dhākira ("memory" in Arabic) is a bilingual web platform for preserving oral histories and photographs from Lebanese villages. Contributors upload interview videos or photos; the system automatically transcribes, translates, fact-checks, and places each memory on a map of Lebanon organised by administrative district (cadaster).

---

## Problem Statement

Lebanon's rural memory — oral traditions, local histories, and knowledge of its villages — is disappearing as older generations pass on. There is no searchable archive, and current efforts face three problems:

1. **Dialect gap.** Lebanese Arabic is not Modern Standard Arabic. Most transcription and translation models do not fully understand it.
2. **False place attribution.** Speakers mention food names, TV program names, and regional nicknames that sound like place names but are not.
3. **Unverified claims.** Oral histories contain factual statements about borders, traditions, and dates that should be checked against public record, while personal testimony must never be altered.

---

## Fanar Models Used

| Model | Role |
|---|---|
| Fanar-Aura-STT-LF-1 | Lebanese-dialect Arabic speech-to-text |
| Fanar-Shaheen-MT-1 | Arabic → English translation |
| Fanar-C-2-27B | Reasoning: refine, extract, summarise, validate, route, evidence judging |
| Fanar-Guard-2 | Content moderation (0–5 scale, threshold 3.5) |
| Fanar-Oryx-IVU-2 | Photo vision: describe, inspect, verify |
| Fanar-Embed-1 | Vector embeddings for semantic search |

**External model:** OpenAI `gpt-4o-mini` with `web_search_preview` — used exclusively in the Evidence Verification step to search the real web for sources.

**Embedding fallback.** The search engine probes Fanar-Embed-1 at startup. If unavailable, it falls back to `paraphrase-multilingual-MiniLM-L12-v2` via sentence-transformers. If that is also unavailable, it falls back to keyword-only OR-matching.

---

## Solution Architecture

```
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
- Uploaded files are written to `uploads/`, processed, then stored at `data/interviews/{cadaster_id}/` or `data/photos/{cadaster_id}/`
- Each record is stored as a JSON file; an in-memory index maps cadaster IDs to record paths

### Frontend
- React + TypeScript with Leaflet for the map
- Renders 1,627 Lebanese cadaster polygons coloured by memory density
- Clicking a district opens a side panel with interview and photo tabs
- Confirmed/partially-supported claims surface as **Verifiable Sources** links in each interview card

### Geographic Data
- Lebanese Admin-3 GeoJSON with 1,627 cadaster entries
- Each entry has `name_en`, `name_ar`, `adm3_pcode`, and centroid coordinates
- Used for routing, place validation, and map rendering

---

## Video Pipeline (`pipeline.py` + `refine_agents.py` + `evidence_agent.py`)

```
[1] Transcribe      Fanar-Aura-STT-LF-1     Arabic speech → timed segments
[MOD] Moderate      Fanar-Guard-2            Safety gate (score < 3.5 → flagged)
[2] Chunk           Python                   Group segments into ~150-word chunks
[3] Translate       Fanar-Shaheen-MT-1       Raw Arabic chunk → draft English
[4] Refine          Fanar-C-2-27B            Clean Arabic + improve translation
[5] Extract         Fanar-C-2-27B            Places, people, themes, keywords per segment
[6] Evidence Check  Evidence Agent           Fact-check claims (blocks on contradiction)
[7] Summarize       Fanar-C-2-27B            Bilingual 2–4 sentence summary
[+] Validate        Place-Validation Agent   Filter false place names
[+] Route           Cadaster match           Map confirmed places to district
```

Evidence check runs **before** summarise so that clear contradictions can block the upload entirely (HTTP 409). The summary is only generated for submissions that pass.

All steps have independent try/except blocks. If one fails (timeout, API error), the pipeline continues with whatever data succeeded rather than returning a 500 error.

---

## Photo Pipeline (`photo_agents.py`)

```
[1] Describe    Fanar-Oryx-IVU-2    1–2 sentence factual caption (uses contributor caption as hint)
[2] Inspect     Fanar-Oryx-IVU-2    Scene type, features, architecture, Arabic text visible, era
[3] Tag         Fanar-C-2-27B       5–10 bilingual searchable tags
[4] Verify      Fanar-Oryx-IVU-2    Visual authenticity check (AI-generated? anachronisms?)
                Fanar-C-2-27B       Caption/year consistency check
                Fanar-Guard-2       Content moderation
[+] Validate    Place-Validation Agent   Same agent as video pipeline
```

**Verify decision logic:**
- `reject` — visual verdict is "reject" OR Guard-2 fails
- `flag` — visual is "suspicious" OR caption has major conflict
- `accept` — all three checks pass

All steps have independent try/except blocks; verify failure defaults to `flag` for manual review.

---

## Agents

### Agent 1 — Place Validation Agent (`validate_places`)
**Model:** Fanar-C-2-27B + cadaster database tool  
**Used in:** Every video upload and every photo upload

```
Step 1 (LLM)    C-2-27B reads all extracted place strings and drops obvious
                non-places: food items, TV program names, household objects,
                country-level regions ("Lebanon", "Syria")

Step 2 (Tool)   Pure Python cadaster lookup — no API call
                Fuzzy-searches 1,627 Lebanese Admin-3 entries
                Scoring: exact=3  |  word-boundary/Arabic substring=2  |  substring=1
                Returns top 3 matches per candidate

Step 3 (LLM)    C-2-27B sees the lookup results and decides which candidates
                are confirmed Lebanese localities, then picks the single
                routing anchor for this upload
```

The second LLM call only runs after seeing what the tool returned — that's what makes it an agent rather than a plain API call.

---

### Agent 2 — Evidence Verification Agent (`verify_interview`)
**Models:** OpenAI `gpt-4o-mini` (web search) + Fanar-C-2-27B (judge)  
**Used in:** Every video upload, runs between Extract and Summarize

**Claim extraction — no LLM call.** Claims are derived from already-extracted metadata:
- One place claim per unique Lebanese locality in `summary.places` + `segment.places`
- One content claim per segment that has places/themes + English text
- Country names and common Arabic nouns filtered via blocklist
- Capped at 6 total claims

**Verification per claim:**

*Place claims shaped as "X is a location in Lebanon":*
```
Cadaster lookup → strong match (score ≥ 2) → confirmed immediately, no web search
               → no match → falls through to web search below
```

*Everything else (content claims, unmatched place claims):*
```
Step 1  OpenAI gpt-4o-mini + web_search_preview
        Searches the real web for evidence about the claim
        Returns: answer text + list of cited source URLs

Step 2  Fanar-C-2-27B reads the web evidence and judges:
        confirmed | partially_supported | no_public_record | contradicted
```

**Blocking logic:**
- `contradicted` + `high confidence` → HTTP 409, user sees "There are inconsistencies — please review and try again"
- Everything else passes through — `no_public_record` is explicitly NOT "false"; novel unverifiable memories are the point of the archive

**Verifiable Sources:** Confirmed/partially-supported claims with real URLs are stored on the interview record and surfaced in the frontend sidebar as clickable source links.

---

### Agent 3 — The Inheritor Research Agent (`research_openai.py`)
**Model:** OpenAI `gpt-4o` with `web_search_preview`  
**Used in:** Standalone script — not triggered by uploads

A heritage research agent that documents a single Lebanese village by searching the open web and assembling a structured, sourced dossier. Designed to produce the data that populates the Inheritor page.

```
Input   Village dict: name (EN + AR), region, district, coordinates, aliases

Step 1  Build system instructions
        Tells the model: which village, where to search (Wikipedia EN + AR,
        localiban.org, census sites, municipal records, news, diaspora pages,
        Facebook groups, YouTube, academic papers), attribution rules,
        and the exact JSON schema to return

Step 2  Single agent call — OpenAI Responses API
        gpt-4o autonomously decides what to search, reads results, and
        iterates internally (web search loop handled by OpenAI, not our code)

Step 3  Extract JSON from response
        Strips markdown fences, json.loads(), regex fallback

Step 4  Stamp trusted location facts
        Overwrites model-returned coordinates/region with known-good input values

Step 5  Save to data/dossiers/<village-slug>.openai.json
```

**Attribution discipline enforced in the prompt:**
- Only attribute facts clearly tied to this village — no borrowing from neighbours
- `documented` tier = 2+ independent sources agree
- `thin` tier = single source only
- Empty categories become named **gaps** with elder interview prompts, not silently skipped

**Output shape:** `village` meta · `sources` list · `sections` (bilingual EN/AR, tiered) · `gaps` (with urgency) · `asks` (bilingual elder prompts per gap)

To research a different village: edit the `VILLAGE` dict at the top of `research_openai.py` and run `python research_openai.py`. Replace the `DOSSIER` const in `InheritorPage.tsx` with the output JSON.

---

## Additional Pages

### The Inheritor — الوارث (`InheritorPage.tsx`)
A full-screen heritage dossier page. Currently shows a static, pre-researched dossier for Khirbet Rouha (خربة روحا), Rashaya District, Beqaa — hardcoded for presentation. Two tabs:
- **What we hold** — sections with bilingual text, inline citations, and corroboration tier badges
- **What's slipping away** — undocumented heritage gaps, each expandable into a bilingual elder interview prompt

Accessible from the topbar: **الوارث · Research**

### Gap Map (`GapMapPage.tsx`)
A full-screen Leaflet map of Lebanon shading every district by how well its heritage is documented online (red = documentation gap → amber → green = well documented). Zoom past district level to see village-by-village shading across all 1,627 cadasters. Coverage scores live in the `COVERAGE` const in `GapMapPage.tsx`.

Accessible from the topbar: **Gap Map**

---

## Search (`search_engine.py`)

The search index is built lazily on first query and cached in memory. It indexes each interview segment individually (English text, Arabic text, places, themes, keywords) and each photo (AI-generated description, bilingual tags).

Queries run against both English and Arabic fields simultaneously. With Fanar-Embed-1 or a sentence-transformer, results are ranked by cosine similarity. Without an embedding backend, results are ranked by fraction of query terms matched.

---

## Running Locally

```bash
# Backend
cd fanar_hackathon
pip install -r requirements.txt   # fastapi uvicorn requests python-dotenv openai
cp .env.example .env              # add FANAR_API_KEY and OPENAI_API_KEY
uvicorn server:app --reload --port 8000

# Frontend
npm install
npm run dev                        # runs on http://localhost:5173

# Research agent (standalone)
python research_openai.py          # researches Khirbet Rouha, saves JSON to data/dossiers/
```
