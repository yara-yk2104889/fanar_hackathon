import { useEffect, useRef, useState } from 'react'
import { API_BASE } from '../config'

interface Props {
  open: boolean
  onClose: () => void
}

type Stage = 'idle' | 'working' | 'success' | 'error'

const VIDEO_STEPS = [
  'Uploading your file…',
  'Transcribing Arabic audio…',
  'Translating & analysing…',
  'Routing to map location…',
]
const PHOTO_STEPS = [
  'Uploading your image…',
  'Describing image with AI…',
  'Locating & verifying…',
  'Tagging & routing…',
]
const STEP_DELAYS = [2000, 45000, 35000, 8000]

export default function ContributeModal({ open, onClose }: Props) {
  const [utype, setUtype]           = useState<'video' | 'photo'>('video')
  const [stage, setStage]           = useState<Stage>('idle')
  const [stepIndex, setStepIndex]   = useState(0)
  const [errorMsg, setErrorMsg]     = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl]   = useState<string | null>(null)
  const [isDragOver, setIsDragOver]   = useState(false)

  // Revoke the old object URL whenever it changes (avoid memory leak)
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }
  }, [previewUrl])

  const fileRef        = useRef<HTMLInputElement>(null)
  const contributorRef = useRef<HTMLInputElement>(null)
  const villageRef     = useRef<HTMLInputElement>(null)
  const yearRef        = useRef<HTMLInputElement>(null)
  const captionRef     = useRef<HTMLTextAreaElement>(null)
  const timerRef       = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopTimer = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }

  const startProgressTimer = (steps: string[]) => {
    let i = 0
    const advance = () => {
      i++
      if (i < steps.length) {
        setStepIndex(i)
        timerRef.current = setTimeout(advance, STEP_DELAYS[i] ?? 10000)
      }
    }
    timerRef.current = setTimeout(advance, STEP_DELAYS[0])
  }

  const resetForm = () => {
    setStage('idle')
    setStepIndex(0)
    setErrorMsg('')
    setSelectedFile(null)
    setPreviewUrl(null)
    stopTimer()
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleFileSelect = (file: File) => {
    setSelectedFile(file)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(file))
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFileSelect(f)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) handleFileSelect(f)
  }

  const switchType = (t: 'video' | 'photo') => {
    if (stage !== 'idle') return
    setUtype(t)
    setSelectedFile(null)
    setPreviewUrl(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && stage !== 'working') { resetForm(); onClose() }
  }

  const handleClose = () => {
    if (stage === 'working') return
    resetForm(); onClose()
  }

  const handleSubmit = async () => {
    if (stage === 'working') return
    if (!selectedFile) {
      setStage('error')
      setErrorMsg('Please select a file first.')
      return
    }

    const steps = utype === 'photo' ? PHOTO_STEPS : VIDEO_STEPS
    const endpoint = utype === 'photo'
      ? `${API_BASE}/api/contribute/photo`
      : `${API_BASE}/api/contribute/interview`

    const body = new FormData()
    if (utype === 'photo') {
      body.append('image', selectedFile)
      body.append('contributor', contributorRef.current?.value.trim() || 'Anonymous')
      body.append('claimed_village', villageRef.current?.value.trim() || '')
      body.append('caption', captionRef.current?.value.trim() || '')
      body.append('year', yearRef.current?.value.trim() || '')
    } else {
      body.append('file', selectedFile)
      body.append('contributor', contributorRef.current?.value.trim() || 'Anonymous')
      body.append('claimed_village', villageRef.current?.value.trim() || '')
      body.append('claimed_year', yearRef.current?.value.trim() || '')
    }

    setStage('working')
    setStepIndex(0)
    setErrorMsg('')
    startProgressTimer(steps)

    try {
      const resp = await fetch(endpoint, { method: 'POST', body })
      stopTimer()
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        throw new Error((data as { detail?: string }).detail ?? `Server error ${resp.status}`)
      }
      setStage('success')
    } catch (err: unknown) {
      stopTimer()
      setStage('error')
      const msg = err instanceof Error ? err.message : 'Something went wrong.'
      setErrorMsg(
        msg === 'Failed to fetch'
          ? 'Cannot reach the server. Run: uvicorn server:app --reload --port 8000'
          : msg
      )
    }
  }

  const steps = utype === 'photo' ? PHOTO_STEPS : VIDEO_STEPS
  const currentLabel = steps[stepIndex] ?? steps[0]

  const accept = utype === 'photo'
    ? 'image/jpeg,image/png,image/heic,image/heif,image/webp'
    : 'video/mp4,video/quicktime,audio/mpeg,audio/mp4,audio/x-m4a'

  return (
    <div className={`modal-backdrop${open ? ' open' : ''}`} onClick={handleBackdrop}>
      <div className="modal-box">
        <div className="modal-header">
          <div>
            <div className="ar">شارك في الذاكرة</div>
            <div className="en">Share a Memory</div>
          </div>
          {stage !== 'working' && (
            <button className="modal-close-btn" onClick={handleClose}>×</button>
          )}
        </div>

        {/* ── Success ──────────────────────────────────────── */}
        {stage === 'success' && (
          <div className="empty-state" style={{ padding: '2rem 0' }}>
            <div className="icon" style={{ fontSize: '2.5rem' }}>✓</div>
            <h3>Memory received!</h3>
            <p>Your contribution has been processed and will appear on the map once it passes our review.</p>
            <button className="form-submit" style={{ marginTop: '1.2rem' }}
              onClick={() => { resetForm(); onClose() }}>
              Close
            </button>
          </div>
        )}

        {/* ── Working ──────────────────────────────────────── */}
        {stage === 'working' && (
          <div className="empty-state" style={{ padding: '2rem 0' }}>
            <div style={{
              width: 36, height: 36,
              border: '3px solid var(--sage)', borderTopColor: 'transparent',
              borderRadius: '50%', animation: 'spin 0.9s linear infinite',
              margin: '0 auto 1rem',
            }} />
            <p style={{ color: 'var(--sage)', fontWeight: 500 }}>{currentLabel}</p>
            <p style={{ color: 'var(--muted)', fontSize: '0.78rem', marginTop: '0.4rem' }}>
              This can take up to 2 minutes — please keep this window open.
            </p>
          </div>
        )}

        {/* ── Form (idle / error) ───────────────────────────── */}
        {(stage === 'idle' || stage === 'error') && (
          <>
            <p className="modal-sub">
              Your contribution will be transcribed, translated, and geolocated by our AI pipeline, then placed on the living map.
              <span className="ar" dir="rtl"> مساهمتك ستُضاف إلى الخريطة بعد المعالجة الآلية.</span>
            </p>

            <div className="upload-tabs">
              <button className={`upload-tab${utype === 'video' ? ' active' : ''}`} onClick={() => switchType('video')}>
                🎙 Interview / Video
              </button>
              <button className={`upload-tab${utype === 'photo' ? ' active' : ''}`} onClick={() => switchType('photo')}>
                📷 Photo
              </button>
            </div>

            {/* Hidden file input — triggered explicitly */}
            <input
              ref={fileRef}
              type="file"
              accept={accept}
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />

            {/* Click-to-upload area */}
            <div
              className="upload-area"
              style={{
                cursor: 'pointer',
                borderColor: isDragOver ? 'var(--sage)' : undefined,
                background: isDragOver ? 'rgba(123,164,140,0.08)' : undefined,
              }}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
            >
              {selectedFile && previewUrl ? (
                <>
                  {selectedFile.type.startsWith('image/') && (
                    <img
                      src={previewUrl}
                      alt="preview"
                      style={{ maxHeight: 130, maxWidth: '100%', borderRadius: 8, objectFit: 'cover', marginBottom: '0.5rem' }}
                    />
                  )}
                  {selectedFile.type.startsWith('video/') && (
                    <video
                      src={previewUrl}
                      style={{ maxHeight: 130, maxWidth: '100%', borderRadius: 8, marginBottom: '0.5rem' }}
                      controls
                      preload="metadata"
                    />
                  )}
                  {selectedFile.type.startsWith('audio/') && (
                    <audio
                      src={previewUrl}
                      style={{ width: '100%', marginBottom: '0.5rem' }}
                      controls
                      preload="metadata"
                    />
                  )}
                  <div style={{ fontSize: '0.78rem', color: 'var(--sage)', fontWeight: 600 }}>
                    {selectedFile.name}
                  </div>
                  <div className="types">
                    {(selectedFile.size / 1024 / 1024).toFixed(1)} MB · Click to change file
                  </div>
                </>
              ) : (
                <>
                  <div className="icon">{utype === 'photo' ? '📷' : '🎙'}</div>
                  <div className="text">Click to upload or drag &amp; drop</div>
                  <div className="types">
                    {utype === 'photo' ? 'JPG, PNG, HEIC — max 50 MB' : 'MP4, MOV, MP3, M4A — max 200 MB'}
                  </div>
                </>
              )}
            </div>

            <div className="form-field">
              <label className="form-label">
                <span className="ar">الاسم</span> Contributor name{' '}
                <small style={{ color: 'var(--muted)' }}>(optional)</small>
              </label>
              <input ref={contributorRef} className="form-input" type="text" placeholder="Your name or 'Anonymous'" />
            </div>

            <div className="form-field">
              <label className="form-label">
                <span className="ar">القرية</span> Village / Town
              </label>
              <input ref={villageRef} className="form-input" type="text" placeholder="e.g. Bint Jbeil, Tyre, Nabatieh…" />
            </div>

            <div className="form-field">
              <label className="form-label">
                <span className="ar">السنة</span> Approximate year{' '}
                <small style={{ color: 'var(--muted)' }}>(optional)</small>
              </label>
              <input ref={yearRef} className="form-input" type="number" placeholder="e.g. 1975" min={1900} max={2030} />
            </div>

            {utype === 'photo' && (
              <div className="form-field">
                <label className="form-label">
                  <span className="ar">وصف</span> Caption{' '}
                  <small style={{ color: 'var(--muted)' }}>(optional)</small>
                </label>
                <textarea ref={captionRef} className="form-textarea"
                  placeholder="Describe what's shown, when and where it was taken…" />
              </div>
            )}

            {stage === 'error' && errorMsg && (
              <p style={{ color: '#c0392b', fontSize: '0.82rem', marginBottom: '0.5rem' }}>
                {errorMsg}
              </p>
            )}

            <button className="form-submit" onClick={handleSubmit}>
              Submit Memory
            </button>
            <p className="form-note">
              All uploads are reviewed before publication.<br />
              Your metadata is kept exactly as entered — AI never alters contributor data.
            </p>
          </>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
