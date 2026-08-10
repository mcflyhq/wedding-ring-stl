import * as THREE from 'three'
import type { RingParams } from './types'

/**
 * Circumferential segments. Kept bounded so the browser stays responsive.
 * High ≈ 0.08 mm and Extra ≈ 0.06 mm inner-wall edges on a US-7 ring.
 */
function qualitySegments(quality: RingParams['quality']): number {
  switch (quality) {
    case 'draft':
      return 180
    case 'high':
      return 640
    case 'extra':
      return 960
    default:
      return 360
  }
}

/** Axial samples along the flat inner wall (critical for date/tengwar engraving). */
function innerWallSteps(quality: RingParams['quality'], width: number): number {
  switch (quality) {
    case 'draft':
      return Math.max(24, Math.ceil(width * 12))
    case 'high':
    case 'extra':
      return Math.max(48, Math.ceil(width * 22))
    default:
      return Math.max(36, Math.ceil(width * 16))
  }
}

/**
 * Domed (D-shape) wedding-band cross-section for LatheGeometry.
 * x = radius, y = height along finger axis.
 *
 * Winding is critical for CSG: walk so the **metal** lies to the left of the
 * path (CCW around the solid). Wrong winding inverts the solid and makes
 * date boolean engraving carve the void instead of the band.
 */
function buildDomedProfile(
  innerR: number,
  thickness: number,
  width: number,
  quality: RingParams['quality'],
): THREE.Vector2[] {
  const halfW = width / 2
  const points: THREE.Vector2[] = []

  // Outer semi-ellipse bottom → top (ang -π/2 → +π/2)
  const arcSteps = Math.max(
    48,
    Math.ceil(
      Math.PI *
        Math.max(thickness, halfW) *
        (quality === 'high' || quality === 'extra' ? 20 : 12),
    ),
  )
  for (let i = 0; i <= arcSteps; i++) {
    const t = i / arcSteps
    const ang = -Math.PI / 2 + t * Math.PI
    const x = innerR + thickness * Math.cos(ang)
    const y = halfW * Math.sin(ang)
    points.push(new THREE.Vector2(Math.max(x, 1e-4), y))
  }

  // Dense flat inner wall (top → bottom) so metal stays to the left of travel
  const steps = innerWallSteps(quality, width)
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    points.push(new THREE.Vector2(innerR, halfW - t * width))
  }

  return points
}

export function createRingGeometry(params: RingParams): THREE.BufferGeometry {
  const innerR = params.innerDiameterMm / 2
  const radial = qualitySegments(params.quality)

  const profile = buildDomedProfile(
    innerR,
    params.bandThicknessMm,
    params.bandWidthMm,
    params.quality,
  )

  for (const p of profile) {
    if (p.x < 1e-4) p.x = 1e-4
  }

  const geometry = new THREE.LatheGeometry(profile, radial)
  geometry.rotateX(Math.PI / 2)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * Outer D-profile (semi-ellipse): r = innerR + thickness·cosφ, z = halfW·sinφ.
 * Returns surface radius and unit outward normal in the (radial, axial) plane.
 */
export function outerDomeFrame(
  z: number,
  innerR: number,
  thickness: number,
  halfW: number,
): { r: number; ur: number; uz: number } {
  const hw = Math.max(halfW, 1e-6)
  const th = Math.max(thickness, 1e-6)
  const s = Math.max(-1, Math.min(1, z / hw)) // sinφ
  const cosφ = Math.sqrt(Math.max(0, 1 - s * s))
  const r = innerR + th * cosφ
  // Gradient of ellipse → outward normal ∝ (cosφ/th, sinφ/hw)
  const nr = cosφ / th
  const nz = s / hw
  const nlen = Math.hypot(nr, nz) || 1
  return { r, ur: nr / nlen, uz: nz / nlen }
}
