import * as THREE from 'three'
import { createRingGeometry } from './ringGeometry'
import type { RingParams } from './types'

/** Max blank band meshes kept (each quality × size combo). */
const MAX_BAND_CACHE = 8

const bandCache = new Map<string, THREE.BufferGeometry>()
const bandOrder: string[] = []

/** Bump when lathe solid winding / topology / wave silhouette changes. */
const BAND_CACHE_VERSION = 8

function bandKey(params: RingParams): string {
  // Round lightly so tiny float noise from number inputs doesn't thrash cache
  const d = Math.round(params.innerDiameterMm * 100) / 100
  const w = Math.round(params.bandWidthMm * 100) / 100
  const t = Math.round(params.bandThicknessMm * 100) / 100
  if (params.bandProfile !== 'wave') {
    return `v${BAND_CACHE_VERSION}|d|${params.quality}|${d}|${w}|${t}`
  }
  const amp = Math.round(params.waveAmplitudeMm * 100) / 100
  const phase = Math.round(params.wavePhaseDeg * 10) / 10
  const top = Math.round(params.waveTopSpanDeg * 10) / 10
  const bot = Math.round(params.waveBotSpanDeg * 10) / 10
  const sharp = Math.round(params.waveSharpness * 100) / 100
  return `v${BAND_CACHE_VERSION}|wave|${params.quality}|${d}|${w}|${t}|${amp}|${phase}|${top}|${bot}|${sharp}`
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
