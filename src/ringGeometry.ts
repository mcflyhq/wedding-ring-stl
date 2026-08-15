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

/** Control point: u ∈ [0,1] within the pinch window, z in millimeters. */
type MotifPt = readonly [number, number]

/**
 * The harmonious reference silhouette from the original ring prototype.
 *
 * Keep this topology stable. Controls may scale it and alter the construction
 * angle, but must not turn the 2 marked flank lengths into extra lobes.
 */
const REFERENCE_PINCH: readonly MotifPt[] = [
  [0, 0],
  [0.06, 0],
  [0.14, 0.06],
  [0.22, 0.22],
  [0.3, 0.5],
  [0.36, 0.78],
  [0.42, 1],
  [0.48, 0.55],
  [0.52, 0.05],
  [0.56, -0.4],
  [0.6, -0.72],
  [0.68, -0.52],
  [0.78, -0.24],
  [0.88, -0.05],
  [0.94, 0],
  [1, 0],
]

const REFERENCE_CREST_U = 0.42
const REFERENCE_WAIST_U = 0.52
const REFERENCE_TROUGH_U = 0.6
/** Physical width of the broader approach shoulder marked on the reference. */
export const PINCH_SHOULDER_WIDTH_MM = 3.7
const REFERENCE_SHOULDER_RAMP_IN_U = 0.02
const REFERENCE_SHOULDER_FULL_START_U = 0.32
const REFERENCE_SHOULDER_MEASURE_U = 0.35
/** Hold 3.70 mm to the crest junction, then fillet into the 3.00 mm crest. */
const REFERENCE_SHOULDER_FULL_END_U = 0.4
/** The descending `\` stroke begins at the crest and stays nominal throughout. */
const REFERENCE_SHOULDER_RAMP_OUT_U = REFERENCE_CREST_U
/** Fixed endpoints of the 2 dimensioned descending edge paths. */
const REFERENCE_TOP_FLANK_START_U = 0.454
const REFERENCE_TOP_FLANK_END_U = 0.56573
const REFERENCE_BOT_FLANK_START_U = 0.4536
const REFERENCE_BOT_FLANK_END_U = 0.569
const REFERENCE_EXCURSION_MM = 5.66 - 3.5

export interface PinchLayout {
  /** Shape-preserving upper-edge knots, with z offsets in millimeters. */
  topMotif: readonly MotifPt[]
  /** PCHIP tangents paired with `topMotif`. */
  topTangents: readonly number[]
  /** Shape-preserving lower-edge knots. Kept parallel to the upper edge. */
  botMotif: readonly MotifPt[]
  /** PCHIP tangents paired with `botMotif`. */
  botTangents: readonly number[]
  /** Centerline envelope used by manufacturing/export helpers. */
  motif: readonly MotifPt[]
  /** PCHIP tangents paired with `motif`. */
  tangents: readonly number[]
  spanRad: number
  spanDeg: number
  topStartU: number
  topEndU: number
  botStartU: number
  botEndU: number
  takeoffU: number
  crestU: number
  waistU: number
  troughU: number
  landingU: number
  /** Center of the constant-width 3.70 mm approach shoulder. */
  shoulderU: number
  riseMm: number
  fallMm: number
  targetWidthMm: number
  requestedAngleDeg: number
  effectiveAngleDeg: number
}

function referenceTangents(points: readonly MotifPt[]): number[] {
  return points.map((_, i) => {
    if (i === 0 || i === points.length - 1) return 0
    const previous = points[i - 1]!
    const point = points[i]!
    const next = points[i + 1]!
    const previousRun = Math.max(point[0] - previous[0], 1e-9)
    const nextRun = Math.max(next[0] - point[0], 1e-9)
    const previousSlope = (point[1] - previous[1]) / previousRun
    const nextSlope = (next[1] - point[1]) / nextRun

    // PCHIP: an extremum or flat segment must have a zero tangent. The former
    // central difference gave the crest a negative tangent, creating a small
    // overshoot immediately before its apex.
    if (
      Math.abs(previousSlope) < 1e-12 ||
      Math.abs(nextSlope) < 1e-12 ||
      previousSlope * nextSlope <= 0
    ) {
      return 0
    }

    const previousWeight = 2 * nextRun + previousRun
    const nextWeight = nextRun + 2 * previousRun
    return (
      (previousWeight + nextWeight) /
      (previousWeight / previousSlope + nextWeight / nextSlope)
    )
  })
}

function motifExtrema(
  motif: readonly MotifPt[],
  tangents: readonly number[],
  sharpness: number,
): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  const samples = 4096
  for (let i = 0; i <= samples; i++) {
    const value = pinchEdgeOffset(i / samples, sharpness, motif, tangents)
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  return { min, max }
}

function isKnotU(u: number, motif: readonly MotifPt[]): boolean {
  return motif.some(([knotU]) => Math.abs(knotU - u) < 1e-7)
}

function motifDerivative(
  u: number,
  sharpness: number,
  motif: readonly MotifPt[],
  tangents: readonly number[],
): number {
  const h = 1e-5
  const u0 = Math.max(0, u - h)
  const u1 = Math.min(1, u + h)
  if (u1 <= u0) return 0
  if (isKnotU(u, motif) && sharpness >= 0.999) {
    const left =
      (pinchEdgeOffset(u, sharpness, motif, tangents) -
        pinchEdgeOffset(u0, sharpness, motif, tangents)) /
      Math.max(u - u0, 1e-9)
    const right =
      (pinchEdgeOffset(u1, sharpness, motif, tangents) -
        pinchEdgeOffset(u, sharpness, motif, tangents)) /
      Math.max(u1 - u, 1e-9)
    return Math.abs(left) <= Math.abs(right) ? left : right
  }
  return (
    (pinchEdgeOffset(u1, sharpness, motif, tangents) -
      pinchEdgeOffset(u0, sharpness, motif, tangents)) /
    (u1 - u0)
  )
}

/**
 * Move only the central descending stroke. At 120° this returns the original
 * knot positions exactly; the shoulders and flat joins stay undisturbed.
 */
function angleWarpU(u: number, angleDeg: number): number {
  const runScale = Math.min(1.45, Math.max(0.65, Math.pow(angleDeg / 120, 1.15)))
  if (u <= REFERENCE_CREST_U) return u

  const warpedTrough =
    REFERENCE_CREST_U + (REFERENCE_TROUGH_U - REFERENCE_CREST_U) * runScale
  if (u <= REFERENCE_TROUGH_U) {
    return REFERENCE_CREST_U + (u - REFERENCE_CREST_U) * runScale
  }

  return (
    warpedTrough +
    ((u - REFERENCE_TROUGH_U) / (1 - REFERENCE_TROUGH_U)) * (1 - warpedTrough)
  )
}

/** Quintic easing with zero first and second derivatives at both ends. */
function smootherstep01(value: number): number {
  const t = clamp01(value)
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/**
 * Local physical width of the swept D section. The approach broadens to
 * 3.70 mm through the shoulder's crest connection. A short C2 junction fillet
 * resolves that incoming width into the nominal-width crest and descending
 * stroke. The long blend back to the flat band stays on the approach side.
 */
function pinchSectionWidthAtU(
  u: number,
  baseWidthMm: number,
  angleDeg: number,
): number {
  const baseWidth = Math.max(baseWidthMm, 0.4)
  const shoulderWidth = Math.max(baseWidth, PINCH_SHOULDER_WIDTH_MM)
  if (shoulderWidth <= baseWidth + 1e-9) return baseWidth

  const rampIn = angleWarpU(REFERENCE_SHOULDER_RAMP_IN_U, angleDeg)
  const fullStart = angleWarpU(REFERENCE_SHOULDER_FULL_START_U, angleDeg)
  const fullEnd = angleWarpU(REFERENCE_SHOULDER_FULL_END_U, angleDeg)
  const rampOut = angleWarpU(REFERENCE_SHOULDER_RAMP_OUT_U, angleDeg)

  let blend = 0
  if (u > rampIn && u < fullStart) {
    blend = smootherstep01((u - rampIn) / Math.max(fullStart - rampIn, 1e-9))
  } else if (u >= fullStart && u <= fullEnd) {
    blend = 1
  } else if (u > fullEnd && u < rampOut) {
    blend = 1 - smootherstep01((u - fullEnd) / Math.max(rampOut - fullEnd, 1e-9))
  }

  return baseWidth + (shoulderWidth - baseWidth) * blend
}

function emptyPinchLayout(bandWidthMm: number): PinchLayout {
  const motif: readonly MotifPt[] = [[0, 0], [1, 0]]
  return {
    topMotif: motif,
    topTangents: [0, 0],
    botMotif: motif,
    botTangents: [0, 0],
    motif,
    tangents: [0, 0],
    spanRad: 0,
    spanDeg: 0,
    topStartU: 0,
    topEndU: 0,
    botStartU: 1,
    botEndU: 1,
    takeoffU: 0,
    crestU: 0,
    waistU: 0.5,
    troughU: 1,
    landingU: 1,
    shoulderU: REFERENCE_SHOULDER_MEASURE_U,
    riseMm: 0,
    fallMm: 0,
    targetWidthMm: bandWidthMm,
    requestedAngleDeg: 120,
    effectiveAngleDeg: 120,
  }
}

/**
 * Build the reference's localized S-step in an unwrapped plane.
 *
 * A D-section is swept normal to the centerline, so the green and blue edges
 * remain parallel. Its approach shoulder broadens locally to 3.70 mm without
 * thinning the steep flanks. The remaining ring returns to its nominal width.
 */
function buildPinchLayout(params: WaveEdgeParams): PinchLayout {
  const bandWidth = Math.max(params.bandWidthMm, 0.4)
  const targetWidth = Math.max(
    bandWidth,
    PINCH_SHOULDER_WIDTH_MM,
    Math.min(10, params.waveAmplitudeMm || bandWidth),
  )
  const nominalExcursion = targetWidth - bandWidth
  if (params.bandProfile !== 'wave' || nominalExcursion <= 1e-6) {
    return emptyPinchLayout(bandWidth)
  }

  const requestedTop = Math.max(params.waveTopFlankMm || 5.2, 0.2)
  const requestedBot = Math.max(params.waveBotFlankMm || 5, 0.2)
  const requestedAngle = Math.min(150, Math.max(70, params.wavePinchAngleDeg || 120))

  // Normalize the actual interpolated curve, including angle warp and corner
  // hardness, so the slider remains an exact edge-to-edge envelope.
  const unitMotif: readonly MotifPt[] = REFERENCE_PINCH.map(([u, value]) => [
    angleWarpU(u, requestedAngle),
    value,
  ])
  const sharpness = clamp01(params.waveSharpness)
  const unitTangents = referenceTangents(unitMotif)
  const unitExtrema = motifExtrema(unitMotif, unitTangents, sharpness)
  const unitRange = Math.max(unitExtrema.max - unitExtrema.min, 1e-6)
  // The sliders define the transition footprint. The readouts are derived
  // measurements of fixed crest-to-trough edge paths, so changing any other
  // parameter updates them instead of silently moving their endpoints.
  const flankMean = (requestedTop + requestedBot) / 2
  // The reference used a 100° window for a 2.16 mm centerline excursion.
  // Grow the footprint sub-linearly with larger envelopes so the silhouette
  // retains the reference slope without swallowing the whole circumference.
  const spanDeg = Math.min(
    220,
    Math.max(
      45,
      100 *
        Math.sqrt(nominalExcursion / REFERENCE_EXCURSION_MM) *
        (flankMean / 5.1),
    ),
  )
  const spanRad = (spanDeg * Math.PI) / 180
  const outerRadius = params.innerDiameterMm / 2 + params.bandThicknessMm
  const axialProjection = (u: number, side: 1 | -1, scale: number): number => {
    const offset = pinchEdgeOffset(u, sharpness, unitMotif, unitTangents) * scale
    const dzDu = motifDerivative(u, sharpness, unitMotif, unitTangents) * scale
    const slope = dzDu / Math.max(outerRadius * spanRad, 1e-6)
    const normalZ = 1 / Math.hypot(1, slope)
    const localWidth = pinchSectionWidthAtU(u, bandWidth, requestedAngle)
    const localHalf = localWidth / 2
    // Grow the shoulder from its underside. Anchoring the upper edge prevents
    // the wider incoming section from forming a crown immediately before the
    // narrower crest.
    const normalCenterShift = -(localWidth - bandWidth) / 2
    return offset + (normalCenterShift + side * localHalf) * normalZ
  }
  const projectedEnvelope = (scale: number): number => {
    let maxTop = -Infinity
    let minBot = Infinity
    const samples = 2048
    const sampleUs = new Set(unitMotif.map(([u]) => u))
    for (let i = 0; i <= samples; i++) sampleUs.add(i / samples)
    for (const u of sampleUs) {
      maxTop = Math.max(maxTop, axialProjection(u, 1, scale))
      minBot = Math.min(minBot, axialProjection(u, -1, scale))
    }
    return maxTop - minBot
  }
  // Normal-offset sections shorten their axial projection on a slope. Solve
  // the centerline scale so the generated crest-to-trough envelope, not the
  // unoffset guide curve, remains exactly equal to the requested full width.
  let lowScale = 0
  let highScale = Math.max((nominalExcursion / unitRange) * 2, 1)
  for (let i = 0; i < 12; i++) {
    const envelope = projectedEnvelope(highScale)
    if (envelope >= targetWidth) break
    highScale *= 2
  }
  for (let i = 0; i < 48; i++) {
    const scale = (lowScale + highScale) / 2
    const envelope = projectedEnvelope(scale)
    if (envelope < targetWidth) lowScale = scale
    else highScale = scale
  }
  const scale = (lowScale + highScale) / 2
  const centerMotif: readonly MotifPt[] = unitMotif.map(([u, value]) => [u, value * scale])
  const tangents = referenceTangents(centerMotif)
  const rise = unitExtrema.max * scale
  const fall = -unitExtrema.min * scale
  const meanFlank = Math.max(flankMean, 1e-6)
  const topScale = requestedTop / meanFlank
  const botScale = requestedBot / meanFlank
  const fixedTopStartU = angleWarpU(REFERENCE_TOP_FLANK_START_U, requestedAngle)
  const fixedTopEndU = angleWarpU(REFERENCE_TOP_FLANK_END_U, requestedAngle)
  const fixedBotStartU = angleWarpU(REFERENCE_BOT_FLANK_START_U, requestedAngle)
  const fixedBotEndU = angleWarpU(REFERENCE_BOT_FLANK_END_U, requestedAngle)
  const topStartU = fixedTopStartU
  const topEndU = Math.min(
    1,
    topStartU + (fixedTopEndU - fixedTopStartU) * topScale,
  )
  const botEndU = fixedBotEndU
  const botStartU = Math.max(
    0,
    botEndU - (fixedBotEndU - fixedBotStartU) * botScale,
  )
  const takeoffU = angleWarpU(0.06, requestedAngle)
  const crestU = angleWarpU(REFERENCE_CREST_U, requestedAngle)
  const waistU = angleWarpU(REFERENCE_WAIST_U, requestedAngle)
  const troughU = angleWarpU(REFERENCE_TROUGH_U, requestedAngle)
  const landingU = angleWarpU(0.94, requestedAngle)
  const shoulderU = angleWarpU(REFERENCE_SHOULDER_MEASURE_U, requestedAngle)
  const topMotif = centerMotif
  const botMotif = centerMotif
  return {
    topMotif,
    topTangents: tangents,
    botMotif,
    botTangents: tangents,
    motif: centerMotif,
    tangents,
    spanRad,
    spanDeg,
    topStartU,
    topEndU,
    botStartU,
    botEndU,
    takeoffU,
    crestU,
    waistU,
    troughU,
    landingU,
    shoulderU,
    riseMm: rise,
    fallMm: fall,
    targetWidthMm: targetWidth,
    requestedAngleDeg: requestedAngle,
    effectiveAngleDeg: requestedAngle,
  }
}

let pinchLayoutCacheKey = ''
let pinchLayoutCache = emptyPinchLayout(3)

/** Memoized because mesh generation evaluates the edge frame for every column. */
export function pinchLayoutFromParams(params: WaveEdgeParams): PinchLayout {
  const key = [
    params.bandProfile,
    params.innerDiameterMm,
    params.bandWidthMm,
    params.waveAmplitudeMm,
    params.waveTopFlankMm,
    params.waveBotFlankMm,
    params.wavePinchAngleDeg,
    params.waveSharpness,
  ].join('|')
  if (key !== pinchLayoutCacheKey) {
    pinchLayoutCache = buildPinchLayout(params)
    pinchLayoutCacheKey = key
  }
  return pinchLayoutCache
}

/** Absolute ring angle for one normalized pinch landmark. */
export function pinchThetaAtU(phaseDeg: number, spanRad: number, u: number): number {
  const phase = (phaseDeg * Math.PI) / 180
  return phase - spanRad / 2 + clamp01(u) * spanRad
}

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

/** Shape-preserving cubic interpolation through the physical construction knots. */
function evalHermiteOpen(u: number, pts: readonly MotifPt[], tangents: readonly number[]): number {
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

  const y1 = p1[1]
  const y2 = p2[1]
  const m1 = (tangents[i] ?? 0) * dt
  const m2 = (tangents[i + 1] ?? 0) * dt

  // Hermite basis
  const h00 = 2 * s3 - 3 * s2 + 1
  const h10 = s3 - 2 * s2 + s
  const h01 = -2 * s3 + 3 * s2
  const h11 = s3 - s2
  return h00 * y1 + h10 * m1 + h01 * y2 + h11 * m2
}

/** C2 join to the untouched flat band, retained from the reference renderer. */
function pinchBoundaryEnvelope(u: number, fade = 0.16): number {
  const t = clamp01(u)
  if (t < fade) return smootherstep01(t / fade)
  if (t > 1 - fade) return smootherstep01((1 - t) / fade)
  return 1
}

/** Edge offset in millimeters. Every hardness passes through the construction knots. */
function pinchEdgeOffset(
  u: number,
  sharpness: number,
  motif: readonly MotifPt[],
  tangents: readonly number[],
): number {
  const sharp = clamp01(sharpness)
  const hard = evalPolylineOpen(u, motif)
  const soft = evalHermiteOpen(u, motif, tangents)
  return (soft + (hard - soft) * sharp) * pinchBoundaryEnvelope(u)
}

/** Map θ to local pinch coordinate u, or null on the untouched flat band. */
function pinchLocalU(theta: number, phase: number, spanRad: number): number | null {
  if (spanRad <= 1e-6) return null
  let delta = theta - phase
  delta = ((delta + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
  const half = spanRad / 2
  if (Math.abs(delta) > half) return null
  return (delta + half) / spanRad
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
  /** Translation of the D-section midpoint along the local section normal. */
  normalCenterShift: number
  /** Unit normal to the centerline in the unwrapped circumferential/axial plane. */
  normalS: number
  normalZ: number
}

export type WaveEdgeParams = Pick<
  RingParams,
  | 'innerDiameterMm'
  | 'bandThicknessMm'
  | 'bandWidthMm'
  | 'bandProfile'
  | 'waveAmplitudeMm'
  | 'waveCount'
  | 'wavePhaseDeg'
  | 'waveSpanDeg'
  | 'waveTopSpanDeg'
  | 'waveBotSpanDeg'
  | 'waveTopFlankMm'
  | 'waveBotFlankMm'
  | 'wavePinchAngleDeg'
  | 'waveSharpness'
  | 'waveAsymmetry'
  | 'waveCharacter'
>

/**
 * Derived pinch span. Both band edges share one physical centerline window;
 * legacy top/bottom span fields no longer distort the requested flank lengths.
 */
export function edgeSpanDegs(params: WaveEdgeParams): {
  topDeg: number
  botDeg: number
  maxDeg: number
} {
  const spanDeg = pinchLayoutFromParams(params).spanDeg
  return { topDeg: spanDeg, botDeg: spanDeg, maxDeg: spanDeg }
}

/**
 * Local upper/lower edges at angle θ (radians).
 * Classic D profile returns constant ±bandWidth/2.
 *
 * Wave profile: one localized S-step around `wavePhaseDeg`. The returned axial
 * endpoints are projections of a section held normal to the centerline. Its
 * marked approach shoulder broadens smoothly while every point outside the
 * window returns to the original band width and plane.
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
      normalCenterShift: 0,
      normalS: 0,
      normalZ: 1,
    }
  }

  const phase = (params.wavePhaseDeg * Math.PI) / 180
  const layout = pinchLayoutFromParams(params)
  const u = pinchLocalU(theta, phase, layout.spanRad)
  if (u === null) {
    return {
      zTop: baseHalf,
      zBot: -baseHalf,
      zMid: 0,
      halfW: baseHalf,
      width: baseHalf * 2,
      normalCenterShift: 0,
      normalS: 0,
      normalZ: 1,
    }
  }
  const offset = pinchEdgeOffset(
    u,
    clamp01(params.waveSharpness),
    layout.motif,
    layout.tangents,
  )
  const outerRadius = params.innerDiameterMm / 2 + params.bandThicknessMm
  const dzDu = motifDerivative(
    u,
    clamp01(params.waveSharpness),
    layout.motif,
    layout.tangents,
  )
  const dsDu = Math.max(outerRadius * layout.spanRad, 1e-6)
  const slope = dzDu / dsDu
  const normalLength = Math.hypot(1, slope)
  const normalS = -slope / normalLength
  const normalZ = 1 / normalLength
  const localWidth = pinchSectionWidthAtU(u, baseHalf * 2, layout.requestedAngleDeg)
  const localHalf = localWidth / 2
  // Keep the upper silhouette tied to the nominal 3 mm section. Any shoulder
  // growth moves toward the underside, so the 3.70→3.00 mm crest junction
  // cannot create a top-edge crown or notch.
  const normalCenterShift = -(localWidth - baseHalf * 2) / 2
  const zMid = offset + normalCenterShift * normalZ
  const zTop = offset + (normalCenterShift + localHalf) * normalZ
  const zBot = offset + (normalCenterShift - localHalf) * normalZ
  return {
    zTop,
    zBot,
    zMid,
    halfW: localHalf,
    width: localWidth,
    normalCenterShift,
    normalS,
    normalZ,
  }
}

/** Minimum axial width around the full ring (for text sizing). */
export function minBandWidthMm(params: WaveEdgeParams): number {
  return Math.max(params.bandWidthMm, 0.4)
}

/** Maximum |z| extent around the ring (for engraving skip bounds). */
export function maxBandHalfExtentMm(params: WaveEdgeParams): number {
  if (params.bandProfile !== 'wave') return params.bandWidthMm / 2
  const layout = pinchLayoutFromParams(params)
  const widestHalf = Math.max(params.bandWidthMm, PINCH_SHOULDER_WIDTH_MM, 0.4) / 2
  return widestHalf + Math.max(layout.riseMm, layout.fallMm)
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
 * Sample the local D-profile (meridional plane) at one ring angle.
 */
function sampleLocalProfile(
  innerR: number,
  thickness: number,
  edges: BandEdgeFrame,
  arcSteps: number,
  wallSteps: number,
): { r: number; angleOffset: number; z: number }[] {
  const { zMid, halfW, normalCenterShift, normalS, normalZ } = edges
  const pts: { r: number; angleOffset: number; z: number }[] = []

  for (let i = 0; i <= arcSteps; i++) {
    const t = i / arcSteps
    const ang = -Math.PI / 2 + t * Math.PI
    const localQ = halfW * Math.sin(ang)
    const worldQ = normalCenterShift + localQ
    const r = Math.max(innerR + thickness * Math.cos(ang), 1e-4)
    const angleOffset = Math.asin(
      Math.max(-0.999, Math.min(0.999, (worldQ * normalS) / r)),
    )
    pts.push({ r, angleOffset, z: zMid + localQ * normalZ })
  }

  for (let i = 1; i <= wallSteps; i++) {
    const t = i / wallSteps
    const localQ = halfW * (1 - 2 * t)
    const worldQ = normalCenterShift + localQ
    const angleOffset = Math.asin(
      Math.max(-0.999, Math.min(0.999, (worldQ * normalS) / innerR)),
    )
    pts.push({ r: innerR, angleOffset, z: zMid + localQ * normalZ })
  }

  return pts
}

/**
 * Build sorted unique θ samples in [0, 2π], densifying both edge pinch windows
 * and forcing hard corners onto mesh columns.
 */
function radialThetaSamples(params: RingParams, baseCount: number): number[] {
  const phase = (params.wavePhaseDeg * Math.PI) / 180
  const layout = pinchLayoutFromParams(params)
  const spanRad = layout.spanRad

  const thetas = new Set<number>()
  for (let i = 0; i < baseCount; i++) {
    thetas.add((i / baseCount) * Math.PI * 2)
  }
  thetas.add(0)
  thetas.add(Math.PI * 2)

  if (spanRad <= 1e-6) return [...thetas].sort((a, b) => a - b)

  const addTheta = (raw: number): void => {
    const θ = ((raw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
    thetas.add(θ)
  }
  const half = spanRad / 2
  addTheta(phase - half)
  addTheta(phase + half)
  for (const motif of [layout.topMotif, layout.botMotif]) {
    for (const [u] of motif) addTheta(phase - half + u * spanRad)
  }
  // Extra density around the physical path keeps both short steps free of facets.
  const pinchSamples = Math.max(64, Math.ceil(baseCount * (spanRad / (Math.PI * 2)) * 3))
  for (let i = 1; i < pinchSamples; i++) {
    addTheta(phase - half + (i / pinchSamples) * spanRad)
  }

  return [...thetas].sort((a, b) => a - b)
}

/**
 * Sculpted wave-silhouette ring: a D section swept along the localized S while
 * its axial axis follows the centerline normal. This prevents flank thinning.
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

    for (let j = 0; j < profileCount; j++) {
      const p = profile[j]!
      const idx = (i * profileCount + j) * 3
      const pointAngle = θ + p.angleOffset
      positions[idx] = p.r * Math.cos(pointAngle)
      positions[idx + 1] = p.r * Math.sin(pointAngle)
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
 * 3D paths of the green and blue construction marks on the steep descending
 * stroke. Their solved endpoints and reported values come from the same metal
 * trajectories used to build the mesh.
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

  const layout = pinchLayoutFromParams(params)
  if (layout.spanRad < 1e-6) return { top: empty(), bot: empty() }

  const sampleFlank = (
    which: 'top' | 'bot',
    u0: number,
    u1: number,
  ): PinchFlankPath => {
    const segmentDeg = layout.spanDeg * Math.max(0, u1 - u0)
    const n = Math.max(160, Math.ceil(segmentDeg * 4))
    const points: { x: number; y: number; z: number }[] = []
    const outerRadius = params.innerDiameterMm / 2 + params.bandThicknessMm
    let length = 0

    for (let i = 0; i <= n; i++) {
      const u = u0 + (i / n) * (u1 - u0)
      const θ = pinchThetaAtU(params.wavePhaseDeg, layout.spanRad, u)
      const edge = bandEdgesAt(θ, params)
      const side = which === 'top' ? 1 : -1
      const z = which === 'top' ? edge.zTop : edge.zBot
      // Match the actual normal-offset edge used by the mesh. The radial part
      // of the offset is essential on steep flanks.
      const edgeQ = edge.normalCenterShift + side * edge.halfW
      const angleOffset = Math.asin(
        Math.max(
          -0.999,
          Math.min(0.999, (edgeQ * edge.normalS) / outerRadius),
        ),
      )
      const p = {
        x: outerRadius * Math.cos(θ + angleOffset),
        y: outerRadius * Math.sin(θ + angleOffset),
        z,
      }
      const previous = points[points.length - 1]
      if (previous) {
        length += Math.hypot(p.x - previous.x, p.y - previous.y, p.z - previous.z)
      }
      points.push(p)
    }

    const mid = points[Math.floor(points.length / 2)] ?? { x: 0, y: 0, z: 0 }
    return { lengthMm: length, points, mid }
  }

  return {
    top: sampleFlank('top', layout.topStartU, layout.topEndU),
    bot: sampleFlank('bot', layout.botStartU, layout.botEndU),
  }
}
