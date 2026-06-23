import { useState } from 'react'
import { PLACES } from '../sampleData'

type Tab = 'locations' | 'videos' | 'photos'

interface Props {
  onSelect: (placeId: string) => void
}

function flatInterviews() {
  return Object.entries(PLACES).flatMap(([pid, place]) =>
    place.interviews.map((iv) => ({
      ...iv,
      placeId: pid,
      placeNameEn: place.nameEn,
      placeNameAr: place.nameAr,
    })),
  )
}

function flatPhotos() {
  return Object.entries(PLACES).flatMap(([pid, place]) =>
    place.photos.map((ph) => ({
      ...ph,
      placeId: pid,
      placeNameEn: place.nameEn,
      placeNameAr: place.nameAr,
    })),
  )
}

export default function ArchiveSidebar({ onSelect }: Props) {
  const [tab, setTab] = useState<Tab>('locations')

  const places = Object.entries(PLACES)
  const interviews = flatInterviews()
  const photos = flatPhotos()

  return (
    <div className="archive-sidebar">
      {/* Header */}
      <div className="archive-header">
        <div className="archive-title">
          <span className="ar">الأرشيف</span>
          <span className="sep">·</span>
          <span className="en">Archive</span>
        </div>
        <div className="archive-stats">
          <span className="stat-pill">{places.length} locations</span>
          <span className="stat-pill">{interviews.length} videos</span>
          <span className="stat-pill">{photos.length} photos</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="archive-tabs">
        <button
          className={`archive-tab${tab === 'locations' ? ' active' : ''}`}
          onClick={() => setTab('locations')}
        >
          📍 Locations
        </button>
        <button
          className={`archive-tab${tab === 'videos' ? ' active' : ''}`}
          onClick={() => setTab('videos')}
        >
          🎙 Videos
        </button>
        <button
          className={`archive-tab${tab === 'photos' ? ' active' : ''}`}
          onClick={() => setTab('photos')}
        >
          📷 Photos
        </button>
      </div>

      {/* Scrollable list */}
      <div className="archive-list">
        {tab === 'locations' &&
          places.map(([pid, place]) => (
            <div key={pid} className="arc-item" onClick={() => onSelect(pid)}>
              <div className="arc-names">
                <span className="arc-ar" dir="rtl">{place.nameAr}</span>
                <span className="arc-en">{place.nameEn}</span>
              </div>
              <div className="arc-gov">{place.gov}</div>
              <div className="arc-counts">
                <span>🎙 {place.interviews.length} interview{place.interviews.length !== 1 ? 's' : ''}</span>
                <span>📷 {place.photos.length} photo{place.photos.length !== 1 ? 's' : ''}</span>
              </div>
            </div>
          ))}

        {tab === 'videos' &&
          interviews.map((iv, i) => (
            <div key={i} className="arc-item" onClick={() => onSelect(iv.placeId)}>
              <div className="arc-place-tag">{iv.placeNameAr} · {iv.placeNameEn}</div>
              <div className="arc-names">
                <span className="arc-en">{iv.titleEn}</span>
                <span className="arc-ar" dir="rtl">{iv.titleAr}</span>
              </div>
              <div className="arc-meta">
                <span>{iv.contributor}</span>
                <span className="arc-dot">·</span>
                <span>{iv.year}</span>
                <span className="arc-dot">·</span>
                <span className="arc-dur">▶ {iv.duration}</span>
              </div>
            </div>
          ))}

        {tab === 'photos' &&
          photos.map((ph, i) => (
            <div key={i} className="arc-item arc-item--photo" onClick={() => onSelect(ph.placeId)}>
              <div className="arc-place-tag">{ph.placeNameAr} · {ph.placeNameEn}</div>
              <div className="arc-photo-row">
                <div className="arc-icon">{ph.icon}</div>
                <div>
                  <div className="arc-desc">{ph.description}</div>
                  <div className="arc-meta">
                    <span>{ph.year}</span>
                    <span className="arc-dot">·</span>
                    <span>{ph.contributor}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
      </div>
    </div>
  )
}
