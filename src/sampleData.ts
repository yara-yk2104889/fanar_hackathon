import type { PlaceData } from './types'

// TODO: replace with fetch('/api/places') returning real pipeline output JSONs
// (namliyeh_clip_output.json segments + *_photo_output.json records)
export const PLACES: Record<string, PlaceData> = {
  bint_jbeil: {
    nameEn: 'Bint Jbeil',
    nameAr: 'بنت جبيل',
    gov: 'South Lebanon — Nabatieh Governorate',
    lat: 33.1167,
    lng: 35.4333,
    match: ['bint jbeil', 'bent jbayl', 'bint jubail'],
    interviews: [
      {
        id: 'i-bj-01',
        contributor: 'Mariam K.',
        year: 'circa 1980s',
        titleEn: 'Life in the village — bread, land, and people',
        titleAr: 'الحياة في الضيعة — الخبز والأرض والناس',
        duration: '3:42',
        summaryEn:
          "Mariam describes daily life in Bint Jbeil in the early 1980s: communal bread-making on the saj, women's role in agriculture, and the close-knit village fabric before displacement.",
        summaryAr:
          'تصف مريم الحياة اليومية في بنت جبيل في مطلع الثمانينيات: صنع الخبز الجماعي على الصاج، دور المرأة في العمل الزراعي، والنسيج الاجتماعي المتماسك قبل التهجير.',
        segments: [
          {
            start: 0,
            end: 92,
            ar: 'كنّا نصحى كل صبح على صوت الصاج. ستّي تشعل النار قبل الفجر وتبدأ تسوي الخبز. الجيران يحضروا، كل واحدة تجيب عجينتها.',
            en: "We woke every morning to the sound of the saj. My grandmother would light the fire before dawn and begin making bread. The neighbours would come, each bringing her own dough.",
            themes: ['daily life', 'bread-making', 'community'],
          },
          {
            start: 92,
            end: 222,
            ar: 'الأرض كانت كل شي. كنّا نزرع زيتون وتين وعنب. موسم القطاف كان عيد — الكل يشتغل مع الكل. بعدين جاءت الحرب وكل شي تغيّر.',
            en: "The land was everything. We grew olives, figs, and grapes. The harvest season was a celebration — everyone worked together. Then the war came and everything changed.",
            themes: ['agriculture', 'olive harvest', 'displacement', 'war'],
          },
        ],
      },
    ],
    photos: [
      {
        id: 'ph-bj-01',
        icon: '🏘',
        description:
          'Stone houses on a sloped lane in Bint Jbeil, with fig trees in the foreground.',
        year: '1970s',
        contributor: 'Mariam K.',
        tagsEn: ['stone houses', 'village', 'fig trees', 'architecture'],
        tagsAr: ['بيوت حجرية', 'قرية', 'تين', 'عمارة تقليدية'],
      },
      {
        id: 'ph-bj-02',
        icon: '🫒',
        description:
          'Women gathering during the olive harvest near Bint Jbeil, south Lebanon.',
        year: '1982',
        contributor: 'Unknown',
        tagsEn: ['olive harvest', 'women', 'agriculture', 'south Lebanon'],
        tagsAr: ['قطاف الزيتون', 'نساء', 'زراعة', 'جنوب لبنان'],
      },
    ],
  },

  tyre: {
    nameEn: 'Tyre (Sur)',
    nameAr: 'صور',
    gov: 'South Lebanon — Tyre District',
    lat: 33.2701,
    lng: 35.1974,
    match: ['tyre', 'sur', 'sour', 'tyr'],
    interviews: [
      {
        id: 'i-ty-01',
        contributor: 'Ibrahim H.',
        year: '1990s',
        titleEn: 'Fishing traditions and the sea',
        titleAr: 'تقاليد الصيد والبحر',
        duration: '2:10',
        summaryEn:
          "Ibrahim recounts three generations of fishing tradition in Tyre's ancient port: seasonal fish, wooden boats, and how conflict transformed the waterfront over the decades.",
        summaryAr:
          'يروي إبراهيم ثلاثة أجيال من الصيد في ميناء صور العتيق: الأسماك الموسمية، والقوارب الخشبية، وكيف غيّرت النزاعات واجهة البحر على مر العقود.',
        segments: [
          {
            start: 0,
            end: 130,
            ar: 'جدّي كان صياد، وأبوي صياد، وأنا كمان صياد. البحر عندنا مش بس رزق — هو الهوية. صور بُنيت على البحر، والبحر بنى صور.',
            en: "My grandfather was a fisherman, my father was a fisherman, and so am I. The sea is not just our livelihood — it is our identity. Tyre was built on the sea, and the sea built Tyre.",
            themes: ['fishing', 'identity', 'heritage', 'sea'],
          },
        ],
      },
    ],
    photos: [
      {
        id: 'ph-ty-01',
        icon: '⚓',
        description:
          'Fishing boats in the ancient harbour of Tyre, with Roman ruins visible in the background.',
        year: '1980s',
        contributor: 'Ibrahim H.',
        tagsEn: ['Tyre', 'harbour', 'fishing boats', 'Roman ruins', 'sea'],
        tagsAr: ['صور', 'ميناء', 'قوارب صيد', 'آثار رومانية', 'بحر'],
      },
      {
        id: 'ph-ty-02',
        icon: '🏛',
        description:
          'The Roman hippodrome of Tyre at dawn — one of the largest surviving hippodrome structures in the world.',
        year: '1975',
        contributor: 'AUB Archive',
        tagsEn: ['Roman ruins', 'hippodrome', 'Tyre', 'archaeology'],
        tagsAr: ['آثار رومانية', 'هيبودروم', 'صور', 'آثار'],
      },
    ],
  },

  nabatieh: {
    nameEn: 'Nabatieh',
    nameAr: 'النبطية',
    gov: 'South Lebanon — Nabatieh Governorate',
    lat: 33.3782,
    lng: 35.4844,
    match: ['nabatieh', 'nabatiye', 'nabatiyeh'],
    interviews: [
      {
        id: 'i-nb-01',
        contributor: 'Fatima A.',
        year: '2001',
        titleEn: 'Markets, crafts, and Ashura in Nabatieh',
        titleAr: 'الأسواق والحرف وعاشوراء في النبطية',
        duration: '1:55',
        summaryEn:
          "Fatima describes Nabatieh's weekly souq, her father's copper-craft tradition, and the city's famous Ashura commemorations that drew visitors from across Lebanon.",
        summaryAr:
          'تصف فاطمة سوق النبطية الأسبوعي، والحرف النحاسية التي كان يمارسها والدها، واحتفالات عاشوراء الشهيرة التي كانت تجذب الزوار من أنحاء لبنان.',
        segments: [
          {
            start: 0,
            end: 115,
            ar: 'السوق كان ينعقد كل يوم جمعة. من كل الضياع المحيطة يجوا الناس. أبوي كان نحاساً — يصنع الأواني والصحون والأباريق. صنعة في إيديه توارثها عن جده.',
            en: "The market convened every Friday. People came from all the surrounding villages. My father was a coppersmith — he made pots, bowls, and ewers. A craft passed through his hands from his grandfather.",
            themes: ['market', 'crafts', 'coppersmith', 'tradition'],
          },
        ],
      },
    ],
    photos: [
      {
        id: 'ph-nb-01',
        icon: '🪹',
        description:
          'A row of copper vessels at the Nabatieh souq, handcrafted using traditional methods.',
        year: '1990s',
        contributor: 'Fatima A.',
        tagsEn: ['coppersmith', 'crafts', 'souq', 'Nabatieh', 'traditional'],
        tagsAr: ['نحاس', 'حرف يدوية', 'سوق', 'النبطية', 'تقليدي'],
      },
    ],
  },
}

export function findPlaceByName(nameEn: string): PlaceData | null {
  const n = nameEn.toLowerCase()
  return (
    Object.values(PLACES).find((p) =>
      p.match.some((m) => n.includes(m) || m.includes(n)),
    ) ?? null
  )
}

// TODO: replace with fetch('/api/search?q=…') → search_engine.py search(query)
export function keywordSearch(query: string) {
  const q = query.toLowerCase().trim()
  const photos: import('./types').SearchPhoto[] = []
  const moments: import('./types').SearchMoment[] = []
  if (!q) return { query, photos, moments }

  for (const [pid, place] of Object.entries(PLACES)) {
    for (const ph of place.photos) {
      const hay = [ph.description, ...ph.tagsEn, ...ph.tagsAr].join(' ').toLowerCase()
      if (hay.includes(q))
        photos.push({ ...ph, placeId: pid, placeNameEn: place.nameEn, placeNameAr: place.nameAr })
    }
    for (const iv of place.interviews) {
      for (const seg of iv.segments) {
        const hay = [seg.en, seg.ar, ...seg.themes].join(' ').toLowerCase()
        if (hay.includes(q))
          moments.push({
            ...seg,
            interviewId: iv.id,
            interviewTitle: iv.titleEn,
            placeId: pid,
            placeNameEn: place.nameEn,
            placeNameAr: place.nameAr,
          })
      }
    }
  }
  return { query, photos, moments }
}
