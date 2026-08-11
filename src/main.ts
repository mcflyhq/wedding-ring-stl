import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  applyCutawayToGroup,
  applyMetalToGroup,
  buildBlankRing,
  buildRing,
  disposeBuiltRing,
} from './buildRing'
import type { BuiltRing, BuildMode } from './buildRing'
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
import { DimensionOverlay } from './dimensionOverlay'
import { DEFAULT_PARAMS, RING_SIZE_PRESETS } from './types'
import type { BandProfile, RingParams, MetalFinish } from './types'

// ─── State ───────────────────────────────────────────────────────────────────

let params: RingParams = { ...DEFAULT_PARAMS }
let built: BuiltRing | null = null
let showInk = true
let lightPreset: LightPreset = 'midday'

/** Monotonic build generation - stale async results are discarded. */
let buildGeneration = 0
let building = false
/** Latest params requested while a build was in flight. */
let pendingParams: RingParams | null = null
type ViewBuildMode = Exclude<BuildMode, 'final'>
let pendingMode: ViewBuildMode | null = null

let previewTimer: ReturnType<typeof setTimeout> | null = null
let settledTimer: ReturnType<typeof setTimeout> | null = null
let annatarTimer: ReturnType<typeof setTimeout> | null = null
let loadingDelayTimer: ReturnType<typeof setTimeout> | null = null
let basePreviewFrame: number | null = null
let basePreviewParams: RingParams | null = null
let environmentPromise: Promise<void> | null = null
/** True until the first ring mesh is shown after boot / hard refresh. */
let isInitialLoad = true

// Live preview is draft quality. The viewport settles to the selected quality
// without CSG; solid boolean carving is reserved for explicit STL export.
const PREVIEW_DEBOUNCE_MS = 80
const SETTLED_IDLE_MS = 650
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

const lights = createSceneLights(scene)
applyLightPreset(lightPreset, lights, scene, renderer)

const ringGroup = new THREE.Group()
scene.add(ringGroup)

const dimOverlay = new DimensionOverlay(host)
scene.add(dimOverlay.group)

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

/** Non-blocking corner chip - never steals focus from the panel. */
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
    void import('./annatarPreview')
      .then(({ renderInscriptionPreview }) => renderInscriptionPreview(hostEl, params))
      .catch((err) => {
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

  const waveAmp = document.getElementById('val-wave-amplitude')
  if (waveAmp) waveAmp.textContent = `${fmt(params.waveAmplitudeMm, 2)} mm`
  const wavePhase = document.getElementById('val-wave-phase')
  if (wavePhase) wavePhase.textContent = `${Math.round(params.wavePhaseDeg)}°`
  // Flank path lengths (3D) are filled after measureRing in updateDimensionOverlay
  const waveTopSpan = document.getElementById('val-wave-top-span')
  if (waveTopSpan && !waveTopSpan.dataset.flankMm) {
    waveTopSpan.textContent = `${Math.round(params.waveTopSpanDeg)}°`
  }
  const waveBotSpan = document.getElementById('val-wave-bot-span')
  if (waveBotSpan && !waveBotSpan.dataset.flankMm) {
    waveBotSpan.textContent = `${Math.round(params.waveBotSpanDeg)}°`
  }
  const waveSharp = document.getElementById('val-wave-sharpness')
  if (waveSharp) waveSharp.textContent = fmt(params.waveSharpness, 2)

  const wavePanel = document.getElementById('wave-controls')
  if (wavePanel) wavePanel.hidden = params.bandProfile !== 'wave'
  const profileHint = document.getElementById('profile-hint')
  if (profileHint) {
    profileHint.textContent =
      params.bandProfile === 'wave'
        ? 'Localized pinch · flat band elsewhere · domed outer · flat inner bore'
        : 'Domed (D-shape) · rounded outer face · flat inner face'
  }

  document.querySelectorAll('#size-presets .chip').forEach((el) => {
    const d = Number((el as HTMLElement).dataset.diameter)
    el.classList.toggle('active', Math.abs(d - params.innerDiameterMm) < 0.05)
  })
}

function syncLabels() {
  updateDimLabels()
  updateGoldEstimate()
  updateDimensionOverlay()
  void updateAnnatarPreview()
}

function updateDimensionOverlay() {
  const m = dimOverlay.update(params)
  // Live flank path lengths next to the sliders (true 3D edge length in mm)
  const waveTopSpan = document.getElementById('val-wave-top-span')
  if (waveTopSpan) {
    if (m.isWave && m.pinchTopFlankMm > 0) {
      waveTopSpan.dataset.flankMm = '1'
      waveTopSpan.textContent = `${Math.round(m.pinchTopSpanDeg)}° · ${fmt(m.pinchTopFlankMm, 2)} mm`
    } else {
      delete waveTopSpan.dataset.flankMm
      waveTopSpan.textContent = `${Math.round(params.waveTopSpanDeg)}°`
    }
  }
  const waveBotSpan = document.getElementById('val-wave-bot-span')
  if (waveBotSpan) {
    if (m.isWave && m.pinchBotFlankMm > 0) {
      waveBotSpan.dataset.flankMm = '1'
      waveBotSpan.textContent = `${Math.round(m.pinchBotSpanDeg)}° · ${fmt(m.pinchBotFlankMm, 2)} mm`
    } else {
      delete waveBotSpan.dataset.flankMm
      waveBotSpan.textContent = `${Math.round(params.waveBotSpanDeg)}°`
    }
  }
  // Surface key pinch measurement in the status bar for quick reading
  if (m.isWave && params.waveAmplitudeMm > 0) {
    const pin = ` · pinch full width <strong class="dim-readout">${fmt(m.pinchEnvelopeMm, 2)} mm</strong>`
    const span = ` · span ${Math.round(m.pinchSpanDeg)}°`
    // statsEl is also written by build pipeline; only set a dim hint attribute for merge
    statsEl.dataset.pinch = `${fmt(m.pinchEnvelopeMm, 2)} mm @ ${Math.round(m.pinchSpanDeg)}°`
    void pin
    void span
  } else {
    delete statsEl.dataset.pinch
  }
  requestRender()
}

function appendPinchToStats(baseHtml: string): string {
  const pinch = statsEl.dataset.pinch
  if (!pinch) return baseHtml
  return `${baseHtml} · pinch full width <strong class="dim-readout">${pinch}</strong>`
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
    bandProfile: ($('bandProfile') as HTMLSelectElement).value as BandProfile,
    waveAmplitudeMm: clampNum(
      Number(($('waveAmplitudeMm') as HTMLInputElement).value),
      0,
      2.5,
      DEFAULT_PARAMS.waveAmplitudeMm,
    ),
    waveCount: 1,
    wavePhaseDeg: clampNum(
      Number(($('wavePhaseDeg') as HTMLInputElement).value),
      0,
      360,
      DEFAULT_PARAMS.wavePhaseDeg,
    ),
    waveTopSpanDeg: clampNum(
      Number(($('waveTopSpanDeg') as HTMLInputElement).value),
      40,
      220,
      DEFAULT_PARAMS.waveTopSpanDeg,
    ),
    waveBotSpanDeg: clampNum(
      Number(($('waveBotSpanDeg') as HTMLInputElement).value),
      40,
      220,
      DEFAULT_PARAMS.waveBotSpanDeg,
    ),
    // Derived: densify / overlay envelope uses the longer edge
    waveSpanDeg: Math.max(
      clampNum(
        Number(($('waveTopSpanDeg') as HTMLInputElement).value),
        40,
        220,
        DEFAULT_PARAMS.waveTopSpanDeg,
      ),
      clampNum(
        Number(($('waveBotSpanDeg') as HTMLInputElement).value),
        40,
        220,
        DEFAULT_PARAMS.waveBotSpanDeg,
      ),
    ),
    waveSharpness: clampNum(
      Number(($('waveSharpness') as HTMLInputElement).value),
      0,
      1,
      DEFAULT_PARAMS.waveSharpness,
    ),
    waveAsymmetry: 0,
    waveCharacter: 1,
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
  ;($('bandProfile') as HTMLSelectElement).value = p.bandProfile
  ;($('waveAmplitudeMm') as HTMLInputElement).value = String(p.waveAmplitudeMm)
  ;($('waveCount') as HTMLInputElement).value = '1'
  ;($('wavePhaseDeg') as HTMLInputElement).value = String(p.wavePhaseDeg)
  ;($('waveTopSpanDeg') as HTMLInputElement).value = String(p.waveTopSpanDeg)
  ;($('waveBotSpanDeg') as HTMLInputElement).value = String(p.waveBotSpanDeg)
  ;($('waveSpanDeg') as HTMLInputElement).value = String(
    Math.max(p.waveTopSpanDeg, p.waveBotSpanDeg, p.waveSpanDeg),
  )
  ;($('waveSharpness') as HTMLInputElement).value = String(p.waveSharpness)
  ;($('waveAsymmetry') as HTMLInputElement).value = '0'
  ;($('waveCharacter') as HTMLInputElement).value = '1'
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
    scheduleGeometryRebuild('both', true)
  })
  presetsHost.appendChild(btn)
}

// ─── Fast paths (no geometry rebuild) ────────────────────────────────────────

function applyCosmeticMetal(metal: MetalFinish) {
  params = { ...params, metal }
  if (built) applyMetalToGroup(built.group, metal)
  requestRender()
}

function applyCosmeticCutaway(cutaway: boolean) {
  params = { ...params, cutaway }
  if (built) {
    built.cutawayPlane = applyCutawayToGroup(built.group, cutaway, params.textAngleDeg)
  }
  requestRender()
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
    a.bandProfile === b.bandProfile &&
    a.waveAmplitudeMm === b.waveAmplitudeMm &&
    a.waveCount === b.waveCount &&
    a.wavePhaseDeg === b.wavePhaseDeg &&
    a.waveSpanDeg === b.waveSpanDeg &&
    a.waveTopSpanDeg === b.waveTopSpanDeg &&
    a.waveBotSpanDeg === b.waveBotSpanDeg &&
    a.waveSharpness === b.waveSharpness &&
    a.waveAsymmetry === b.waveAsymmetry &&
    a.waveCharacter === b.waveCharacter &&
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

function mergeBuildMode(a: ViewBuildMode | null, b: ViewBuildMode): ViewBuildMode {
  return a === 'settled' || b === 'settled' ? 'settled' : 'preview'
}

/** Abort in-flight work at the next yield checkpoint. */
function invalidateInFlightBuild() {
  buildGeneration++
}

/**
 * Keep band dimensions visually attached to sliders. Engraving is restored by
 * the debounced preview build, while this cheap draft shell is capped at 1/frame.
 */
function scheduleBaseBandPreview(nextParams: RingParams) {
  basePreviewParams = nextParams
  if (basePreviewFrame !== null) return
  basePreviewFrame = requestAnimationFrame(() => {
    basePreviewFrame = null
    const latest = basePreviewParams
    basePreviewParams = null
    if (!latest) return

    const blank = buildBlankRing(latest)
    clearRingGroup()
    ringGroup.add(blank.group)
    built = blank
    statsEl.innerHTML = appendPinchToStats(
      `Triangles: <strong>${blank.triangleCount.toLocaleString()}</strong> · shaping`,
    )
    requestRender()
  })
}

async function runBuild(nextParams: RingParams, mode: ViewBuildMode) {
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
    // Non-blocking chip only - never cover the form
    setBuildBusy(true, mode === 'preview' ? 'Live preview…' : 'Refining…')
  }

  params = nextParams
  updateGoldEstimate()
  updateDimLabels()
  updateDimensionOverlay()

  // Only toast; do not flip `building` while work may still finish.
  const safetyMs = mode === 'preview' ? 3000 : 10000
  const safety = window.setTimeout(() => {
    if (building && buildGeneration === gen) {
      if (isInitialLoad) {
        setLoadingCopy('Still working…', 'Preparing the engraved preview')
      }
      setBuildBusy(true, 'Still building…')
      toast('Preview is slow - try Draft quality', false)
    }
  }, safetyMs)

  try {
    const qualityOverride =
      mode === 'preview' && nextParams.quality !== 'draft' ? ('draft' as const) : undefined

    const next = await buildRing(nextParams, {
      mode,
      qualityOverride,
      isCancelled: () => gen !== buildGeneration,
    })

    // Stale generation - discard
    if (gen !== buildGeneration) {
      disposeBuiltRing(next)
      return
    }

    if (basePreviewFrame !== null) {
      cancelAnimationFrame(basePreviewFrame)
      basePreviewFrame = null
      basePreviewParams = null
    }
    clearRingGroup()
    ringGroup.add(next.group)
    built = next
    setInkVisible(next.group, showInk)
    requestRender()
    // Don't re-run applyLightPreset (full scene traverse) on every rebuild
    const tag = mode === 'preview' ? ' · live' : ''
    statsEl.innerHTML = appendPinchToStats(
      `Triangles: <strong>${next.triangleCount.toLocaleString()}</strong>${tag}`,
    )
    finishInitialLoad()
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      // Cancelled by newer generation - ignore
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
      const m = pendingMode ?? 'settled'
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
 * - `settled`: selected viewport quality, still without CSG
 * - `both`: preview soon + selected quality after idle
 */
function scheduleGeometryRebuild(
  kind: ViewBuildMode | 'both' = 'both',
  showBaseBand = false,
) {
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
  updateDimensionOverlay()
  if (showBaseBand) scheduleBaseBandPreview(next)

  // New input always cancels the current heavy job so the UI never waits on it
  if (building) invalidateInFlightBuild()

  if (kind === 'preview' || kind === 'both') {
    if (previewTimer) clearTimeout(previewTimer)
    previewTimer = setTimeout(() => {
      previewTimer = null
      void runBuild(readParamsFromUi(), 'preview')
    }, PREVIEW_DEBOUNCE_MS)
  }

  if (kind === 'settled' || kind === 'both') {
    if (settledTimer) clearTimeout(settledTimer)
    settledTimer = setTimeout(() => {
      settledTimer = null
      if (previewTimer) {
        clearTimeout(previewTimer)
        previewTimer = null
      }
      void runBuild(readParamsFromUi(), 'settled')
    }, kind === 'settled' ? 50 : SETTLED_IDLE_MS)
  }
}

function scheduleSettledNow() {
  if (previewTimer) {
    clearTimeout(previewTimer)
    previewTimer = null
  }
  if (settledTimer) {
    clearTimeout(settledTimer)
    settledTimer = null
  }
  if (building) invalidateInFlightBuild()
  void runBuild(readParamsFromUi(), 'settled')
}

// ─── Control wiring ──────────────────────────────────────────────────────────

/** Params that need geometry rebuild on input (sliders / numbers). */
const geomLiveIds = [
  'innerDiameterMm',
  'bandWidthMm',
  'bandThicknessMm',
  'bandProfile',
  'waveAmplitudeMm',
  'wavePhaseDeg',
  'waveTopSpanDeg',
  'waveBotSpanDeg',
  'waveSharpness',
  'textDepthMm',
  'textSizeMm',
  'dateTextSizeMm',
  'textAngleDeg',
  'quality',
] as const

const bandShapeIds = new Set([
  'innerDiameterMm',
  'bandWidthMm',
  'bandThicknessMm',
  'bandProfile',
  'waveAmplitudeMm',
  'wavePhaseDeg',
  'waveTopSpanDeg',
  'waveBotSpanDeg',
  'waveSharpness',
])

for (const id of geomLiveIds) {
  const el = $(id)
  el.addEventListener('input', () => {
    scheduleGeometryRebuild('both', bandShapeIds.has(id))
  })
  el.addEventListener('change', () => scheduleSettledNow())
}

// Metal - color only, no rebuild
$('metal').addEventListener('input', () => {
  applyCosmeticMetal(($('metal') as HTMLSelectElement).value as MetalFinish)
})
$('metal').addEventListener('change', () => {
  applyCosmeticMetal(($('metal') as HTMLSelectElement).value as MetalFinish)
})

// Cutaway - clipping only
$('cutaway').addEventListener('change', () => {
  applyCosmeticCutaway(($('cutaway') as HTMLInputElement).checked)
})

$('goldSpotUsd').addEventListener('input', () => updateGoldEstimate())
$('goldSpotUsd').addEventListener('change', () => updateGoldEstimate())

$('showInk').addEventListener('change', () => {
  showInk = ($('showInk') as HTMLInputElement).checked
  if (built) setInkVisible(built.group, showInk)
  requestRender()
})

$('showDimensions').addEventListener('change', () => {
  dimOverlay.setVisible(($('showDimensions') as HTMLInputElement).checked)
  requestRender()
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
    requestRender()
  })
})

// Text fields: Annatar preview on type; geometry on change/blur
$('innerText').addEventListener('input', () => {
  params = readParamsFromUi()
  void updateAnnatarPreview()
})
$('innerText').addEventListener('change', () => scheduleSettledNow())

$('innerTengwarKeys').addEventListener('input', () => {
  params = readParamsFromUi()
  void updateAnnatarPreview()
})
$('innerTengwarKeys').addEventListener('change', () => scheduleSettledNow())

$('innerDateText').addEventListener('input', () => {
  // Live date typing uses draft displacement, then selected viewport quality.
  scheduleGeometryRebuild('both')
})
$('innerDateText').addEventListener('change', () => scheduleSettledNow())
$('innerDateText').addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter') scheduleSettledNow()
})

$('outerText').addEventListener('change', () => scheduleSettledNow())
$('outerTengwarKeys').addEventListener('change', () => scheduleSettledNow())

$('font').addEventListener('change', () => {
  params = readParamsFromUi()
  void updateAnnatarPreview()
  scheduleSettledNow()
})

$('btn-rebuild').addEventListener('click', () => scheduleSettledNow())

async function doExport() {
  if (params.cutaway) {
    toast('Tip: turn off cutaway before final export', false)
  }

  // Always export a final-quality mesh (not a draft live preview)
  setLoading(true)
  setBuildBusy(true, 'Preparing STL…')
  try {
    const p = readParamsFromUi()
    const exporterModule = import('./exportStl')
    const final = await buildRing(p, { mode: 'final' })
    const { exportMeshToStl } = await exporterModule
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
    requestRender()
    statsEl.innerHTML = appendPinchToStats(
      `Triangles: <strong>${final.triangleCount.toLocaleString()}</strong>`,
    )
    toast(`Exported ${filename}`)
  } catch (err) {
    console.error(err)
    toast(err instanceof Error ? err.message : 'Export failed', true)
  } finally {
    setLoading(false)
    setBuildBusy(false)
  }
}

$('btn-export').addEventListener('click', doExport)
$('btn-export-footer').addEventListener('click', doExport)

$('btn-reset-camera').addEventListener('click', () => {
  camera.position.set(22, 14, 20)
  controls.target.set(0, 0, 0)
  controls.update()
  requestRender()
})

// ─── Resize / render invalidation ───────────────────────────────────────────

function onResize() {
  const w = window.innerWidth
  const h = window.innerHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
  dimOverlay.resize(w, h)
  requestRender()
}
window.addEventListener('resize', onResize)

let renderRequested = false

/** Render only when scene/camera state changes; damping queues its own tail frames. */
function requestRender() {
  if (renderRequested) return
  renderRequested = true
  requestAnimationFrame(renderFrame)
}

function prepareEnvironment(): Promise<void> {
  if (environmentPromise) return environmentPromise
  environmentPromise = import('three/examples/jsm/environments/RoomEnvironment.js')
    .then(({ RoomEnvironment }) => {
      const pmrem = new THREE.PMREMGenerator(renderer)
      const room = new RoomEnvironment()
      scene.environment = pmrem.fromScene(room, 0.04).texture
      room.dispose()
      pmrem.dispose()
      requestRender()
    })
    .catch((err) => {
      console.warn('Studio reflections unavailable', err)
    })
  return environmentPromise
}

function renderFrame() {
  renderRequested = false
  const controlsChanged = controls.update()
  renderer.render(scene, camera)
  dimOverlay.render(scene, camera)
  if (controlsChanged) requestRender()
}

controls.addEventListener('change', requestRender)

// ─── Boot ────────────────────────────────────────────────────────────────────

// Overlay is already `.visible.initial` in HTML so hard refresh shows it before
// the module finishes evaluating; keep it until first mesh is ready.
writeParamsToUi(params)
setLoading(true, true)
setLoadingCopy('Forging your ring', 'Building geometry & inscriptions…')

// Put a real, orbitable band on screen before font parsing or inscription work.
const initialBand = buildBlankRing(params)
ringGroup.add(initialBand.group)
built = initialBand
updateDimensionOverlay()
statsEl.innerHTML = appendPinchToStats(
  `Triangles: <strong>${initialBand.triangleCount.toLocaleString()}</strong> · base`,
)
finishInitialLoad()
requestRender()

void runBuild(params, 'preview').then(() => {
  // Reflection-map generation is GPU-heavy and not needed for first paint.
  void prepareEnvironment()
  // Upgrade the visible draft after the first ring is already interactive.
  if (!settledTimer && built) {
    settledTimer = setTimeout(() => {
      settledTimer = null
      void runBuild(readParamsFromUi(), 'settled')
    }, SETTLED_IDLE_MS)
  }
})
