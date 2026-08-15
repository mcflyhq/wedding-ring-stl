/**
 * Physical contract for the localized S-pinch.
 *
 * The UI controls full axial width, two physical flank lengths, and the red
 * construction angle independently. The rest of the ring stays a flat D band.
 */
import * as THREE from 'three'
import {
  bandEdgesAt,
  createRingGeometry,
  pinchLayoutFromParams,
  pinchThetaAtU,
} from '../src/ringGeometry.ts'
import { measureRing } from '../src/dimensionOverlay.ts'
import { DEFAULT_PARAMS, type RingParams } from '../src/types.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`)
}

function approx(actual: number, expected: number, tolerance: number, label: string): void {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual.toFixed(4)} vs ${expected.toFixed(4)} ± ${tolerance}`,
  )
}

function assertFiniteAttribute(
  geometry: THREE.BufferGeometry,
  name: 'position' | 'normal',
): void {
  const attr = geometry.getAttribute(name) as THREE.BufferAttribute | undefined
  assert(attr && attr.count > 0, `${name} attribute exists`)
  for (let i = 0; i < attr.count; i++) {
    assert(
      Number.isFinite(attr.getX(i)) &&
        Number.isFinite(attr.getY(i)) &&
        Number.isFinite(attr.getZ(i)),
      `${name}[${i}] is finite`,
    )
  }
}

function main(): void {
  const params: RingParams = {
    ...DEFAULT_PARAMS,
    bandProfile: 'wave',
    quality: 'draft',
  }

  approx(params.bandWidthMm, 3, 1e-9, 'default band width')
  approx(params.waveAmplitudeMm, 8.3, 1e-9, 'default full pinch width')
  approx(params.waveTopFlankMm, 5.2, 1e-9, 'default upper flank')
  approx(params.waveBotFlankMm, 5, 1e-9, 'default lower flank')
  approx(params.wavePinchAngleDeg, 120, 1e-9, 'default red angle')

  const layout = pinchLayoutFromParams(params)
  assert(
    layout.spanDeg > 100 && layout.spanDeg < 180,
    `scaled reference footprint stays localized (${layout.spanDeg.toFixed(1)}°)`,
  )
  approx(layout.targetWidthMm, 8.3, 1e-9, 'layout target width')
  approx(layout.effectiveAngleDeg, 120, 0.1, 'default construction angle')
  assert(
    layout.topStartU < layout.topEndU &&
      layout.botStartU < layout.botEndU,
    'both physical flank intervals are ordered',
  )
  assert(
    Math.abs(layout.topStartU - layout.botStartU) > 1e-4 ||
      Math.abs(layout.topEndU - layout.botEndU) > 1e-4,
    'the independently solved 5.20 / 5.00 mm marks use distinct endpoints',
  )

  const phase = (params.wavePhaseDeg * Math.PI) / 180
  const edgeAtU = (u: number, p: RingParams = params) => {
    const localLayout = pinchLayoutFromParams(p)
    return bandEdgesAt(
      pinchThetaAtU(p.wavePhaseDeg, localLayout.spanRad, u),
      p,
    )
  }
  const baseTop = params.bandWidthMm / 2
  const baseBot = -baseTop
  const seamBefore = bandEdgesAt(phase - layout.spanRad / 2 - 1e-5, params)
  const seamAfter = bandEdgesAt(phase - layout.spanRad / 2 + 1e-5, params)
  approx(seamBefore.zMid, seamAfter.zMid, 0.001, 'pinch window entry is closed')
  for (const theta of [phase + layout.spanRad, phase + Math.PI]) {
    const edge = bandEdgesAt(theta, params)
    approx(edge.width, params.bandWidthMm, 1e-9, 'flat-sector width')
    approx(edge.zMid, 0, 1e-9, 'outside sector returns exactly to the original plane')
  }

  const crest = bandEdgesAt(
    pinchThetaAtU(params.wavePhaseDeg, layout.spanRad, layout.crestU),
    params,
  )
  const waist = bandEdgesAt(
    pinchThetaAtU(params.wavePhaseDeg, layout.spanRad, layout.waistU),
    params,
  )
  const trough = bandEdgesAt(
    pinchThetaAtU(params.wavePhaseDeg, layout.spanRad, layout.troughU),
    params,
  )
  assert(crest.zTop > baseTop + layout.riseMm * 0.9, 'upper S crest reaches its lobe')
  assert(trough.zBot < baseBot - layout.fallMm * 0.9, 'lower S trough reaches its lobe')
  assert(Math.abs(waist.zMid) < layout.riseMm * 0.1, 'central waist crosses the base plane')
  approx(edgeAtU(0.01).width, 3, 1e-9, 'flat band before shoulder ramp')
  approx(edgeAtU(0.02).width, 3, 1e-9, 'shoulder ramp starts at nominal width')
  approx(edgeAtU(0.32).width, 3.7, 1e-9, 'shoulder reaches 3.70 mm')
  const markedShoulder = edgeAtU(layout.shoulderU)
  approx(markedShoulder.width, 3.7, 1e-9, 'marked shoulder is 3.70 mm')
  approx(
    markedShoulder.normalCenterShift + markedShoulder.halfW,
    params.bandWidthMm / 2,
    1e-9,
    'widened shoulder keeps its upper edge anchored',
  )
  approx(edgeAtU(0.4).width, 3.7, 1e-9, 'shoulder stays 3.70 mm at the crest junction')
  approx(edgeAtU(layout.crestU).width, 3, 1e-9, 'crest resolves to nominal width')
  approx(edgeAtU(0.7).width, 3, 1e-9, 'right pinch resumes nominal width')
  let previousRampInWidth = edgeAtU(0.02).width
  for (let i = 1; i <= 24; i++) {
    const width = edgeAtU(0.02 + (i / 24) * 0.3).width
    assert(width >= previousRampInWidth - 1e-9, `shoulder entry is monotone at sample ${i}`)
    previousRampInWidth = width
  }
  let previousRampOutWidth = edgeAtU(0.4).width
  for (let i = 1; i <= 24; i++) {
    const width = edgeAtU(0.4 + (i / 24) * 0.02).width
    assert(width <= previousRampOutWidth + 1e-9, `shoulder exit is monotone at sample ${i}`)
    previousRampOutWidth = width
  }
  const joinSlope = (u: number, h = 1e-5): number =>
    (edgeAtU(u + h).width - edgeAtU(u - h).width) / (2 * h)
  for (const joinU of [0.02, 0.32, 0.4, 0.42]) {
    approx(joinSlope(joinU), 0, 0.001, `C2 shoulder join slope at u=${joinU}`)
  }
  let maxApproachTop = edgeAtU(0.32).zTop
  for (let i = 1; i <= 96; i++) {
    const u = 0.32 + (i / 96) * (layout.crestU - 0.32)
    const top = edgeAtU(u).zTop
    maxApproachTop = Math.max(maxApproachTop, top)
  }
  assert(
    maxApproachTop - crest.zTop < 0.005,
    `crest upper edge has no visible crown (${(maxApproachTop - crest.zTop).toFixed(4)} mm)`,
  )
  for (let i = 0; i <= 96; i++) {
    const u = layout.crestU + (i / 96) * (layout.troughU - layout.crestU)
    approx(edgeAtU(u).width, 3, 1e-9, `descending stroke width at sample ${i}`)
  }
  const strokeVariants: RingParams[] = [
    { ...params, wavePinchAngleDeg: 70 },
    { ...params, wavePinchAngleDeg: 140 },
    { ...params, waveAmplitudeMm: 10 },
    { ...params, waveTopFlankMm: 7, waveBotFlankMm: 6 },
    { ...params, waveSharpness: 1 },
    { ...params, bandWidthMm: 3.6 },
  ]
  for (const variant of strokeVariants) {
    const variantLayout = pinchLayoutFromParams(variant)
    for (let i = 0; i <= 48; i++) {
      const u =
        variantLayout.crestU +
        (i / 48) * (variantLayout.troughU - variantLayout.crestU)
      approx(
        edgeAtU(u, variant).width,
        variant.bandWidthMm,
        1e-9,
        `variant descending stroke width at sample ${i}`,
      )
    }
  }
  for (const edge of [crest, waist, trough]) {
    approx(
      Math.hypot(edge.normalS, edge.normalZ),
      1,
      1e-9,
      'section normal is normalized',
    )
    approx(
      Math.hypot(
        edge.width * edge.normalS,
        edge.zTop - edge.zBot,
      ),
      edge.width,
      1e-6,
      'physical edge separation matches the local section width',
    )
  }
  for (let i = 0; i <= 96; i++) {
    const u = layout.topStartU + (i / 96) * (layout.botEndU - layout.topStartU)
    const edge = bandEdgesAt(
      pinchThetaAtU(params.wavePhaseDeg, layout.spanRad, u),
      params,
    )
    approx(
      Math.hypot(
        edge.width * edge.normalS,
        edge.zTop - edge.zBot,
      ),
      edge.width,
      1e-6,
      `physical local width at flank sample ${i}`,
    )
  }

  const measurements = measureRing(params)
  approx(measurements.pinchEnvelopeMm, 8.3, 0.01, 'measured full pinch width')
  approx(measurements.pinchLocalWidthMm, 3.7, 1e-9, 'measured shoulder width')
  approx(measurements.pinchAngleDeg, 120, 1e-9, 'measured red angle')
  assert(measurements.pinchTopFlankMm > 0, 'upper flank is measured from generated geometry')
  assert(measurements.pinchBotFlankMm > 0, 'lower flank is measured from generated geometry')
  approx(measurements.pinchTopFlankMm, 5.2, 0.03, 'default upper measured flank')
  approx(measurements.pinchBotFlankMm, 5, 0.03, 'default lower measured flank')

  const maxed: RingParams = { ...params, waveAmplitudeMm: 10 }
  const maxMeasurements = measureRing(maxed)
  approx(maxMeasurements.pinchEnvelopeMm, 10, 0.01, '10 mm slider maximum')
  assert(
    maxMeasurements.pinchTopFlankMm > measurements.pinchTopFlankMm + 1,
    'upper measured flank updates when full pinch width changes',
  )
  assert(
    maxMeasurements.pinchBotFlankMm > measurements.pinchBotFlankMm + 1,
    'lower measured flank updates when full pinch width changes',
  )
  for (const amplitude of [3.7, 4, 5.5, 7, 9, 10]) {
    const changed = measureRing({ ...params, waveAmplitudeMm: amplitude })
    approx(changed.pinchEnvelopeMm, amplitude, 0.02, `${amplitude} mm envelope remains exact`)
  }
  const wideBand: RingParams = { ...params, bandWidthMm: 4 }
  approx(
    edgeAtU(pinchLayoutFromParams(wideBand).shoulderU, wideBand).width,
    4,
    1e-9,
    'shoulder never narrows a wider base band',
  )
  const dependentVariants: { label: string; params: RingParams }[] = [
    { label: 'diameter', params: { ...params, innerDiameterMm: 19 } },
    { label: 'thickness', params: { ...params, bandThicknessMm: 2.2 } },
    { label: 'band width', params: { ...params, bandWidthMm: 3.6 } },
    { label: 'angle', params: { ...params, wavePinchAngleDeg: 95 } },
    { label: 'hardness', params: { ...params, waveSharpness: 0.65 } },
  ]
  for (const variant of dependentVariants) {
    const changed = measureRing(variant.params)
    assert(
      Math.abs(changed.pinchTopFlankMm - measurements.pinchTopFlankMm) > 0.01 ||
        Math.abs(changed.pinchBotFlankMm - measurements.pinchBotFlankMm) > 0.01,
      `${variant.label} updates at least one measured flank`,
    )
  }

  const hard = measureRing({ ...params, waveSharpness: 1 })
  approx(hard.pinchEnvelopeMm, 8.3, 0.01, 'hard-corner full width remains exact')

  const acute = pinchLayoutFromParams({ ...params, wavePinchAngleDeg: 80 })
  const open = pinchLayoutFromParams({ ...params, wavePinchAngleDeg: 135 })
  assert(
    acute.effectiveAngleDeg < open.effectiveAngleDeg,
    'red angle control preserves the requested construction angle',
  )
  assert(
    acute.troughU < open.troughU,
    'red angle opens the physical central transition',
  )
  approx(
    measureRing({ ...params, wavePinchAngleDeg: 80 }).pinchEnvelopeMm,
    8.3,
    0.01,
    'acute red-angle full width remains exact',
  )
  approx(
    measureRing({ ...params, wavePinchAngleDeg: 135 }).pinchEnvelopeMm,
    8.3,
    0.01,
    'open red-angle full width remains exact',
  )

  const longerTop = measureRing({ ...params, waveTopFlankMm: 7 })
  assert(
    longerTop.pinchTopFlankMm > measurements.pinchTopFlankMm + 0.5,
    'upper reach control changes the green measured path',
  )

  const beforePinch = bandEdgesAt(
    pinchThetaAtU(params.wavePhaseDeg, layout.spanRad, 0.01),
    params,
  )
  const afterPinch = bandEdgesAt(
    pinchThetaAtU(params.wavePhaseDeg, layout.spanRad, 0.99),
    params,
  )
  approx(beforePinch.zMid, 0, 1e-5, 'S entry pad is flat')
  approx(afterPinch.zMid, 0, 1e-5, 'S exit pad is flat')

  const geometry = createRingGeometry(params)
  geometry.computeBoundingBox()
  assertFiniteAttribute(geometry, 'position')
  assertFiniteAttribute(geometry, 'normal')
  const bounds = geometry.boundingBox
  assert(bounds, 'geometry has bounds')
  approx(
    bounds.max.z - bounds.min.z,
    measurements.pinchEnvelopeMm,
    0.02,
    'mesh and overlay envelopes agree',
  )
  geometry.dispose()

  console.log(
    `ok physical pinch  width=${measurements.pinchEnvelopeMm.toFixed(2)} mm  ` +
      `flanks=${measurements.pinchTopFlankMm.toFixed(2)}/${measurements.pinchBotFlankMm.toFixed(2)} mm  ` +
      `angle=${measurements.pinchAngleDeg.toFixed(0)}°  span=${measurements.pinchSpanDeg.toFixed(1)}°`,
  )
}

main()
