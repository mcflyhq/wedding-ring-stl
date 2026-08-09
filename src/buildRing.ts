import * as THREE from 'three'
import { getBlankBandGeometry } from './buildCache'
import { buildTextLayout, engraveByDisplacement } from './textEngraving'
import type { RingParams } from './types'
import { METAL_COLORS } from './types'

export interface BuiltRing {
  /** Full group: band + visible inscription fill (preview). Export uses `exportMesh`. */
  group: THREE.Group
  /** Mesh to export as STL (band with recessed engraving only). */
  exportMesh: THREE.Mesh
  geometry: THREE.BufferGeometry
  triangleCount: number
  cutawayPlane: THREE.Plane | null
}

export interface BuildOptions {
  /**
   * `preview` — interactive edits: draft quality for speed.
   * `final` — idle / export quality.
   */
  mode?: 'preview' | 'final'
  /** Override mesh quality (used for live draft while dragging). */
  qualityOverride?: RingParams['quality']
  /** Return true to abandon mid-build (generation cancelled). */
  isCancelled?: () => boolean
}

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

/** Darker fill for lettering — sits inside recessed pockets. */
function inkMaterial(clipped: THREE.Plane | null): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x1c140a,
    metalness: 0.4,
    roughness: 0.45,
    envMapIntensity: 0.5,
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

function disposeLayout(layout: Awaited<ReturnType<typeof buildTextLayout>>): void {
  if (!layout) return
  for (const g of layout.previewGeometries) g.dispose()
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
 * All text (Tengwar, date, Latin) is recessed into the metal via vertex
 * displacement — same carve style, never embossed solids into the hole.
 */
export async function buildRing(
  params: RingParams,
  options: BuildOptions = {},
): Promise<BuiltRing> {
  const isCancelled = options.isCancelled ?? (() => false)

  const workParams: RingParams = options.qualityOverride
    ? { ...params, quality: options.qualityOverride }
    : params

  let bandGeom = getBlankBandGeometry(workParams)
  let layout: Awaited<ReturnType<typeof buildTextLayout>> = null

  try {
    throwIfCancelled(isCancelled)

    await yieldToMain()
    throwIfCancelled(isCancelled)

    layout = await buildTextLayout(workParams)
    throwIfCancelled(isCancelled)

    await yieldToMain()
    throwIfCancelled(isCancelled)

    // Recess all inscriptions into the band (inner wall → outward into metal)
    if (layout && layout.polys.length > 0) {
      const next = await engraveByDisplacement(
        bandGeom,
        layout.polys,
        workParams,
        isCancelled,
      )
      if (next !== bandGeom) {
        bandGeom.dispose()
        bandGeom = next
      }
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

    const index = bandGeom.index
    const triCount = index
      ? index.count / 3
      : (bandGeom.getAttribute('position')?.count ?? 0) / 3

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

    return {
      group,
      exportMesh: bandMesh,
      geometry: outGeom,
      triangleCount: Math.round(triCount + inkTris),
      cutawayPlane,
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
