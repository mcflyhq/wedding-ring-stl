import * as THREE from 'three'
import { getBlankBandGeometry } from './buildCache'
import type { TextLayout } from './textEngraving'
import type { RingParams } from './types'
import { METAL_COLORS } from './types'

export interface BuildStages {
  mode: BuildMode
  /** Vertex displacement ran for inscriptions (includes date on preview). */
  ranDisplacement: boolean
  /** Expensive solid date CSG cavities - final/export only. */
  ranDateCsg: boolean
  /** Wall-clock ms for this build (includes layout + carve). */
  durationMs: number
  layoutMs: number
  displacementMs: number
  dateCsgMs: number
}

export interface BuiltRing {
  /** Full group: band + visible inscription fill (preview). Export uses `exportMesh`. */
  group: THREE.Group
  /** Mesh to export as STL (band with recessed engraving only). */
  exportMesh: THREE.Mesh
  geometry: THREE.BufferGeometry
  triangleCount: number
  cutawayPlane: THREE.Plane | null
  /** Observable stage flags for performance tests / debugging. */
  stages: BuildStages
}

export interface BuildOptions {
  /**
   * `preview` - interactive: draft-friendly, **skip date CSG**; date still recessed via displacement.
   * `settled` - selected mesh quality for the viewport, still without blocking CSG.
   * `final` - export-grade: user quality + solid date CSG cavities.
   */
  mode?: BuildMode
  /** Override mesh quality (used for live draft while dragging). */
  qualityOverride?: RingParams['quality']
  /** Return true to abandon mid-build (generation cancelled). */
  isCancelled?: () => boolean
}

export type BuildMode = 'preview' | 'settled' | 'final'

function metalMaterial(params: RingParams, clipped: THREE.Plane | null): THREE.MeshStandardMaterial {
  const color = METAL_COLORS[params.metal]
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.88,
    roughness: 0.26,
    envMapIntensity: 1.0,
    side: THREE.DoubleSide,
    clippingPlanes: clipped ? [clipped] : [],
    clipShadows: true,
  })
}

/** Darker fill for lettering - sits inside recessed pockets. */
function inkMaterial(clipped: THREE.Plane | null): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x1c140a,
    metalness: 0.35,
    roughness: 0.5,
    envMapIntensity: 0.4,
    side: THREE.DoubleSide,
    flatShading: false,
    clippingPlanes: clipped ? [clipped] : [],
    clipShadows: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
}

function yieldToMain(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

function throwIfCancelled(isCancelled: () => boolean): void {
  if (isCancelled()) throw new DOMException('Build cancelled', 'AbortError')
}

function makeCutawayPlane(params: RingParams): THREE.Plane | null {
  if (!params.cutaway) return null
  const angle = (params.textAngleDeg * Math.PI) / 180
  return new THREE.Plane(new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0), 0)
}

function disposeLayout(layout: TextLayout | null): void {
  if (!layout) return
  layout.dateCutter?.dispose()
  for (const g of layout.previewGeometries) g.dispose()
}

function triangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.index
  return index
    ? index.count / 3
    : (geometry.getAttribute('position')?.count ?? 0) / 3
}

/**
 * Produce the visible base band without loading fonts or engraving code.
 * Used for the first paint so a manipulable ring appears immediately.
 */
export function buildBlankRing(
  params: RingParams,
  quality: RingParams['quality'] = 'draft',
): BuiltRing {
  const t0 =
    typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : Date.now()
  const workParams = { ...params, quality }
  const geometry = getBlankBandGeometry(workParams)
  const cutawayPlane = makeCutawayPlane(params)
  const mesh = new THREE.Mesh(geometry, metalMaterial(params, cutawayPlane))
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.name = 'wedding-ring-band'

  const group = new THREE.Group()
  group.name = 'wedding-ring'
  group.add(mesh)

  const t1 =
    typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : Date.now()
  return {
    group,
    exportMesh: mesh,
    geometry,
    triangleCount: Math.round(triangleCount(geometry)),
    cutawayPlane,
    stages: {
      mode: 'preview',
      ranDisplacement: false,
      ranDateCsg: false,
      durationMs: Math.round(t1 - t0),
      layoutMs: 0,
      displacementMs: 0,
      dateCsgMs: 0,
    },
  }
}

/** Dispose a built ring that was superseded by a newer generation. */
export function disposeBuiltRing(built: BuiltRing): void {
  built.group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose()
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose())
      else obj.material.dispose()
    }
  })
}

/**
 * Build ring + inscription.
 *
 * Performance contract:
 * - **preview**: displacement for all inscriptions (including date) - metal recesses without CSG cost
 * - **settled**: selected mesh quality for the viewport, without CSG
 * - **final**: same displacement, then date CSG for solid export-grade cavities
 *
 * Order: displace on clean lathe first, then optional CSG (avoids densifying mesh before Tengwar walk).
 */
export async function buildRing(
  params: RingParams,
  options: BuildOptions = {},
): Promise<BuiltRing> {
  const t0 =
    typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : Date.now()
  const mode = options.mode ?? 'final'
  const isCancelled = options.isCancelled ?? (() => false)

  const workParams: RingParams = options.qualityOverride
    ? { ...params, quality: options.qualityOverride }
    : params

  let bandGeom = getBlankBandGeometry(workParams)
  let layout: TextLayout | null = null
  let ranDisplacement = false
  let ranDateCsg = false
  let layoutMs = 0
  let displacementMs = 0
  let dateCsgMs = 0

  try {
    throwIfCancelled(isCancelled)

    await yieldToMain()
    throwIfCancelled(isCancelled)

    const layoutStart =
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now()
    const { buildTextLayout, engraveByDisplacement } = await import('./textEngraving')
    throwIfCancelled(isCancelled)

    layout = await buildTextLayout(workParams, isCancelled)
    layoutMs = Math.round(
      (typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now()) - layoutStart,
    )
    throwIfCancelled(isCancelled)

    await yieldToMain()
    throwIfCancelled(isCancelled)

    // 1) Displacement on clean lathe - Tengwar + date recesses (ink-off visibility)
    if (layout && layout.polys.length > 0) {
      const displacementStart =
        typeof performance !== 'undefined' && performance.now
          ? performance.now()
          : Date.now()
      const next = await engraveByDisplacement(
        bandGeom,
        layout.polys,
        workParams,
        isCancelled,
      )
      ranDisplacement = true
      displacementMs = Math.round(
        (typeof performance !== 'undefined' && performance.now
          ? performance.now()
          : Date.now()) - displacementStart,
      )
      if (next !== bandGeom) {
        bandGeom.dispose()
        bandGeom = next
      }
    }

    throwIfCancelled(isCancelled)

    // 2) Date CSG - final/export only (expensive; skipped on live preview)
    const useDateCsg = mode === 'final' && !!layout?.dateCutter
    if (useDateCsg && layout?.dateCutter) {
      const dateCsgStart =
        typeof performance !== 'undefined' && performance.now
          ? performance.now()
          : Date.now()
      await yieldToMain()
      throwIfCancelled(isCancelled)
      const { carveDateWithCsg } = await import('./dateCsg')
      throwIfCancelled(isCancelled)
      const carved = carveDateWithCsg(bandGeom, layout.dateCutter)
      ranDateCsg = true // path entered (success or CSG fallback still marks stage)
      dateCsgMs = Math.round(
        (typeof performance !== 'undefined' && performance.now
          ? performance.now()
          : Date.now()) - dateCsgStart,
      )
      if (carved !== bandGeom) {
        bandGeom.dispose()
        bandGeom = carved
      }
    }

    if (layout?.dateCutter) {
      layout.dateCutter.dispose()
      layout.dateCutter = null
    }

    throwIfCancelled(isCancelled)

    const cutawayPlane = makeCutawayPlane(params)

    const bandMat = metalMaterial(params, cutawayPlane)
    const bandMesh = new THREE.Mesh(bandGeom, bandMat)
    bandMesh.castShadow = true
    bandMesh.receiveShadow = true
    bandMesh.name = 'wedding-ring-band'

    const group = new THREE.Group()
    group.name = 'wedding-ring'
    group.add(bandMesh)

    if (layout) {
      const inkMat = inkMaterial(cutawayPlane)
      for (const g of layout.previewGeometries) {
        const m = new THREE.Mesh(g, inkMat)
        m.name = 'inscription-glyph'
        m.renderOrder = 1
        group.add(m)
      }
      layout.previewGeometries = []
    }

    const triCount = triangleCount(bandGeom)

    let inkTris = 0
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.name === 'inscription-glyph') {
        const g = obj.geometry
        const idx = g.index
        inkTris += idx ? idx.count / 3 : (g.getAttribute('position')?.count ?? 0) / 3
      }
    })

    const outGeom = bandGeom
    bandGeom = null as unknown as THREE.BufferGeometry

    const t1 =
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now()

    return {
      group,
      exportMesh: bandMesh,
      geometry: outGeom,
      triangleCount: Math.round(triCount + inkTris),
      cutawayPlane,
      stages: {
        mode,
        ranDisplacement,
        ranDateCsg,
        durationMs: Math.round(t1 - t0),
        layoutMs,
        displacementMs,
        dateCsgMs,
      },
    }
  } catch (err) {
    if (bandGeom) bandGeom.dispose()
    disposeLayout(layout)
    throw err
  }
}

/** Apply metal color without rebuilding geometry. */
export function applyMetalToGroup(root: THREE.Object3D, metal: RingParams['metal']): void {
  const color = METAL_COLORS[metal]
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    if (obj.name === 'inscription-glyph') return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (m instanceof THREE.MeshStandardMaterial) {
        m.color.setHex(color)
        m.needsUpdate = true
      }
    }
  })
}

/** Apply / clear cutaway clipping on existing meshes. */
export function applyCutawayToGroup(
  root: THREE.Object3D,
  cutaway: boolean,
  textAngleDeg: number,
): THREE.Plane | null {
  const plane = cutaway
    ? new THREE.Plane(
        new THREE.Vector3(
          Math.cos((textAngleDeg * Math.PI) / 180),
          Math.sin((textAngleDeg * Math.PI) / 180),
          0,
        ),
        0,
      )
    : null
  const planes = plane ? [plane] : []
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (m instanceof THREE.MeshStandardMaterial) {
        m.clippingPlanes = planes
        m.clipShadows = cutaway
        m.needsUpdate = true
      }
    }
  })
  return plane
}
