export interface Segment {
  start: number
  end: number
  ar: string
  en: string
  themes: string[]
}

export interface EvidenceSource {
  title: string
  url: string | null
}

export interface EvidenceEntry {
  claim_en: string
  claim_ar: string
  type: string
  verdict: 'confirmed' | 'partially_supported' | 'no_public_record' | 'contradicted'
  confidence: 'high' | 'medium' | 'low'
  source: string | null
  sources: EvidenceSource[]
  note: string
  possibly_sole_record?: boolean
}

export interface Interview {
  id: string
  contributor: string
  year: string
  titleEn: string
  titleAr: string
  duration: string
  summaryEn: string
  summaryAr: string
  segments: Segment[]
  filePath?: string
  mediaUrl?: string
  flagged?: boolean
  evidence?: EvidenceEntry[]
}

export interface Photo {
  id: string
  icon: string
  description: string
  year: string
  contributor: string
  tagsEn: string[]
  tagsAr: string[]
  filePath?: string
  imageUrl?: string
  lat?: number
  lng?: number
  flagged?: boolean
}

export interface PlaceData {
  nameEn: string
  nameAr: string
  gov: string
  lat: number
  lng: number
  /** Lowercase strings used to match against GeoJSON feature names */
  match: string[]
  interviews: Interview[]
  photos: Photo[]
}

/** Passed from MapView to App when user clicks a district or village */
export interface PlaceClickInfo {
  nameEn: string
  nameAr: string
  gov: string
  cadasterId?: string
}

// ── API response types (from server.py) ──────────────────────────────────────

export interface ApiSegment {
  start: number
  end: number
  arabic: string
  english: string
  themes: string[]
}

export interface ApiInterview {
  contributor?: string
  claimed_year?: string
  claimed_village?: string
  summary?: { summary_en?: string; summary_ar?: string }
  segments?: ApiSegment[]
  _file_path?: string
  media_url?: string
  flagged?: boolean
  evidence?: EvidenceEntry[]
}

export interface ApiPhoto {
  description?: string
  contributor_caption?: string
  contributor?: string
  claimed_year?: string
  era_estimate?: string
  tags_en?: string[]
  tags_ar?: string[]
  _file_path?: string
  image_url?: string
  lat?: number
  lng?: number
  flagged?: boolean
}

export interface ApiPlaceResponse {
  cadaster_id: string
  interviews: ApiInterview[]
  photos: ApiPhoto[]
}

export interface SearchPhoto extends Photo {
  placeId: string
  placeNameEn: string
  placeNameAr: string
}

export interface SearchMoment extends Segment {
  interviewId: string
  interviewTitle: string
  placeId: string
  placeNameEn: string
  placeNameAr: string
}

export interface SearchResults {
  query: string
  photos: SearchPhoto[]
  moments: SearchMoment[]
}
