import { useState } from 'react'
import type { Interview, Photo, PlaceClickInfo, PlaceData, Segment } from '../types'

interface Props {
  info: PlaceClickInfo | null
  place: PlaceData | null
  loading?: boolean
  onClose: () => void
  onDelete?: (filePath: string, type: 'interview' | 'photo') => void
}

export default function SidePanel({ info, place, loading, onClose, onDelete }: Props) {
  const [tab, setTab] = useState<'testimonies' | 'photos'>('testimonies')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const isOpen = info !== null

  const handleClose = () => {
    setExpandedId(null)
    onClose()
  }

  return (
    <div className={`side-panel${isOpen ? ' open' : ''}`}>
      <div className="panel-header">
        <div className="panel-place">
          <div className="ar" dir="rtl">{info?.nameAr ?? ''}</div>
          <div className="en">{info?.nameEn ?? ''}</div>
          {info?.gov && <div className="gov">{info.gov} Governorate</div>}
        </div>
        <button className="panel-close" onClick={handleClose}>×</button>
      </div>

      {loading ? (
        <div className="empty-state">
          <div style={{
            width: 32, height: 32,
            border: '3px solid var(--sage)',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 0.9s linear infinite',
            margin: '0 auto 0.8rem',
          }} />
          <p style={{ color: 'var(--muted)' }}>Loading memories…</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : !place ? (
        <div className="empty-state">
          <div className="icon">🗺</div>
          <h3>No memories yet</h3>
          <p>Be the first to contribute from {info?.nameEn}.</p>
        </div>
      ) : (
        <>
          <div className="panel-tabs">
            <button
              className={`panel-tab${tab === 'testimonies' ? ' active' : ''}`}
              onClick={() => setTab('testimonies')}
            >
              🎙 Testimonies ({place.interviews.length})
            </button>
            <button
              className={`panel-tab${tab === 'photos' ? ' active' : ''}`}
              onClick={() => setTab('photos')}
            >
              📷 Photos ({place.photos.length})
            </button>
          </div>

          <div className="panel-body">
            {tab === 'testimonies' && (
              <>
                {place.interviews.length === 0 ? (
                  <div className="empty-state">
                    <div className="icon">🎙</div>
                    <h3>No interviews yet</h3>
                  </div>
                ) : (
                  place.interviews.map((iv) => (
                    <InterviewCard
                      key={iv.id}
                      iv={iv}
                      expanded={expandedId === iv.id}
                      onToggle={() =>
                        setExpandedId(expandedId === iv.id ? null : iv.id)
                      }
                      onDelete={iv.filePath && onDelete
                        ? () => onDelete(iv.filePath!, 'interview')
                        : undefined}
                    />
                  ))
                )}
              </>
            )}

            {tab === 'photos' && (
              <div className="photo-grid">
                {place.photos.length === 0 ? (
                  <div className="empty-state">
                    <div className="icon">📷</div>
                    <h3>No photos yet</h3>
                  </div>
                ) : (
                  place.photos.map((ph) => (
                    <PhotoCard
                      key={ph.id}
                      ph={ph}
                      onDelete={ph.filePath && onDelete
                        ? () => onDelete(ph.filePath!, 'photo')
                        : undefined}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function DeleteBtn({ onDelete }: { onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false)
  if (confirming) {
    return (
      <span style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center' }}>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          style={{ background: '#c0392b', color: '#fff', border: 'none', borderRadius: 4, padding: '1px 7px', fontSize: '0.72rem', cursor: 'pointer' }}
        >Delete</button>
        <button
          onClick={(e) => { e.stopPropagation(); setConfirming(false) }}
          style={{ background: 'none', border: '1px solid var(--muted)', borderRadius: 4, padding: '1px 7px', fontSize: '0.72rem', cursor: 'pointer', color: 'var(--muted)' }}
        >Cancel</button>
      </span>
    )
  }
  return (
    <button
      onClick={(e) => { e.stopPropagation(); setConfirming(true) }}
      title="Delete this memory"
      style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.9rem', padding: '0 2px', lineHeight: 1 }}
    >🗑</button>
  )
}

function InterviewCard({
  iv,
  expanded,
  onToggle,
  onDelete,
}: {
  iv: Interview
  expanded: boolean
  onToggle: () => void
  onDelete?: () => void
}) {
  return (
    <div className={`interview-card${expanded ? ' expanded' : ''}`}>
      <div className="card-meta" onClick={!expanded ? onToggle : undefined} style={{ cursor: expanded ? 'default' : 'pointer' }}>
        <div className="titles">
          <div className="en">{iv.titleEn}</div>
          <div className="ar" dir="rtl">{iv.titleAr}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <div className="year">{iv.year}</div>
          {onDelete && <DeleteBtn onDelete={onDelete} />}
        </div>
      </div>

      {!expanded && (
        <div
          style={{ fontSize: '0.72rem', color: 'var(--sage)', marginTop: '0.4rem', cursor: 'pointer' }}
          onClick={onToggle}
        >
          {iv.contributor} · {iv.duration} ▼
        </div>
      )}

      {expanded && (
        <>
          <div style={{ fontSize: '0.72rem', color: 'var(--sage)', marginTop: '0.3rem', marginBottom: '0.5rem' }}>
            {iv.contributor} · {iv.duration}
            <button
              onClick={onToggle}
              style={{ float: 'right', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '0.9rem' }}
            >
              ▲
            </button>
          </div>

          {/* Video stub */}
          <div className="video-stub">
            <div className="play-btn">▶</div>
            <span className="dur">{iv.duration}</span>
            <span className="by">{iv.contributor}</span>
          </div>

          {/* AI summary */}
          <div className="ai-summary">
            <div className="ai-badge">AI Summary</div>
            <p className="en">{iv.summaryEn}</p>
            <p className="ar" dir="rtl">{iv.summaryAr}</p>
          </div>

          {/* Transcript segments */}
          {iv.segments.length > 0 && (
            <div style={{ marginTop: '0.85rem' }}>
              <div className="transcript-label">Transcript highlights</div>
              {iv.segments.map((seg, i) => (
                <SegmentRow key={i} seg={seg} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SegmentRow({ seg }: { seg: Segment }) {
  function fmtTime(sec: number) {
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
  }

  return (
    <div className="segment">
      <div className="segment-time">
        ▶ {fmtTime(seg.start)}
        <span className="themes">
          {seg.themes.map((t) => <span key={t} className="chip">{t}</span>)}
        </span>
      </div>
      <div className="segment-ar" dir="rtl">{seg.ar}</div>
      <div className="segment-en">{seg.en}</div>
    </div>
  )
}

function PhotoCard({ ph, onDelete }: { ph: Photo; onDelete?: () => void }) {
  return (
    <div className="photo-card">
      <div className="photo-thumb">{ph.icon}</div>
      <div className="photo-info">
        <div className="photo-caption">{ph.description}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="photo-year">{ph.year}</div>
          {onDelete && <DeleteBtn onDelete={onDelete} />}
        </div>
        <div className="photo-tags">
          {ph.tagsEn.slice(0, 3).map((t) => (
            <span key={t} className="chip">{t}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
