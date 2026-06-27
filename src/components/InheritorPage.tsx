import { useState } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface VillageMeta {
  name_en: string
  name_ar: string
  region: string
  district: string
  lat: number
  lng: number
  elevation_m: number | null
  area_km2: number | null
  pop_resident: number | null
  pop_diaspora: number | null
  hook: string
}

interface Source {
  id: string
  title: string
  url: string
  type: 'wikipedia' | 'gov' | 'article' | 'social' | 'youtube' | 'academic' | 'directory'
  lang: 'en' | 'ar'
}

interface Section {
  category: string
  title_en: string
  title_ar: string
  subtitle_en: string
  subtitle_ar: string
  body_en: string
  body_ar: string
  tier: 'documented' | 'thin'
  source_ids: string[]
  note?: string
}

interface Gap {
  category: string
  title: string
  title_ar: string
  body: string
  body_ar: string
  urgency: 'critical' | 'high' | 'medium'
}

interface Ask {
  gap_category: string
  prompt_text: string
}

interface Dossier {
  village: VillageMeta
  sources: Source[]
  sections: Section[]
  gaps: Gap[]
  asks: Ask[]
}

// ── The dossier (researched via OpenAI web search, verified against Wikipedia) ──

const DOSSIER: Dossier = {
  village: {
    name_en: 'Khirbet Rouha',
    name_ar: 'خربة روحا',
    region: 'Beqaa',
    district: 'Rashaya',
    lat: 33.57823286,
    lng: 35.84824708,
    elevation_m: 1150,
    area_km2: 14.37,
    pop_resident: 2754,
    pop_diaspora: null,
    hook: 'A highland village in the Beqaa, perched beneath Mount Hermon, whose people carried its name across the world while keeping its memory alive at home.',
  },
  sources: [
    { id: 's1', title: 'Kherbet Rouha — Wikipedia (English)', url: 'https://en.wikipedia.org/wiki/Kherbet_Rouha', type: 'wikipedia', lang: 'en' },
    { id: 's2', title: 'بلدية خربة روحا — Bekaa.com', url: 'https://bekaa.com/detail/kherbet-rouha-municipality/', type: 'gov', lang: 'ar' },
    { id: 's3', title: 'Kherbet Rouha — Population & Demographics, CityFacts', url: 'https://www.city-facts.com/khirbet-rouha/population', type: 'article', lang: 'en' },
    { id: 's4', title: 'Kherbet Rouha — Mapcarta', url: 'https://mapcarta.com/12890442', type: 'directory', lang: 'en' },
    { id: 's5', title: 'Kherbet Rouha (Q6401334) — Wikidata', url: 'https://www.wikidata.org/wiki/Q6401334', type: 'directory', lang: 'en' },
  ],
  sections: [
    {
      category: 'name_origin',
      title_en: 'Name & Etymology',
      title_ar: 'الاسم والأصل',
      subtitle_en: 'Two readings of a single name — a legend and a language',
      subtitle_ar: 'قراءتان لاسمٍ واحد — أسطورة ولغة',
      body_en: 'The name Kherbet Rouha is most often read as "broken soul." A local legend holds that the village was first called Madinat Al-Rouha\'a — "City of Souls" — but was levelled seven times by wars and natural disasters until its soul was "broken." A second reading traces it to Aramaic: kherbet ("ruins") and rouha ("spirit"), giving "Ruins of the Spirit."',
      body_ar: 'يُقرأ اسم "خربة روحا" غالباً على أنه "الروح المكسورة". تقول أسطورة محلية إن القرية كانت تُسمى أصلاً "مدينة الروحاء"، لكنها دُمّرت سبع مرات بفعل الحروب والكوارث الطبيعية حتى "انكسرت" روحها. وثمة قراءة ثانية تردّ الاسم إلى الآرامية: "خربة" بمعنى الأطلال و"روحا" بمعنى الروح، أي "أطلال الروح".',
      tier: 'thin',
      source_ids: ['s1'],
      note: 'Both meanings rest on a single Wikipedia source.',
    },
    {
      category: 'geography',
      title_en: 'Geography & Setting',
      title_ar: 'الجغرافيا والموقع',
      subtitle_en: 'A highland village under Mount Hermon, ~1,150 m above the sea',
      subtitle_ar: 'قرية مرتفعة تحت جبل حرمون، على ارتفاع نحو 1,150 متراً',
      body_en: 'Khirbet Rouha sits in the Rashaya District of the Beqaa Governorate, about 10 km northwest of Mount Hermon, in the southern Bekaa Valley. The village stands at roughly 1,150 metres elevation and spans a cadastral area of about 14.37 km².',
      body_ar: 'تقع خربة روحا في قضاء راشيا بمحافظة البقاع، على بُعد نحو 10 كيلومترات شمال غرب جبل حرمون، في جنوب سهل البقاع. ترتفع القرية نحو 1,150 متراً عن سطح البحر، وتمتدّ على مساحة عقارية تبلغ نحو 14.37 كم².',
      tier: 'documented',
      source_ids: ['s1', 's4'],
    },
    {
      category: 'demographics',
      title_en: 'Demographics',
      title_ar: 'الديموغرافيا',
      subtitle_en: 'A young, growing population — by estimate, not census',
      subtitle_ar: 'سكان فتيّون ومتنامون — بالتقدير لا بالإحصاء',
      body_en: 'Population aggregators estimate around 2,754 residents (2025 estimate), with a median age near 28 years and growth of roughly 125% since 1975. Lebanon has held no official census since 1932, so all such figures are estimates rather than counts.',
      body_ar: 'تُقدّر مواقع البيانات السكانية عدد سكان القرية بنحو 2,754 نسمة (تقدير 2025)، بمتوسط عمر يقارب 28 عاماً ونموٍّ يبلغ نحو 125% منذ عام 1975. لم يُجرَ في لبنان أيّ إحصاء رسمي منذ عام 1932، لذا فإن هذه الأرقام تقديرية لا تعدادية.',
      tier: 'documented',
      source_ids: ['s3', 's5'],
      note: 'Estimates only — no official Lebanese census since 1932.',
    },
    {
      category: 'built_environment',
      title_en: 'Religious Heritage',
      title_ar: 'التراث الديني',
      subtitle_en: 'Said to hold Lebanon\'s tallest minaret — 100 metres',
      subtitle_ar: 'يُقال إنها تضمّ أطول مئذنة في لبنان — مئة متر',
      body_en: 'The village is noted for the tall minarets of its mosques, with the tallest reported at 100 metres — described as the highest in Lebanon. The claim is striking but rests on a single source and is not independently corroborated.',
      body_ar: 'تشتهر القرية بمآذن مساجدها المرتفعة، وأعلاها يبلغ — وفق ما ذُكر — مئة متر، وُصِفت بأنها الأعلى في لبنان. الادعاء لافت لكنه يستند إلى مصدر واحد ولم يُؤكَّد بشكل مستقل.',
      tier: 'thin',
      source_ids: ['s1'],
      note: 'Single Wikipedia source; the "tallest in Lebanon" claim is uncorroborated.',
    },
    {
      category: 'diaspora',
      title_en: 'Diaspora',
      title_ar: 'الشتات',
      subtitle_en: 'From the Beqaa to Alberta — and a graveyard in North Dakota',
      subtitle_ar: 'من البقاع إلى ألبرتا — ومقبرة في داكوتا الشمالية',
      body_en: 'People of Khirbet Rouha emigrated widely — chiefly to Canada, the United States, Brazil and the UAE. In Canada the largest communities settled in Edmonton and Calgary, Alberta. Early immigrants to the US reached the Turtle Mountain region of North Dakota; one of the oldest Islamic cemeteries in America, in Dunseith, North Dakota, still holds their headstones, some dating to the early 20th century.',
      body_ar: 'هاجر أبناء خربة روحا إلى أنحاء العالم — أساساً إلى كندا والولايات المتحدة والبرازيل والإمارات. في كندا استقرّ أكبر تجمّع في إدمونتون وكالغاري بمقاطعة ألبرتا. وبلغ المهاجرون الأوائل إلى الولايات المتحدة منطقة جبال تيرتل في داكوتا الشمالية؛ وما تزال إحدى أقدم المقابر الإسلامية في أميركا، في بلدة دنسيث بداكوتا الشمالية، تحمل شواهد قبورهم، بعضها يعود إلى مطلع القرن العشرين.',
      tier: 'thin',
      source_ids: ['s1'],
      note: 'Richly detailed, but all from one Wikipedia source.',
    },
    {
      category: 'people',
      title_en: 'Notable People',
      title_ar: 'شخصيات بارزة',
      subtitle_en: 'Birthplace of a Mamluk-era Qur\'anic scholar',
      subtitle_ar: 'مسقط رأس عالمٍ مفسّر من العصر المملوكي',
      body_en: 'The village is recorded as the birthplace of Burhān al-Dīn al-Biqāʿī (1407–1480), the Mamluk-era scholar and Qur\'anic exegete whose very name — "al-Biqāʿī" — marks him as a son of the Beqaa. The attribution is historical and widely repeated, but is given here from a single source.',
      body_ar: 'تُذكر القرية بوصفها مسقط رأس برهان الدين البقاعي (1407–1480)، العالم والمفسّر القرآني من العصر المملوكي، الذي يدلّ اسمه — "البقاعي" — على انتمائه إلى البقاع. النسبة تاريخية ومتداولة، لكنها مذكورة هنا من مصدر واحد.',
      tier: 'thin',
      source_ids: ['s1'],
    },
  ],
  gaps: [
    { category: 'customs', title: 'Weddings, songs & rituals', title_ar: 'الأعراس والأغاني والطقوس', body: 'The engagement, the henna night and the zalghouta, the dabke and the singers who led it, and the customs of birth, mourning and visiting — the rituals that marked a life in Khirbet Rouha survive only in memory.', body_ar: 'الخطبة، وليلة الحنّة، والزغاريد، والدبكة ومن كان يقودها، وعادات الولادة والعزاء والزيارة — الطقوس التي رافقت حياة أبناء خربة روحا لم تعد تعيش إلا في الذاكرة.', urgency: 'high' },
    { category: 'crafts', title: 'Dress & adornment', title_ar: 'اللباس والزينة', body: 'Women\'s head coverings, the embroidery and fabrics of their dresses, their jewelry, and the everyday and work clothing of the men — the village\'s own way of dressing was never photographed or described.', body_ar: 'أغطية رأس النساء، وتطريز فساتينهنّ وأقمشتها، وحُليّهنّ، وملابس الرجال اليومية وملابس العمل — لم تُصوَّر طريقة لباس القرية الخاصة ولم توصَف.', urgency: 'high' },
    { category: 'land_food', title: 'Food & the table', title_ar: 'الطعام والمائدة', body: 'The dishes set out at weddings and funerals, in Ramadan and at Eid, and the daily work of cooking, preserving and storing food through the seasons — a village table with no written recipe.', body_ar: 'الأطباق التي كانت تُقدَّم في الأعراس والمآتم، وفي رمضان والعيد، والعمل اليومي في الطبخ والمؤونة والتخزين عبر الفصول — مائدة قرية بلا وصفة مكتوبة.', urgency: 'high' },
    { category: 'dialect', title: 'Words & village place-names', title_ar: 'المفردات وأسماء الأماكن', body: 'The words the village used for everyday objects, and the micro-names of its quarters, springs and fields — a private geography and vocabulary that no map or dictionary holds.', body_ar: 'الكلمات التي استعملتها القرية لأشياء الحياة اليومية، والأسماء الدقيقة لحاراتها وينابيعها وحقولها — جغرافيا ومفردات خاصة لا تحملها خريطة ولا قاموس.', urgency: 'high' },
    { category: 'memory', title: 'Old houses, mills & springs', title_ar: 'البيوت القديمة والمطاحن والينابيع', body: 'The stories of the old stone houses, the mills, the springs and the orchards — and the family-by-family accounts of who left, when and why — survive only in the telling.', body_ar: 'حكايات البيوت الحجرية القديمة والمطاحن والينابيع والبساتين — وروايات كلّ عائلة عمّن رحل ومتى ولماذا — لا تبقى إلا في الحكاية.', urgency: 'high' },
    { category: 'history', title: 'Pre-modern village history', title_ar: 'تاريخ القرية قبل الحديث', body: 'No excavation or written history has been published for Khirbet Rouha itself. Its Ottoman-era life, its founding families and the events that shaped it remain undocumented.', body_ar: 'لم يُنشر أيّ تنقيب أو تاريخ مكتوب لخربة روحا نفسها. تبقى حياتها في العهد العثماني وعائلاتها المؤسِّسة والأحداث التي صاغتها غير موثّقة.', urgency: 'critical' },
  ],
  asks: [
    { gap_category: 'customs', prompt_text: 'كيف كانت تُقام الخطبة وليلة الحنّة والعرس في الخربة، ومن كان يقود الدبكة والغناء؟ / How were the engagement, the henna night and the wedding held in Khirbet Rouha, and who led the dabke and the singing?' },
    { gap_category: 'crafts', prompt_text: 'كيف كانت تلبس نساء الخربة ورجالها، وما التطريز والحُليّ التي كانت تميّزهم؟ / How did the women and men of Khirbet Rouha dress, and what embroidery and jewelry set them apart?' },
    { gap_category: 'land_food', prompt_text: 'ما الأطباق التي كانت تُحضَّر للأعراس والعزاء وفي رمضان والعيد، وكيف كانت تُحفظ المؤونة؟ / What dishes were prepared for weddings, funerals, Ramadan and Eid, and how was food preserved for the year?' },
    { gap_category: 'dialect', prompt_text: 'ما الكلمات التي يقولها أهل الخربة لأشياء البيت، وما أسماء الحارات والينابيع داخل القرية؟ / What words do the people of Khirbet Rouha use for household things, and what are the names of the quarters and springs inside the village?' },
    { gap_category: 'memory', prompt_text: 'احكِ لي عن بيت قديم أو مطحنة أو نبع في الخربة، ومتى وكيف غادرت عائلتك القرية؟ / Tell me about an old house, a mill or a spring in Khirbet Rouha — and when and how your family left the village.' },
    { gap_category: 'history', prompt_text: 'من هي العائلات الأولى التي سكنت خربة روحا، وماذا تتذكّر عن القرية في العهد العثماني؟ / Who were the first families of Khirbet Rouha, and what is remembered of the village under Ottoman rule?' },
  ],
}

// ── Labels ────────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  people: 'People',
  diaspora: 'Diaspora',
  history: 'History',
  name_origin: 'Name & Origins',
  geography: 'Geography',
  demographics: 'Demographics',
  land_food: 'Land & Food',
  built_environment: 'Built Environment',
  conflict: 'Conflict & Memory',
  dialect: 'Dialect',
  customs: 'Customs & Rituals',
  crafts: 'Dress & Crafts',
  memory: 'Places & Memory',
}

const SOURCE_TYPE_META: Record<string, { icon: string; label: string }> = {
  wikipedia: { icon: '📖', label: 'Wikipedia' },
  gov: { icon: '🏛', label: 'Municipal' },
  article: { icon: '📰', label: 'Article' },
  social: { icon: '💬', label: 'Social' },
  youtube: { icon: '▶', label: 'YouTube' },
  academic: { icon: '🎓', label: 'Academic' },
  directory: { icon: '🗂', label: 'Directory' },
}

// ── Tier badge ────────────────────────────────────────────────────────────────

function TierBadge({ tier }: { tier: 'documented' | 'thin' }) {
  const documented = tier === 'documented'
  return (
    <span style={{
      display: 'inline-block', fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.06em',
      textTransform: 'uppercase', padding: '2px 7px', borderRadius: 12,
      background: documented ? 'rgba(47,93,80,0.12)' : 'rgba(193,124,91,0.13)',
      color: documented ? 'var(--cedar)' : 'var(--terra)',
      border: `1px solid ${documented ? 'rgba(47,93,80,0.25)' : 'rgba(193,124,91,0.3)'}`,
    }}>
      {documented ? '✓ corroborated' : '~ single source'}
    </span>
  )
}

// ── Section block (Wikipedia-style heading + subtitle + body + citations) ──────

function SectionBlock({ section, sources }: { section: Section; sources: Source[] }) {
  const [showAr, setShowAr] = useState(false)
  const cited = sources.filter(s => section.source_ids.includes(s.id))
  return (
    <div style={{ marginBottom: '1.7rem', paddingBottom: '1.6rem', borderBottom: '1px solid rgba(47,93,80,0.1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.15rem' }}>
        <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--cedar)', margin: 0, lineHeight: 1.25 }}>
          {section.title_en}
        </h2>
        <span dir="rtl" style={{ fontFamily: "'Amiri', serif", fontSize: '1.05rem', color: 'var(--muted)' }}>
          {section.title_ar}
        </span>
        <span style={{ marginLeft: 'auto' }}><TierBadge tier={section.tier} /></span>
      </div>

      {section.subtitle_en && (
        <div style={{ fontSize: '0.78rem', fontStyle: 'italic', color: 'var(--muted)', marginBottom: '0.7rem' }}>
          {section.subtitle_en}
        </div>
      )}

      <p style={{ fontSize: '0.88rem', lineHeight: 1.72, color: 'var(--text)', margin: '0 0 0.5rem' }}>
        {section.body_en}
        {cited.map(s => (
          <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer"
            title={s.title}
            style={{ fontSize: '0.62rem', verticalAlign: 'super', color: 'var(--sage)', textDecoration: 'none', marginLeft: 2, fontWeight: 700 }}>
            [{s.id.replace('s', '')}]
          </a>
        ))}
      </p>

      {section.body_ar && (
        <>
          {showAr && (
            <p dir="rtl" style={{
              fontFamily: "'Amiri', serif", fontSize: '0.96rem', lineHeight: 1.85, color: 'var(--muted)',
              margin: '0 0 0.5rem', paddingTop: '0.4rem', borderTop: '1px solid rgba(0,0,0,0.06)',
            }}>
              {section.body_ar}
            </p>
          )}
          <button onClick={() => setShowAr(v => !v)} style={{
            background: 'none', border: 'none', color: 'var(--sage)', fontSize: '0.7rem',
            cursor: 'pointer', padding: 0, fontFamily: 'inherit',
          }}>
            {showAr ? '▲ إخفاء العربية' : '▼ بالعربية'}
          </button>
        </>
      )}

      {section.note && (
        <div style={{ marginTop: '0.6rem', fontSize: '0.68rem', color: 'var(--terra)', fontStyle: 'italic', opacity: 0.85 }}>
          ⚠ {section.note}
        </div>
      )}

      {cited.length > 0 && (
        <div style={{ marginTop: '0.6rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
          {cited.map(s => (
            <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" style={{
              fontSize: '0.66rem', color: 'var(--muted)', textDecoration: 'none',
              background: 'rgba(47,93,80,0.05)', border: '1px solid rgba(47,93,80,0.12)',
              borderRadius: 6, padding: '2px 7px',
            }}>
              {SOURCE_TYPE_META[s.type]?.icon} {s.title.length > 38 ? s.title.slice(0, 38) + '…' : s.title} ↗
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Gap card ──────────────────────────────────────────────────────────────────

function GapCard({ gap, ask }: { gap: Gap; ask?: Ask }) {
  const [showAsk, setShowAsk] = useState(false)
  const urgencyColor = gap.urgency === 'critical' ? '#c0392b' : gap.urgency === 'high' ? 'var(--terra)' : 'var(--muted)'
  return (
    <div style={{
      border: '1.5px dashed rgba(193,124,91,0.45)', borderRadius: 10,
      padding: '1rem 1.1rem', marginBottom: '0.75rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
        <span className="chip" style={{ fontSize: '0.58rem', background: 'rgba(193,124,91,0.1)', color: 'var(--terra)', border: '1px solid rgba(193,124,91,0.25)' }}>
          {CATEGORY_LABELS[gap.category] ?? gap.category}
        </span>
        <span style={{ fontSize: '0.6rem', color: urgencyColor, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          {gap.urgency}
        </span>
      </div>
      <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--terra)', marginBottom: '0.3rem' }}>
        {gap.title}
      </div>
      {gap.title_ar && (
        <div dir="rtl" style={{ fontFamily: "'Amiri', serif", fontSize: '0.92rem', color: 'var(--muted)', marginBottom: '0.4rem' }}>
          {gap.title_ar}
        </div>
      )}
      <div style={{ fontSize: '0.82rem', lineHeight: 1.65, color: 'var(--muted)' }}>
        {gap.body}
      </div>
      {ask && (
        <div style={{ marginTop: '0.7rem' }}>
          {!showAsk ? (
            <button onClick={() => setShowAsk(true)} style={{
              background: 'rgba(193,124,91,0.09)', border: '1px solid rgba(193,124,91,0.3)',
              borderRadius: 6, padding: '0.3rem 0.7rem', fontSize: '0.72rem',
              color: 'var(--terra)', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              Turn this gap into an ask →
            </button>
          ) : (
            <div style={{ background: 'rgba(193,124,91,0.07)', border: '1px solid rgba(193,124,91,0.2)', borderRadius: 7, padding: '0.7rem 0.85rem' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--terra)', fontWeight: 700, marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Ask an elder:
              </div>
              <div style={{ fontSize: '0.82rem', lineHeight: 1.65, color: 'var(--text)' }}>
                {ask.prompt_text}
              </div>
              <button onClick={() => setShowAsk(false)} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: '0.68rem', cursor: 'pointer', marginTop: '0.4rem' }}>
                ▲ collapse
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void
}

export default function InheritorPage({ onBack }: Props) {
  const dossier = DOSSIER
  const v = dossier.village
  const [activeTab, setActiveTab] = useState<'held' | 'gaps'>('held')
  const documentedCount = dossier.sections.filter(s => s.tier === 'documented').length

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--bg)', display: 'flex', flexDirection: 'column', zIndex: 500, overflowY: 'auto' }}>
      {/* Topbar */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10, background: 'var(--cedar)', color: '#fff',
        padding: '0 1.4rem', height: 'var(--bar-h)', display: 'flex', alignItems: 'center', gap: '1rem',
        boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
      }}>
        <button onClick={onBack} style={{
          background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 7, padding: '0.3rem 0.8rem', color: '#fff', fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit',
        }}>
          ← Archive
        </button>
        <div style={{ flex: 1 }}>
          <span style={{ fontWeight: 700, fontSize: '0.95rem', letterSpacing: '-0.01em' }}>الوارث · The Inheritor</span>
          <span style={{ marginLeft: '0.8rem', fontSize: '0.75rem', opacity: 0.7 }}>heritage research agent</span>
        </div>
        <span style={{ fontSize: '0.68rem', opacity: 0.65 }}>researched via web search · verified</span>
      </div>

      <div style={{ maxWidth: 760, margin: '0 auto', width: '100%', padding: '1.8rem 1.4rem 3rem' }}>

        {/* Village header */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.7rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
            <h1 style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--cedar)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              {v.name_en}
            </h1>
            <span dir="rtl" style={{ fontFamily: "'Amiri', serif", fontSize: '1.4rem', color: 'var(--muted)' }}>{v.name_ar}</span>
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--muted)', marginBottom: '0.7rem' }}>
            {[`${v.district} District`, `${v.region} Governorate`, 'Lebanon'].join(' · ')}
            {v.elevation_m && ` · ${v.elevation_m} m`}
            {v.area_km2 && ` · ${v.area_km2} km²`}
            {v.pop_resident && ` · ~${v.pop_resident.toLocaleString()} residents (est.)`}
          </div>
          <div style={{
            fontSize: '0.92rem', fontStyle: 'italic', color: 'var(--cedar)', padding: '0.6rem 1rem',
            background: 'rgba(47,93,80,0.06)', borderLeft: '3px solid var(--cedar)', borderRadius: '0 6px 6px 0',
          }}>
            {v.hook}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', marginBottom: '1.4rem', borderBottom: '2px solid rgba(47,93,80,0.15)' }}>
          {(['held', 'gaps'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              background: 'none', border: 'none', padding: '0.6rem 1.2rem', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: 600,
              color: activeTab === tab ? 'var(--cedar)' : 'var(--muted)',
              borderBottom: `2px solid ${activeTab === tab ? 'var(--cedar)' : 'transparent'}`, marginBottom: -2,
            }}>
              {tab === 'held' ? `What we hold (${dossier.sections.length})` : `What's slipping away (${dossier.gaps.length})`}
            </button>
          ))}
        </div>

        {/* What we hold */}
        {activeTab === 'held' && (
          <div>
            <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: '1.2rem', lineHeight: 1.55 }}>
              {dossier.sections.length} sections assembled from {dossier.sources.length} web sources — {documentedCount} corroborated by two or more, the rest resting on a single source. Citations link to the original pages.
            </div>
            {dossier.sections.map((section, i) => (
              <SectionBlock key={i} section={section} sources={dossier.sources} />
            ))}

            {/* Sources list */}
            <div style={{ marginTop: '1.2rem' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.6rem' }}>
                Sources
              </div>
              {dossier.sources.map(s => (
                <div key={s.id} style={{ fontSize: '0.74rem', color: 'var(--muted)', marginBottom: '0.35rem', display: 'flex', gap: '0.5rem' }}>
                  <span style={{ color: 'var(--sage)', fontWeight: 700, minWidth: 18 }}>[{s.id.replace('s', '')}]</span>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--muted)', textDecoration: 'none' }}>
                    {SOURCE_TYPE_META[s.type]?.icon} {s.title} <span style={{ opacity: 0.5 }}>↗</span>
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* What's slipping away */}
        {activeTab === 'gaps' && (
          <div>
            <div style={{ fontSize: '0.82rem', color: 'var(--muted)', marginBottom: '1.2rem', lineHeight: 1.6 }}>
              Khirbet Rouha has a visible administrative and historical footprint online — elections, infrastructure, religious institutions, migration and conflict are recorded. But its <em>lived</em> culture is severely underdocumented: clothing, weddings, women's lives, food, songs, household tools, oral stories and local vocabulary survive mainly in family memory and private photographs. Each gap below is an invitation to record what the web never will.
            </div>
            {dossier.gaps.map((gap, i) => {
              const ask = dossier.asks.find(a => a.gap_category === gap.category)
              return <GapCard key={i} gap={gap} ask={ask} />
            })}
          </div>
        )}
      </div>
    </div>
  )
}
