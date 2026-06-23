import { useState } from 'react'

interface Props {
  open: boolean
  onClose: () => void
}

export default function ContributeModal({ open, onClose }: Props) {
  const [utype, setUtype] = useState<'video' | 'photo'>('video')

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose()
  }

  // TODO: wire handleSubmit to POST /api/upload → pipeline.py (video) or photo_agents.py (photo)
  const handleSubmit = () => {
    alert(
      `TODO: POST to /api/upload\nPipeline: ${utype === 'photo' ? 'photo_agents.py' : 'pipeline.py'}`,
    )
  }

  return (
    <div className={`modal-backdrop${open ? ' open' : ''}`} onClick={handleBackdrop}>
      <div className="modal-box">
        <div className="modal-header">
          <div>
            <div className="ar">شارك في الذاكرة</div>
            <div className="en">Share a Memory</div>
          </div>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>

        <p className="modal-sub">
          Your contribution will be transcribed, translated, and geolocated by our AI
          pipeline, then placed on the living map.
          <span className="ar" dir="rtl">
            مساهمتك ستُضاف إلى الخريطة بعد المعالجة الآلية.
          </span>
        </p>

        <div className="upload-tabs">
          <button
            className={`upload-tab${utype === 'video' ? ' active' : ''}`}
            onClick={() => setUtype('video')}
          >
            🎙 Interview / Video
          </button>
          <button
            className={`upload-tab${utype === 'photo' ? ' active' : ''}`}
            onClick={() => setUtype('photo')}
          >
            📷 Photo
          </button>
        </div>

        <div className="upload-area">
          <div className="icon">{utype === 'photo' ? '📷' : '🎙'}</div>
          <div className="text">Click to upload or drag &amp; drop</div>
          <div className="types">
            {utype === 'photo'
              ? 'JPG, PNG, HEIC — max 50 MB'
              : 'MP4, MOV, MP3, M4A — max 200 MB'}
          </div>
        </div>

        <div className="form-field">
          <label className="form-label">
            <span className="ar">الاسم</span> Contributor name{' '}
            <small style={{ color: 'var(--muted)' }}>(optional)</small>
          </label>
          <input className="form-input" type="text" placeholder="Your name or 'Anonymous'" />
        </div>

        <div className="form-field">
          <label className="form-label">
            <span className="ar">القرية</span> Village / Town
          </label>
          <input
            className="form-input"
            type="text"
            placeholder="e.g. Bint Jbeil, Tyre, Nabatieh…"
          />
        </div>

        <div className="form-field">
          <label className="form-label">
            <span className="ar">السنة</span> Approximate year{' '}
            <small style={{ color: 'var(--muted)' }}>(optional)</small>
          </label>
          <input
            className="form-input"
            type="number"
            placeholder="e.g. 1975"
            min={1900}
            max={2030}
          />
        </div>

        {utype === 'photo' && (
          <div className="form-field">
            <label className="form-label">
              <span className="ar">وصف</span> Caption{' '}
              <small style={{ color: 'var(--muted)' }}>(optional)</small>
            </label>
            <textarea
              className="form-textarea"
              placeholder="Describe what's shown, when and where it was taken…"
            />
          </div>
        )}

        <button className="form-submit" onClick={handleSubmit}>
          Submit Memory
        </button>
        <p className="form-note">
          All uploads are reviewed before publication.
          <br />
          Your metadata is kept exactly as entered — AI never alters contributor data.
        </p>
      </div>
    </div>
  )
}
