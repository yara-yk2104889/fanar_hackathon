import type { SearchResults } from '../types'

interface Props {
  results: SearchResults | null
  query: string
  onClose: () => void
  onResultClick: (placeId: string, type: 'photo' | 'moment') => void
}

function fmtTime(sec: number) {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
}

export default function SearchOverlay({ results, query, onClose, onResultClick }: Props) {
  const isOpen = results !== null
  const total = (results?.photos.length ?? 0) + (results?.moments.length ?? 0)

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className={`search-overlay${isOpen ? ' open' : ''}`} onClick={handleBackdrop}>
      <div className="search-box">
        <div className="search-header">
          <div className="search-title">
            {isOpen
              ? `"${query}" — ${total} result${total !== 1 ? 's' : ''}`
              : 'Search results'}
          </div>
          <button className="search-close" onClick={onClose}>×</button>
        </div>

        <div className="search-results">
          {!results || total === 0 ? (
            <div className="empty-state">
              <div className="icon">🔍</div>
              <h3>No results for "{query}"</h3>
              <p>Try another word — or browse the map.</p>
            </div>
          ) : (
            <>
              {results.moments.length > 0 && (
                <>
                  <div className="search-section">🎙 Interview Moments ({results.moments.length})</div>
                  {results.moments.map((m, i) => (
                    <div
                      key={i}
                      className="result-item"
                      onClick={() => onResultClick(m.placeId, 'moment')}
                    >
                      <div className="result-icon">🎙</div>
                      <div className="result-text">
                        <div className="result-place">{m.placeNameAr} · {m.placeNameEn}</div>
                        <div className="result-snippet">{m.en.slice(0, 140)}…</div>
                        <div className="result-chips">
                          {m.themes.slice(0, 3).map((t) => (
                            <span key={t} className="chip">{t}</span>
                          ))}
                          <span className="chip" style={{ color: 'var(--sage)' }}>
                            ▶ {fmtTime(m.start)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {results.photos.length > 0 && (
                <>
                  <div className="search-section" style={{ marginTop: results.moments.length ? '0.9rem' : '0' }}>
                    📷 Photos ({results.photos.length})
                  </div>
                  {results.photos.map((p) => (
                    <div
                      key={p.id}
                      className="result-item"
                      onClick={() => onResultClick(p.placeId, 'photo')}
                    >
                      <div className="result-icon">{p.icon}</div>
                      <div className="result-text">
                        <div className="result-place">{p.placeNameAr} · {p.placeNameEn}</div>
                        <div className="result-snippet">{p.description}</div>
                        <div className="result-chips">
                          {p.tagsEn.slice(0, 4).map((t) => (
                            <span key={t} className="chip">{t}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
