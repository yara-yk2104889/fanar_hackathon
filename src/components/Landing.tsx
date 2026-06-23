interface LandingProps {
  screen: 'landing' | 'map'
  onEnter: () => void
}

export default function Landing({ screen, onEnter }: LandingProps) {
  if (screen === 'map') return null
  return (
    <div className="landing">
      <div className="landing-inner">
        <div className="landing-title">
          <div className="landing-ar">ذاكرة</div>
          <div className="landing-en">Dhākira</div>
        </div>
        <div className="landing-tagline">
          <span className="ar">قبل أن تُنسى، نحفظها على الخريطة</span>
          <span className="en">Before memory fades — we keep it on the map</span>
        </div>
        <button className="landing-btn" onClick={onEnter}>
          Enter the Archive
        </button>
        <div className="landing-hint">
          <span className="arrow">↓</span>
          <span>Lebanese oral history, geolocated</span>
        </div>
      </div>
    </div>
  )
}
