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
import { buildRing, disposeBuiltRing } from '../src/buildRing.ts'
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
    quality: 'draft', // keep CI fast; still exercises full stage path
    cutaway: false,
    innerText: 'test',
    innerTengwarKeys: '',
    outerText: '',
    outerTengwarKeys: '',
    innerDateText: '27.09.2026',
    textAngleDeg: 0,
    textDepthMm: 0.35,
    dateTextSizeMm: 1.35,
    textSizeMm: 1.4,
    innerDiameterMm: 17.3,
    bandWidthMm: 4.5,
    bandThicknessMm: 1.6,
  }
}

/** Sample band export mesh near date angle (π opposite start) for recessed r. */
function countRecessedDateVerts(geom: THREE.BufferGeometry, params: RingParams): number {
  const innerR = params.innerDiameterMm / 2
  const depth = Math.min(params.textDepthMm, params.bandThicknessMm * 0.75)
  const dateAngle = (params.textAngleDeg * Math.PI) / 180 + Math.PI
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

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${msg}`)
}

async function main(): Promise<void> {
  const lines: string[] = []
  const log = (s: string) => {
    lines.push(s)
    console.log(s)
  }

  const params = fixedParams()
  log(`params date="${params.innerDateText}" quality=${params.quality}`)

  // --- Preview: must NOT run date CSG ---
  const tPrev0 = performance.now()
  const preview = await buildRing(params, { mode: 'preview' })
  const tPrev1 = performance.now()
  log(
    `preview: durationMs=${preview.stages.durationMs} wallMs=${Math.round(tPrev1 - tPrev0)} ` +
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
  log(`preview recessed date verts near date sector: ${previewRecess}`)
  assert(previewRecess > 0, 'preview date recesses in metal (ink-off visible path)')

  // --- Final: must run date CSG and keep export mesh ---
  const tFin0 = performance.now()
  const final = await buildRing(params, { mode: 'final' })
  const tFin1 = performance.now()
  log(
    `final: durationMs=${final.stages.durationMs} wallMs=${Math.round(tFin1 - tFin0)} ` +
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

  disposeBuiltRing(preview)
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
