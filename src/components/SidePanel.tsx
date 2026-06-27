import { useState } from 'react'
import type { EvidenceEntry, Interview, Photo, PlaceClickInfo, PlaceData, Segment } from '../types'

interface Props {
  info: PlaceClickInfo | null
  place: PlaceData | null
  loading?: boolean
  onClose: () => void
  onDelete?: (filePath: string, type: 'interview' | 'photo') => void
  onPhotoZoom?: (lat: number, lng: number) => void
}

export default function SidePanel({ info, place, loading, onClose, onDelete, onPhotoZoom }: Props) {
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
                      onZoom={ph.lat && ph.lng && onPhotoZoom
                        ? () => onPhotoZoom(ph.lat!, ph.lng!)
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
          {iv.flagged && (
            <span title="Flagged by safety filter" style={{ color: '#e67e22', fontSize: '0.78rem', lineHeight: 1 }}>⚠</span>
          )}
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

          {/* Media player */}
          {iv.mediaUrl ? (
            /\.(mp3|m4a|aac|wav|ogg)$/i.test(iv.mediaUrl) ? (
              <audio
                controls
                src={iv.mediaUrl}
                style={{ width: '100%', marginBottom: '0.5rem', borderRadius: 6 }}
              />
            ) : (
              <video
                controls
                src={iv.mediaUrl}
                style={{ width: '100%', maxHeight: 220, borderRadius: 6, marginBottom: '0.5rem', background: '#000', display: 'block' }}
              />
            )
          ) : (
            <div className="video-stub" style={{ opacity: 0.45 }}>
              <div className="play-btn">▶</div>
              <span className="dur">{iv.duration}</span>
              <span className="by" style={{ fontStyle: 'italic' }}>media not stored</span>
            </div>
          )}

          {/* AI summary */}
          <div className="ai-summary">
            <div className="ai-badge">AI Summary</div>
            <p className="en">{iv.summaryEn}</p>
            <p className="ar" dir="rtl">{iv.summaryAr}</p>
          </div>

          {/* Verifiable sources */}
          <VerifiableSources evidence={iv.evidence} />

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

function VerifiableSources({ evidence }: { evidence?: EvidenceEntry[] }) {
  if (!evidence || evidence.length === 0) return null

  const links = evidence
    .filter(e => e.verdict === 'confirmed' || e.verdict === 'partially_supported')
    .flatMap(e => e.sources.filter(s => s.url))

  if (links.length === 0) return null

  return (
    <div style={{
      marginTop: '0.9rem',
      padding: '0.65rem 0.75rem',
      background: 'rgba(47, 93, 80, 0.05)',
      border: '1px solid rgba(47, 93, 80, 0.15)',
      borderRadius: 7,
    }}>
      <div style={{
        fontSize: '0.68rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.07em',
        color: 'var(--sage)',
        marginBottom: '0.45rem',
      }}>
        Verifiable Sources
      </div>
      {links.map((s, i) => (
        <a
          key={i}
          href={s.url!}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'block',
            fontSize: '0.8rem',
            color: 'var(--cedar, #5c2e0e)',
            textDecoration: 'none',
            marginBottom: i < links.length - 1 ? '0.25rem' : 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={s.url!}
        >
          ↗ {s.title || s.url}
        </a>
      ))}
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

function PhotoCard({ ph, onDelete, onZoom }: { ph: Photo; onDelete?: () => void; onZoom?: () => void }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* ── Card ──────────────────────────────────── */}
      <div
        className="photo-card"
        style={{ flexDirection: 'column', alignItems: 'stretch', cursor: 'pointer' }}
        onClick={() => { setOpen(true); onZoom?.() }}
      >
        <div style={{
          width: '100%', aspectRatio: '16/9', overflow: 'hidden',
          borderRadius: '6px 6px 0 0', background: '#e8ede9',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {ph.imageUrl
            ? <img src={ph.imageUrl} alt={ph.description} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ fontSize: '2rem', opacity: 0.4 }}>{ph.icon}</span>
          }
        </div>
        <div className="photo-info">
          <div className="photo-caption" style={{ WebkitLineClamp: 2, display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {ph.description}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <div className="photo-year">{ph.year}</div>
            {ph.flagged && (
              <span title="Flagged by safety filter" style={{ color: '#e67e22', fontSize: '0.78rem', lineHeight: 1 }}>⚠</span>
            )}
          </div>
          <div className="photo-tags">
            {ph.tagsEn.slice(0, 3).map(t => <span key={t} className="chip">{t}</span>)}
          </div>
        </div>
      </div>

      {/* ── Lightbox ──────────────────────────────── */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 2000,
            background: 'rgba(0,0,0,0.82)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1.5rem',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 12, overflow: 'hidden',
              maxWidth: 560, width: '100%', maxHeight: '90vh',
              display: 'flex', flexDirection: 'column',
            }}
          >
            {/* Image */}
            <div style={{ position: 'relative', background: '#111' }}>
              {ph.imageUrl
                ? <img src={ph.imageUrl} alt={ph.description} style={{ width: '100%', maxHeight: 340, objectFit: 'contain', display: 'block' }} />
                : <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '3rem', opacity: 0.3 }}>{ph.icon}</div>
              }
              <button
                onClick={() => setOpen(false)}
                style={{ position: 'absolute', top: 10, right: 12, background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', fontSize: '1.2rem', borderRadius: '50%', width: 30, height: 30, cursor: 'pointer', lineHeight: 1 }}
              >×</button>
            </div>

            {/* Details */}
            <div style={{ padding: '1.1rem 1.3rem', overflowY: 'auto' }}>
              <p style={{ margin: '0 0 0.7rem', fontSize: '0.9rem', lineHeight: 1.55, color: '#2a2a2a' }}>
                {ph.description}
              </p>

              {ph.contributor && (
                <p style={{ margin: '0 0 0.3rem', fontSize: '0.78rem', color: '#666' }}>
                  Contributed by <strong>{ph.contributor}</strong>{ph.year ? ` · ${ph.year}` : ''}
                </p>
              )}

              {ph.tagsEn.length > 0 && (
                <div style={{ marginTop: '0.7rem' }}>
                  <div style={{ fontSize: '0.7rem', color: '#999', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tags</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                    {ph.tagsEn.map(t => <span key={t} className="chip">{t}</span>)}
                  </div>
                </div>
              )}

              {ph.tagsAr.length > 0 && (
                <div style={{ marginTop: '0.5rem', direction: 'rtl' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                    {ph.tagsAr.map(t => <span key={t} className="chip">{t}</span>)}
                  </div>
                </div>
              )}

              {onDelete && (
                <div style={{ marginTop: '1rem' }} onClick={e => e.stopPropagation()}>
                  <DeleteBtn onDelete={() => { setOpen(false); onDelete() }} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
