import { useCallback, useRef, useState } from 'react'
import Landing from './components/Landing'
import MapView, { type MapViewHandle } from './components/MapView'
import SidePanel from './components/SidePanel'
import SearchOverlay from './components/SearchOverlay'
import ContributeModal from './components/ContributeModal'
import ArchiveSidebar from './components/ArchiveSidebar'
import { findPlaceByName, keywordSearch, PLACES } from './sampleData'
import { API_BASE } from './config'
import type {
  ApiInterview, ApiPhoto, ApiPlaceResponse,
  Interview, Photo, PlaceClickInfo, PlaceData, SearchResults, Segment,
} from './types'

// ── Convert API response to local PlaceData format ───────────────────────────

function fmtDuration(segments: Segment[]): string {
  const last = segments[segments.length - 1]
  if (!last) return '—'
  const total = last.end
  return `${Math.floor(total / 60)}:${String(Math.floor(total % 60)).padStart(2, '0')}`
}

function convertInterviews(recs: ApiInterview[], info: PlaceClickInfo): Interview[] {
  return recs.map((rec, i) => {
    const segments: Segment[] = (rec.segments ?? []).map(seg => ({
      start: seg.start ?? 0,
      end: seg.end ?? 0,
      ar: seg.arabic ?? '',
      en: seg.english ?? '',
      themes: seg.themes ?? [],
    }))
    return {
      id: `${info.cadasterId ?? info.nameEn}-iv-${i}`,
      contributor: rec.contributor ?? 'Anonymous',
      year: rec.claimed_year ?? '',
      titleEn: `Memory from ${rec.claimed_village ?? info.nameEn}`,
      titleAr: `ذاكرة من ${rec.claimed_village ?? info.nameAr}`,
      duration: fmtDuration(segments),
      summaryEn: rec.summary?.summary_en ?? '',
      summaryAr: rec.summary?.summary_ar ?? '',
      segments,
    }
  })
}

function convertPhotos(recs: ApiPhoto[], info: PlaceClickInfo): Photo[] {
  return recs.map((rec, i) => ({
    id: `${info.cadasterId ?? info.nameEn}-ph-${i}`,
    icon: '📷',
    description: rec.description ?? rec.contributor_caption ?? '',
    year: rec.claimed_year ?? rec.era_estimate ?? '',
    contributor: rec.contributor ?? 'Anonymous',
    tagsEn: rec.tags_en ?? [],
    tagsAr: rec.tags_ar ?? [],
  }))
}

function convertApiPlace(data: ApiPlaceResponse, info: PlaceClickInfo): PlaceData {
  return {
    nameEn: info.nameEn,
    nameAr: info.nameAr,
    gov: info.gov,
    lat: 0, lng: 0, match: [],
    interviews: convertInterviews(data.interviews ?? [], info),
    photos: convertPhotos(data.photos ?? [], info),
  }
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState<'landing' | 'map'>('landing')
  const [panelInfo, setPanelInfo] = useState<PlaceClickInfo | null>(null)
  const [panelPlace, setPanelPlace] = useState<PlaceData | null>(null)
  const [placeLoading, setPlaceLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null)
  const [contributeOpen, setContributeOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const mapRef = useRef<MapViewHandle>(null)

  const handleEnter = useCallback(() => setScreen('map'), [])

  const handlePlaceClick = useCallback((info: PlaceClickInfo) => {
    setPanelInfo(info)
    setSearchResults(null)

    if (info.cadasterId) {
      setPlaceLoading(true)
      setPanelPlace(null)
      fetch(`${API_BASE}/api/place/${encodeURIComponent(info.cadasterId)}`)
        .then(r => r.json() as Promise<ApiPlaceResponse>)
        .then(data => {
          const place = convertApiPlace(data, info)
          if (place.interviews.length > 0 || place.photos.length > 0) {
            setPanelPlace(place)
          }
        })
        .catch(err => console.warn('[app] place fetch failed', err))
        .finally(() => setPlaceLoading(false))
    } else {
      // District-level click or no cadasterId — fall back to sample data
      setPanelPlace(findPlaceByName(info.nameEn))
      setPlaceLoading(false)
    }
  }, [])

  const handleClosePanel = useCallback(() => {
    setPanelInfo(null)
    setPanelPlace(null)
    setPlaceLoading(false)
    mapRef.current?.clearSelection()
  }, [])

  const handleSearch = useCallback((q: string) => {
    if (!q.trim()) return
    setSearchQuery(q)
    setSearchResults(keywordSearch(q))
    setPanelInfo(null)
  }, [])

  const handleSearchResultClick = useCallback((placeId: string, type: 'photo' | 'moment') => {
    const place = PLACES[placeId]
    if (!place) return
    setSearchResults(null)
    mapRef.current?.flyTo(place.lat, place.lng)
    setPanelInfo({ nameEn: place.nameEn, nameAr: place.nameAr, gov: place.gov })
    setPanelPlace(place)
    void type
  }, [])

  const handleArchiveSelect = useCallback((placeId: string) => {
    const place = PLACES[placeId]
    if (!place) return
    mapRef.current?.flyTo(place.lat, place.lng)
    setPanelInfo({ nameEn: place.nameEn, nameAr: place.nameAr, gov: place.gov })
    setPanelPlace(place)
    setSearchResults(null)
  }, [])

  return (
    <>
      <Landing screen={screen} onEnter={handleEnter} />

      <div className="app-shell">
        <header className="topbar">
          <div className="topbar-logo">
            <span className="ar">ذاكرة</span>
            <span className="dot">·</span>
            <span className="en">Dhākira</span>
          </div>
          <SearchBar onSearch={handleSearch} />
          <button className="topbar-contribute" onClick={() => setContributeOpen(true)}>
            + Contribute
          </button>
        </header>

        <div className="map-wrap">
          <ArchiveSidebar onSelect={handleArchiveSelect} />

          <div className="map-area">
            <MapView ref={mapRef} onPlaceClick={handlePlaceClick} />

            <SidePanel
              info={panelInfo}
              place={panelPlace}
              loading={placeLoading}
              onClose={handleClosePanel}
            />

            <SearchOverlay
              results={searchResults}
              query={searchQuery}
              onClose={() => setSearchResults(null)}
              onResultClick={handleSearchResultClick}
            />
          </div>
        </div>
      </div>

      <ContributeModal open={contributeOpen} onClose={() => setContributeOpen(false)} />
    </>
  )
}

function SearchBar({ onSearch }: { onSearch: (q: string) => void }) {
  const [value, setValue] = useState('')
  const submit = () => { if (value.trim()) onSearch(value.trim()) }
  return (
    <div className="topbar-search">
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Search memories… ابحث في الذاكرة"
        autoComplete="off"
      />
      <button onClick={submit}>→</button>
    </div>
  )
}
