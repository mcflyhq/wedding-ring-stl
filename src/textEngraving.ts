import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { parse, type Font, type Path } from 'opentype.js'
import { outerDomeFrame } from './ringGeometry'
import type { RingParams, TextSurface } from './types'
import { DATE_FONT_PATH, FONT_PATHS } from './types'
import { resolveInscriptionText } from './tengwarTranscribe'

/** Band cross-section params needed to map outer ink onto the D-profile dome. */
interface DomeParams {
  innerR: number
  thickness: number
  halfW: number
}

const fontCache = new Map<string, Font>()

/** Curve tessellation for ExtrudeGeometry — smooth Annatar + Inter digits. */
const EXTRUDE_CURVE_SEGMENTS = 16
/** Outline sampling for displacement masks. */
const POLY_DIVISIONS = 48
const POLY_HOLE_DIVISIONS = 24

async function loadFontFromPath(path: string): Promise<Font> {
  const cached = fontCache.get(path)
  if (cached) return cached

  const res = await fetch(path)
  if (!res.ok) {
    throw new Error(`Failed to fetch font (${res.status}): ${path}`)
  }
  const font = parse(await res.arrayBuffer())
  fontCache.set(path, font)
  return font
}

export async function loadFont(key: RingParams['font']): Promise<Font> {
  return loadFontFromPath(FONT_PATHS[key])
}

export async function loadDateFont(): Promise<Font> {
  return loadFontFromPath(DATE_FONT_PATH)
}

/**
 * OpenType path → THREE shapes (Y flipped for upright glyphs).
 * Forces outer rings to positive area so ExtrudeGeometry fills solidly.
 */
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
  const shapes = shapePath.toShapes()
  // Ensure outer contour winds for solid fill after Y-flip
  for (const shape of shapes) {
    ensurePositiveArea(shape)
    for (const hole of shape.holes) ensureNegativeArea(hole)
  }
  return shapes
}

function signedArea(pts: THREE.Vector2[]): number {
  let a = 0
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i]!
    const q = pts[(i + 1) % n]!
    a += p.x * q.y - q.x * p.y
  }
  return a * 0.5
}

function rebuildFromPoints(target: THREE.Path | THREE.Shape, pts: THREE.Vector2[]): void {
  if (pts.length < 3) return
  target.curves.length = 0
  target.moveTo(pts[0]!.x, pts[0]!.y)
  for (let i = 1; i < pts.length; i++) target.lineTo(pts[i]!.x, pts[i]!.y)
  target.closePath()
}

function ensurePositiveArea(shape: THREE.Shape): void {
  const pts = shape.getPoints(48)
  if (pts.length < 3) return
  if (signedArea(pts) < 0) rebuildFromPoints(shape, pts.slice().reverse())
}

function ensureNegativeArea(path: THREE.Path): void {
  const pts = path.getPoints(32)
  if (pts.length < 3) return
  if (signedArea(pts) > 0) rebuildFromPoints(path, pts.slice().reverse())
}

export interface FlatPoly {
  outer: THREE.Vector2[]
  holes: THREE.Vector2[][]
  surface: TextSurface
  angleOffsetRad: number
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
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
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
   * CSG-subtracted from the band for full solid cavities — displacement cannot
   * resolve thin Inter strokes on a lathe mesh.
   */
  dateCutter: THREE.BufferGeometry | null
  sizeMm: number
  depthMm: number
  transcribedPreview?: string
}

interface SurfaceJob {
  text: string
  surface: TextSurface
  radius: number
  angleRad: number
  sizeMm: number
  font: Font | Promise<Font>
  keysOverride?: string
  /** Date / Inter digits — solid CSG carve + ink */
  latinSafe?: boolean
}

/**
 * Build per-glyph OpenType paths with advances (never uses GSUB — safe for Inter).
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
 * Date (latinSafe): solid CSG cutter + ink only — no displacement polys.
 * Thin Inter strokes cannot be resolved by vertex displacement on a lathe mesh.
 */
function layoutTextRun(
  font: Font,
  rawText: string,
  sizeMm: number,
  depthMm: number,
  surface: TextSurface,
  radius: number,
  angleRad: number,
  angleOffsetRad: number,
  keysOverride: string | undefined,
  latinSafe: boolean,
  dome: DomeParams,
): {
  polys: FlatPoly[]
  previews: THREE.BufferGeometry[]
  cutter: THREE.BufferGeometry | null
  encoded: string
  widthMm: number
} {
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

  // Center run at origin — same as the versions where date carved correctly
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

  for (const path of paths) {
    if (!path.commands.length) continue
    const shapes = pathToShapes(path)
    if (shapes.length === 0) continue

    // --- Ink solid (preview + visual fill) — entirely inside metal ---
    const inkGeom = new THREE.ExtrudeGeometry(shapes, {
      depth: inkDepth,
      bevelEnabled: false,
      curveSegments: curveSegs,
      steps: 1,
    })
    inkGeom.translate(-cx, -cy, 0)
    previews.push(bendOntoSurface(inkGeom, radius, angleRad, surface, depthMm, dome))
    inkGeom.dispose()

    // Displacement masks (used for preview; skipped when final CSG runs on date)
    for (const shape of shapes) {
      const outer = shape
        .getPoints(latinSafe ? 64 : polyDiv)
        .map((p) => new THREE.Vector2(p.x - cx, p.y - cy))
      const holes = shape.holes.map((h) =>
        h.getPoints(latinSafe ? 32 : holeDiv).map((p) => new THREE.Vector2(p.x - cx, p.y - cy)),
      )
      polys.push({
        outer,
        holes,
        surface,
        angleOffsetRad,
      })
    }

    if (latinSafe && surface === 'inner') {
      // CSG cutter for final builds — full solid cavities independent of mesh density
      const cutGeom = new THREE.ExtrudeGeometry(shapes, {
        depth: cutterDepth,
        bevelEnabled: false,
        curveSegments: Math.min(curveSegs, 12), // lighter cutter for faster CSG
        steps: 1,
      })
      cutGeom.translate(-cx, -cy, 0)
      cutterParts.push(bendDateCutter(cutGeom, radius, angleRad, depthMm))
      cutGeom.dispose()
    }
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
 * Layout inner (primary + Latin date) and/or outer inscriptions.
 *
 * Placement (restored from working versions):
 * - Primary inner + outer share the same center angle (`textAngleDeg`).
 * - Date is centered opposite the primary run’s midpoint (not the start),
 *   so long Tengwar does not collide with the date.
 */
export async function buildTextLayout(params: RingParams): Promise<TextLayout | null> {
  const sizeMm = Math.min(params.textSizeMm, params.bandWidthMm * 0.55)
  const dateSizeMm = Math.min(
    params.dateTextSizeMm > 0 ? params.dateTextSizeMm : sizeMm * 0.9,
    params.bandWidthMm * 0.55,
  )
  const depthMm = Math.min(params.textDepthMm, params.bandThicknessMm * 0.75)
  const startAngle = (params.textAngleDeg * Math.PI) / 180
  const innerR = params.innerDiameterMm / 2
  const outerR = innerR + params.bandThicknessMm

  const primaryFont = await loadFont(params.font)
  const dome: DomeParams = {
    innerR,
    thickness: params.bandThicknessMm,
    halfW: params.bandWidthMm / 2,
  }

  // Date is centered diametrically opposite the primary (center-aligned) run.
  const dateAngle = startAngle + Math.PI

  const jobs: SurfaceJob[] = []

  if (params.innerText.trim() || params.innerTengwarKeys.trim()) {
    jobs.push({
      text: params.innerText.trim(),
      surface: 'inner',
      radius: innerR,
      angleRad: startAngle,
      sizeMm,
      font: primaryFont,
      keysOverride: params.innerTengwarKeys.trim() || undefined,
    })
  }
  if (params.innerDateText.trim()) {
    jobs.push({
      text: params.innerDateText.trim(),
      surface: 'inner',
      // Opposite the primary inscription center (working classic placement)
      angleRad: dateAngle,
      radius: innerR,
      sizeMm: Math.max(dateSizeMm, 1.25),
      font: loadDateFont(),
      latinSafe: true,
    })
  }
  if (params.outerText.trim() || params.outerTengwarKeys.trim()) {
    jobs.push({
      text: params.outerText.trim(),
      surface: 'outer',
      // Same angular center as primary inner
      angleRad: startAngle,
      sizeMm,
      radius: outerR,
      font: primaryFont,
      keysOverride: params.outerTengwarKeys.trim() || undefined,
    })
  }
  if (jobs.length === 0) return null

  const polys: FlatPoly[] = []
  const previewGeometries: THREE.BufferGeometry[] = []
  let dateCutter: THREE.BufferGeometry | null = null
  let transcribedPreview: string | undefined

  for (const job of jobs) {
    const font = await job.font
    const isDate = !!job.latinSafe
    const result = layoutTextRun(
      font,
      job.text,
      job.sizeMm,
      depthMm,
      job.surface,
      job.radius,
      job.angleRad,
      job.angleRad - startAngle,
      job.keysOverride,
      !!job.latinSafe,
      dome,
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

  if (polys.length === 0 && previewGeometries.length === 0 && !dateCutter) return null
  return { polys, previewGeometries, dateCutter, sizeMm, depthMm, transcribedPreview }
}

/**
 * Map layout-x onto cylinder angle.
 * Restored working convention:
 *   inner: θ = start − x/r
 *   outer: θ = start + x/r  (via signedArc flip)
 * so ink + displacement stay aligned and date at ±π samples correctly with wrap.
 */
function layoutXToWorldAngle(
  layoutX: number,
  radius: number,
  startAngleRad: number,
  surface: TextSurface,
): number {
  const signedArc = surface === 'inner' ? layoutX : -layoutX
  return startAngleRad - signedArc / radius
}

/** Shortest-path arc length from refAngle to theta (handles atan2 wrap at ±π). */
function wrappedArcMm(theta: number, refAngle: number, radius: number, invert: boolean): number {
  // invert=true → (ref − theta) as used by the original inner sampler
  let d = invert ? refAngle - theta : theta - refAngle
  d = Math.atan2(Math.sin(d), Math.cos(d))
  return d * radius
}

/**
 * Bend flat glyph mesh onto the ring so ink sits fully inside the metal pocket
 * (recessed engraving fill — never embossed into the hole).
 */
function bendOntoSurface(
  geometry: THREE.BufferGeometry,
  radius: number,
  startAngleRad: number,
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
    const angle = layoutXToWorldAngle(v.x, radius, startAngleRad, surface)
    // ExtrudeGeometry: glyph face at zMin → near free surface; back at zMax → pocket floor
    const t = (v.z - zMin) / extrude
    const along = insetFront + t * (floor - insetFront)
    const cosA = Math.cos(angle)
    const sinA = Math.sin(angle)

    if (surface === 'inner') {
      // Into metal = larger r (never into the hole)
      const radial = radius + along
      pos.setXYZ(i, cosA * radial, sinA * radial, v.y)
    } else {
      const zAx = v.y
      const { r: rSurf, ur, uz } = outerDomeFrame(zAx, dome.innerR, dome.thickness, dome.halfW)
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
  pocketDepth: number,
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
    const angle = layoutXToWorldAngle(v.x, radius, startAngleRad, 'inner')
    const t = (v.z - zMin) / extrude // 0 glyph face → 1 extruded back
    // t=0 at free side (into hole), t=1 deep in metal
    const along = -intoHole + t * (intoMetal + intoHole)
    const radial = radius + along
    pos.setXYZ(i, Math.cos(angle) * radial, Math.sin(angle) * radial, v.y)
  }

  pos.needsUpdate = true
  geom.computeVertexNormals()
  return geom
}

const YIELD_EVERY_VERTS = 12_000

function yieldToMain(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

/**
 * Carve inscriptions into ring vertices — recesses into the metal.
 * Inner: push vertices to larger radius (away from hole).
 * Outer: push along dome normal into the band.
 */
export async function engraveByDisplacement(
  ringGeometry: THREE.BufferGeometry,
  polys: FlatPoly[],
  params: RingParams,
  isCancelled?: () => boolean,
): Promise<THREE.BufferGeometry> {
  const geom = ringGeometry.clone()
  const pos = geom.attributes.position as THREE.BufferAttribute
  const innerR = params.innerDiameterMm / 2
  const thickness = params.bandThicknessMm
  const outerR = innerR + thickness
  const depth = Math.min(params.textDepthMm, thickness * 0.75)
  const baseAngle = (params.textAngleDeg * Math.PI) / 180
  const halfBand = params.bandWidthMm / 2

  const innerPolys = polys.filter((p) => p.surface === 'inner')
  const outerPolys = polys.filter((p) => p.surface === 'outer')

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
        geom.dispose()
        throw new DOMException('Build cancelled', 'AbortError')
      }
    }

    v.fromBufferAttribute(pos, i)
    const r = Math.hypot(v.x, v.y)
    if (Math.abs(v.z) > halfBand + 0.05) continue

    const theta = Math.atan2(v.y, v.x)

    // Match working bend: inner uses (ref − θ)·r, outer (θ − ref)·r, with wrap.
    // Soft multi-sample catches thin Inter date strokes between mesh vertices.
    if (innerPolys.length && r >= innerRMin && r <= innerRMax) {
      let hit = false
      for (const poly of innerPolys) {
        const angle = baseAngle + poly.angleOffsetRad
        const a0 = wrappedArcMm(theta, angle, innerR, true)
        if (hitPolySoft(a0, v.z, poly, sample, 0.06)) {
          hit = true
          break
        }
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

    if (outerPolys.length) {
      const { r: rSurf, ur, uz } = outerDomeFrame(v.z, innerR, thickness, halfBand)
      if (Math.abs(r - rSurf) > depth + 0.25) continue

      let hit = false
      for (const poly of outerPolys) {
        const angle = baseAngle + poly.angleOffsetRad
        const a0 = wrappedArcMm(theta, angle, outerR, false)
        if (hitPolySoft(a0, v.z, poly, sample, 0.05)) {
          hit = true
          break
        }
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
