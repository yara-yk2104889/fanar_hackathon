import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

interface Props {
  onBack: () => void
}

// ── Demo documentation-coverage scores ────────────────────────────────────────
// 0 = almost no online documentation (deep red) · 100 = richly documented (green).
// NOTE: prototype values only — these are placeholders for what a research agent
// would eventually measure (sources found per village, corroboration density…).
// Distribution is intentionally gap-heavy: the South, West Bekaa, Rachaya and
// Akkar read red; the Mount-Lebanon/coastal belt reads amber; only a couple of
// famously-documented cities (Beirut, Baalbek) approach green.
const COVERAGE: Record<string, number> = {
  // ── Green-ish: heavily documented cities (deliberately rare) ──
  'Beirut': 88,
  'Baalbek': 80,

  // ── Amber: moderately documented Mount-Lebanon / coastal / Bekaa belt ──
  'Jbeil': 66,
  'Kesrwane': 62,
  'El Meten': 60,
  'Tripoli': 60,
  'Baabda': 57,
  'Zahle': 56,
  'Aley': 54,
  'Chouf': 51,
  'El Batroun': 50,
  'Zgharta': 49,
  'Bcharre': 47,
  'El Koura': 45,

  // ── Orange: thinly documented ──
  'El Minieh-Dennie': 38,
  'Saida': 37,
  'El Hermel': 35,
  'Sour': 33,

  // ── Red: the documentation gaps (South villages, West Bekaa, Rachaya, Akkar) ──
  'El Nabatieh': 26,
  'West Bekaa': 27,
  'Rachaya': 25,
  'Hasbaya': 22,
  'Jezzine': 22,
  'Marjaayoun': 20,
  'Akkar': 19,
  'Bent Jbeil': 16,
}
const DEFAULT_COVERAGE = 40

const WORLD: L.LatLngTuple[] = [
  [-90, -180], [-90, 180], [90, 180], [90, -180],
]
const LEBANON_CENTER: L.LatLngTuple = [33.85, 35.87]
const LEBANON_ZOOM = 8
const A3_ZOOM_THRESHOLD = 11

// Deterministic per-village score: anchor on the parent district's band, then
// jitter by a hash of the village pcode so villages within a district vary a
// little (some greener pockets, some deeper gaps) without ever leaving the band.
function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 1000) / 1000 // 0..1
}
function villageScore(districtName: string, pcode: string): number {
  const base = COVERAGE[districtName] ?? DEFAULT_COVERAGE
  const jitter = (hashStr(pcode + districtName) - 0.5) * 22 // ±11
  return Math.max(4, Math.min(96, Math.round(base + jitter)))
}

function geomCenter(geom: GeoJSON.Geometry): L.LatLngTuple | null {
  const ring =
    geom.type === 'Polygon' ? geom.coordinates[0]
    : geom.type === 'MultiPolygon' ? geom.coordinates[0][0]
    : null
  if (!ring) return null
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
  for (const [lng, lat] of ring as number[][]) {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
  }
  return [(minLat + maxLat) / 2, (minLng + maxLng) / 2]
}

// ── 3-stop heat scale: red → amber → green, keyed to the project palette ───────
function mix(a: number[], b: number[], t: number): number[] {
  return [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t))
}
function coverageColor(score: number): string {
  const RED = [192, 57, 43]     // #C0392B
  const AMBER = [232, 176, 75]  // #E8B04B
  const GREEN = [78, 156, 109]  // #4E9C6D
  const t = Math.max(0, Math.min(100, score)) / 100
  const rgb = t < 0.5 ? mix(RED, AMBER, t / 0.5) : mix(AMBER, GREEN, (t - 0.5) / 0.5)
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
}
function coverageLabel(score: number): string {
  if (score >= 70) return 'Well documented'
  if (score >= 50) return 'Partially documented'
  if (score >= 32) return 'Thinly documented'
  return 'Documentation gap'
}

export default function GapMapPage({ onBack }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      center: LEBANON_CENTER,
      zoom: LEBANON_ZOOM,
      zoomControl: true,
      attributionControl: false,
      wheelPxPerZoomLevel: 80,
    })
    mapRef.current = map
    setTimeout(() => map.invalidateSize(), 120)

    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
      { subdomains: 'abcd', maxZoom: 19, pane: 'tilePane' },
    ).addTo(map)

    const heatPane = map.createPane('heatPane')   // admin2 district fills
    const heat3Pane = map.createPane('heat3Pane') // admin3 village fills
    const maskPane = map.createPane('maskPane')
    const labelPane = map.createPane('labelPane')
    heatPane.style.zIndex = '400'
    heat3Pane.style.zIndex = '401'
    maskPane.style.zIndex = '403'
    maskPane.style.pointerEvents = 'none'
    labelPane.style.zIndex = '404'
    labelPane.style.pointerEvents = 'none'

    heatPane.style.transition = 'opacity 0.55s ease'
    heat3Pane.style.transition = 'opacity 0.55s ease'
    heat3Pane.style.opacity = '0'

    const NEIGHBOR_LABELS = [
      { name: 'SYRIA', lat: 34.5, lng: 37.8 },
      { name: 'PALESTINE', lat: 31.45, lng: 34.75 },
      { name: 'JORDAN', lat: 31.5, lng: 36.5 },
      { name: 'CYPRUS', lat: 35.0, lng: 33.1 },
      { name: 'TURKEY', lat: 38.5, lng: 36.0 },
      { name: 'EGYPT', lat: 28.5, lng: 29.5 },
    ]
    NEIGHBOR_LABELS.forEach(({ name, lat, lng }) => {
      L.marker([lat, lng] as L.LatLngTuple, {
        icon: L.divIcon({ className: 'country-label', html: name, iconSize: [110, 18], iconAnchor: [55, 9] }),
        interactive: false,
        pane: 'labelPane',
      } as L.MarkerOptions).addTo(map)
    })

    // Donut mask over surrounding countries + Lebanon outline
    fetch('/geojson/lbn_admin0.geojson')
      .then(r => r.json())
      .then((gj: GeoJSON.FeatureCollection | GeoJSON.Feature) => {
        const feat = 'features' in gj ? gj.features[0] : gj
        if (!feat || feat.geometry.type !== 'Polygon') return
        const ring = (feat.geometry as GeoJSON.Polygon).coordinates[0].map(
          ([lng, lat]): L.LatLngTuple => [lat, lng],
        )
        L.polygon([WORLD, ring], {
          pane: 'maskPane', fillColor: '#dce4e8', fillOpacity: 0.58, stroke: false, interactive: false,
        }).addTo(map)
        L.polygon([ring], {
          pane: 'maskPane', fill: false, color: '#2F5D50', weight: 2.2, opacity: 0.9, interactive: false,
        }).addTo(map)
      })
      .catch(e => console.warn('admin0 load error', e))

    // Admin2 districts, filled by coverage score
    fetch('/geojson/lbn_admin2.geojson')
      .then(r => r.json())
      .then((gj: GeoJSON.FeatureCollection) => {
        L.geoJSON(gj, {
          pane: 'heatPane',
          style: (feature) => {
            const p = (feature?.properties ?? {}) as Record<string, string>
            const score = COVERAGE[p['adm2_name'] ?? ''] ?? DEFAULT_COVERAGE
            return {
              pane: 'heatPane',
              fillColor: coverageColor(score),
              fillOpacity: 0.62,
              color: '#ffffff',
              weight: 1.2,
              opacity: 0.85,
            }
          },
          onEachFeature(feature, flayer) {
            const p = feature.properties as Record<string, string>
            const nameEn = p['adm2_name'] ?? ''
            const nameAr = p['adm2_name1'] ?? ''
            const score = COVERAGE[nameEn] ?? DEFAULT_COVERAGE
            const centerLat = parseFloat(p['center_lat'] ?? '0')
            const centerLon = parseFloat(p['center_lon'] ?? '0')

            const path = flayer as L.Path
            flayer.on('mouseover', () => path.setStyle({ fillOpacity: 0.82, weight: 2 }))
            flayer.on('mouseout', () => path.setStyle({ fillOpacity: 0.62, weight: 1.2 }))

            flayer.bindTooltip(
              `<div class="tooltip-en">${nameEn}</div>` +
              `<div class="tooltip-ar">${nameAr}</div>` +
              `<div class="gap-tip-meta">${coverageLabel(score)} · ${score}%</div>`,
              { className: 'map-tooltip gap-tip', direction: 'top', sticky: true },
            )

            if (centerLat && centerLon) {
              L.marker([centerLat, centerLon] as L.LatLngTuple, {
                icon: L.divIcon({ className: 'district-label', html: nameEn, iconSize: [130, 20], iconAnchor: [65, 10] }),
                interactive: false,
                pane: 'labelPane',
              } as L.MarkerOptions).addTo(map)
            }
          },
        }).addTo(map)
      })
      .catch(e => console.warn('admin2 load error', e))

    // Admin3 villages — lazy-loaded once, on first zoom past the threshold
    let a3Loading = false
    let a3Loaded = false
    const handleZoom = () => {
      const z = map.getZoom()
      if (z >= A3_ZOOM_THRESHOLD) {
        heatPane.style.opacity = '0.25'
        heat3Pane.style.opacity = '1'
        if (a3Loaded || a3Loading) return
        a3Loading = true
        fetch('/geojson/lbn_admin3.geojson')
          .then(r => r.json())
          .then((gj: GeoJSON.FeatureCollection) => {
            L.geoJSON(gj, {
              pane: 'heat3Pane',
              style: (feature) => {
                const p = (feature?.properties ?? {}) as Record<string, string>
                const score = villageScore(p['adm2_name'] ?? '', p['adm3_pcode'] ?? p['adm3_name'] ?? '')
                return {
                  pane: 'heat3Pane',
                  fillColor: coverageColor(score),
                  fillOpacity: 0.66,
                  color: '#ffffff',
                  weight: 0.6,
                  opacity: 0.7,
                }
              },
              onEachFeature(feature, flayer) {
                const p = feature.properties as Record<string, string>
                const nameEn = p['adm3_name'] ?? ''
                const nameAr = p['adm3_name1'] ?? ''
                const district = p['adm2_name'] ?? ''
                if (nameEn === 'Conflict') return
                const score = villageScore(district, p['adm3_pcode'] ?? nameEn)

                const path = flayer as L.Path
                flayer.on('mouseover', () => path.setStyle({ fillOpacity: 0.85, weight: 1.4 }))
                flayer.on('mouseout', () => path.setStyle({ fillOpacity: 0.66, weight: 0.6 }))

                flayer.bindTooltip(
                  `<div class="tooltip-en">${nameEn}</div>` +
                  `<div class="tooltip-ar">${nameAr || district}</div>` +
                  `<div class="gap-tip-meta">${coverageLabel(score)} · ${score}%</div>`,
                  { className: 'map-tooltip gap-tip', direction: 'top', sticky: true },
                )

                const center = geomCenter(feature.geometry)
                if (center) {
                  L.marker(center, {
                    icon: L.divIcon({ className: 'village-label', html: nameEn, iconSize: [110, 16], iconAnchor: [55, 8] }),
                    interactive: false,
                    pane: 'labelPane',
                  } as L.MarkerOptions).addTo(map)
                }
              },
            }).addTo(map)
            a3Loaded = true
          })
          .catch(e => {
            console.warn('admin3 load error', e)
            a3Loading = false
          })
      } else {
        heatPane.style.opacity = '1'
        heat3Pane.style.opacity = '0'
      }
    }
    map.on('zoomend', handleZoom)

    return () => {
      map.off('zoomend', handleZoom)
      map.remove()
      mapRef.current = null
    }
  }, [])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-logo">
          <span className="ar">ذاكرة</span>
          <span className="dot">·</span>
          <span className="en">Dhākira</span>
        </div>
        <div className="gap-title">
          <span className="gap-title-en">Gap Map</span>
          <span className="gap-title-ar">خريطة الفجوة</span>
        </div>
        <button className="topbar-contribute" onClick={onBack} style={{ marginLeft: 'auto' }}>
          ← Back to Archive
        </button>
      </header>

      <div className="map-wrap">
        <div className="map-area">
          <div ref={containerRef} className="map-container" />

          {/* Intro / context card */}
          <div className="gap-intro">
            <h2>Where is Lebanon’s heritage under-documented?</h2>
            <p>
              A research agent sweeps the open web for each village and scores how much
              documentation exists. Red districts are the <strong>gaps</strong> — places where
              oral history is most at risk of being lost. <strong style={{ color: 'var(--cedar)' }}>Zoom in</strong> to
              break each district down to the village level. <em>Prototype values for demo.</em>
            </p>
          </div>

          {/* Heat legend */}
          <div className="gap-legend">
            <div className="gap-legend-title">Online documentation</div>
            <div className="gap-legend-bar" />
            <div className="gap-legend-scale">
              <span>Gap</span>
              <span>Thin</span>
              <span>Rich</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
