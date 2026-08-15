/**
 * Integration tests for buildRing preview vs final performance contract.
 * Calls the real build entry with real fonts from public/fonts.
 *
 * Run: npm test
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { buildBlankRing, buildRing, disposeBuiltRing } from '../src/buildRing.ts'
import type { RingParams } from '../src/types.ts'
import { DEFAULT_PARAMS } from '../src/types.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const fontsDir = path.join(root, 'public', 'fonts')

// Real fetch of bundled fonts (buildTextLayout uses fetch('/fonts/...'))
const realFetch = globalThis.fetch
globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.includes('/fonts/') || url.startsWith('/fonts')) {
    const name = path.basename(url.split('?')[0]!)
    const file = path.join(fontsDir, name)
    const buf = readFileSync(file)
    return new Response(buf, {
      status: 200,
      headers: { 'Content-Type': 'font/ttf' },
    })
  }
  if (realFetch) return realFetch(input)
  throw new Error(`Unexpected fetch in test: ${url}`)
}

function fixedParams(): RingParams {
  return {
    ...DEFAULT_PARAMS,
    // Classic D for deterministic engraving regression; wave is covered by blank mesh path.
    bandProfile: 'd',
    quality: 'draft', // keep CI fast; still exercises full stage path
    cutaway: false,
    innerText: 'test',
    innerTengwarKeys: '',
    outerText: '',
    outerTengwarKeys: '',
    innerDateText: '27.09.2026',
    textAngleDeg: 0,
    innerTextAngleDeg: 0,
    dateAngleDeg: 90,
    textDepthMm: 0.35,
    dateTextSizeMm: 1.35,
    textSizeMm: 1.4,
    innerDiameterMm: 17.3,
    bandWidthMm: 4.5,
    bandThicknessMm: 1.6,
  }
}

/** Sample band export mesh near the independent date angle for recessed r. */
function countRecessedDateVerts(geom: THREE.BufferGeometry, params: RingParams): number {
  const innerR = params.innerDiameterMm / 2
  const depth = Math.min(params.textDepthMm, params.bandThicknessMm * 0.75)
  const dateAngle = (params.dateAngleDeg * Math.PI) / 180
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  let n = 0
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    if (Math.abs(z) > params.bandWidthMm * 0.45) continue
    const r = Math.hypot(x, y)
    // Recessed into metal: above free surface, within pocket depth
    if (r < innerR + 0.04 || r > innerR + depth + 0.35) continue
    const th = Math.atan2(y, x)
    let d = th - dateAngle
    d = Math.atan2(Math.sin(d), Math.cos(d))
    if (Math.abs(d) > 0.45) continue
    n++
  }
  return n
}

function countRecessedPrimaryVerts(geom: THREE.BufferGeometry, params: RingParams): number {
  const innerR = params.innerDiameterMm / 2
  const depth = Math.min(params.textDepthMm, params.bandThicknessMm * 0.75)
  const primaryAngle =
    ((params.bandProfile === 'd' ? params.innerTextAngleDeg : params.textAngleDeg) * Math.PI) /
    180
  const pos = geom.getAttribute('position') as THREE.BufferAttribute
  let n = 0
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    if (Math.abs(z) > params.bandWidthMm * 0.45) continue
    const r = Math.hypot(x, y)
    if (r < innerR + 0.04 || r > innerR + depth + 0.35) continue
    let d = Math.atan2(y, x) - primaryAngle
    d = Math.atan2(Math.sin(d), Math.cos(d))
    if (Math.abs(d) > 1.2) continue
    n++
  }
  return n
}

function assertFiniteGeometry(geometry: THREE.BufferGeometry, label: string): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  assert(position && position.count > 0, `${label} has positions`)
  for (let i = 0; i < position.count; i++) {
    assert(
      Number.isFinite(position.getX(i)) &&
        Number.isFinite(position.getY(i)) &&
        Number.isFinite(position.getZ(i)),
      `${label} position ${i} is finite`,
    )
  }
}

function geometryCenterAngle(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  let x = 0
  let y = 0
  for (let i = 0; i < position.count; i++) {
    const px = position.getX(i)
    const py = position.getY(i)
    const radius = Math.hypot(px, py)
    x += px / radius
    y += py / radius
  }
  return Math.atan2(y, x)
}

function angularDistanceRad(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
}

function countInkMeshes(ring: ReturnType<typeof buildBlankRing>): number {
  let count = 0
  ring.group.traverse((child) => {
    if (child instanceof THREE.Mesh && child.name === 'inscription-glyph') count++
  })
  return count
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${msg}`)
}

function beginMainThreadGapProbe(): () => Promise<number> {
  let last = performance.now()
  let maxGapMs = 0
  const timer = setInterval(() => {
    const now = performance.now()
    maxGapMs = Math.max(maxGapMs, now - last)
    last = now
  }, 1)
  return async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    clearInterval(timer)
    return Math.round(maxGapMs)
  }
}

async function main(): Promise<void> {
  const lines: string[] = []
  const log = (s: string) => {
    lines.push(s)
    console.log(s)
  }

  const params = fixedParams()
  log(`params date="${params.innerDateText}" quality=${params.quality}`)

  // --- First paint: base band needs neither fonts nor engraving ---
  const blank = buildBlankRing(params)
  log(
    `blank: durationMs=${blank.stages.durationMs} ` +
      `ranDisplacement=${blank.stages.ranDisplacement} tris=${blank.triangleCount}`,
  )
  assert(blank.stages.ranDisplacement === false, 'blank band skips displacement')
  assert(blank.stages.ranDateCsg === false, 'blank band skips date CSG')
  assert(blank.triangleCount > 0, 'blank band geometry is visible')

  // --- Preview: must NOT run date CSG ---
  const tPrev0 = performance.now()
  const preview = await buildRing(params, { mode: 'preview' })
  const tPrev1 = performance.now()
  log(
    `preview: durationMs=${preview.stages.durationMs} wallMs=${Math.round(tPrev1 - tPrev0)} ` +
      `layoutMs=${preview.stages.layoutMs} displacementMs=${preview.stages.displacementMs} ` +
      `ranDisplacement=${preview.stages.ranDisplacement} ranDateCsg=${preview.stages.ranDateCsg} ` +
      `tris=${preview.triangleCount}`,
  )
  assert(preview.stages.mode === 'preview', 'preview mode flag')
  assert(preview.stages.ranDateCsg === false, 'preview must skip date CSG')
  assert(preview.stages.ranDisplacement === true, 'preview must displace (date metal recesses)')
  assert(preview.exportMesh.geometry !== undefined, 'preview export mesh exists')
  const prevPos = preview.exportMesh.geometry.getAttribute('position')
  assert(prevPos && prevPos.count > 0, 'preview export geometry non-empty')
  const previewRecess = countRecessedDateVerts(preview.exportMesh.geometry, params)
  const previewPrimaryRecess = countRecessedPrimaryVerts(preview.exportMesh.geometry, params)
  log(`preview recessed date verts near date sector: ${previewRecess}`)
  log(`preview recessed primary verts near text sector: ${previewPrimaryRecess}`)
  assert(previewRecess > 0, 'preview date recesses in metal (ink-off visible path)')
  assert(previewPrimaryRecess > 0, 'preview primary inscription recesses in metal')
  assertFiniteGeometry(preview.exportMesh.geometry, 'preview band')

  const { buildTextLayout, layoutXToWorldAngle } = await import('../src/textEngraving.ts')
  const directionStart = 0.4
  const layoutX = 1.25
  const innerRadius = params.innerDiameterMm / 2
  const outerRadius = innerRadius + params.bandThicknessMm
  const innerArc =
    (layoutXToWorldAngle(layoutX, innerRadius, directionStart) - directionStart) * innerRadius
  const outerArc =
    (layoutXToWorldAngle(layoutX, outerRadius, directionStart) - directionStart) * outerRadius
  const dateArc =
    (layoutXToWorldAngle(layoutX, innerRadius, directionStart, -1) - directionStart) * innerRadius
  assert(Math.abs(innerArc - layoutX) < 1e-9, 'forward text direction maps to positive arc')
  assert(Math.abs(outerArc - layoutX) < 1e-9, 'outer text keeps source reading direction')
  assert(Math.sign(innerArc) === Math.sign(outerArc), 'forward runs are not mirrored')
  assert(Math.abs(dateArc + layoutX) < 1e-9, 'date keeps its established reading direction')

  const waveInnerLayout = await buildTextLayout({
    ...DEFAULT_PARAMS,
    innerText: 'test',
    innerDateText: '',
    outerText: '',
    quality: 'draft',
  })
  const waveInnerPolys = waveInnerLayout?.polys.filter((poly) => poly.surface === 'inner') ?? []
  assert(waveInnerPolys.length > 0, 'wave inner-direction probe produces engraving masks')
  assert(
    waveInnerPolys.every((poly) => poly.angularDirection === -1),
    'wave inner text reads in the same direction as the date',
  )
  waveInnerLayout?.dateCutter?.dispose()
  for (const geometry of waveInnerLayout?.previewGeometries ?? []) geometry.dispose()

  const classicInnerLayout = await buildTextLayout({
    ...DEFAULT_PARAMS,
    bandProfile: 'd',
    innerText: 'test',
    innerDateText: '',
    outerText: 'outer',
    innerTextAngleDeg: 35,
    textAngleDeg: 145,
    quality: 'draft',
  })
  const classicInnerPolys =
    classicInnerLayout?.polys.filter((poly) => poly.surface === 'inner') ?? []
  const classicOuterPolys =
    classicInnerLayout?.polys.filter((poly) => poly.surface === 'outer') ?? []
  assert(classicInnerPolys.length > 0, 'classic-D inner-direction probe produces engraving masks')
  assert(
    classicInnerPolys.every(
      (poly) =>
        poly.angularDirection === -1 &&
        angularDistanceRad(poly.angleOffsetRad, (35 * Math.PI) / 180) < 1e-9,
    ),
    'classic-D inner text reads like the date at its independent position',
  )
  assert(classicOuterPolys.length > 0, 'classic-D outer-position probe produces masks')
  assert(
    classicOuterPolys.every(
      (poly) =>
        poly.angularDirection === 1 &&
        angularDistanceRad(poly.angleOffsetRad, (145 * Math.PI) / 180) < 1e-9,
    ),
    'classic-D outer text retains its independent position and direction',
  )
  classicInnerLayout?.dateCutter?.dispose()
  for (const geometry of classicInnerLayout?.previewGeometries ?? []) geometry.dispose()

  // Date position must remain continuous through the wave pinch sector. This
  // catches both safety snapping and a cache key that omits dateAngleDeg.
  const dateProbeBase = {
    ...DEFAULT_PARAMS,
    innerText: '',
    innerDateText: '27.09.2026',
    quality: 'draft' as const,
  }
  const dateLayout30 = await buildTextLayout({ ...dateProbeBase, dateAngleDeg: 30 })
  const dateLayout60 = await buildTextLayout({ ...dateProbeBase, dateAngleDeg: 60 })
  assert(dateLayout30?.dateCutter, '30° date-position probe has a cutter')
  assert(dateLayout60?.dateCutter, '60° date-position probe has a cutter')
  const actualDateMovement = angularDistanceRad(
    geometryCenterAngle(dateLayout60.dateCutter),
    geometryCenterAngle(dateLayout30.dateCutter),
  )
  assert(
    Math.abs(actualDateMovement - Math.PI / 6) < 1e-4,
    'date position moves by the requested 30° inside the pinch sector',
  )
  for (const layout of [dateLayout30, dateLayout60]) {
    layout.dateCutter?.dispose()
    for (const geometry of layout.previewGeometries) geometry.dispose()
  }

  // --- Real first-load text, then selected-quality viewport from cached layout ---
  const defaultPreviewParams = {
    ...DEFAULT_PARAMS,
    // Classic D for engraving/perf regressions (wave densifies pinch sector)
    bandProfile: 'd' as const,
    innerText: 'Além do universo, em perpetuidade.',
    innerDateText: '27.09.2026',
    quality: 'draft' as const,
  }
  const stopDefaultPreviewGapProbe = beginMainThreadGapProbe()
  const defaultPreview = await buildRing(defaultPreviewParams, { mode: 'preview' })
  const defaultPreviewMaxGapMs = await stopDefaultPreviewGapProbe()
  log(
    `preview-default: durationMs=${defaultPreview.stages.durationMs} ` +
      `layoutMs=${defaultPreview.stages.layoutMs} ` +
      `displacementMs=${defaultPreview.stages.displacementMs} ` +
      `maxMainThreadGapMs=${defaultPreviewMaxGapMs} tris=${defaultPreview.triangleCount}`,
  )
  assert(defaultPreview.stages.ranDateCsg === false, 'default preview skips date CSG')
  assert(defaultPreviewMaxGapMs < 150, 'default preview should yield before a 150 ms long task')

  // --- Settled viewport: selected quality but never blocking CSG ---
  const settledParams = { ...defaultPreviewParams, quality: 'normal' as const }
  const stopSettledGapProbe = beginMainThreadGapProbe()
  const settled = await buildRing(settledParams, { mode: 'settled' })
  const settledMaxGapMs = await stopSettledGapProbe()
  log(
    `settled-default: durationMs=${settled.stages.durationMs} ` +
      `layoutMs=${settled.stages.layoutMs} displacementMs=${settled.stages.displacementMs} ` +
      `maxMainThreadGapMs=${settledMaxGapMs} ` +
      `ranDisplacement=${settled.stages.ranDisplacement} ` +
      `ranDateCsg=${settled.stages.ranDateCsg} tris=${settled.triangleCount}`,
  )
  assert(settled.stages.mode === 'settled', 'settled mode flag')
  assert(settled.stages.ranDisplacement === true, 'settled viewport displaces engraving')
  assert(settled.stages.ranDateCsg === false, 'settled viewport must skip date CSG')
  assert(settled.stages.layoutMs < 75, 'settled build should reuse preview text layout')
  assert(settledMaxGapMs < 150, 'settled viewport should yield before a 150 ms long task')
  assert(
    settled.stages.durationMs < 3000,
    'default normal-quality settled build should stay below the 3 s regression ceiling',
  )

  const stopHighGapProbe = beginMainThreadGapProbe()
  const highSettled = await buildRing(
    { ...defaultPreviewParams, quality: 'high' },
    { mode: 'settled' },
  )
  const highMaxGapMs = await stopHighGapProbe()
  log(
    `settled-high: durationMs=${highSettled.stages.durationMs} ` +
      `layoutMs=${highSettled.stages.layoutMs} ` +
      `displacementMs=${highSettled.stages.displacementMs} ` +
      `maxMainThreadGapMs=${highMaxGapMs} tris=${highSettled.triangleCount}`,
  )
  assert(highSettled.stages.ranDateCsg === false, 'high viewport must skip date CSG')
  assert(highMaxGapMs < 150, 'high viewport should yield before a 150 ms long task')

  // Classic D has fixed radial counts (wave injects motif corners, so ratio ≠ 960/640).
  const highBlank = buildBlankRing({ ...defaultPreviewParams, bandProfile: 'd' }, 'high')
  const extraBlank = buildBlankRing({ ...defaultPreviewParams, bandProfile: 'd' }, 'extra')
  assert(
    extraBlank.triangleCount === highBlank.triangleCount * 1.5,
    'extra uses 960 radial segments versus high at 640',
  )
  log(`quality-extra: high=${highBlank.triangleCount} extra=${extraBlank.triangleCount} tris`)
  disposeBuiltRing(highBlank)
  disposeBuiltRing(extraBlank)

  // --- Rapid edits: stale text layout must cancel at a cooperative checkpoint ---
  let cancellationChecks = 0
  let cancelled = false
  const cancelStarted = performance.now()
  try {
    await buildRing(
      { ...params, innerText: 'cancel-me '.repeat(20) },
      {
        mode: 'preview',
        isCancelled: () => ++cancellationChecks >= 8,
      },
    )
  } catch (err) {
    cancelled = err instanceof DOMException && err.name === 'AbortError'
  }
  const cancelDurationMs = Math.round(performance.now() - cancelStarted)
  log(`cancelled-stale-build: durationMs=${cancelDurationMs} checks=${cancellationChecks}`)
  assert(cancelled, 'stale layout build should abort')
  assert(cancelDurationMs < 1000, 'stale layout build should abort promptly')

  // --- Final: must run date CSG and keep export mesh ---
  const tFin0 = performance.now()
  const final = await buildRing(params, { mode: 'final' })
  const tFin1 = performance.now()
  log(
    `final: durationMs=${final.stages.durationMs} wallMs=${Math.round(tFin1 - tFin0)} ` +
      `layoutMs=${final.stages.layoutMs} displacementMs=${final.stages.displacementMs} ` +
      `dateCsgMs=${final.stages.dateCsgMs} ` +
      `ranDisplacement=${final.stages.ranDisplacement} ranDateCsg=${final.stages.ranDateCsg} ` +
      `tris=${final.triangleCount}`,
  )
  assert(final.stages.mode === 'final', 'final mode flag')
  assert(final.stages.ranDateCsg === true, 'final must run date CSG path')
  assert(final.stages.ranDisplacement === true, 'final still displaces Tengwar/etc')
  const finPos = final.exportMesh.geometry.getAttribute('position')
  assert(finPos && finPos.count > 0, 'final export geometry non-empty')
  const finTris = final.exportMesh.geometry.index
    ? final.exportMesh.geometry.index.count / 3
    : finPos.count / 3
  assert(finTris > 0, 'final triangle count > 0')
  const finalRecess = countRecessedDateVerts(final.exportMesh.geometry, params)
  log(`final recessed date verts near date sector: ${finalRecess}`)
  assert(finalRecess > 0, 'final date recesses in metal (not ink-only)')
  assertFiniteGeometry(final.exportMesh.geometry, 'final band')

  // Preview cheaper than final when CSG would run
  log(
    `timing: preview.stages.durationMs=${preview.stages.durationMs} ` +
      `final.stages.durationMs=${final.stages.durationMs}`,
  )
  assert(
    preview.stages.durationMs < final.stages.durationMs,
    'preview duration must be strictly less than final when date CSG runs on final',
  )
  assert(
    preview.stages.ranDateCsg === false && final.stages.ranDateCsg === true,
    'stage flags: CSG off preview / on final',
  )

  // Export mesh is the band (no requirement that ink is in export)
  assert(final.exportMesh.name === 'wedding-ring-band', 'export mesh is solid band')

  // Path tessellation must stay valid across every selectable inscription font.
  const fontCases: RingParams['font'][] = [
    'tengwar-annatar',
    'tengwar-annatar-italic',
    'ring-inscription',
    'elvish-uncial',
    'cinzel',
  ]
  for (const font of fontCases) {
    const fontRing = await buildRing(
      { ...params, font, innerText: 'test', innerDateText: '' },
      { mode: 'preview' },
    )
    assert(fontRing.stages.ranDateCsg === false, `${font} preview skips CSG`)
    assert(countInkMeshes(fontRing) > 0, `${font} produces visible inscription meshes`)
    assertFiniteGeometry(fontRing.exportMesh.geometry, `${font} band`)
    disposeBuiltRing(fontRing)
  }
  log(`font-smoke: ${fontCases.length} selectable fonts passed`)

  disposeBuiltRing(blank)
  disposeBuiltRing(preview)
  disposeBuiltRing(defaultPreview)
  disposeBuiltRing(settled)
  disposeBuiltRing(highSettled)
  disposeBuiltRing(final)

  log('ALL ASSERTIONS PASSED')

  // Optional scratch log path via env (goal harness)
  const scratch = process.env.GOAL_SCRATCH
  if (scratch) {
    mkdirSync(scratch, { recursive: true })
    writeFileSync(path.join(scratch, 'build-mode-tests.log'), lines.join('\n') + '\n')
    writeFileSync(
      path.join(scratch, 'build-timings.txt'),
      [
        `preview_ms=${preview.stages.durationMs}`,
        `preview_default_ms=${defaultPreview.stages.durationMs}`,
        `settled_default_ms=${settled.stages.durationMs}`,
        `final_ms=${final.stages.durationMs}`,
        `preview_ranDateCsg=${preview.stages.ranDateCsg}`,
        `final_ranDateCsg=${final.stages.ranDateCsg}`,
        `preview_recess_verts=${previewRecess}`,
        `final_recess_verts=${finalRecess}`,
      ].join('\n') + '\n',
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
