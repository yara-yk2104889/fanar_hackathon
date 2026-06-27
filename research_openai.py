"""
research_openai.py — The Inheritor heritage research agent.

Uses the OpenAI Responses API with web_search_preview to find real, cited
information about a Lebanese village and structures it into a heritage dossier
matching the shape expected by InheritorPage.tsx.

Run:    python research_openai.py
Output: data/dossiers/<slug>.openai.json   (+ printed summary)

To research a different village, edit the VILLAGE dict below or import research()
and pass your own dict.
"""

import os
import re
import json
import sys
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

MODEL = "gpt-4o"

VILLAGE = {
    "name_en": "Khirbet Rouha",
    "name_ar": "خربة روحا",
    "region": "Beqaa",
    "district": "Rashaya",
    "lat": 33.57823286,
    "lng": 35.84824708,
    "area_km2": 14.37,
    "aliases": ["Kherbet Rouha", "Kherbet Rouhaa", "Khirbet Rawha", "خربة روحا"],
}


def build_instructions(v: dict) -> str:
    name = v["name_en"]
    aliases = ", ".join(a for a in v.get("aliases", []) if a)
    return f"""\
You are "The Inheritor" (الوارث), a heritage-research agent documenting a single Lebanese \
village. You search the open web, read what you find, and assemble a sourced, structured \
dossier — like a careful Wikipedia editor who refuses to invent anything.

TARGET VILLAGE: {name}{f' (also spelled: {aliases})' if aliases else ''}, in the \
{v.get('district','?')} District of the {v.get('region','?')} Governorate, Lebanon. \
Latitude {v.get('lat','?')}, longitude {v.get('lng','?')}.

SEARCH the web thoroughly. Try the alternate spellings. Look for: Wikipedia (English + \
Arabic), localiban.org, population/census data, municipal records, news articles, diaspora \
association pages, social media (Facebook village groups), YouTube videos, blogs, and academic \
references.

ATTRIBUTION DISCIPLINE (critical):
- Only attribute a fact to {name} if the source clearly ties it to THIS village.
- Do NOT borrow heritage from neighbouring towns and pin it on {name}.
- If a claim has only one source, mark it "thin". If two or more genuinely independent sources \
  agree, mark it "documented".
- Never fabricate a source, URL, date, or statistic. If you are unsure, leave it out and let \
  it become a gap instead.

Produce a dossier organised into SECTIONS — each with a clear heading and, where useful, a \
one-line subtitle. Typical sections: Name & Etymology, Geography & Setting, Demographics, \
History, Religious Heritage / Built Environment, Economy & Land, Diaspora, Notable People. \
Only include a section if you actually found sourced material for it.

For EVERY section write the body in BOTH English and fluent Modern Standard Arabic.

Then list the GAPS — heritage categories where you found little or nothing village-specific \
(these become "What's slipping away"), each paired with an elicitation question for an elder.

OUTPUT FORMAT — return ONLY a single valid JSON object (no markdown fences, double-quoted keys):
{{
  "village": {{
    "name_en": "{name}",
    "name_ar": "{v.get('name_ar','')}",
    "region": "{v.get('region','')}",
    "district": "{v.get('district','')}",
    "pop_resident": <int or null>,
    "pop_diaspora": <int or null>,
    "elevation_m": <int or null>,
    "hook": "<one evocative sentence about the village>"
  }},
  "sources": [
    {{"id": "s1", "title": "<page title>", "url": "<real url>", "type": "wikipedia|article|gov|social|youtube|academic|directory", "lang": "en|ar"}}
  ],
  "sections": [
    {{
      "category": "name_origin|geography|demographics|history|built_environment|land_food|diaspora|people|conflict|customs",
      "title_en": "<section heading>",
      "title_ar": "<Arabic heading>",
      "subtitle_en": "<short one-line subtitle>",
      "subtitle_ar": "<Arabic subtitle>",
      "body_en": "<2-5 sentence sourced summary in English>",
      "body_ar": "<same content in Modern Standard Arabic>",
      "tier": "documented|thin",
      "source_ids": ["s1", "s2"]
    }}
  ],
  "gaps": [
    {{"category": "...", "title": "<gap name>", "title_ar": "<...>", "body": "<what is missing and why it matters>", "body_ar": "<...>", "urgency": "critical|high|medium"}}
  ],
  "asks": [
    {{"gap_category": "...", "prompt_text": "<Arabic question> / <English question>"}}
  ]
}}
"""


def _extract_json(text: str) -> dict:
    cleaned = re.sub(r"```(?:json)?", "", text).strip()
    try:
        return json.loads(cleaned)
    except Exception:
        pass
    m = re.search(r"\{[\s\S]*\}", cleaned)
    if m:
        return json.loads(m.group(0))
    raise ValueError("No JSON found in model output")


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def research(village: dict | None = None) -> dict:
    """Research a village on the open web and return a structured dossier dict."""
    v = village or VILLAGE
    print(f"[openai] Researching {v['name_en']} with web search…")
    resp = client.responses.create(
        model=MODEL,
        tools=[{"type": "web_search_preview"}],
        instructions=build_instructions(v),
        input=(
            f"Research the village of {v['name_en']}"
            f"{' (' + v.get('name_ar','') + ')' if v.get('name_ar') else ''}, "
            f"{v.get('district','')} District, {v.get('region','')}, Lebanon. "
            "Search the web, read the sources, and return the dossier JSON exactly as "
            "specified. Use real URLs you actually found."
        ),
        max_output_tokens=6000,
    )
    dossier = _extract_json(resp.output_text)

    # Stamp in known-good location facts
    dossier.setdefault("village", {})
    dossier["village"].setdefault("name_en", v["name_en"])
    dossier["village"].setdefault("name_ar", v.get("name_ar", ""))
    dossier["village"]["region"]   = v.get("region",   dossier["village"].get("region"))
    dossier["village"]["district"] = v.get("district", dossier["village"].get("district"))
    for key in ("lat", "lng", "area_km2"):
        if v.get(key) is not None:
            dossier["village"][key] = v[key]

    return dossier


def research_and_save(village: dict | None = None) -> tuple[dict, Path]:
    """Research a village and write the dossier to data/dossiers/<slug>.openai.json."""
    v = village or VILLAGE
    dossier = research(v)
    out = Path(__file__).parent / "data" / "dossiers" / f"{_slug(v['name_en'])}.openai.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(dossier, ensure_ascii=False, indent=2), encoding="utf-8")
    return dossier, out


if __name__ == "__main__":
    dossier, out = research_and_save()
    print(f"\n[openai] Saved → {out}")
    print(f"  sections : {len(dossier.get('sections', []))}")
    print(f"  sources  : {len(dossier.get('sources', []))}")
    print(f"  gaps     : {len(dossier.get('gaps', []))}")
    for s in dossier.get("sections", []):
        print(f"   [{s.get('tier','?'):10}] {s.get('title_en','?')}  ({len(s.get('source_ids', []))} src)")
    print("\n--- SOURCES ---")
    for s in dossier.get("sources", []):
        print(f"   {s.get('id')}: {s.get('title')}  {s.get('url')}")
