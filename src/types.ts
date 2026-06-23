export interface Segment {
  start: number
  end: number
  ar: string
  en: string
  themes: string[]
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
}

export interface Photo {
  id: string
  icon: string
  description: string
  year: string
  contributor: string
  tagsEn: string[]
  tagsAr: string[]
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
