import * as THREE from 'three'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import {
  bandEdgesAt,
  maxBandHalfExtentMm,
  measurePinchFlankPaths,
  pinchLayoutFromParams,
  pinchThetaAtU,
  type PinchFlankPath,
} from './ringGeometry'
import type { RingParams } from './types'

export interface RingMeasurements {
  innerDiameterMm: number
  outerDiameterMm: number
  bandThicknessMm: number
  /** Nominal axial band width on the untouched part of the ring. */
  bandWidthMm: number
  /**
   * Full axial extent through the pinch sector: max(zTop) − min(zBot).
   * Larger than bandWidth when the centerline shifts (true “how tall is the
   * metal at the pinch” envelope).
   */
  pinchEnvelopeMm: number
  /** True cross-section width at the broader approach shoulder. */
  pinchLocalWidthMm: number
  /** Crest z of the upper edge inside the pinch. */
  pinchZMaxMm: number
  /** Lowest z of the lower edge inside the pinch. */
  pinchZMinMm: number
  /** Peak |mid-plane| offset inside the pinch. */
  pinchMidExcursionMm: number
  /** Max of upper/lower edge spans (envelope for densification). */
  pinchSpanDeg: number
  /** Angular length of the upper edge pinch (degrees). */
  pinchTopSpanDeg: number
  /** Angular length of the lower edge pinch (degrees). */
  pinchBotSpanDeg: number
  /**
   * Circumferential arc of the upper edge pinch window (outerR · θ).
   */
  pinchTopSpanMm: number
  /**
   * Circumferential arc of the lower edge pinch window (outerR · θ).
   */
  pinchBotSpanMm: number
  /**
   * 3D path length of the steep upper flank of the S (the visible Z diagonal), mm.
   */
  pinchTopFlankMm: number
  /**
   * 3D path length of the steep lower flank of the S (parallel Z diagonal), mm.
   */
  pinchBotFlankMm: number
  /** Sampled polylines for drawing flank dimensions. */
  topFlankPath: PinchFlankPath
  botFlankPath: PinchFlankPath
  /** Red construction control value shown at the lower pinch corner. */
  pinchAngleDeg: number
  thetaTakeoff: number
  thetaCrest: number
  thetaWaist: number
  thetaTrough: number
  thetaBotStart: number
  pinchPhaseDeg: number
  isWave: boolean
}

function clampEdgeSpanDeg(deg: number, fallback: number): number {
  const v = deg > 0 ? deg : fallback
  return Math.min(350, Math.max(20, v || 100))
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

  const layout = isWave ? pinchLayoutFromParams(params) : null
  const fallback = params.waveSpanDeg || 120
  const topSpanDeg =
    isWave && layout && layout.spanDeg > 0
      ? clampEdgeSpanDeg(layout.spanDeg, fallback)
      : 0
  const botSpanDeg = topSpanDeg
  const maxSpanDeg = Math.max(topSpanDeg, botSpanDeg)
  // Outer-circumference arc length for each edge window
  const topSpanMm = isWave ? outerR * ((topSpanDeg * Math.PI) / 180) : 0
  const botSpanMm = isWave ? outerR * ((botSpanDeg * Math.PI) / 180) : 0

  const flanks =
    isWave && params.waveAmplitudeMm > params.bandWidthMm
      ? measurePinchFlankPaths(params)
      : {
          top: { lengthMm: 0, points: [], mid: { x: 0, y: 0, z: 0 } },
          bot: { lengthMm: 0, points: [], mid: { x: 0, y: 0, z: 0 } },
        }

  if (isWave && layout && layout.spanRad > 0) {
    const phase = (params.wavePhaseDeg * Math.PI) / 180
    const span = layout.spanRad
    const n = 1536
    for (let i = 0; i <= n; i++) {
      const u = i / n
      const θ = phase - span / 2 + u * span
      const e = bandEdgesAt(θ, params)
      pinchZMax = Math.max(pinchZMax, e.zTop)
      pinchZMin = Math.min(pinchZMin, e.zBot)
      midExcursion = Math.max(midExcursion, Math.abs(e.zMid))
    }
    for (const u of [
      layout.shoulderU,
      layout.crestU,
      layout.waistU,
      layout.troughU,
    ]) {
      const e = bandEdgesAt(phase - span / 2 + u * span, params)
      pinchZMax = Math.max(pinchZMax, e.zTop)
      pinchZMin = Math.min(pinchZMin, e.zBot)
      midExcursion = Math.max(midExcursion, Math.abs(e.zMid))
    }
    pinchLocalWidth = bandEdgesAt(
      phase - span / 2 + layout.shoulderU * span,
      params,
    ).width
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
    pinchSpanDeg: isWave ? maxSpanDeg : 0,
    pinchTopSpanDeg: isWave ? topSpanDeg : 0,
    pinchBotSpanDeg: isWave ? botSpanDeg : 0,
    pinchTopSpanMm: topSpanMm,
    pinchBotSpanMm: botSpanMm,
    pinchTopFlankMm: flanks.top.lengthMm,
    pinchBotFlankMm: flanks.bot.lengthMm,
    topFlankPath: flanks.top,
    botFlankPath: flanks.bot,
    pinchAngleDeg: layout?.requestedAngleDeg ?? 0,
    thetaTakeoff: layout
      ? pinchThetaAtU(params.wavePhaseDeg, layout.spanRad, layout.takeoffU)
      : 0,
    thetaCrest: layout
      ? pinchThetaAtU(params.wavePhaseDeg, layout.spanRad, layout.crestU)
      : 0,
    thetaWaist: layout
      ? pinchThetaAtU(params.wavePhaseDeg, layout.spanRad, layout.waistU)
      : 0,
    thetaTrough: layout
      ? pinchThetaAtU(params.wavePhaseDeg, layout.spanRad, layout.troughU)
      : 0,
    thetaBotStart: layout
      ? pinchThetaAtU(params.wavePhaseDeg, layout.spanRad, layout.botStartU)
      : 0,
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
      params.waveTopSpanDeg,
      params.waveBotSpanDeg,
      params.waveTopFlankMm,
      params.waveBotFlankMm,
      params.wavePinchAngleDeg,
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
    if (m.isWave && m.pinchSpanDeg > 0) {
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

      // Witness lines from the actual crest and trough out to the envelope.
      const eCrest = bandEdgesAt(m.thetaCrest, params)
      const eTrough = bandEdgesAt(m.thetaTrough, params)
      this.group.add(
        makeLine(
          [
            new THREE.Vector3(
              Math.cos(m.thetaCrest) * outerR,
              Math.sin(m.thetaCrest) * outerR,
              eCrest.zTop,
            ),
            new THREE.Vector3(cos * rDim, sin * rDim, zMax),
          ],
          0xffb84d,
        ),
      )
      this.group.add(
        makeLine(
          [
            new THREE.Vector3(
              Math.cos(m.thetaTrough) * outerR,
              Math.sin(m.thetaTrough) * outerR,
              eTrough.zBot,
            ),
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

      // True 3.70 mm width across the marked approach shoulder, measured
      // normal to the S centerline.
      const rLocal = outerR + 1.35
      const layout = pinchLayoutFromParams(params)
      const bridgeAngle = pinchThetaAtU(
        params.wavePhaseDeg,
        layout.spanRad,
        layout.shoulderU,
      )
      const bridgeCos = Math.cos(bridgeAngle)
      const bridgeSin = Math.sin(bridgeAngle)
      const bridgeEdge = bandEdgesAt(bridgeAngle, params)
      const topQ = bridgeEdge.normalCenterShift + bridgeEdge.halfW
      const botQ = bridgeEdge.normalCenterShift - bridgeEdge.halfW
      const topWidthAngle = Math.asin(
        Math.max(
          -0.999,
          Math.min(0.999, (topQ * bridgeEdge.normalS) / rLocal),
        ),
      )
      const botWidthAngle = Math.asin(
        Math.max(
          -0.999,
          Math.min(0.999, (botQ * bridgeEdge.normalS) / rLocal),
        ),
      )
      const lt = new THREE.Vector3(
        Math.cos(bridgeAngle + topWidthAngle) * rLocal,
        Math.sin(bridgeAngle + topWidthAngle) * rLocal,
        bridgeEdge.zTop,
      )
      const lb = new THREE.Vector3(
        Math.cos(bridgeAngle + botWidthAngle) * rLocal,
        Math.sin(bridgeAngle + botWidthAngle) * rLocal,
        bridgeEdge.zBot,
      )
      this.group.add(makeLine([lt, lb], ACCENT))
      const localLab = makeLabel(
        `<span class="dim-name">Shoulder width</span><span class="dim-val">${fmtMm(m.pinchLocalWidthMm)}</span>`,
        'dim-label dim-label-accent',
      )
      localLab.position.set(
        bridgeCos * (rLocal + 0.15),
        bridgeSin * (rLocal + 0.15),
        bridgeEdge.zMid,
      )
      this.group.add(localLab)

      // ── Steep S-flank path lengths (the two parallel Z diagonals) ─────────
      // Drawn on the outer metal surface — these are the edges the user marks
      // as the pinch “sides”, measured as true 3D path length in mm.
      const FLANK_TOP_COLOR = 0x7dff3d
      const FLANK_BOT_COLOR = 0x2454ff

      const drawFlank = (
        path: PinchFlankPath,
        name: string,
        color: number,
        labelClass: string,
        labelNudge: number,
      ): void => {
        if (path.points.length < 2 || path.lengthMm < 0.05) return
        const pts = path.points.map((p) => new THREE.Vector3(p.x, p.y, p.z))
        this.group.add(makeLine(pts, color))
        // End ticks normal-ish to the path (short radial ticks)
        for (const end of [pts[0]!, pts[pts.length - 1]!]) {
          const er = Math.hypot(end.x, end.y) || 1
          const ux = end.x / er
          const uy = end.y / er
          this.group.add(
            makeLine(
              [
                new THREE.Vector3(end.x - ux * 0.35, end.y - uy * 0.35, end.z),
                new THREE.Vector3(end.x + ux * 0.35, end.y + uy * 0.35, end.z),
              ],
              color,
            ),
          )
        }
        const mid = path.mid
        const mr = Math.hypot(mid.x, mid.y) || 1
        const lab = makeLabel(
          `<span class="dim-name">${name}</span><span class="dim-val">${fmtMm(path.lengthMm)}</span>`,
          labelClass,
        )
        lab.position.set(
          mid.x + (mid.x / mr) * labelNudge,
          mid.y + (mid.y / mr) * labelNudge,
          mid.z,
        )
        this.group.add(lab)
      }

      drawFlank(
        m.topFlankPath,
        'Upper flank',
        FLANK_TOP_COLOR,
        'dim-label dim-label-flank-top',
        1.1,
      )
      drawFlank(
        m.botFlankPath,
        'Lower flank',
        FLANK_BOT_COLOR,
        'dim-label dim-label-flank-bot',
        1.35,
      )

      // Red construction angle in the opening requested by the drawing. Place
      // it at the inside of the lower-edge trough so the angle reads in the
      // negative space between the two branches, not outside the ring.
      const edgeSurfacePoint = (theta: number, edgeName: 'top' | 'bot'): THREE.Vector3 => {
        const edge = bandEdgesAt(theta, params)
        const side = edgeName === 'top' ? 1 : -1
        const r = outerR - params.bandThicknessMm * 0.62
        const edgeQ = edge.normalCenterShift + side * edge.halfW
        const angleOffset = Math.asin(
          Math.max(
            -0.999,
            Math.min(0.999, (edgeQ * edge.normalS) / r),
          ),
        )
        const z = edgeName === 'top' ? edge.zTop : edge.zBot
        return new THREE.Vector3(
          Math.cos(theta + angleOffset) * r,
          Math.sin(theta + angleOffset) * r,
          z,
        )
      }
      const angleVertex = edgeSurfacePoint(m.thetaTrough, 'bot')
      const incoming = edgeSurfacePoint(m.thetaWaist, 'bot')
      const outgoing = edgeSurfacePoint(
        pinchThetaAtU(
          params.wavePhaseDeg,
          pinchLayoutFromParams(params).spanRad,
          pinchLayoutFromParams(params).landingU,
        ),
        'bot',
      )
      const red = 0xff3f2e
      this.group.add(makeLine([angleVertex, incoming], red))
      this.group.add(makeLine([angleVertex, outgoing], red))
      const rayA = incoming.clone().sub(angleVertex).normalize()
      const rayB = outgoing.clone().sub(angleVertex).normalize()
      const arcPts: THREE.Vector3[] = []
      for (let i = 0; i <= 20; i++) {
        const t = i / 20
        const ray = rayA.clone().multiplyScalar(1 - t).addScaledVector(rayB, t).normalize()
        arcPts.push(angleVertex.clone().addScaledVector(ray, 1.05))
      }
      this.group.add(makeLine(arcPts, red))
      const angleAnchor = arcPts[Math.floor(arcPts.length / 2)]!
      const angleRadius = Math.hypot(angleAnchor.x, angleAnchor.y) || 1
      const angleLab = makeLabel(
        `<span class="dim-name">Pinch angle</span><span class="dim-val">${fmtDeg(m.pinchAngleDeg)}</span>`,
        'dim-label dim-label-corner',
      )
      angleLab.position.set(
        angleAnchor.x - (angleAnchor.x / angleRadius) * 1.05,
        angleAnchor.y - (angleAnchor.y / angleRadius) * 1.05,
        angleAnchor.z - 0.2,
      )
      this.group.add(angleLab)

      // Maximum centerline displacement inside the localized S.
      if (m.pinchMidExcursionMm > 0.05) {
        const ampLab = makeLabel(
          `<span class="dim-name">Mid shift max</span><span class="dim-val">${fmtMm(m.pinchMidExcursionMm)}</span>`,
        )
        ampLab.position.set(
          Math.cos(m.thetaCrest) * (outerR * 0.55),
          Math.sin(m.thetaCrest) * (outerR * 0.55),
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
