import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import {
  applyCutawayToGroup,
  applyMetalToGroup,
  buildRing,
  disposeBuiltRing,
} from './buildRing'
import type { BuiltRing } from './buildRing'
import { exportMeshToStl } from './exportStl'
import { renderInscriptionPreview } from './annatarPreview'
import {
  DEFAULT_GOLD_SPOT_USD_PER_TROY_OZ,
  estimate18kGold,
  formatGrams,
  formatUsd,
} from './goldEstimate'
import {
  applyLightPreset,
  createSceneLights,
  setInkVisible,
  type LightPreset,
} from './lighting'
import { DEFAULT_PARAMS, RING_SIZE_PRESETS } from './types'
import type { RingParams, MetalFinish } from './types'

// ─── State ───────────────────────────────────────────────────────────────────

let params: RingParams = { ...DEFAULT_PARAMS }
let built: BuiltRing | null = null
let showInk = true
let lightPreset: LightPreset = 'midday'

/** Monotonic build generation — stale async results are discarded. */
let buildGeneration = 0
let building = false
/** Latest params requested while a build was in flight. */
let pendingParams: RingParams | null = null
let pendingMode: 'preview' | 'final' | null = null

let previewTimer: ReturnType<typeof setTimeout> | null = null
let finalTimer: ReturnType<typeof setTimeout> | null = null
let annatarTimer: ReturnType<typeof setTimeout> | null = null
let loadingDelayTimer: ReturnType<typeof setTimeout> | null = null
/** True until the first ring mesh is shown after boot / hard refresh. */
let isInitialLoad = true

// Live preview is cheap (draft + no CSG); final settles to user quality + CSG.
// Final is deliberately slow so editing two fields in a row never runs CSG mid-way.
const PREVIEW_DEBOUNCE_MS = 80
const FINAL_IDLE_MS = 900
const LOADING_SHOW_AFTER_MS = 90

// ─── Three.js scene ──────────────────────────────────────────────────────────

const host = document.getElementById('canvas-host')!
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.15
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.localClippingEnabled = true
host.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0c0b0a)
scene.fog = new THREE.Fog(0x0c0b0a, 80, 220)

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 500)
camera.position.set(22, 14, 20)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.06
controls.minDistance = 8
controls.maxDistance = 120
controls.target.set(0, 0, 0)

const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture

const lights = createSceneLights(scene)
applyLightPreset(lightPreset, lights, scene, renderer)

const ringGroup = new THREE.Group()
scene.add(ringGroup)

// ─── UI helpers ──────────────────────────────────────────────────────────────

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const loadingEl = $('loading')
const loadingTitleEl = document.getElementById('loading-title')
const loadingSubEl = document.getElementById('loading-sub')
const toastEl = $('toast')
const statsEl = $('stats')
const buildBusyEl = document.getElementById('build-busy')
const buildBusyLabelEl = document.getElementById('build-busy-label')

function setLoadingCopy(title: string, sub: string) {
  if (loadingTitleEl) loadingTitleEl.textContent = title
  if (loadingSubEl) loadingSubEl.textContent = sub
}

/** Non-blocking corner chip — never steals focus from the panel. */
function setBuildBusy(on: boolean, label = 'Updating…') {
  if (!buildBusyEl) return
  if (buildBusyLabelEl) buildBusyLabelEl.textContent = label
  buildBusyEl.classList.toggle('visible', on)
}

/**
 * Full-screen overlay: **initial boot only**.
 * Post-boot rebuilds must not cover the panel (that was freezing param edits).
 */
function setLoading(on: boolean, immediate = false) {
  if (loadingDelayTimer) {
    clearTimeout(loadingDelayTimer)
    loadingDelayTimer = null
  }
  // After first ring, never use the full-screen overlay for rebuilds
  if (!isInitialLoad) {
    loadingEl.classList.remove('visible', 'initial')
    loadingEl.setAttribute('aria-busy', 'false')
    return
  }
  if (!on) {
    loadingEl.classList.remove('visible')
    loadingEl.setAttribute('aria-busy', 'false')
    return
  }
  loadingEl.setAttribute('aria-busy', 'true')
  if (immediate) {
    loadingEl.classList.add('visible')
    return
  }
  loadingDelayTimer = setTimeout(() => {
    if (isInitialLoad) loadingEl.classList.add('visible')
    loadingDelayTimer = null
  }, LOADING_SHOW_AFTER_MS)
}

function finishInitialLoad() {
  if (!isInitialLoad) return
  isInitialLoad = false
  setLoading(false, true)
  loadingEl.classList.remove('initial')
  setBuildBusy(false)
}

function toast(message: string, isError = false) {
  toastEl.textContent = message
  toastEl.classList.toggle('error', isError)
  toastEl.classList.add('visible')
  window.setTimeout(() => toastEl.classList.remove('visible'), 2800)
}

function fmt(n: number, digits = 1) {
  return n.toFixed(digits)
}

function parseNum(raw: string | number): number {
  if (typeof raw === 'number') return raw
  const n = Number(String(raw).trim().replace(',', '.'))
  return n
}

function clampNum(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function updateAnnatarPreview() {
  if (annatarTimer) clearTimeout(annatarTimer)
  annatarTimer = setTimeout(() => {
    const hostEl = document.getElementById('annatar-preview-host')
    if (!hostEl) return
    void renderInscriptionPreview(hostEl, params).catch((err) => {
      console.warn(err)
      hostEl.innerHTML = '<p class="hint">Preview unavailable</p>'
    })
  }, 150)
}

function readSpotPrice(): number {
  const raw = Number(($('goldSpotUsd') as HTMLInputElement).value)
  return clampNum(raw, 0, 1_000_000, DEFAULT_GOLD_SPOT_USD_PER_TROY_OZ)
}

function updateGoldEstimate() {
  const est = estimate18kGold(
    params.innerDiameterMm,
    params.bandWidthMm,
    params.bandThicknessMm,
    readSpotPrice(),
  )
  $('est-volume').textContent = `${est.volumeMm3.toFixed(0)} mm³`
  $('est-mass-18k').textContent = `${formatGrams(est.mass18kGrams)} g`
  $('est-pure-gold').textContent =
    `${formatGrams(est.pureGoldGrams)} g · ${est.pureGoldTroyOz.toFixed(3)} oz t`
  $('est-melt').textContent = formatUsd(est.meltValueUsd)
}

function updateDimLabels() {
  $('val-text-size').textContent = `${fmt(params.textSizeMm, 2)} mm`
  $('val-date-size').textContent = `${fmt(params.dateTextSizeMm, 2)} mm`
  $('val-text-depth').textContent = `${fmt(params.textDepthMm, 2)} mm`
  $('val-text-angle').textContent = `${Math.round(params.textAngleDeg)}°`

  document.querySelectorAll('#size-presets .chip').forEach((el) => {
    const d = Number((el as HTMLElement).dataset.diameter)
    el.classList.toggle('active', Math.abs(d - params.innerDiameterMm) < 0.05)
  })
}

function syncLabels() {
  updateDimLabels()
  updateGoldEstimate()
  void updateAnnatarPreview()
}

function readParamsFromUi(): RingParams {
  return {
    innerDiameterMm: clampNum(
      parseNum(($('innerDiameterMm') as HTMLInputElement).value),
      12,
      30,
      DEFAULT_PARAMS.innerDiameterMm,
    ),
    bandWidthMm: clampNum(
      parseNum(($('bandWidthMm') as HTMLInputElement).value),
      1.5,
      12,
      DEFAULT_PARAMS.bandWidthMm,
    ),
    bandThicknessMm: clampNum(
      parseNum(($('bandThicknessMm') as HTMLInputElement).value),
      0.6,
      4,
      DEFAULT_PARAMS.bandThicknessMm,
    ),
    innerText: ($('innerText') as HTMLTextAreaElement).value,
    innerDateText: ($('innerDateText') as HTMLInputElement).value,
    innerTengwarKeys: ($('innerTengwarKeys') as HTMLTextAreaElement).value,
    outerText: ($('outerText') as HTMLTextAreaElement).value,
    outerTengwarKeys: ($('outerTengwarKeys') as HTMLTextAreaElement).value,
    textDepthMm: Number(($('textDepthMm') as HTMLInputElement).value),
    textSizeMm: Number(($('textSizeMm') as HTMLInputElement).value),
    dateTextSizeMm: Number(($('dateTextSizeMm') as HTMLInputElement).value),
    textAngleDeg: Number(($('textAngleDeg') as HTMLInputElement).value),
    font: ($('font') as HTMLSelectElement).value as RingParams['font'],
    metal: ($('metal') as HTMLSelectElement).value as MetalFinish,
    quality: ($('quality') as HTMLSelectElement).value as RingParams['quality'],
    cutaway: ($('cutaway') as HTMLInputElement).checked,
  }
}

function writeParamsToUi(p: RingParams) {
  ;($('innerDiameterMm') as HTMLInputElement).value = String(p.innerDiameterMm)
  ;($('bandWidthMm') as HTMLInputElement).value = String(p.bandWidthMm)
  ;($('bandThicknessMm') as HTMLInputElement).value = String(p.bandThicknessMm)
  ;($('innerText') as HTMLTextAreaElement).value = p.innerText
  ;($('innerDateText') as HTMLInputElement).value = p.innerDateText
  ;($('innerTengwarKeys') as HTMLTextAreaElement).value = p.innerTengwarKeys
  ;($('outerText') as HTMLTextAreaElement).value = p.outerText
  ;($('outerTengwarKeys') as HTMLTextAreaElement).value = p.outerTengwarKeys
  ;($('textDepthMm') as HTMLInputElement).value = String(p.textDepthMm)
  ;($('textSizeMm') as HTMLInputElement).value = String(p.textSizeMm)
  ;($('dateTextSizeMm') as HTMLInputElement).value = String(p.dateTextSizeMm)
  ;($('textAngleDeg') as HTMLInputElement).value = String(p.textAngleDeg)
  ;($('font') as HTMLSelectElement).value = p.font
  ;($('metal') as HTMLSelectElement).value = p.metal
  ;($('quality') as HTMLSelectElement).value = p.quality
  ;($('cutaway') as HTMLInputElement).checked = p.cutaway
  ;($('goldSpotUsd') as HTMLInputElement).value = String(DEFAULT_GOLD_SPOT_USD_PER_TROY_OZ)
  syncLabels()
}

// Size presets
const presetsHost = $('size-presets')
for (const preset of RING_SIZE_PRESETS) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'chip'
  btn.textContent = preset.label
  btn.dataset.diameter = String(preset.diameterMm)
  btn.addEventListener('click', () => {
    ;($('innerDiameterMm') as HTMLInputElement).value = String(preset.diameterMm)
    scheduleGeometryRebuild('both')
  })
  presetsHost.appendChild(btn)
}

// ─── Fast paths (no geometry rebuild) ────────────────────────────────────────

function applyCosmeticMetal(metal: MetalFinish) {
  params = { ...params, metal }
  if (built) applyMetalToGroup(built.group, metal)
}

function applyCosmeticCutaway(cutaway: boolean) {
  params = { ...params, cutaway }
  if (built) {
    built.cutawayPlane = applyCutawayToGroup(built.group, cutaway, params.textAngleDeg)
  }
}

function clearRingGroup() {
  while (ringGroup.children.length) {
    const child = ringGroup.children[0]!
    ringGroup.remove(child)
    child.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose())
        else obj.material.dispose()
      }
    })
  }
}

// ─── Rebuild pipeline ────────────────────────────────────────────────────────

function paramsEqualGeom(a: RingParams, b: RingParams): boolean {
  return (
    a.innerDiameterMm === b.innerDiameterMm &&
    a.bandWidthMm === b.bandWidthMm &&
    a.bandThicknessMm === b.bandThicknessMm &&
    a.innerText === b.innerText &&
    a.innerDateText === b.innerDateText &&
    a.innerTengwarKeys === b.innerTengwarKeys &&
    a.outerText === b.outerText &&
    a.outerTengwarKeys === b.outerTengwarKeys &&
    a.textDepthMm === b.textDepthMm &&
    a.textSizeMm === b.textSizeMm &&
    a.dateTextSizeMm === b.dateTextSizeMm &&
    a.textAngleDeg === b.textAngleDeg &&
    a.font === b.font &&
    a.quality === b.quality
    // metal + cutaway are cosmetic
  )
}

function mergeBuildMode(
  a: 'preview' | 'final' | null,
  b: 'preview' | 'final',
): 'preview' | 'final' {
  return a === 'final' || b === 'final' ? 'final' : 'preview'
}

/** Abort in-flight work at the next yield checkpoint. */
function invalidateInFlightBuild() {
  buildGeneration++
}

async function runBuild(nextParams: RingParams, mode: 'preview' | 'final') {
  // Coalesce: remember latest request and cancel the running job
  if (building) {
    pendingParams = nextParams
    pendingMode = mergeBuildMode(pendingMode, mode)
    invalidateInFlightBuild()
    return
  }

  const gen = ++buildGeneration
  building = true

  if (isInitialLoad) {
    setLoading(true, true)
    setLoadingCopy('Forging your ring', 'Building geometry & inscriptions…')
  } else {
    // Non-blocking chip only — never cover the form
    setBuildBusy(true, mode === 'preview' ? 'Live preview…' : 'Refining…')
  }

  params = nextParams
  updateGoldEstimate()
  updateDimLabels()

  const safety = window.setTimeout(() => {
    if (building && buildGeneration === gen) {
      building = false
      setBuildBusy(false)
      setLoading(false, true)
      if (isInitialLoad) {
        setLoadingCopy('Still working…', 'Try Draft quality if this keeps hanging')
      }
      toast('Build timed out — try Draft or Normal quality', true)
    }
  }, 45000)

  try {
    const qualityOverride =
      mode === 'preview' && nextParams.quality !== 'draft' ? ('draft' as const) : undefined

    const next = await buildRing(nextParams, {
      mode,
      qualityOverride,
      isCancelled: () => gen !== buildGeneration,
    })

    // Stale generation — discard
    if (gen !== buildGeneration) {
      disposeBuiltRing(next)
      return
    }

    clearRingGroup()
    ringGroup.add(next.group)
    built = next
    setInkVisible(next.group, showInk)
    // Don't re-run applyLightPreset (full scene traverse) on every rebuild
    const tag = mode === 'preview' ? ' · live' : ''
    statsEl.innerHTML = `Triangles: <strong>${next.triangleCount.toLocaleString()}</strong>${tag}`
    finishInitialLoad()
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      // Cancelled by newer generation — ignore
    } else {
      console.error(err)
      if (isInitialLoad) {
        setLoadingCopy('Could not build ring', 'Check the console, then try Rebuild')
        setLoading(true, true)
      }
      toast(err instanceof Error ? err.message : 'Failed to build ring', true)
    }
  } finally {
    window.clearTimeout(safety)
    building = false

    if (pendingParams) {
      const p = pendingParams
      const m = pendingMode ?? 'final'
      pendingParams = null
      pendingMode = null
      // Keep busy chip on; next runBuild will refresh label
      void runBuild(p, m)
    } else {
      setBuildBusy(false)
      if (isInitialLoad && built) finishInitialLoad()
      else if (!isInitialLoad) setLoading(false, true)
    }
  }
}

/**
 * Schedule geometry rebuild.
 * - `preview`: fast draft mesh while dragging (no CSG)
 * - `final`: full quality + CSG after a long idle pause
 * - `both`: preview soon + final after idle (slider input)
 */
function scheduleGeometryRebuild(kind: 'preview' | 'final' | 'both' = 'both') {
  let next: RingParams
  try {
    next = readParamsFromUi()
  } catch {
    return
  }

  // Instant cosmetics when only metal/cutaway changed
  if (built) {
    const geomSame = paramsEqualGeom(next, params)
    if (geomSame) {
      if (next.metal !== params.metal) applyCosmeticMetal(next.metal)
      if (next.cutaway !== params.cutaway) applyCosmeticCutaway(next.cutaway)
      params = next
      updateGoldEstimate()
      updateDimLabels()
      return
    }
  }

  params = next
  updateGoldEstimate()
  updateDimLabels()

  // New input always cancels the current heavy job so the UI never waits on it
  if (building) invalidateInFlightBuild()

  if (kind === 'preview' || kind === 'both') {
    if (previewTimer) clearTimeout(previewTimer)
    previewTimer = setTimeout(() => {
      previewTimer = null
      void runBuild(readParamsFromUi(), 'preview')
    }, PREVIEW_DEBOUNCE_MS)
  }

  if (kind === 'final' || kind === 'both') {
    if (finalTimer) clearTimeout(finalTimer)
    finalTimer = setTimeout(() => {
      finalTimer = null
      if (previewTimer) {
        clearTimeout(previewTimer)
        previewTimer = null
      }
      void runBuild(readParamsFromUi(), 'final')
    }, kind === 'final' ? 50 : FINAL_IDLE_MS)
  }
}

function scheduleFinalNow() {
  if (previewTimer) {
    clearTimeout(previewTimer)
    previewTimer = null
  }
  if (finalTimer) {
    clearTimeout(finalTimer)
    finalTimer = null
  }
  if (building) invalidateInFlightBuild()
  void runBuild(readParamsFromUi(), 'final')
}

// ─── Control wiring ──────────────────────────────────────────────────────────

/** Params that need geometry rebuild on input (sliders / numbers). */
const geomLiveIds = [
  'innerDiameterMm',
  'bandWidthMm',
  'bandThicknessMm',
  'textDepthMm',
  'textSizeMm',
  'dateTextSizeMm',
  'textAngleDeg',
  'quality',
] as const

for (const id of geomLiveIds) {
  const el = $(id)
  el.addEventListener('input', () => {
    if (id === 'innerDiameterMm' || id === 'bandWidthMm' || id === 'bandThicknessMm') {
      try {
        params = readParamsFromUi()
        updateGoldEstimate()
        updateDimLabels()
      } catch {
        /* partial */
      }
    }
    scheduleGeometryRebuild('both')
  })
  el.addEventListener('change', () => scheduleFinalNow())
}

// Metal — color only, no rebuild
$('metal').addEventListener('input', () => {
  applyCosmeticMetal(($('metal') as HTMLSelectElement).value as MetalFinish)
})
$('metal').addEventListener('change', () => {
  applyCosmeticMetal(($('metal') as HTMLSelectElement).value as MetalFinish)
})

// Cutaway — clipping only
$('cutaway').addEventListener('change', () => {
  applyCosmeticCutaway(($('cutaway') as HTMLInputElement).checked)
})

$('goldSpotUsd').addEventListener('input', () => updateGoldEstimate())
$('goldSpotUsd').addEventListener('change', () => updateGoldEstimate())

$('showInk').addEventListener('change', () => {
  showInk = ($('showInk') as HTMLInputElement).checked
  if (built) setInkVisible(built.group, showInk)
})

document.querySelectorAll<HTMLButtonElement>('.light-chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.light as LightPreset
    if (!id || id === lightPreset) return
    lightPreset = id
    document.querySelectorAll('.light-chip').forEach((el) => {
      el.classList.toggle('active', (el as HTMLElement).dataset.light === id)
    })
    applyLightPreset(lightPreset, lights, scene, renderer)
  })
})

// Text fields: Annatar preview on type; geometry on change/blur
$('innerText').addEventListener('input', () => {
  params = readParamsFromUi()
  void updateAnnatarPreview()
})
$('innerText').addEventListener('change', () => scheduleFinalNow())

$('innerTengwarKeys').addEventListener('input', () => {
  params = readParamsFromUi()
  void updateAnnatarPreview()
})
$('innerTengwarKeys').addEventListener('change', () => scheduleFinalNow())

$('innerDateText').addEventListener('input', () => {
  // Live date typing — draft preview; CSG final after idle
  scheduleGeometryRebuild('both')
})
$('innerDateText').addEventListener('change', () => scheduleFinalNow())
$('innerDateText').addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter') scheduleFinalNow()
})

$('outerText').addEventListener('change', () => scheduleFinalNow())
$('outerTengwarKeys').addEventListener('change', () => scheduleFinalNow())

$('font').addEventListener('change', () => {
  params = readParamsFromUi()
  void updateAnnatarPreview()
  scheduleFinalNow()
})

$('btn-rebuild').addEventListener('click', () => scheduleFinalNow())

async function doExport() {
  if (params.cutaway) {
    toast('Tip: turn off cutaway before final export', false)
  }

  // Always export a final-quality mesh (not a draft live preview)
  setLoading(true)
  try {
    const p = readParamsFromUi()
    const final = await buildRing(p, { mode: 'final' })
    const label = p.innerText || p.outerText || 'wedding-ring'
    const safeName = label
      .slice(0, 40)
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
    const filename = `ring-${safeName || 'band'}-${fmt(p.innerDiameterMm)}mm.stl`
    exportMeshToStl(final.exportMesh, filename, true)
    // Swap viewport to the exported mesh so UI matches file
    clearRingGroup()
    ringGroup.add(final.group)
    built = final
    setInkVisible(final.group, showInk)
    applyLightPreset(lightPreset, lights, scene, renderer)
    statsEl.innerHTML = `Triangles: <strong>${final.triangleCount.toLocaleString()}</strong>`
    toast(`Exported ${filename}`)
  } catch (err) {
    console.error(err)
    toast(err instanceof Error ? err.message : 'Export failed', true)
  } finally {
    setLoading(false)
  }
}

$('btn-export').addEventListener('click', doExport)
$('btn-export-footer').addEventListener('click', doExport)

$('btn-reset-camera').addEventListener('click', () => {
  camera.position.set(22, 14, 20)
  controls.target.set(0, 0, 0)
  controls.update()
})

// ─── Resize / animate ────────────────────────────────────────────────────────

function onResize() {
  const w = window.innerWidth
  const h = window.innerHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
}
window.addEventListener('resize', onResize)

function animate() {
  requestAnimationFrame(animate)
  controls.update()
  renderer.render(scene, camera)
}

// ─── Boot ────────────────────────────────────────────────────────────────────

// Overlay is already `.visible.initial` in HTML so hard refresh shows it before
// the module finishes evaluating; keep it until first mesh is ready.
writeParamsToUi(params)
setLoading(true, true)
setLoadingCopy('Forging your ring', 'Building geometry & inscriptions…')
void runBuild(params, 'final')
animate()
