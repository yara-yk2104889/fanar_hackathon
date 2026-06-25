import { useEffect, useState } from 'react'
import { API_BASE } from '../config'
import type { PlaceClickInfo } from '../types'

interface ApiPlace {
  cadaster_id: string
  name_en: string
  name_ar: string
  interview_count: number
  photo_count: number
}

interface Props {
  onSelect: (info: PlaceClickInfo) => void
}

export default function ArchiveSidebar({ onSelect }: Props) {
  const [places, setPlaces] = useState<ApiPlace[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API_BASE}/api/places`)
      .then(r => r.json() as Promise<{ places: ApiPlace[] }>)
      .then(data => setPlaces(data.places ?? []))
      .catch(() => setPlaces([]))
      .finally(() => setLoading(false))
  }, [])

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
        <div className="archive-stats">
          <span className="stat-pill">{places.length} locations</span>
          <span className="stat-pill">{totalInterviews} videos</span>
          <span className="stat-pill">{totalPhotos} photos</span>
        </div>
      </div>

      <div className="archive-list">
        {loading && (
          <div className="empty-state" style={{ padding: '1.5rem 0' }}>
            <p style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>Loading archive…</p>
          </div>
        )}

        {!loading && places.length === 0 && (
          <div className="empty-state" style={{ padding: '1.5rem 0' }}>
            <div className="icon" style={{ fontSize: '1.6rem' }}>🗺</div>
            <p style={{ color: 'var(--muted)', fontSize: '0.82rem', marginTop: '0.5rem' }}>
              No memories yet.<br />Be the first to contribute!
            </p>
          </div>
        )}

        {places.map(place => (
          <div
            key={place.cadaster_id}
            className="arc-item"
            onClick={() => onSelect({
              nameEn: place.name_en,
              nameAr: place.name_ar,
              gov: '',
              cadasterId: place.cadaster_id,
            })}
          >
            <div className="arc-names">
              {place.name_ar && <span className="arc-ar" dir="rtl">{place.name_ar}</span>}
              <span className="arc-en">{place.name_en}</span>
            </div>
            <div className="arc-counts">
              {place.interview_count > 0 && (
                <span>🎙 {place.interview_count} interview{place.interview_count !== 1 ? 's' : ''}</span>
              )}
              {place.photo_count > 0 && (
                <span>📷 {place.photo_count} photo{place.photo_count !== 1 ? 's' : ''}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
