import * as THREE from 'three'
import { createRingGeometry } from './ringGeometry'
import type { RingParams } from './types'

/** Max blank band meshes kept (each quality × size combo). */
const MAX_BAND_CACHE = 8

const bandCache = new Map<string, THREE.BufferGeometry>()
const bandOrder: string[] = []

function bandKey(params: Pick<RingParams, 'quality' | 'innerDiameterMm' | 'bandWidthMm' | 'bandThicknessMm'>): string {
  // Round lightly so tiny float noise from number inputs doesn't thrash cache
  const d = Math.round(params.innerDiameterMm * 100) / 100
  const w = Math.round(params.bandWidthMm * 100) / 100
  const t = Math.round(params.bandThicknessMm * 100) / 100
  return `${params.quality}|${d}|${w}|${t}`
}

/**
 * Return a fresh clone of a cached blank lathe band.
 * Engraving mutates geometry, so callers must not share instances.
 */
export function getBlankBandGeometry(params: RingParams): THREE.BufferGeometry {
  const key = bandKey(params)
  let cached = bandCache.get(key)
  if (!cached) {
    cached = createRingGeometry(params)
    bandCache.set(key, cached)
    bandOrder.push(key)
    while (bandOrder.length > MAX_BAND_CACHE) {
      const old = bandOrder.shift()!
      const g = bandCache.get(old)
      if (g) {
        g.dispose()
        bandCache.delete(old)
      }
    }
  }
  return cached.clone()
}

export function clearBandCache(): void {
  for (const g of bandCache.values()) g.dispose()
  bandCache.clear()
  bandOrder.length = 0
}
