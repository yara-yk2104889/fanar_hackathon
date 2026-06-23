import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { PlaceClickInfo } from '../types'
import { PLACES } from '../sampleData'

export interface MapViewHandle {
  flyTo(lat: number, lng: number): void
  clearSelection(): void
}

interface Props {
  onPlaceClick: (info: PlaceClickInfo) => void
}

const WORLD: L.LatLngTuple[] = [
  [-90, -180], [-90, 180], [90, 180], [90, -180],
]
const LEBANON_CENTER: L.LatLngTuple = [33.85, 35.87]
const LEBANON_ZOOM = 8
const A3_ZOOM_THRESHOLD = 11

const A2_STYLE: L.PathOptions = {
  fillColor: '#7BA48C', fillOpacity: 0.25,
  color: '#2F5D50', weight: 1.8, opacity: 0.85,
}
const A2_HOVER: L.PathOptions = { fillOpacity: 0.45, weight: 2.5, color: '#1e3d35' }
const A2_SELECTED: L.PathOptions = {
  fillColor: '#2F5D50', fillOpacity: 0.42,
  color: '#1e3d35', weight: 3,
}
const A3_STYLE: L.PathOptions = {
  fillColor: '#A8B89A', fillOpacity: 0.3,
  color: '#5a8070', weight: 0.8, opacity: 0.7,
}
const A3_HOVER: L.PathOptions = { fillOpacity: 0.55, weight: 1.5, color: '#2F5D50' }

function geomCenter(geom: GeoJSON.Geometry): L.LatLngTuple | null {
  const ring =
    geom.type === 'Polygon' ? geom.coordinates[0]
    : geom.type === 'MultiPolygon' ? geom.coordinates[0][0]
    : null
  if (!ring) return null
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
  for (const [lng, lat] of ring) {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
  }
  return [(minLat + maxLat) / 2, (minLng + maxLng) / 2]
}

const MapView = forwardRef<MapViewHandle, Props>(function MapView({ onPlaceClick }, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const onClickRef = useRef(onPlaceClick)
  const a3LoadingRef = useRef(false)
  const a3LoadedRef = useRef(false)
  const selectedLayerRef = useRef<L.Path | null>(null)

  useEffect(() => { onClickRef.current = onPlaceClick }, [onPlaceClick])

  useImperativeHandle(ref, () => ({
    flyTo(lat: number, lng: number) {
      mapRef.current?.flyTo([lat, lng], 12, { duration: 1.2 })
    },
    clearSelection() {
      if (selectedLayerRef.current) {
        selectedLayerRef.current.setStyle(A2_STYLE)
        selectedLayerRef.current = null
      }
    },
  }))

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

    // Base tile: borders + geography, no labels (for surrounding countries)
    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
      { subdomains: 'abcd', maxZoom: 19, pane: 'tilePane' },
    ).addTo(map)

    // Custom panes
    const a2Pane           = map.createPane('a2Pane')
    const a3Pane           = map.createPane('a3Pane')
    const districtBorderPane = map.createPane('districtBorderPane')
    const maskPane         = map.createPane('maskPane')
    const labelPane        = map.createPane('labelPane')

    a2Pane.style.zIndex           = '400'
    a3Pane.style.zIndex           = '401'
    districtBorderPane.style.zIndex        = '402'
    districtBorderPane.style.pointerEvents = 'none'
    maskPane.style.zIndex         = '403'
    maskPane.style.pointerEvents  = 'none'
    labelPane.style.zIndex        = '404'
    labelPane.style.pointerEvents = 'none'

    a2Pane.style.transition = 'opacity 0.55s ease'
    a3Pane.style.transition = 'opacity 0.55s ease'
    a3Pane.style.opacity    = '0'

    // Hardcoded country-name-only labels for neighbouring countries (above the mask)
    const NEIGHBOR_LABELS = [
      { name: 'SYRIA',      lat: 34.5,  lng: 37.8 },
      { name: 'PALESTINE',  lat: 31.45, lng: 34.75 },
      { name: 'JORDAN',     lat: 31.5,  lng: 36.5  },
      { name: 'CYPRUS',     lat: 35.0,  lng: 33.1  },
      { name: 'TURKEY',     lat: 38.5,  lng: 36.0  },
      { name: 'EGYPT',      lat: 28.5,  lng: 29.5  },
    ]
    NEIGHBOR_LABELS.forEach(({ name, lat, lng }) => {
      L.marker([lat, lng] as L.LatLngTuple, {
        icon: L.divIcon({
          className: 'country-label',
          html: name,
          iconSize: [110, 18],
          iconAnchor: [55, 9],
        }),
        interactive: false,
        pane: 'labelPane',
      } as L.MarkerOptions).addTo(map)
    })

    // Donut mask: semi-transparent fade over non-Lebanon, keeping borders visible
    fetch('/geojson/lbn_admin0.geojson')
      .then((r) => r.json())
      .then((gj: GeoJSON.FeatureCollection | GeoJSON.Feature) => {
        const feat = 'features' in gj ? gj.features[0] : gj
        if (!feat || feat.geometry.type !== 'Polygon') return
        const ring = (feat.geometry as GeoJSON.Polygon).coordinates[0].map(
          ([lng, lat]): L.LatLngTuple => [lat, lng],
        )
        // Translucent fade over surrounding countries (borders still visible through it)
        L.polygon([WORLD, ring], {
          pane: 'maskPane',
          fillColor: '#dce4e8',
          fillOpacity: 0.58,
          stroke: false,
          interactive: false,
        }).addTo(map)
        // Lebanon outline border
        L.polygon([ring], {
          pane: 'maskPane',
          fill: false,
          color: '#2F5D50',
          weight: 2.2,
          opacity: 0.9,
          interactive: false,
        }).addTo(map)
      })
      .catch((e) => console.warn('admin0 load error', e))

    // Admin2 districts
    fetch('/geojson/lbn_admin2.geojson')
      .then((r) => r.json())
      .then((gj: GeoJSON.FeatureCollection) => {
        // Persistent district outlines — never fades, sits above a3 fills
        L.geoJSON(gj, {
          pane: 'districtBorderPane',
          style: () => ({
            fill: false,
            color: '#2F5D50',
            weight: 1.1,
            opacity: 0.28,
            pane: 'districtBorderPane',
          }),
          interactive: false,
        }).addTo(map)

        // District fills + labels + interaction (fades when zoomed into villages)
        L.geoJSON(gj, {
          pane: 'a2Pane',
          style: () => ({ ...A2_STYLE, pane: 'a2Pane' }),
          onEachFeature(feature, flayer) {
            const p = feature.properties as Record<string, string>
            const nameEn = p['adm2_name'] ?? ''
            const nameAr = p['adm2_name1'] ?? ''
            const gov = p['adm1_name'] ?? ''
            const centerLat = parseFloat(p['center_lat'] ?? '0')
            const centerLon = parseFloat(p['center_lon'] ?? '0')

            const path = flayer as L.Path
            flayer.on('mouseover', () => {
              if (path !== selectedLayerRef.current) path.setStyle(A2_HOVER)
            })
            flayer.on('mouseout', () => {
              if (path !== selectedLayerRef.current) path.setStyle(A2_STYLE)
            })
            flayer.on('click', () => {
              if (selectedLayerRef.current && selectedLayerRef.current !== path) {
                selectedLayerRef.current.setStyle(A2_STYLE)
              }
              selectedLayerRef.current = path
              path.setStyle(A2_SELECTED)
              onClickRef.current({ nameEn, nameAr, gov })
              if (centerLat && centerLon) {
                // Fly to district at zoom 10 (just under admin3 threshold)
                map.flyTo([centerLat, centerLon], Math.max(map.getZoom(), 10), { duration: 0.8 })
              }
            })

            // Permanent district name label at centroid (fades with a2Pane)
            if (centerLat && centerLon) {
              L.marker([centerLat, centerLon] as L.LatLngTuple, {
                icon: L.divIcon({
                  className: 'district-label',
                  html: nameEn,
                  iconSize: [130, 20],
                  iconAnchor: [65, 10],
                }),
                interactive: false,
                pane: 'a2Pane',
              } as L.MarkerOptions).addTo(map)
            }
          },
        }).addTo(map)
      })
      .catch((e) => console.warn('admin2 load error', e))

    // Place dot markers (sample data)
    Object.entries(PLACES).forEach(([, place]) => {
      const dot = L.circleMarker([place.lat, place.lng] as L.LatLngTuple, {
        radius: 7,
        fillColor: '#C17C5B',
        fillOpacity: 0.9,
        color: '#fff',
        weight: 1.5,
      })
      dot.bindTooltip(
        `<div class="tooltip-en">${place.nameEn}</div><div class="tooltip-ar">${place.nameAr}</div>`,
        { className: 'map-tooltip', direction: 'top' },
      )
      dot.on('click', () => {
        onClickRef.current({ nameEn: place.nameEn, nameAr: place.nameAr, gov: place.gov })
        map.flyTo([place.lat, place.lng] as L.LatLngTuple, 12, { duration: 0.9 })
      })
      dot.addTo(map)
    })

    // Admin3 lazy-loaded on zoom >= 11
    const handleZoom = () => {
      const z = map.getZoom()
      if (z >= A3_ZOOM_THRESHOLD) {
        a2Pane.style.opacity = '0.3'
        a3Pane.style.opacity = '1'
        if (!a3LoadedRef.current && !a3LoadingRef.current) {
          a3LoadingRef.current = true
          fetch('/geojson/lbn_admin3.geojson')
            .then((r) => r.json())
            .then((gj: GeoJSON.FeatureCollection) => {
              L.geoJSON(gj, {
                pane: 'a3Pane',
                style: () => ({ ...A3_STYLE, pane: 'a3Pane' }),
                onEachFeature(feature, flayer) {
                  const p = feature.properties as Record<string, string>
                  const nameEn = p['adm3_name'] ?? ''
                  const nameAr = p['adm3_name1'] ?? ''
                  const gov = p['adm1_name'] ?? ''

                  const path = flayer as L.Path
                  flayer.on('mouseover', () => path.setStyle(A3_HOVER))
                  flayer.on('mouseout', () => path.setStyle(A3_STYLE))
                  flayer.on('click', () => {
                    onClickRef.current({ nameEn, nameAr, gov })
                  })

                  // Permanent village name label at polygon center
                  const center = geomCenter(feature.geometry)
                  if (center) {
                    L.marker(center, {
                      icon: L.divIcon({
                        className: 'village-label',
                        html: nameEn,
                        iconSize: [110, 16],
                        iconAnchor: [55, 8],
                      }),
                      interactive: false,
                      pane: 'a3Pane',
                    } as L.MarkerOptions).addTo(map)
                  }
                },
              }).addTo(map)
              a3LoadedRef.current = true
            })
            .catch((e) => {
              console.warn('admin3 load error', e)
              a3LoadingRef.current = false
            })
        }
      } else {
        a2Pane.style.opacity = '1'
        a3Pane.style.opacity = '0'
      }
    }

    map.on('zoomend', handleZoom)
    return () => {
      map.off('zoomend', handleZoom)
      map.remove()
      mapRef.current = null
    }
  }, [])

  return <div ref={containerRef} className="map-container" />
})

export default MapView
