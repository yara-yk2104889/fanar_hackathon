import { useCallback, useRef, useState } from 'react'
import Landing from './components/Landing'
import MapView, { type MapViewHandle } from './components/MapView'
import SidePanel from './components/SidePanel'
import SearchOverlay from './components/SearchOverlay'
import ContributeModal from './components/ContributeModal'
import ArchiveSidebar from './components/ArchiveSidebar'
import { findPlaceByName, keywordSearch, PLACES } from './sampleData'
import type { PlaceClickInfo, PlaceData, SearchResults } from './types'

export default function App() {
  const [screen, setScreen] = useState<'landing' | 'map'>('landing')
  const [panelInfo, setPanelInfo] = useState<PlaceClickInfo | null>(null)
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null)
  const [contributeOpen, setContributeOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const mapRef = useRef<MapViewHandle>(null)

  const panelPlace: PlaceData | null = panelInfo ? findPlaceByName(panelInfo.nameEn) : null

  const handleEnter = useCallback(() => setScreen('map'), [])

  const handlePlaceClick = useCallback((info: PlaceClickInfo) => {
    setPanelInfo(info)
    setSearchResults(null)
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
    void type
  }, [])

  const handleArchiveSelect = useCallback((placeId: string) => {
    const place = PLACES[placeId]
    if (!place) return
    mapRef.current?.flyTo(place.lat, place.lng)
    setPanelInfo({ nameEn: place.nameEn, nameAr: place.nameAr, gov: place.gov })
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
          {/* Always-visible archive browser */}
          <ArchiveSidebar onSelect={handleArchiveSelect} />

          {/* Map + overlays in their own stacking context */}
          <div className="map-area">
            <MapView ref={mapRef} onPlaceClick={handlePlaceClick} />

            <SidePanel
              info={panelInfo}
              place={panelPlace}
              onClose={() => { setPanelInfo(null); mapRef.current?.clearSelection() }}
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
