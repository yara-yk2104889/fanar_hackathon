import { useEffect, useState } from 'react'
import { API_BASE } from '../config'
import type { PlaceClickInfo } from '../types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ApiPlace {
  cadaster_id: string
  name_en: string
  name_ar: string
  interview_count: number
  photo_count: number
  lat?: number
  lng?: number
}

interface ArchivePhoto {
  cadaster_id: string
  cadaster_name_en: string
  cadaster_name_ar: string
  lat?: number
  lng?: number
  description: string
  contributor_caption?: string
  tags_en: string[]
  tags_ar: string[]
}

interface ArchiveInterview {
  cadaster_id: string
  cadaster_name_en: string
  cadaster_name_ar: string
  lat?: number
  lng?: number
  claimed_village?: string
  claimed_year?: string
  contributor: string
  summary_en?: string
  themes: string[]
}

interface Props {
  onSelect: (info: PlaceClickInfo) => void
  onZoom?: (lat: number, lng: number) => void
  refreshKey?: number
}

// ── Color palette for location cards ─────────────────────────────────────────

const PALETTE = [
  { bg: '#E6EFE9', border: '#7BA48C' },
  { bg: '#F2EAE3', border: '#C17C5B' },
  { bg: '#E8EEF4', border: '#6B8CAE' },
  { bg: '#EFE9F4', border: '#9B8EA3' },
  { bg: '#F4EFE3', border: '#B8956A' },
  { bg: '#E3F0EC', border: '#5A9A84' },
  { bg: '#F0EDE5', border: '#8B7355' },
  { bg: '#E8F0E6', border: '#6A8C5A' },
]

function placeColor(index: number) {
  return PALETTE[index % PALETTE.length]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate(str: string, max: number) {
  if (!str) return ''
  return str.length > max ? str.slice(0, max).trimEnd() + '…' : str
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LocationCard({
  place,
  index,
  onSelect,
  onZoom,
}: {
  place: ApiPlace
  index: number
  onSelect: (info: PlaceClickInfo) => void
  onZoom?: (lat: number, lng: number) => void
}) {
  const color = placeColor(index)
  const handleClick = () => {
    onSelect({ nameEn: place.name_en, nameAr: place.name_ar, gov: '', cadasterId: place.cadaster_id })
    if (place.lat && place.lng) onZoom?.(place.lat, place.lng)
  }
  return (
    <div
      className="arc-location-card"
      style={{ background: color.bg, borderLeftColor: color.border }}
      onClick={handleClick}
    >
      {place.name_ar && (
        <div className="arc-ar" dir="rtl" style={{ fontSize: '1.2rem', marginBottom: '0.1rem' }}>
          {place.name_ar}
        </div>
      )}
      <div className="arc-en" style={{ fontWeight: 600 }}>{place.name_en}</div>
      <div className="arc-counts" style={{ marginTop: '0.35rem' }}>
        {place.interview_count > 0 && (
          <span>🎙 {place.interview_count} interview{place.interview_count !== 1 ? 's' : ''}</span>
        )}
        {place.photo_count > 0 && (
          <span>📷 {place.photo_count} photo{place.photo_count !== 1 ? 's' : ''}</span>
        )}
      </div>
    </div>
  )
}

function PhotoRow({
  photo,
  onSelect,
  onZoom,
}: {
  photo: ArchivePhoto
  onSelect: (info: PlaceClickInfo) => void
  onZoom?: (lat: number, lng: number) => void
}) {
  const title = truncate(photo.contributor_caption || photo.description, 60)
  const tags = photo.tags_en.slice(0, 3)

  const handleClick = () => {
    onSelect({ nameEn: photo.cadaster_name_en, nameAr: photo.cadaster_name_ar, gov: '', cadasterId: photo.cadaster_id })
    if (photo.lat && photo.lng) onZoom?.(photo.lat, photo.lng)
  }

  return (
    <div className="arc-item" onClick={handleClick}>
      <div className="arc-desc">{title}</div>
      <div className="arc-row-meta">
        <span className="arc-place-tag">📍 {photo.cadaster_name_en}</span>
        {tags.map(t => <span key={t} className="arc-hashtag">#{t}</span>)}
      </div>
    </div>
  )
}

function InterviewRow({
  interview,
  onSelect,
  onZoom,
}: {
  interview: ArchiveInterview
  onSelect: (info: PlaceClickInfo) => void
  onZoom?: (lat: number, lng: number) => void
}) {
  const village = interview.claimed_village || interview.cadaster_name_en
  const title = truncate(interview.summary_en || `Memory from ${village}`, 60)
  const themes = interview.themes.slice(0, 3)

  const handleClick = () => {
    onSelect({ nameEn: interview.cadaster_name_en, nameAr: interview.cadaster_name_ar, gov: '', cadasterId: interview.cadaster_id })
    if (interview.lat && interview.lng) onZoom?.(interview.lat, interview.lng)
  }

  return (
    <div className="arc-item" onClick={handleClick}>
      <div className="arc-desc">{title}</div>
      <div className="arc-row-meta">
        <span className="arc-place-tag">📍 {interview.cadaster_name_en}</span>
        {themes.map(t => <span key={t} className="arc-hashtag">#{t}</span>)}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type Tab = 'locations' | 'photos' | 'videos'

export default function ArchiveSidebar({ onSelect, onZoom, refreshKey }: Props) {
  const [places, setPlaces]     = useState<ApiPlace[]>([])
  const [photos, setPhotos]     = useState<ArchivePhoto[]>([])
  const [interviews, setInterviews] = useState<ArchiveInterview[]>([])
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState<Tab>('locations')

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`${API_BASE}/api/places`).then(r => r.json()),
      fetch(`${API_BASE}/api/archive`).then(r => r.json()),
    ])
      .then(([placesData, archiveData]) => {
        setPlaces(placesData.places ?? [])
        setPhotos(archiveData.photos ?? [])
        setInterviews(archiveData.interviews ?? [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [refreshKey])

  const totalInterviews = places.reduce((n, p) => n + p.interview_count, 0)
  const totalPhotos     = places.reduce((n, p) => n + p.photo_count, 0)

  return (
    <div className="archive-sidebar">
      <div className="archive-header">
        <div className="archive-title">
          <span className="ar">الأرشيف</span>
          <span className="sep">·</span>
          <span className="en">Archive</span>
        </div>
      </div>

      <div className="archive-tabs">
        <button
          className={`archive-tab${tab === 'locations' ? ' active' : ''}`}
          onClick={() => setTab('locations')}
        >
          📍 {places.length} Locations
        </button>
        <button
          className={`archive-tab${tab === 'photos' ? ' active' : ''}`}
          onClick={() => setTab('photos')}
        >
          📷 {totalPhotos} Photos
        </button>
        <button
          className={`archive-tab${tab === 'videos' ? ' active' : ''}`}
          onClick={() => setTab('videos')}
        >
          🎙 {totalInterviews} Videos
        </button>
      </div>

      <div className="archive-list">
        {loading && (
          <div className="empty-state" style={{ padding: '1.5rem 0' }}>
            <p style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>Loading archive…</p>
          </div>
        )}

        {!loading && tab === 'locations' && (
          places.length === 0 ? (
            <div className="empty-state" style={{ padding: '1.5rem 0' }}>
              <div className="icon" style={{ fontSize: '1.6rem' }}>🗺</div>
              <p style={{ color: 'var(--muted)', fontSize: '0.82rem', marginTop: '0.5rem' }}>
                No memories yet.<br />Be the first to contribute!
              </p>
            </div>
          ) : (
            <div style={{ padding: '0.4rem 0' }}>
              {places.map((place, i) => (
                <LocationCard
                  key={place.cadaster_id}
                  place={place}
                  index={i}
                  onSelect={onSelect}
                  onZoom={onZoom}
                />
              ))}
            </div>
          )
        )}

        {!loading && tab === 'photos' && (
          photos.length === 0 ? (
            <div className="empty-state" style={{ padding: '1.5rem 0' }}>
              <div className="icon" style={{ fontSize: '1.6rem' }}>📷</div>
              <p style={{ color: 'var(--muted)', fontSize: '0.82rem', marginTop: '0.5rem' }}>No photos yet.</p>
            </div>
          ) : (
            photos.map((ph, i) => (
              <PhotoRow key={i} photo={ph} onSelect={onSelect} onZoom={onZoom} />
            ))
          )
        )}

        {!loading && tab === 'videos' && (
          interviews.length === 0 ? (
            <div className="empty-state" style={{ padding: '1.5rem 0' }}>
              <div className="icon" style={{ fontSize: '1.6rem' }}>🎙</div>
              <p style={{ color: 'var(--muted)', fontSize: '0.82rem', marginTop: '0.5rem' }}>No interviews yet.</p>
            </div>
          ) : (
            interviews.map((iv, i) => (
              <InterviewRow key={i} interview={iv} onSelect={onSelect} onZoom={onZoom} />
            ))
          )
        )}
      </div>
    </div>
  )
}
