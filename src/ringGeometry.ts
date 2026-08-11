import * as THREE from 'three'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
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

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t))
}

/** Control point: u ∈ [0,1] within the pinch window, offset ∈ [-1,1]. */
type MotifPt = readonly [number, number]

/**
 * Localized pinch motif (u = 0…1 only inside the angular span).
 *
 * Zero-slope pads at both ends so the join to the flat band is C1-friendly.
 * Interior is a single S (crest → waist → trough) without extra spikes that
 * Catmull-Rom would overshoot into “bourrelets”.
 */
const PINCH_CENTERLINE: readonly MotifPt[] = [
  [0.0, 0.0],
  [0.06, 0.0], // zero-slope pad → flat band
  [0.14, 0.06],
  [0.22, 0.22],
  [0.3, 0.5],
  [0.36, 0.78],
  [0.42, 1.0], // crest
  [0.48, 0.55],
  [0.52, 0.05],
  [0.56, -0.4],
  [0.6, -0.72], // trough
  [0.68, -0.52],
  [0.78, -0.24],
  [0.88, -0.05],
  [0.94, 0.0], // zero-slope pad → flat band
  [1.0, 0.0],
]

/** Interior feature samples forced onto mesh columns (within the pinch span). */
const PINCH_FEATURE_US: readonly number[] = [0.06, 0.42, 0.52, 0.6, 0.94]

/** Piecewise-linear sample on a non-periodic [0,1] path (open motif). */
function evalPolylineOpen(u: number, pts: readonly MotifPt[]): number {
  const t = Math.min(1, Math.max(0, u))
  for (let i = 0; i < pts.length; i++) {
    if (Math.abs(pts[i]![0] - t) < 1e-9) return pts[i]![1]
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const [t0, y0] = pts[i]!
    const [t1, y1] = pts[i + 1]!
    if (t >= t0 && t <= t1) {
      const s = (t - t0) / Math.max(t1 - t0, 1e-12)
      return y0 + (y1 - y0) * s
    }
  }
  return pts[pts.length - 1]![1]
}

/**
 * Cubic Hermite between control points with finite-difference tangents,
 * **clamped to zero at the ends** so the pinch joins the flat band with no kink.
 * Tension in [0,1]: 1 = almost polyline (short tangents), 0 = fuller smooth S.
 */
function evalHermiteOpen(u: number, pts: readonly MotifPt[], tension: number): number {
  const t = Math.min(1, Math.max(0, u))
  const n = pts.length
  if (n < 2) return pts[0]?.[1] ?? 0
  if (t <= pts[0]![0]) return pts[0]![1]
  if (t >= pts[n - 1]![0]) return pts[n - 1]![1]

  let i = 0
  for (let k = 0; k < n - 1; k++) {
    if (t >= pts[k]![0] && t <= pts[k + 1]![0]) {
      i = k
      break
    }
  }

  const p1 = pts[i]!
  const p2 = pts[i + 1]!
  const t1 = p1[0]
  const t2 = p2[0]
  const dt = Math.max(t2 - t1, 1e-12)
  const s = (t - t1) / dt
  const s2 = s * s
  const s3 = s2 * s

  // Finite-difference tangents in value/parameter space, scaled by segment length
  const yPrev = pts[Math.max(0, i - 1)]![1]
  const y1 = p1[1]
  const y2 = p2[1]
  const yNext = pts[Math.min(n - 1, i + 2)]![1]
  const tPrev = pts[Math.max(0, i - 1)]![0]
  const tNext = pts[Math.min(n - 1, i + 2)]![0]

  // Cardinal-style tangents; tension shortens them (harder corners)
  const taut = 1 - clamp01(tension) * 0.85
  let m1 = taut * ((y2 - yPrev) / Math.max(t2 - tPrev, 1e-12)) * dt
  let m2 = taut * ((yNext - y1) / Math.max(tNext - t1, 1e-12)) * dt

  // Force zero end tangents on first/last segments (C1 match to flat band)
  if (i === 0) m1 = 0
  if (i >= n - 2) m2 = 0

  // Hermite basis
  const h00 = 2 * s3 - 3 * s2 + 1
  const h10 = s3 - 2 * s2 + s
  const h01 = -2 * s3 + 3 * s2
  const h11 = s3 - s2
  return h00 * y1 + h10 * m1 + h01 * y2 + h11 * m2
}

/**
 * C² fade at the pinch window edges (0 at ends, 1 on the interior plateau).
 * Kills derivative jumps where the flat band meets the pinch — main source of
 * “bourrelet” ridges — without shrinking crest/trough in the middle.
 */
function boundaryEnvelope(u: number, fade = 0.16): number {
  const t = Math.min(1, Math.max(0, u))
  const f = Math.min(Math.max(fade, 0.04), 0.35)
  const smoother = (x: number): number => {
    // Ken Perlin’s smootherstep: 6x⁵ − 15x⁴ + 10x³
    const s = Math.min(1, Math.max(0, x))
    return s * s * s * (s * (s * 6 - 15) + 10)
  }
  if (t < f) return smoother(t / f)
  if (t > 1 - f) return smoother((1 - t) / f)
  return 1
}

/**
 * Pinch centerline offset for local u ∈ [0,1].
 *
 * `sharpness` 1 = hard polyline interior; 0 = smooth Hermite through the same
 * peaks. Boundary envelope always blends into the flat band (no edge bourrelet).
 * Crest/trough control values stay at ±1 so amplitude / full width hold.
 */
function pinchCenterline(u: number, sharpness: number): number {
  const sharp = clamp01(sharpness)
  const hard = evalPolylineOpen(u, PINCH_CENTERLINE)
  // tension high when sharp → short tangents ≈ polyline; low when soft
  const soft = evalHermiteOpen(u, PINCH_CENTERLINE, sharp)
  const shape = sharp >= 0.999 ? hard : sharp <= 0.001 ? soft : soft + (hard - soft) * sharp
  return shape * boundaryEnvelope(u)
}

/**
 * Map ring angle θ to local pinch coordinate u ∈ [0,1], or null if outside span.
 * Window is centered on `phase`, width = `spanRad`.
 */
function pinchLocalU(theta: number, phase: number, spanRad: number): number | null {
  if (spanRad <= 1e-6) return null
  // Signed shortest angular delta from window center
  let d = theta - phase
  d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
  const half = spanRad / 2
  if (Math.abs(d) > half) return null
  return (d + half) / spanRad
}

export interface BandEdgeFrame {
  /** Upper axial edge (finger-axis +z) */
  zTop: number
  /** Lower axial edge */
  zBot: number
  /** Mid-plane of the local D section */
  zMid: number
  /** Half the local axial width */
  halfW: number
  /** Full local axial width */
  width: number
}

export type WaveEdgeParams = Pick<
  RingParams,
  | 'bandWidthMm'
  | 'bandProfile'
  | 'waveAmplitudeMm'
  | 'waveCount'
  | 'wavePhaseDeg'
  | 'waveSpanDeg'
  | 'waveTopSpanDeg'
  | 'waveBotSpanDeg'
  | 'waveSharpness'
  | 'waveAsymmetry'
  | 'waveCharacter'
>

/** Clamp an edge span (degrees) to a safe manufacturing range. */
function clampSpanDeg(deg: number): number {
  return Math.min(350, Math.max(20, deg))
}

/**
 * Effective upper/lower pinch spans (degrees).
 * Falls back to `waveSpanDeg` when a dedicated edge length is missing/zero
 * so older param blobs still build a valid ring.
 */
export function edgeSpanDegs(params: Pick<WaveEdgeParams, 'waveSpanDeg' | 'waveTopSpanDeg' | 'waveBotSpanDeg'>): {
  topDeg: number
  botDeg: number
  maxDeg: number
} {
  const fallback = clampSpanDeg(params.waveSpanDeg || 100)
  const topRaw = params.waveTopSpanDeg > 0 ? params.waveTopSpanDeg : fallback
  const botRaw = params.waveBotSpanDeg > 0 ? params.waveBotSpanDeg : fallback
  const topDeg = clampSpanDeg(topRaw)
  const botDeg = clampSpanDeg(botRaw)
  return { topDeg, botDeg, maxDeg: Math.max(topDeg, botDeg) }
}

/**
 * Local upper/lower edges at angle θ (radians).
 * Classic D profile returns constant ±bandWidth/2.
 *
 * Wave profile: **localized pinch** around `wavePhaseDeg`. Upper and lower
 * edges may occupy different angular lengths (`waveTopSpanDeg` /
 * `waveBotSpanDeg`) so one edge of the pinch can run longer than the other
 * for an organic, staggered silhouette. Outside each edge’s window that
 * edge is flat; where both are active the ribbon stays roughly constant width.
 */
export function bandEdgesAt(theta: number, params: WaveEdgeParams): BandEdgeFrame {
  const baseHalf = Math.max(params.bandWidthMm, 0.4) / 2

  if (params.bandProfile !== 'wave') {
    return {
      zTop: baseHalf,
      zBot: -baseHalf,
      zMid: 0,
      halfW: baseHalf,
      width: baseHalf * 2,
    }
  }

  const amp = Math.max(0, params.waveAmplitudeMm)
  const phase = (params.wavePhaseDeg * Math.PI) / 180
  const { topDeg, botDeg } = edgeSpanDegs(params)
  const topSpanRad = (topDeg * Math.PI) / 180
  const botSpanRad = (botDeg * Math.PI) / 180
  const sharp = clamp01(params.waveSharpness)

  // Independent local u per edge → one edge can extend past the other
  const uTop = pinchLocalU(theta, phase, topSpanRad)
  const uBot = pinchLocalU(theta, phase, botSpanRad)
  const midTop = uTop === null ? 0 : amp * pinchCenterline(uTop, sharp)
  const midBot = uBot === null ? 0 : amp * pinchCenterline(uBot, sharp)

  const zTop = midTop + baseHalf
  const zBot = midBot - baseHalf
  // Guard against inverted edges if spans/shape ever diverge hard
  const zHi = Math.max(zTop, zBot + 0.2)
  const zLo = Math.min(zBot, zTop - 0.2)
  const zMid = (zHi + zLo) / 2
  const halfW = (zHi - zLo) / 2
  return {
    zTop: zHi,
    zBot: zLo,
    zMid,
    halfW,
    width: halfW * 2,
  }
}

/** Minimum axial width around the full ring (for text sizing). */
export function minBandWidthMm(params: WaveEdgeParams): number {
  if (params.bandProfile !== 'wave') return params.bandWidthMm
  let minW = Infinity
  const samples = 72
  for (let i = 0; i < samples; i++) {
    const θ = (i / samples) * Math.PI * 2
    minW = Math.min(minW, bandEdgesAt(θ, params).width)
  }
  return minW
}

/** Maximum |z| extent around the ring (for engraving skip bounds). */
export function maxBandHalfExtentMm(params: WaveEdgeParams): number {
  if (params.bandProfile !== 'wave') return params.bandWidthMm / 2
  let maxAbs = 0
  const samples = 72
  for (let i = 0; i < samples; i++) {
    const θ = (i / samples) * Math.PI * 2
    const e = bandEdgesAt(θ, params)
    maxAbs = Math.max(maxAbs, Math.abs(e.zTop), Math.abs(e.zBot))
  }
  return maxAbs
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

/**
 * Sample the local D-profile (meridional plane) at one θ.
 * Topology (point count) is fixed by `arcSteps` + `wallSteps` so every
 * circumferential column can share the same index buffer.
 */
function sampleLocalProfile(
  innerR: number,
  thickness: number,
  edges: BandEdgeFrame,
  arcSteps: number,
  wallSteps: number,
): { r: number; z: number }[] {
  const { zTop, zBot, zMid, halfW } = edges
  const pts: { r: number; z: number }[] = []

  for (let i = 0; i <= arcSteps; i++) {
    const t = i / arcSteps
    const ang = -Math.PI / 2 + t * Math.PI
    const r = Math.max(innerR + thickness * Math.cos(ang), 1e-4)
    // Map semi-ellipse from zBot → zTop through zMid
    const z = zMid + halfW * Math.sin(ang)
    pts.push({ r, z })
  }

  for (let i = 1; i <= wallSteps; i++) {
    const t = i / wallSteps
    pts.push({ r: innerR, z: zTop - t * (zTop - zBot) })
  }

  return pts
}

/**
 * Build sorted unique θ samples in [0, 2π], densifying both edge pinch windows
 * and forcing hard corners onto mesh columns.
 */
function radialThetaSamples(params: RingParams, baseCount: number): number[] {
  const phase = (params.wavePhaseDeg * Math.PI) / 180
  const { topDeg, botDeg, maxDeg } = edgeSpanDegs(params)
  const spans = [topDeg, botDeg, maxDeg].map((d) => (d * Math.PI) / 180)

  const thetas = new Set<number>()
  for (let i = 0; i < baseCount; i++) {
    thetas.add((i / baseCount) * Math.PI * 2)
  }
  thetas.add(0)
  thetas.add(Math.PI * 2)

  // Motif vertices + feature samples + dense edge fades (smooth join to flat)
  const times = new Set<number>(PINCH_FEATURE_US)
  for (const [t] of PINCH_CENTERLINE) {
    if (t > 0 && t < 1) times.add(t)
  }
  for (let i = 0; i <= 12; i++) {
    times.add((i / 12) * 0.18)
    times.add(1 - (i / 12) * 0.18)
  }

  for (const spanRad of spans) {
    const half = spanRad / 2
    // Window edges (flat ↔ pinch transitions) for each edge length
    for (const edge of [-half, half]) {
      let θ = phase + edge
      θ = ((θ % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
      thetas.add(θ)
    }
    for (const u of times) {
      let θ = phase - half + u * spanRad
      θ = ((θ % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
      thetas.add(θ)
    }
    // Dense samples across the pinch for a clean freeform surface
    const pinchSamples = Math.max(48, Math.ceil(baseCount * (spanRad / (Math.PI * 2)) * 3))
    for (let i = 1; i < pinchSamples; i++) {
      const u = i / pinchSamples
      let θ = phase - half + u * spanRad
      θ = ((θ % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
      thetas.add(θ)
    }
  }

  return [...thetas].sort((a, b) => a - b)
}

/**
 * Sculpted wave-silhouette ring: circular finger bore, D radial section,
 * axial edges that follow the draft-inspired hard-corner motif around θ.
 */
function createWaveRingGeometry(params: RingParams): THREE.BufferGeometry {
  const innerR = params.innerDiameterMm / 2
  const thickness = params.bandThicknessMm
  const baseRadial = qualitySegments(params.quality)
  const thetaList = radialThetaSamples(params, baseRadial)
  // Ensure closed loop: last sample must be 2π (duplicate of 0 for seam)
  if (thetaList[thetaList.length - 1]! < Math.PI * 2 - 1e-12) {
    thetaList.push(Math.PI * 2)
  }
  const radial = thetaList.length - 1 // number of segments

  // Fixed topology from base width (local width only deforms, never changes count)
  const baseHalf = Math.max(params.bandWidthMm, 0.4) / 2
  const maxHalf = maxBandHalfExtentMm(params)
  const arcSteps = Math.max(
    48,
    Math.ceil(
      Math.PI *
        Math.max(thickness, maxHalf) *
        (params.quality === 'high' || params.quality === 'extra' ? 20 : 12),
    ),
  )
  const wallSteps = innerWallSteps(params.quality, baseHalf * 2)
  const profileCount = arcSteps + 1 + wallSteps
  // radial columns + wrap seam (last column is θ=2π ≡ 0)
  const columns = radial + 1

  const positions = new Float32Array(columns * profileCount * 3)
  const uvs = new Float32Array(columns * profileCount * 2)

  for (let i = 0; i < columns; i++) {
    const θ = thetaList[i]!
    const t = θ / (Math.PI * 2)
    const edges = bandEdgesAt(θ, params)
    const profile = sampleLocalProfile(innerR, thickness, edges, arcSteps, wallSteps)
    const cos = Math.cos(θ)
    const sin = Math.sin(θ)

    for (let j = 0; j < profileCount; j++) {
      const p = profile[j]!
      const idx = (i * profileCount + j) * 3
      positions[idx] = p.r * cos
      positions[idx + 1] = p.r * sin
      positions[idx + 2] = p.z
      const uvi = (i * profileCount + j) * 2
      uvs[uvi] = t
      uvs[uvi + 1] = j / (profileCount - 1)
    }
  }

  // Quads between adjacent columns. Winding: look from outside → CCW for outward normals.
  // Profile walks outer bottom→top then inner top→bottom (metal left of path in rz).
  // For θ increasing (right-hand around +z), connect (i,j)→(i+1,j)→(i+1,j+1)→(i,j+1).
  const indices: number[] = []
  for (let i = 0; i < radial; i++) {
    const c0 = i * profileCount
    const c1 = (i + 1) * profileCount
    for (let j = 0; j < profileCount - 1; j++) {
      const a = c0 + j
      const b = c1 + j
      const c = c1 + j + 1
      const d = c0 + j + 1
      indices.push(a, b, d)
      indices.push(b, c, d)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(indices)

  // Creased normals on a D-profile create false “bourrelet” ridges under metal
  // lighting (dome/inner angle ≈ 90°). Only crease when the user wants truly
  // hard interior kinks; otherwise smooth vertex normals.
  if (params.waveSharpness >= 0.85) {
    const creased = toCreasedNormals(geometry, Math.PI / 3) // 60° — real hard breaks only
    geometry.dispose()
    return creased
  }
  geometry.computeVertexNormals()
  return geometry
}

export function createRingGeometry(params: RingParams): THREE.BufferGeometry {
  if (params.bandProfile === 'wave') {
    return createWaveRingGeometry(params)
  }

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
 * Outer D-profile (semi-ellipse) at a local section:
 * r = innerR + thickness·cosφ, z = zMid + halfW·sinφ.
 * Returns surface radius and unit outward normal in the (radial, axial) plane.
 */
export function outerDomeFrame(
  z: number,
  innerR: number,
  thickness: number,
  halfW: number,
  zMid = 0,
): { r: number; ur: number; uz: number } {
  const hw = Math.max(halfW, 1e-6)
  const th = Math.max(thickness, 1e-6)
  const s = Math.max(-1, Math.min(1, (z - zMid) / hw)) // sinφ
  const cosφ = Math.sqrt(Math.max(0, 1 - s * s))
  const r = innerR + th * cosφ
  // Gradient of ellipse → outward normal ∝ (cosφ/th, sinφ/hw)
  const nr = cosφ / th
  const nz = s / hw
  const nlen = Math.hypot(nr, nz) || 1
  return { r, ur: nr / nlen, uz: nz / nlen }
}

/**
 * Motif u-range of the steep “Z” diagonals of the pinch (crest → trough).
 * Soft pads at the ends of the window are excluded so measured length matches
 * the visible hard flanks of the S silhouette.
 */
export const PINCH_FLANK_U0 = 0.30
export const PINCH_FLANK_U1 = 0.72

export interface PinchFlankPath {
  /** 3D path length along the outer dome edge (mm). */
  lengthMm: number
  /** Polyline samples on the outer surface (for dimension drawing). */
  points: { x: number; y: number; z: number }[]
  /** Midpoint of the path (label anchor). */
  mid: { x: number; y: number; z: number }
}

/**
 * Point on the outer domed surface at angle θ for a given axial edge z.
 */
export function outerEdgePointAt(
  theta: number,
  z: number,
  params: Pick<RingParams, 'innerDiameterMm' | 'bandThicknessMm'>,
  halfW: number,
  zMid: number,
): { x: number; y: number; z: number } {
  const innerR = params.innerDiameterMm / 2
  const { r } = outerDomeFrame(z, innerR, params.bandThicknessMm, halfW, zMid)
  return {
    x: r * Math.cos(theta),
    y: r * Math.sin(theta),
    z,
  }
}

/**
 * 3D path of the steep pinch flank on the upper and lower outer edges.
 * These are the two parallel diagonals of the S/Z ribbon the user sees.
 */
export function measurePinchFlankPaths(params: WaveEdgeParams & Pick<RingParams, 'innerDiameterMm' | 'bandThicknessMm'>): {
  top: PinchFlankPath
  bot: PinchFlankPath
} {
  const empty = (): PinchFlankPath => ({
    lengthMm: 0,
    points: [],
    mid: { x: 0, y: 0, z: 0 },
  })

  if (params.bandProfile !== 'wave' || params.waveAmplitudeMm <= 0) {
    return { top: empty(), bot: empty() }
  }

  const phase = (params.wavePhaseDeg * Math.PI) / 180
  const { topDeg, botDeg } = edgeSpanDegs(params)

  const sampleFlank = (spanDeg: number, which: 'top' | 'bot'): PinchFlankPath => {
    const spanRad = (spanDeg * Math.PI) / 180
    if (spanRad < 1e-6) return empty()
    const half = spanRad / 2
    const n = Math.max(32, Math.ceil(spanDeg * 1.2))
    const points: { x: number; y: number; z: number }[] = []
    let length = 0

    for (let i = 0; i <= n; i++) {
      const u = PINCH_FLANK_U0 + (i / n) * (PINCH_FLANK_U1 - PINCH_FLANK_U0)
      const θ = phase - half + u * spanRad
      const e = bandEdgesAt(θ, params)
      const z = which === 'top' ? e.zTop : e.zBot
      const p = outerEdgePointAt(θ, z, params, e.halfW, e.zMid)
      if (points.length > 0) {
        const prev = points[points.length - 1]!
        length += Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z)
      }
      points.push(p)
    }

    const mid = points[Math.floor(points.length / 2)] ?? { x: 0, y: 0, z: 0 }
    return { lengthMm: length, points, mid }
  }

  return {
    top: sampleFlank(topDeg, 'top'),
    bot: sampleFlank(botDeg, 'bot'),
  }
}
