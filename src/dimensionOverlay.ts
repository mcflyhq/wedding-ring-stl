import * as THREE from 'three'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { bandEdgesAt, maxBandHalfExtentMm } from './ringGeometry'
import type { RingParams } from './types'

export interface RingMeasurements {
  innerDiameterMm: number
  outerDiameterMm: number
  bandThicknessMm: number
  /** Nominal / local axial band width (constant along θ for current wave model). */
  bandWidthMm: number
  /**
   * Full axial extent through the pinch sector: max(zTop) − min(zBot).
   * Larger than bandWidth when the centerline shifts (true “how tall is the
   * metal at the pinch” envelope).
   */
  pinchEnvelopeMm: number
  /** Local band width sampled at the pinch center. */
  pinchLocalWidthMm: number
  /** Crest z of the upper edge inside the pinch. */
  pinchZMaxMm: number
  /** Lowest z of the lower edge inside the pinch. */
  pinchZMinMm: number
  /** Peak |mid-plane| offset inside the pinch. */
  pinchMidExcursionMm: number
  pinchSpanDeg: number
  pinchPhaseDeg: number
  isWave: boolean
}

/** Dense sample of the pinch sector (or full ring for classic D). */
export function measureRing(params: RingParams): RingMeasurements {
  const innerR = params.innerDiameterMm / 2
  const outerR = innerR + params.bandThicknessMm
  const isWave = params.bandProfile === 'wave'

  let pinchZMax = -Infinity
  let pinchZMin = Infinity
  let pinchLocalWidth = params.bandWidthMm
  let midExcursion = 0

  if (isWave && params.waveAmplitudeMm > 0 && params.waveSpanDeg > 0) {
    const phase = (params.wavePhaseDeg * Math.PI) / 180
    const span = (Math.min(350, Math.max(20, params.waveSpanDeg)) * Math.PI) / 180
    const n = 96
    for (let i = 0; i <= n; i++) {
      const u = i / n
      const θ = phase - span / 2 + u * span
      const e = bandEdgesAt(θ, params)
      pinchZMax = Math.max(pinchZMax, e.zTop)
      pinchZMin = Math.min(pinchZMin, e.zBot)
      pinchLocalWidth = e.width
      midExcursion = Math.max(midExcursion, Math.abs(e.zMid))
    }
  } else {
    const e = bandEdgesAt(0, params)
    pinchZMax = e.zTop
    pinchZMin = e.zBot
    pinchLocalWidth = e.width
    midExcursion = Math.abs(e.zMid)
  }

  return {
    innerDiameterMm: params.innerDiameterMm,
    outerDiameterMm: outerR * 2,
    bandThicknessMm: params.bandThicknessMm,
    bandWidthMm: params.bandWidthMm,
    pinchEnvelopeMm: pinchZMax - pinchZMin,
    pinchLocalWidthMm: pinchLocalWidth,
    pinchZMaxMm: pinchZMax,
    pinchZMinMm: pinchZMin,
    pinchMidExcursionMm: midExcursion,
    pinchSpanDeg: isWave ? params.waveSpanDeg : 0,
    pinchPhaseDeg: isWave ? params.wavePhaseDeg : 0,
    isWave,
  }
}

function fmtMm(n: number, digits = 2): string {
  return `${n.toFixed(digits)} mm`
}

function fmtDeg(n: number): string {
  return `${Math.round(n)}°`
}

const LINE_COLOR = 0xe8d5a3
const ACCENT = 0xc9a227

function makeLine(points: THREE.Vector3[], color = LINE_COLOR): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints(points)
  const mat = new THREE.LineBasicMaterial({
    color,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.92,
  })
  const line = new THREE.Line(geo, mat)
  line.renderOrder = 10
  line.frustumCulled = false
  return line
}

function makeLabel(html: string, className = 'dim-label'): CSS2DObject {
  const el = document.createElement('div')
  el.className = className
  el.innerHTML = html
  const obj = new CSS2DObject(el)
  obj.center.set(0.5, 0.5)
  return obj
}

function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.LineSegments) {
      obj.geometry?.dispose()
      const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : []
      for (const m of mats) m.dispose()
    }
    if (obj instanceof CSS2DObject) {
      obj.element.remove()
    }
  })
}

/**
 * Live CAD-style dimension overlay in the 3D viewport.
 * Rebuilds from RingParams (no mesh dependency) so it stays in sync while dragging.
 */
export class DimensionOverlay {
  readonly group = new THREE.Group()
  readonly labelRenderer: CSS2DRenderer
  private visible = true
  private lastKey = ''

  constructor(host: HTMLElement) {
    this.group.name = 'dimension-overlay'
    this.labelRenderer = new CSS2DRenderer()
    this.labelRenderer.setSize(host.clientWidth, host.clientHeight)
    const el = this.labelRenderer.domElement
    el.style.position = 'absolute'
    el.style.inset = '0'
    el.style.pointerEvents = 'none'
    el.style.zIndex = '5'
    el.className = 'dim-label-layer'
    host.appendChild(el)
  }

  setVisible(on: boolean): void {
    this.visible = on
    this.group.visible = on
    this.labelRenderer.domElement.style.display = on ? 'block' : 'none'
  }

  isVisible(): boolean {
    return this.visible
  }

  resize(width: number, height: number): void {
    this.labelRenderer.setSize(width, height)
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (!this.visible) return
    this.labelRenderer.render(scene, camera)
  }

  /** Rebuild annotation geometry if params changed. */
  update(params: RingParams): RingMeasurements {
    const m = measureRing(params)
    const key = JSON.stringify([
      params.bandProfile,
      params.innerDiameterMm,
      params.bandWidthMm,
      params.bandThicknessMm,
      params.waveAmplitudeMm,
      params.wavePhaseDeg,
      params.waveSpanDeg,
      params.waveSharpness,
    ])
    if (key === this.lastKey) return m
    this.lastKey = key
    this.rebuild(params, m)
    return m
  }

  private rebuild(params: RingParams, m: RingMeasurements): void {
    while (this.group.children.length) {
      const child = this.group.children[0]!
      this.group.remove(child)
      disposeObject3D(child)
    }

    const innerR = params.innerDiameterMm / 2
    const outerR = innerR + params.bandThicknessMm
    // Place flat-section dimensions opposite the pinch so they don’t overlap
    const flatAngle =
      params.bandProfile === 'wave'
        ? (params.wavePhaseDeg * Math.PI) / 180 + Math.PI
        : Math.PI * 0.15
    const pinchAngle = (params.wavePhaseDeg * Math.PI) / 180

    // ── Inner diameter (through hole, in XY plane) ──────────────────────────
    {
      const yOff = maxBandHalfExtentMm(params) + 2.2
      const a = new THREE.Vector3(-innerR, 0, yOff)
      const b = new THREE.Vector3(innerR, 0, yOff)
      this.group.add(makeLine([a, b]))
      // end ticks
      this.group.add(
        makeLine([
          new THREE.Vector3(-innerR, 0, yOff - 0.45),
          new THREE.Vector3(-innerR, 0, yOff + 0.45),
        ]),
      )
      this.group.add(
        makeLine([
          new THREE.Vector3(innerR, 0, yOff - 0.45),
          new THREE.Vector3(innerR, 0, yOff + 0.45),
        ]),
      )
      const lab = makeLabel(
        `<span class="dim-name">Inner ⌀</span><span class="dim-val">${fmtMm(m.innerDiameterMm, 1)}</span>`,
      )
      lab.position.set(0, 0, yOff + 0.9)
      this.group.add(lab)
    }

    // ── Radial thickness at flat section ────────────────────────────────────
    {
      const cos = Math.cos(flatAngle)
      const sin = Math.sin(flatAngle)
      const z = 0
      const pad = 0.55
      const p0 = new THREE.Vector3(cos * (innerR - pad), sin * (innerR - pad), z)
      const p1 = new THREE.Vector3(cos * (outerR + pad), sin * (outerR + pad), z)
      // Offset the dimension line slightly along +z for clarity
      const lift = params.bandWidthMm / 2 + 1.1
      p0.z = lift
      p1.z = lift
      this.group.add(makeLine([p0, p1], ACCENT))
      this.group.add(
        makeLine([
          new THREE.Vector3(cos * innerR, sin * innerR, lift - 0.35),
          new THREE.Vector3(cos * innerR, sin * innerR, lift + 0.35),
        ], ACCENT),
      )
      this.group.add(
        makeLine([
          new THREE.Vector3(cos * outerR, sin * outerR, lift - 0.35),
          new THREE.Vector3(cos * outerR, sin * outerR, lift + 0.35),
        ], ACCENT),
      )
      const midR = (innerR + outerR) / 2
      const lab = makeLabel(
        `<span class="dim-name">Thickness</span><span class="dim-val">${fmtMm(m.bandThicknessMm)}</span>`,
        'dim-label dim-label-accent',
      )
      lab.position.set(cos * midR, sin * midR, lift + 0.85)
      this.group.add(lab)
    }

    // ── Nominal band width at flat section ──────────────────────────────────
    {
      const cos = Math.cos(flatAngle)
      const sin = Math.sin(flatAngle)
      const r = outerR + 1.6
      const half = params.bandWidthMm / 2
      const top = new THREE.Vector3(cos * r, sin * r, half)
      const bot = new THREE.Vector3(cos * r, sin * r, -half)
      this.group.add(makeLine([top, bot]))
      this.group.add(
        makeLine([
          new THREE.Vector3(cos * (r - 0.4), sin * (r - 0.4), half),
          new THREE.Vector3(cos * (r + 0.4), sin * (r + 0.4), half),
        ]),
      )
      this.group.add(
        makeLine([
          new THREE.Vector3(cos * (r - 0.4), sin * (r - 0.4), -half),
          new THREE.Vector3(cos * (r + 0.4), sin * (r + 0.4), -half),
        ]),
      )
      const lab = makeLabel(
        `<span class="dim-name">Band width</span><span class="dim-val">${fmtMm(m.bandWidthMm)}</span>`,
      )
      lab.position.set(cos * (r + 0.2), sin * (r + 0.2), 0)
      this.group.add(lab)
    }

    // ── Pinch sector annotations ────────────────────────────────────────────
    if (m.isWave && params.waveAmplitudeMm > 0 && params.waveSpanDeg > 0) {
      const cos = Math.cos(pinchAngle)
      const sin = Math.sin(pinchAngle)
      const rDim = outerR + 2.4
      const zMax = m.pinchZMaxMm
      const zMin = m.pinchZMinMm

      // Full axial envelope at pinch (the critical “full width” check)
      const top = new THREE.Vector3(cos * rDim, sin * rDim, zMax)
      const bot = new THREE.Vector3(cos * rDim, sin * rDim, zMin)
      this.group.add(makeLine([top, bot], 0xffb84d))
      this.group.add(
        makeLine(
          [
            new THREE.Vector3(cos * (rDim - 0.5), sin * (rDim - 0.5), zMax),
            new THREE.Vector3(cos * (rDim + 0.5), sin * (rDim + 0.5), zMax),
          ],
          0xffb84d,
        ),
      )
      this.group.add(
        makeLine(
          [
            new THREE.Vector3(cos * (rDim - 0.5), sin * (rDim - 0.5), zMin),
            new THREE.Vector3(cos * (rDim + 0.5), sin * (rDim + 0.5), zMin),
          ],
          0xffb84d,
        ),
      )

      // Witness lines from metal edges out to the dimension
      const eCenter = bandEdgesAt(pinchAngle, params)
      const rMetal = outerR
      this.group.add(
        makeLine(
          [
            new THREE.Vector3(cos * rMetal, sin * rMetal, eCenter.zTop),
            new THREE.Vector3(cos * rDim, sin * rDim, zMax),
          ],
          0xffb84d,
        ),
      )
      this.group.add(
        makeLine(
          [
            new THREE.Vector3(cos * rMetal, sin * rMetal, eCenter.zBot),
            new THREE.Vector3(cos * rDim, sin * rDim, zMin),
          ],
          0xffb84d,
        ),
      )

      const envLab = makeLabel(
        `<span class="dim-name">Pinch full width</span><span class="dim-val">${fmtMm(m.pinchEnvelopeMm)}</span>`,
        'dim-label dim-label-pinch',
      )
      envLab.position.set(cos * (rDim + 0.35), sin * (rDim + 0.35), (zMax + zMin) / 2)
      this.group.add(envLab)

      // Local band width at pinch center (metal thickness along finger axis)
      const rLocal = outerR + 1.35
      const lt = new THREE.Vector3(cos * rLocal, sin * rLocal, eCenter.zTop)
      const lb = new THREE.Vector3(cos * rLocal, sin * rLocal, eCenter.zBot)
      this.group.add(makeLine([lt, lb], ACCENT))
      const localLab = makeLabel(
        `<span class="dim-name">Local width</span><span class="dim-val">${fmtMm(m.pinchLocalWidthMm)}</span>`,
        'dim-label dim-label-accent',
      )
      localLab.position.set(
        cos * (rLocal + 0.15),
        sin * (rLocal + 0.15),
        eCenter.zMid,
      )
      this.group.add(localLab)

      // Angular span arc (on a plane slightly above max envelope)
      const spanRad = (Math.min(350, Math.max(20, params.waveSpanDeg)) * Math.PI) / 180
      const arcR = outerR + 3.4
      const zArc = zMax + 1.2
      const arcPts: THREE.Vector3[] = []
      const arcSteps = Math.max(16, Math.ceil(params.waveSpanDeg / 4))
      for (let i = 0; i <= arcSteps; i++) {
        const u = i / arcSteps
        const θ = pinchAngle - spanRad / 2 + u * spanRad
        arcPts.push(new THREE.Vector3(Math.cos(θ) * arcR, Math.sin(θ) * arcR, zArc))
      }
      this.group.add(makeLine(arcPts, 0x9ecbff))
      // Arc end ticks
      const θ0 = pinchAngle - spanRad / 2
      const θ1 = pinchAngle + spanRad / 2
      for (const θ of [θ0, θ1]) {
        const c = Math.cos(θ)
        const s = Math.sin(θ)
        this.group.add(
          makeLine(
            [
              new THREE.Vector3(c * (arcR - 0.45), s * (arcR - 0.45), zArc),
              new THREE.Vector3(c * (arcR + 0.45), s * (arcR + 0.45), zArc),
            ],
            0x9ecbff,
          ),
        )
      }
      const midθ = pinchAngle
      const angleLab = makeLabel(
        `<span class="dim-name">Pinch angle</span><span class="dim-val">${fmtDeg(m.pinchSpanDeg)}</span>`,
        'dim-label dim-label-angle',
      )
      angleLab.position.set(
        Math.cos(midθ) * (arcR + 0.2),
        Math.sin(midθ) * (arcR + 0.2),
        zArc + 0.55,
      )
      this.group.add(angleLab)

      // Amplitude callout at crest
      if (m.pinchMidExcursionMm > 0.05) {
        const ampLab = makeLabel(
          `<span class="dim-name">Mid shift max</span><span class="dim-val">${fmtMm(m.pinchMidExcursionMm)}</span>`,
        )
        ampLab.position.set(
          cos * (outerR * 0.55),
          sin * (outerR * 0.55),
          zMax + 0.7,
        )
        this.group.add(ampLab)
      }
    }
  }

  dispose(): void {
    disposeObject3D(this.group)
    this.labelRenderer.domElement.remove()
  }
}
