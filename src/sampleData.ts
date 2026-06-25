import type { PlaceData } from './types'

export const PLACES: Record<string, PlaceData> = {}

export function findPlaceByName(_nameEn: string): PlaceData | null {
  return null
}

export function keywordSearch(query: string) {
  return { query, photos: [] as import('./types').SearchPhoto[], moments: [] as import('./types').SearchMoment[] }
}
