import { useCallback, useRef, useState } from 'react'
import Landing from './components/Landing'
import MapView, { type MapViewHandle } from './components/MapView'
import SidePanel from './components/SidePanel'
import SearchOverlay from './components/SearchOverlay'
import ContributeModal from './components/ContributeModal'
import ArchiveSidebar from './components/ArchiveSidebar'
import { API_BASE } from './config'
import type {
  ApiInterview, ApiPhoto, ApiPlaceResponse,
  Interview, Photo, PlaceClickInfo, PlaceData, SearchResults, SearchPhoto, SearchMoment, Segment,
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
      filePath: rec._file_path,
      mediaUrl: rec.media_url ? `${API_BASE}${rec.media_url}` : undefined,
      flagged: rec.flagged ?? false,
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
    filePath: rec._file_path,
    imageUrl: rec.image_url ? `${API_BASE}${rec.image_url}` : undefined,
    lat: rec.lat,
    lng: rec.lng,
    flagged: rec.flagged ?? false,
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
  const [searchLoading, setSearchLoading] = useState(false)
  const [contributeOpen, setContributeOpen] = useState(false)
  const [uploadRefreshKey, setUploadRefreshKey] = useState(0)

  const handleUploadSuccess = useCallback(() => {
    setUploadRefreshKey(k => k + 1)
    mapRef.current?.refreshDots()
  }, [])
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
      // District-level click — search the index by name
      setPlaceLoading(true)
      setPanelPlace(null)
      fetch(`${API_BASE}/api/places`)
        .then(r => r.json() as Promise<{ places: { cadaster_id: string; name_en: string; name_ar: string }[] }>)
        .then(data => {
          const nameL = info.nameEn.toLowerCase()
          const match = (data.places ?? []).find(p =>
            p.name_en.toLowerCase() === nameL ||
            p.name_en.toLowerCase().includes(nameL) ||
            nameL.includes(p.name_en.toLowerCase())
          )
          if (match) {
            return fetch(`${API_BASE}/api/place/${encodeURIComponent(match.cadaster_id)}`)
              .then(r => r.json() as Promise<import('./types').ApiPlaceResponse>)
              .then(placeData => {
                const converted = convertApiPlace(placeData, { ...info, cadasterId: match.cadaster_id })
                if (converted.interviews.length > 0 || converted.photos.length > 0) {
                  setPanelPlace(converted)
                }
              })
          }
        })
        .catch(err => console.warn('[app] district place lookup failed', err))
        .finally(() => setPlaceLoading(false))
    }
  }, [])

  const handlePhotoZoom = useCallback((lat: number, lng: number) => {
    mapRef.current?.flyTo(lat, lng)
  }, [])

  const handleDeleteMemory = useCallback(async (filePath: string, type: 'interview' | 'photo') => {
    try {
      const resp = await fetch(`${API_BASE}/api/memory`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath }),
      })
      if (!resp.ok) throw new Error(`Server error ${resp.status}`)
      // Remove from local state immediately
      setPanelPlace(prev => {
        if (!prev) return prev
        return {
          ...prev,
          interviews: type === 'interview'
            ? prev.interviews.filter(iv => iv.filePath !== filePath)
            : prev.interviews,
          photos: type === 'photo'
            ? prev.photos.filter(ph => ph.filePath !== filePath)
            : prev.photos,
        }
      })
    } catch (err) {
      console.error('[app] delete failed', err)
    }
  }, [])

  const handleClosePanel = useCallback(() => {
    setPanelInfo(null)
    setPanelPlace(null)
    setPlaceLoading(false)
    mapRef.current?.clearSelection()
  }, [])

  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim()) return
    setSearchQuery(q)
    setSearchResults(null)
    setSearchLoading(true)
    setPanelInfo(null)
    try {
      const resp = await fetch(`${API_BASE}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      })
      const data = await resp.json()
      const photos: SearchPhoto[] = (data.photos ?? []).map((p: Record<string, unknown>, i: number) => ({
        id: (p.id as string) ?? `ph-${i}`,
        placeId: (p.cadaster_id as string) ?? '',
        placeNameEn: (p.cadaster as string) ?? (p.inferred_locality as string) ?? '',
        placeNameAr: '',
        icon: '📷',
        description: (p.description as string) ?? '',
        year: (p.era_estimate as string) ?? '',
        contributor: (p.contributor as string) ?? 'Anonymous',
        tagsEn: (p.tags_en as string[]) ?? [],
        tagsAr: (p.tags_ar as string[]) ?? [],
        imageUrl: p.image_url ? `${API_BASE}${p.image_url}` : undefined,
        lat: p.lat as number | undefined,
        lng: p.lng as number | undefined,
      }))
      const moments: SearchMoment[] = (data.interview_moments ?? []).map((m: Record<string, unknown>, i: number) => {
        const ts = m.timestamp as [number, number] | null
        return {
          interviewId: (m.id as string) ?? `iv-${i}`,
          interviewTitle: `Interview from ${(m.cadaster as string) ?? '—'}`,
          placeId: (m.cadaster_id as string) ?? '',
          placeNameEn: (m.cadaster as string) ?? '',
          placeNameAr: '',
          start: ts?.[0] ?? 0,
          end: ts?.[1] ?? 0,
          ar: (m.snippet_ar as string) ?? '',
          en: (m.snippet as string) ?? '',
          themes: (m.themes as string[]) ?? [],
        }
      })
      setSearchResults({ query: q, photos, moments })
    } catch (err) {
      console.warn('[search] failed', err)
      setSearchResults({ query: q, photos: [], moments: [] })
    } finally {
      setSearchLoading(false)
    }
  }, [])

  const handleSearchResultClick = useCallback((result: SearchPhoto | SearchMoment, type: 'photo' | 'moment') => {
    if (type === 'photo') {
      const photo = result as SearchPhoto
      if (photo.lat && photo.lng) {
        mapRef.current?.flyTo(photo.lat, photo.lng)
      }
    }
    handlePlaceClick({
      nameEn: result.placeNameEn,
      nameAr: result.placeNameAr,
      gov: '',
      cadasterId: result.placeId || undefined,
    })
  }, [handlePlaceClick])

  const handleArchiveSelect = useCallback((info: PlaceClickInfo) => {
    handlePlaceClick(info)
  }, [handlePlaceClick])

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
          <SearchBar onSearch={handleSearch} loading={searchLoading} />
          <button className="topbar-contribute" onClick={() => setContributeOpen(true)}>
            + Contribute
          </button>
        </header>

        <div className="map-wrap">
          <ArchiveSidebar
            onSelect={handleArchiveSelect}
            onZoom={(lat, lng) => mapRef.current?.flyTo(lat, lng)}
            refreshKey={uploadRefreshKey}
          />

          <div className="map-area">
            <MapView ref={mapRef} onPlaceClick={handlePlaceClick} />

            <SidePanel
              info={panelInfo}
              place={panelPlace}
              loading={placeLoading}
              onClose={handleClosePanel}
              onDelete={handleDeleteMemory}
              onPhotoZoom={handlePhotoZoom}
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

      <ContributeModal open={contributeOpen} onClose={() => setContributeOpen(false)} onSuccess={handleUploadSuccess} />
    </>
  )
}

function SearchBar({ onSearch, loading }: { onSearch: (q: string) => void; loading?: boolean }) {
  const [value, setValue] = useState('')
  const submit = () => { if (value.trim() && !loading) onSearch(value.trim()) }
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
      <button onClick={submit} disabled={loading} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {loading
          ? <span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
          : '→'}
      </button>
    </div>
  )
}
