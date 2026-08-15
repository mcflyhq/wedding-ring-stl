import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Font, Path } from 'opentype.js'
import { loadDateFont, loadRingFont } from './fontLoader'
import {
  bandEdgesAt,
  edgeSpanDegs,
  maxBandHalfExtentMm,
  minBandWidthMm,
  outerDomeFrame,
  type WaveEdgeParams,
} from './ringGeometry'
import type { RingParams, TextSurface } from './types'
import { resolveInscriptionText } from './tengwarTranscribe'

/** Extra clearance past the pinch window so glyphs don’t graze the soft fade. */
const PINCH_TEXT_MARGIN_DEG = 8

/** Band cross-section params needed to map outer ink onto the D-profile dome. */
interface DomeParams {
  innerR: number
  thickness: number
  /** Mean half-width (fallback when θ is unknown). */
  halfW: number
  /** Wave / profile edges for local section at each angle. */
  edgeParams: WaveEdgeParams
}

/** Curve tessellation for ExtrudeGeometry - smooth Annatar + Inter digits. */
const EXTRUDE_CURVE_SEGMENTS = 16
/** Outline sampling for displacement masks. */
const POLY_DIVISIONS = 48
const POLY_HOLE_DIVISIONS = 24

/** OpenType path → THREE shapes (Y flipped for upright glyphs). */
function pathToShapes(path: Path): THREE.Shape[] {
  const shapePath = new THREE.ShapePath()
  for (const cmd of path.commands) {
    switch (cmd.type) {
      case 'M':
        shapePath.moveTo(cmd.x, -cmd.y)
        break
      case 'L':
        shapePath.lineTo(cmd.x, -cmd.y)
        break
      case 'C':
        shapePath.bezierCurveTo(cmd.x1, -cmd.y1, cmd.x2, -cmd.y2, cmd.x, -cmd.y)
        break
      case 'Q':
        shapePath.quadraticCurveTo(cmd.x1, -cmd.y1, cmd.x, -cmd.y)
        break
      case 'Z':
        shapePath.currentPath?.closePath()
        break
      default:
        break
    }
  }
  // ShapePath and ExtrudeGeometry both normalize contour/hole winding. Keeping
  // the original Bézier curves avoids flattening every glyph to hundreds of
  // line segments before the requested tessellation is applied.
  return shapePath.toShapes()
}

export interface FlatPoly {
  outer: THREE.Vector2[]
  holes: THREE.Vector2[][]
  surface: TextSurface
  angleOffsetRad: number
  angularDirection: AngularDirection
  /** Flat-layout bounds used to reject almost every glyph before polygon tests. */
  minX: number
  maxX: number
  minY: number
  maxY: number
}

interface FlatPolyGroup {
  angleOffsetRad: number
  angularDirection: AngularDirection
  polys: FlatPoly[]
  minX: number
  maxX: number
  minY: number
  maxY: number
}

function boundsForRings(outer: THREE.Vector2[], holes: THREE.Vector2[][]) {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const ring of [outer, ...holes]) {
    for (const p of ring) {
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y)
      maxY = Math.max(maxY, p.y)
    }
  }
  return { minX, maxX, minY, maxY }
}

function groupPolysByAngle(polys: FlatPoly[]): FlatPolyGroup[] {
  const groups = new Map<string, FlatPolyGroup>()
  for (const poly of polys) {
    const key = `${poly.angleOffsetRad}:${poly.angularDirection}`
    let group = groups.get(key)
    if (!group) {
      group = {
        angleOffsetRad: poly.angleOffsetRad,
        angularDirection: poly.angularDirection,
        polys: [],
        minX: Infinity,
        maxX: -Infinity,
        minY: Infinity,
        maxY: -Infinity,
      }
      groups.set(key, group)
    }
    group.polys.push(poly)
    group.minX = Math.min(group.minX, poly.minX)
    group.maxX = Math.max(group.maxX, poly.maxX)
    group.minY = Math.min(group.minY, poly.minY)
    group.maxY = Math.max(group.maxY, poly.maxY)
  }
  return [...groups.values()]
}

function pointInRing(point: THREE.Vector2, ring: THREE.Vector2[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]!.x
    const yi = ring[i]!.y
    const xj = ring[j]!.x
    const yj = ring[j]!.y
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + 1e-12) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function pointInPoly(point: THREE.Vector2, poly: FlatPoly): boolean {
  if (!pointInRing(point, poly.outer)) return false
  for (const hole of poly.holes) {
    if (pointInRing(point, hole)) return false
  }
  return true
}

/** Multi-sample point-in-poly so thin digit strokes still hit lathe vertices. */
function hitPolySoft(
  arc: number,
  y: number,
  poly: FlatPoly,
  sample: THREE.Vector2,
  softMm: number,
): boolean {
  if (
    arc < poly.minX - softMm ||
    arc > poly.maxX + softMm ||
    y < poly.minY - softMm ||
    y > poly.maxY + softMm
  ) {
    return false
  }

  // The center hits most interior vertices and avoids the other 8 tests.
  sample.set(arc, y)
  if (pointInPoly(sample, poly)) return true

  for (const dx of [-1, 0, 1]) {
    for (const dy of [-1, 0, 1]) {
      if (dx === 0 && dy === 0) continue
      sample.set(arc + dx * softMm, y + dy * softMm)
      if (pointInPoly(sample, poly)) return true
    }
  }
  return false
}

export interface TextLayout {
  /** Displacement masks (Tengwar / long runs). Date uses CSG instead. */
  polys: FlatPoly[]
  /** Ink fill meshes sitting inside the recesses. */
  previewGeometries: THREE.BufferGeometry[]
  /**
   * Solid letter cutter for the Latin date (inner face only).
   * CSG-subtracted from the band for full solid cavities - displacement cannot
   * resolve thin Inter strokes on a lathe mesh.
   */
  dateCutter: THREE.BufferGeometry | null
  sizeMm: number
  depthMm: number
  transcribedPreview?: string
}

const MAX_LAYOUT_CACHE = 4
const layoutCache = new Map<string, TextLayout>()

function textLayoutKey(params: RingParams): string {
  return JSON.stringify([
    params.innerDiameterMm,
    params.bandWidthMm,
    params.bandThicknessMm,
    params.bandProfile,
    params.waveAmplitudeMm,
    params.waveCount,
    params.wavePhaseDeg,
    params.waveSpanDeg,
    params.waveTopSpanDeg,
    params.waveBotSpanDeg,
    params.waveTopFlankMm,
    params.waveBotFlankMm,
    params.wavePinchAngleDeg,
    params.waveSharpness,
    params.waveAsymmetry,
    params.waveCharacter,
    params.innerText,
    params.innerDateText,
    params.innerTengwarKeys,
    params.outerText,
    params.outerTengwarKeys,
    params.textDepthMm,
    params.textSizeMm,
    params.dateTextSizeMm,
    params.textAngleDeg,
    params.innerTextAngleDeg,
    params.dateAngleDeg,
    params.font,
  ])
}

function cloneTextLayout(layout: TextLayout): TextLayout {
  return {
    // Polygon points are read-only during displacement and safe to share.
    polys: layout.polys,
    previewGeometries: layout.previewGeometries.map((geometry) => geometry.clone()),
    dateCutter: layout.dateCutter?.clone() ?? null,
    sizeMm: layout.sizeMm,
    depthMm: layout.depthMm,
    transcribedPreview: layout.transcribedPreview,
  }
}

function disposeTextLayout(layout: TextLayout): void {
  for (const geometry of layout.previewGeometries) geometry.dispose()
  layout.dateCutter?.dispose()
}

function getCachedTextLayout(key: string): TextLayout | null {
  const cached = layoutCache.get(key)
  if (!cached) return null
  // Refresh insertion order for LRU eviction.
  layoutCache.delete(key)
  layoutCache.set(key, cached)
  return cloneTextLayout(cached)
}

function cacheTextLayout(key: string, layout: TextLayout): void {
  const previous = layoutCache.get(key)
  if (previous) disposeTextLayout(previous)
  layoutCache.delete(key)
  layoutCache.set(key, cloneTextLayout(layout))
  while (layoutCache.size > MAX_LAYOUT_CACHE) {
    const oldestKey = layoutCache.keys().next().value as string | undefined
    if (!oldestKey) break
    const oldest = layoutCache.get(oldestKey)
    if (oldest) disposeTextLayout(oldest)
    layoutCache.delete(oldestKey)
  }
}

interface SurfaceJob {
  text: string
  surface: TextSurface
  radius: number
  angleRad: number
  sizeMm: number
  font: Font | Promise<Font>
  keysOverride?: string
  /** Date / Inter digits - solid CSG carve + ink */
  latinSafe?: boolean
  angularDirection: AngularDirection
}

export type AngularDirection = 1 | -1

/**
 * Build per-glyph OpenType paths with advances (never uses GSUB - safe for Inter).
 */
function pathsForLatinRun(font: Font, text: string, sizeMm: number): Path[] {
  const paths: Path[] = []
  let x = 0
  const scale = sizeMm / font.unitsPerEm
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    const g = font.charToGlyph(ch)
    if (i > 0) {
      try {
        const prev = font.charToGlyph(text[i - 1]!)
        x += font.getKerningValue(prev, g) * scale
      } catch {
        /* no kerning */
      }
    }
    paths.push(g.getPath(x, 0, sizeMm))
    x += g.advanceWidth * scale
  }
  return paths
}

/**
 * Layout a single text run onto the ring.
 * Glyph coords are centered (working placement from earlier versions).
 *
 * Date (latinSafe): solid CSG cutter + ink only - no displacement polys.
 * Thin Inter strokes cannot be resolved by vertex displacement on a lathe mesh.
 */
async function layoutTextRun(
  font: Font,
  rawText: string,
  sizeMm: number,
  depthMm: number,
  surface: TextSurface,
  radius: number,
  angleRad: number,
  angleOffsetRad: number,
  angularDirection: AngularDirection,
  keysOverride: string | undefined,
  latinSafe: boolean,
  dome: DomeParams,
  isCancelled: () => boolean,
): Promise<{
  polys: FlatPoly[]
  previews: THREE.BufferGeometry[]
  cutter: THREE.BufferGeometry | null
  encoded: string
  widthMm: number
}> {
  const encoded = resolveInscriptionText(rawText, keysOverride ?? '')
  if (!encoded) return { polys: [], previews: [], cutter: null, encoded: '', widthMm: 0 }

  let paths: Path[]
  if (latinSafe) {
    paths = pathsForLatinRun(font, encoded, sizeMm)
  } else {
    try {
      paths = font.getPaths(encoded, 0, 0, sizeMm)
    } catch {
      paths = pathsForLatinRun(font, encoded, sizeMm)
    }
  }

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const path of paths) {
    if (!path.commands.length) continue
    const bb = path.getBoundingBox()
    minX = Math.min(minX, bb.x1)
    maxX = Math.max(maxX, bb.x2)
    minY = Math.min(minY, bb.y1)
    maxY = Math.max(maxY, bb.y2)
  }
  if (!Number.isFinite(minX)) return { polys: [], previews: [], cutter: null, encoded, widthMm: 0 }

  // Center run at origin - same as the versions where date carved correctly
  const cx = (minX + maxX) / 2
  const cy = -((minY + maxY) / 2)
  const widthMm = maxX - minX

  const polys: FlatPoly[] = []
  const previews: THREE.BufferGeometry[] = []
  const cutterParts: THREE.BufferGeometry[] = []

  // Date needs a thick solid for CSG; ink extrude stays inside the pocket
  const inkDepth = Math.max(depthMm * 0.85, latinSafe ? 0.32 : 0.22)
  const cutterDepth = Math.max(depthMm + 0.25, 0.55)
  const curveSegs = latinSafe ? 24 : EXTRUDE_CURVE_SEGMENTS
  const polyDiv = POLY_DIVISIONS
  const holeDiv = POLY_HOLE_DIVISIONS

  try {
    for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
      if (pathIndex > 0 && pathIndex % 2 === 0) {
        await yieldToMain()
        if (isCancelled()) throw new DOMException('Build cancelled', 'AbortError')
      }

      const path = paths[pathIndex]!
      if (!path.commands.length) continue
      const shapes = pathToShapes(path)
      if (shapes.length === 0) continue

      // --- Ink solid (preview + visual fill) - entirely inside metal ---
      const inkGeom = new THREE.ExtrudeGeometry(shapes, {
        depth: inkDepth,
        bevelEnabled: false,
        curveSegments: curveSegs,
        steps: 1,
      })
      inkGeom.translate(-cx, -cy, 0)
      previews.push(
        bendOntoSurface(
          inkGeom,
          radius,
          angleRad,
          angularDirection,
          surface,
          depthMm,
          dome,
        ),
      )
      inkGeom.dispose()

      // Displacement masks (used for preview; skipped when final CSG runs on date)
      for (const shape of shapes) {
        const outer = shape
          .getPoints(latinSafe ? 64 : polyDiv)
          .map((p) => new THREE.Vector2(p.x - cx, p.y - cy))
        const holes = shape.holes.map((h) =>
          h
            .getPoints(latinSafe ? 32 : holeDiv)
            .map((p) => new THREE.Vector2(p.x - cx, p.y - cy)),
        )
        const bounds = boundsForRings(outer, holes)
        polys.push({
          outer,
          holes,
          surface,
          angleOffsetRad,
          angularDirection,
          ...bounds,
        })
      }

      if (latinSafe && surface === 'inner') {
        // CSG cutter for final builds - full solid cavities independent of mesh density
        const cutGeom = new THREE.ExtrudeGeometry(shapes, {
          depth: cutterDepth,
          bevelEnabled: false,
          curveSegments: Math.min(curveSegs, 12), // lighter cutter for faster CSG
          steps: 1,
        })
        cutGeom.translate(-cx, -cy, 0)
        cutterParts.push(
          bendDateCutter(
            cutGeom,
            radius,
            angleRad,
            angularDirection,
            depthMm,
            dome.edgeParams,
          ),
        )
        cutGeom.dispose()
      }
    }
  } catch (err) {
    for (const geometry of previews) geometry.dispose()
    for (const geometry of cutterParts) geometry.dispose()
    throw err
  }

  if (isCancelled()) {
    for (const geometry of previews) geometry.dispose()
    for (const geometry of cutterParts) geometry.dispose()
    throw new DOMException('Build cancelled', 'AbortError')
  }

  let cutter: THREE.BufferGeometry | null = null
  if (cutterParts.length > 0) {
    const merged = mergeGeometries(cutterParts, false)
    for (const g of cutterParts) g.dispose()
    if (merged) {
      merged.computeVertexNormals()
      cutter = merged
    }
  }

  return { polys, previews, cutter, encoded, widthMm }
}

/**
 * Pinch sector that inscriptions must not enter (radians).
 * `halfRad` includes a soft margin past the mesh pinch window.
 */
function pinchTextExclusion(
  params: RingParams,
): { phaseRad: number; halfRad: number } | null {
  if (params.bandProfile !== 'wave' || params.waveAmplitudeMm <= params.bandWidthMm) return null
  const { maxDeg } = edgeSpanDegs(params)
  if (maxDeg <= 0) return null
  const halfDeg = Math.min(170, maxDeg / 2 + PINCH_TEXT_MARGIN_DEG)
  return {
    phaseRad: normalizeAngle((params.wavePhaseDeg * Math.PI) / 180),
    halfRad: (halfDeg * Math.PI) / 180,
  }
}

/** Shortest absolute angular distance in [0, π]. */
function angularDistance(a: number, b: number): number {
  return Math.abs(normalizeAngle(a - b))
}

/** True if a centered run of half-angle `halfRun` intersects the pinch exclusion. */
function runOverlapsPinch(
  center: number,
  halfRun: number,
  excl: { phaseRad: number; halfRad: number },
): boolean {
  return angularDistance(center, excl.phaseRad) < excl.halfRad + Math.max(halfRun, 0)
}

/**
 * Conservative half-angle of a text run (radians) for pinch avoidance.
 * Slightly overestimates so we err on the side of the flat band.
 */
function estimateRunHalfAngleRad(
  text: string,
  keysOverride: string | undefined,
  sizeMm: number,
  radius: number,
  latinSafe: boolean,
): number {
  const raw = (keysOverride ?? text).trim()
  if (!raw) return 0
  // Count visible-ish units; keys strings are denser than plain Latin.
  const units = Math.max(raw.replace(/\s+/g, '').length, 1)
  const em = latinSafe ? 0.58 : 0.72
  const widthMm = Math.max(units * sizeMm * em, sizeMm * 0.9)
  return widthMm / 2 / Math.max(radius, 1e-3)
}

/**
 * Snap a preferred center into the flat (non-pinch) arc so the whole run fits.
 * When `avoid` is set, keep the runs from stacking.
 */
function placeCenterOnFlatBand(
  preferred: number,
  halfRun: number,
  excl: { phaseRad: number; halfRad: number } | null,
  avoid?: { center: number; half: number },
): number {
  if (!excl) return normalizeAngle(preferred)

  const gap = 0.12 // ~7° minimum air gap between runs
  const fits = (θ: number): boolean => {
    if (runOverlapsPinch(θ, halfRun, excl)) return false
    if (avoid && angularDistance(θ, avoid.center) < halfRun + avoid.half + gap) {
      return false
    }
    return true
  }

  const pref = normalizeAngle(preferred)
  if (fits(pref)) return pref

  // Prefer the middle of the flat sector (opposite the pinch).
  const flatCenter = normalizeAngle(excl.phaseRad + Math.PI)
  if (fits(flatCenter)) return flatCenter

  // Scan the circle; score by proximity to preferred + separation from avoid.
  let best = flatCenter
  let bestScore = -Infinity
  const samples = 180
  for (let i = 0; i < samples; i++) {
    const θ = (i / samples) * Math.PI * 2
    if (!fits(θ)) continue
    const nearPref = -angularDistance(θ, pref)
    const awayAvoid = avoid ? angularDistance(θ, avoid.center) : 0
    const score = nearPref * 0.35 + awayAvoid
    if (score > bestScore) {
      bestScore = score
      best = θ
    }
  }
  return normalizeAngle(best)
}

/**
 * Layout inner (primary + Latin date) and/or outer inscriptions.
 *
 * Placement:
 * - Wave inner + outer text share `textAngleDeg` and are snapped onto the flat
 *   sector. D-shaped inner text uses `innerTextAngleDeg` independently.
 * - D-shaped outer text continues to use `textAngleDeg`.
 * - Date uses its independent center angle (`dateAngleDeg`) exactly. Explicit
 *   positioning must remain continuous, including through the pinch sector.
 */
export async function buildTextLayout(
  params: RingParams,
  isCancelled: () => boolean = () => false,
): Promise<TextLayout | null> {
  const cacheKey = textLayoutKey(params)
  const cached = getCachedTextLayout(cacheKey)
  if (cached) return cached

  const usableWidth = minBandWidthMm(params)
  const sizeMm = Math.min(params.textSizeMm, usableWidth * 0.55)
  const dateSizeMm = Math.min(
    params.dateTextSizeMm > 0 ? params.dateTextSizeMm : sizeMm * 0.9,
    usableWidth * 0.55,
  )
  const depthMm = Math.min(params.textDepthMm, params.bandThicknessMm * 0.75)
  const innerR = params.innerDiameterMm / 2
  const outerR = innerR + params.bandThicknessMm

  const primaryFont = await loadRingFont(params.font)
  if (isCancelled()) throw new DOMException('Build cancelled', 'AbortError')
  const dome: DomeParams = {
    innerR,
    thickness: params.bandThicknessMm,
    halfW: params.bandWidthMm / 2,
    edgeParams: params,
  }

  const excl = pinchTextExclusion(params)
  const preferredPrimary = (params.textAngleDeg * Math.PI) / 180
  const preferredDInner = (params.innerTextAngleDeg * Math.PI) / 180
  const preferredDate = (params.dateAngleDeg * Math.PI) / 180

  const hasInner = !!(params.innerText.trim() || params.innerTengwarKeys.trim())
  const hasOuter = !!(params.outerText.trim() || params.outerTengwarKeys.trim())
  const hasDate = !!params.innerDateText.trim()

  const primaryHalf = hasInner
    ? estimateRunHalfAngleRad(
        params.innerText,
        params.innerTengwarKeys || undefined,
        sizeMm,
        innerR,
        false,
      )
    : hasOuter
      ? estimateRunHalfAngleRad(
          params.outerText,
          params.outerTengwarKeys || undefined,
          sizeMm,
          outerR,
          false,
        )
      : 0
  const outerHalf = hasOuter
    ? estimateRunHalfAngleRad(
        params.outerText,
        params.outerTengwarKeys || undefined,
        sizeMm,
        outerR,
        false,
      )
    : 0
  // Wave inner + outer text share this pinch-safe position. On D bands it is
  // the independent outer-text position because no pinch exclusion applies.
  const sharedTextAngle = placeCenterOnFlatBand(
    preferredPrimary,
    Math.max(primaryHalf, outerHalf),
    excl,
  )
  const innerTextAngle =
    params.bandProfile === 'd' ? normalizeAngle(preferredDInner) : sharedTextAngle
  // Independent manufacturing parameter: never snap or collapse slider ranges.
  const dateAngle = normalizeAngle(preferredDate)

  const jobs: SurfaceJob[] = []

  if (hasInner) {
    jobs.push({
      text: params.innerText.trim(),
      surface: 'inner',
      radius: innerR,
      angleRad: innerTextAngle,
      sizeMm,
      font: primaryFont,
      keysOverride: params.innerTengwarKeys.trim() || undefined,
      angularDirection: -1,
    })
  }
  if (hasDate) {
    jobs.push({
      text: params.innerDateText.trim(),
      surface: 'inner',
      angleRad: dateAngle,
      radius: innerR,
      sizeMm: Math.max(dateSizeMm, 1.25),
      font: loadDateFont(),
      latinSafe: true,
      angularDirection: -1,
    })
  }
  if (hasOuter) {
    jobs.push({
      text: params.outerText.trim(),
      surface: 'outer',
      angleRad: sharedTextAngle,
      sizeMm,
      radius: outerR,
      font: primaryFont,
      keysOverride: params.outerTengwarKeys.trim() || undefined,
      angularDirection: 1,
    })
  }
  if (jobs.length === 0) return null

  const polys: FlatPoly[] = []
  const previewGeometries: THREE.BufferGeometry[] = []
  let dateCutter: THREE.BufferGeometry | null = null
  let transcribedPreview: string | undefined

  try {
    for (const job of jobs) {
      const font = await job.font
      if (isCancelled()) throw new DOMException('Build cancelled', 'AbortError')
      const isDate = !!job.latinSafe
      const result = await layoutTextRun(
        font,
        job.text,
        job.sizeMm,
        depthMm,
        job.surface,
        job.radius,
        job.angleRad,
        // Absolute world angle for displacement masks (must match bendOntoSurface).
        // Do not store relative-to-textAngleDeg — wave snap would then re-center wrong.
        job.angleRad,
        job.angularDirection,
        job.keysOverride,
        !!job.latinSafe,
        dome,
        isCancelled,
      )
      polys.push(...result.polys)
      previewGeometries.push(...result.previews)
      if (result.cutter) {
        if (dateCutter) dateCutter.dispose()
        dateCutter = result.cutter
      }
      if (job.surface === 'inner' && !isDate && result.encoded) {
        transcribedPreview = result.encoded
      }
    }
  } catch (err) {
    for (const geometry of previewGeometries) geometry.dispose()
    dateCutter?.dispose()
    throw err
  }

  if (polys.length === 0 && previewGeometries.length === 0 && !dateCutter) return null
  const layout = { polys, previewGeometries, dateCutter, sizeMm, depthMm, transcribedPreview }
  cacheTextLayout(cacheKey, layout)
  return layout
}

/**
 * Map layout-x onto cylinder angle.
 * The caller selects the reading direction for each inscription run. Inner
 * text and the date use -1; outer text uses +1.
 */
export function layoutXToWorldAngle(
  layoutX: number,
  radius: number,
  startAngleRad: number,
  angularDirection: AngularDirection = 1,
): number {
  return startAngleRad + (angularDirection * layoutX) / radius
}

/** Shortest-path arc length from refAngle to theta (handles atan2 wrap at ±π). */
function wrappedArcMm(
  theta: number,
  refAngle: number,
  radius: number,
  angularDirection: AngularDirection,
): number {
  // Both angles are normalized, so one correction puts their delta in [-π, π].
  let d = theta - refAngle
  if (d > Math.PI) d -= Math.PI * 2
  else if (d < -Math.PI) d += Math.PI * 2
  return angularDirection * d * radius
}

function normalizeAngle(angle: number): number {
  let normalized = angle % (Math.PI * 2)
  if (normalized > Math.PI) normalized -= Math.PI * 2
  else if (normalized < -Math.PI) normalized += Math.PI * 2
  return normalized
}

/**
 * Bend flat glyph mesh onto the ring so ink sits fully inside the metal pocket
 * (recessed engraving fill - never embossed into the hole).
 */
function bendOntoSurface(
  geometry: THREE.BufferGeometry,
  radius: number,
  startAngleRad: number,
  angularDirection: AngularDirection,
  surface: TextSurface,
  pocketDepth: number,
  dome: DomeParams,
): THREE.BufferGeometry {
  const geom = geometry.clone()
  const pos = geom.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  geom.computeBoundingBox()
  const zMin = geom.boundingBox!.min.z
  const zMax = geom.boundingBox!.max.z
  const extrude = Math.max(zMax - zMin, 0.1)
  const depth = Math.max(pocketDepth, 0.22)
  const insetFront = 0.06
  const floor = depth

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const angle = layoutXToWorldAngle(v.x, radius, startAngleRad, angularDirection)
    // ExtrudeGeometry: glyph face at zMin → near free surface; back at zMax → pocket floor
    const t = (v.z - zMin) / extrude
    const along = insetFront + t * (floor - insetFront)
    const cosA = Math.cos(angle)
    const sinA = Math.sin(angle)

    if (surface === 'inner') {
      // Into metal = larger r (never into the hole). Offset y by local mid so
      // glyphs sit centered on the sculpted section, not the global equator.
      const edges = bandEdgesAt(angle, dome.edgeParams)
      const radial = radius + along
      pos.setXYZ(i, cosA * radial, sinA * radial, v.y + edges.zMid)
    } else {
      const edges = bandEdgesAt(angle, dome.edgeParams)
      const zAx = v.y + edges.zMid
      const { r: rSurf, ur, uz } = outerDomeFrame(
        zAx,
        dome.innerR,
        dome.thickness,
        edges.halfW,
        edges.zMid,
      )
      const r = rSurf - along * ur
      const zOut = zAx - along * uz
      pos.setXYZ(i, cosA * r, sinA * r, zOut)
    }
  }

  pos.needsUpdate = true
  geom.computeVertexNormals()
  return geom
}

/**
 * Bend a solid date glyph into a CSG cutter that crosses the inner wall.
 * Front (glyph face) peeks slightly into the hole so subtraction opens a cavity;
 * back sits deep in the metal. Result: recessed digits, not embossed blocks.
 */
function bendDateCutter(
  geometry: THREE.BufferGeometry,
  radius: number,
  startAngleRad: number,
  angularDirection: AngularDirection,
  pocketDepth: number,
  edgeParams: WaveEdgeParams,
): THREE.BufferGeometry {
  const geom = geometry.clone()
  const pos = geom.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  geom.computeBoundingBox()
  const zMin = geom.boundingBox!.min.z
  const zMax = geom.boundingBox!.max.z
  const extrude = Math.max(zMax - zMin, 0.1)
  const depth = Math.max(pocketDepth, 0.3)
  // Small overshoot into the hole so the free surface is opened by CSG
  const intoHole = 0.1
  const intoMetal = depth + 0.12

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const angle = layoutXToWorldAngle(v.x, radius, startAngleRad, angularDirection)
    const t = (v.z - zMin) / extrude // 0 glyph face → 1 extruded back
    // t=0 at free side (into hole), t=1 deep in metal
    const along = -intoHole + t * (intoMetal + intoHole)
    const radial = radius + along
    const zMid = bandEdgesAt(angle, edgeParams).zMid
    pos.setXYZ(i, Math.cos(angle) * radial, Math.sin(angle) * radial, v.y + zMid)
  }

  pos.needsUpdate = true
  geom.computeVertexNormals()
  return geom
}

const YIELD_EVERY_VERTS = 4_000

function yieldToMain(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

/**
 * Carve inscriptions into ring vertices - recesses into the metal.
 * Inner: push vertices to larger radius (away from hole).
 * Outer: push along dome normal into the band.
 */
export async function engraveByDisplacement(
  ringGeometry: THREE.BufferGeometry,
  polys: FlatPoly[],
  params: RingParams,
  isCancelled?: () => boolean,
): Promise<THREE.BufferGeometry> {
  // buildRing passes an owned clone from the blank-band cache. Mutate that
  // working geometry directly instead of cloning the entire mesh a second time.
  const geom = ringGeometry
  const pos = geom.attributes.position as THREE.BufferAttribute
  const innerR = params.innerDiameterMm / 2
  const thickness = params.bandThicknessMm
  const outerR = innerR + thickness
  const depth = Math.min(params.textDepthMm, thickness * 0.75)
  const maxHalf = maxBandHalfExtentMm(params)

  const innerGroups = groupPolysByAngle(polys.filter((p) => p.surface === 'inner'))
  const outerGroups = groupPolysByAngle(polys.filter((p) => p.surface === 'outer'))
  // angleOffsetRad is already absolute world angle from layout (pinch-safe on wave).
  for (const group of [...innerGroups, ...outerGroups]) {
    group.angleOffsetRad = normalizeAngle(group.angleOffsetRad)
  }

  const sample = new THREE.Vector2()
  const v = new THREE.Vector3()
  let carved = 0
  let sinceYield = 0

  const innerRMin = innerR - 0.05
  const innerRMax = innerR + depth + 0.4
  const count = pos.count

  for (let i = 0; i < count; i++) {
    if (++sinceYield >= YIELD_EVERY_VERTS) {
      sinceYield = 0
      await yieldToMain()
      if (isCancelled?.()) {
        throw new DOMException('Build cancelled', 'AbortError')
      }
    }

    v.fromBufferAttribute(pos, i)
    const r = Math.hypot(v.x, v.y)
    if (Math.abs(v.z) > maxHalf + 0.08) continue

    const theta = Math.atan2(v.y, v.x)
    const edges = bandEdgesAt(theta, params)
    // Flat layout y is relative to local section mid (glyphs centered on local width)
    const localY = v.z - edges.zMid

    // Invert each run's bend direction. Inner text and the date use -1;
    // outer text uses +1.
    // Soft multi-sample catches thin Inter date strokes between mesh vertices.
    if (innerGroups.length && r >= innerRMin && r <= innerRMax) {
      let hit = false
      for (const group of innerGroups) {
        const a0 = wrappedArcMm(
          theta,
          group.angleOffsetRad,
          innerR,
          group.angularDirection,
        )
        const softMm = 0.06
        if (
          a0 < group.minX - softMm ||
          a0 > group.maxX + softMm ||
          localY < group.minY - softMm ||
          localY > group.maxY + softMm
        ) {
          continue
        }
        for (const poly of group.polys) {
          if (hitPolySoft(a0, localY, poly, sample, softMm)) {
            hit = true
            break
          }
        }
        if (hit) break
      }
      if (hit) {
        // Recess into metal: move free-surface verts deeper (larger r)
        const targetR = innerR + depth
        if (r < targetR - 1e-6) {
          const s = targetR / (r || 1e-6)
          pos.setXYZ(i, v.x * s, v.y * s, v.z)
          carved++
          continue
        }
      }
    }

    if (outerGroups.length) {
      const { r: rSurf, ur, uz } = outerDomeFrame(
        v.z,
        innerR,
        thickness,
        edges.halfW,
        edges.zMid,
      )
      if (Math.abs(r - rSurf) > depth + 0.25) continue

      let hit = false
      for (const group of outerGroups) {
        const a0 = wrappedArcMm(
          theta,
          group.angleOffsetRad,
          outerR,
          group.angularDirection,
        )
        const softMm = 0.05
        if (
          a0 < group.minX - softMm ||
          a0 > group.maxX + softMm ||
          localY < group.minY - softMm ||
          localY > group.maxY + softMm
        ) {
          continue
        }
        for (const poly of group.polys) {
          if (hitPolySoft(a0, localY, poly, sample, softMm)) {
            hit = true
            break
          }
        }
        if (hit) break
      }
      if (hit) {
        const cosT = Math.cos(theta)
        const sinT = Math.sin(theta)
        pos.setXYZ(
          i,
          v.x - depth * ur * cosT,
          v.y - depth * ur * sinT,
          v.z - depth * uz,
        )
        carved++
      }
    }
  }

  if (carved === 0 && polys.length > 0) {
    console.warn('Engraving displacement hit 0 vertices')
  }

  pos.needsUpdate = true
  geom.computeVertexNormals()
  return geom
}

export function mergePreview(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (geoms.length === 0) return null
  return mergeGeometries(geoms, false)
}
