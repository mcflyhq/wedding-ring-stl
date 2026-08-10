export type MetalFinish = 'gold' | 'rose-gold' | 'silver' | 'platinum' | 'black'
export type TextSurface = 'inner' | 'outer'
/** Classic constant-width D-profile, or sculpted wave silhouette (draft-inspired). */
export type BandProfile = 'd' | 'wave'

export interface RingParams {
  /** Inner diameter in millimeters (finger size) */
  innerDiameterMm: number
  /** Band width along the finger axis (mean width for wave profile) */
  bandWidthMm: number
  /** Wall thickness of the band (radial) */
  bandThicknessMm: number

  /**
   * Band silhouette style.
   * - `d`: classic constant-width domed (D) profile
   * - `wave`: variable axial edges from the organic top-view draft
   */
  bandProfile: BandProfile
  /**
   * Peak axial excursion of the localized pinch (mm).
   * 0 → classic constant-width D. Typical range 0.6–1.6 mm.
   */
  waveAmplitudeMm: number
  /**
   * Kept for cache/API compatibility. Always one pinch feature (ignored).
   */
  waveCount: number
  /** Angular center of the pinch around the finger (degrees). */
  wavePhaseDeg: number
  /**
   * How much of the circumference the pinch occupies (degrees).
   * Rest of the band stays a flat classic D. Typical 70–140°.
   */
  waveSpanDeg: number
  /**
   * Corner hardness of the pinch motif only (does not change amplitude).
   * 1 = sharp polyline breaks; 0 = smooth spline through the same peaks —
   * pinch full width / amplitude stay locked.
   */
  waveSharpness: number
  /** Unused (kept for API / cache keys). */
  waveAsymmetry: number
  /** Unused (kept for API / cache keys). */
  waveCharacter: number

  /** Primary inner inscription (Latin reference / or Latin face text) */
  innerText: string
  /**
   * Secondary inner inscription for a Latin-digit timestamp (e.g. 27.09.2026).
   * Placed opposite the primary inner text; always Inter (Latin).
   */
  innerDateText: string
  /** Engraved text on the outer surface (Latin reference / Latin face text) */
  outerText: string
  /** Shared engraving depth into the metal */
  textDepthMm: number
  /** Font size of the primary inscriptions */
  textSizeMm: number
  /** Font size of the Latin date (defaults slightly smaller if 0 → auto) */
  dateTextSizeMm: number
  /** Angular offset of the primary inscription (degrees); date is +180° */
  textAngleDeg: number
  /** Font key for primary / outer text - Tengwar Annatar + fallbacks */
  font: 'tengwar-annatar' | 'tengwar-annatar-italic' | 'ring-inscription' | 'elvish-uncial' | 'cinzel'
  /**
   * Tecendil Annatar key string for the inner face.
   * When set, used for engraving instead of `innerText`.
   */
  innerTengwarKeys: string
  /**
   * Tecendil Annatar key string for the outer face.
   * When set, used for engraving instead of `outerText`.
   */
  outerTengwarKeys: string

  /** Preview metal color */
  metal: MetalFinish
  /** Mesh resolution quality */
  quality: 'draft' | 'normal' | 'high' | 'extra'
  /** Show cross-section cut for inspecting the engraving */
  cutaway: boolean
}

export const DEFAULT_PARAMS: RingParams = {
  innerDiameterMm: 17.3,
  bandWidthMm: 5.2,
  bandThicknessMm: 1.6,
  bandProfile: 'wave',
  // Localized pinch: hard waist in one sector only; rest of band flat
  waveAmplitudeMm: 1.25,
  waveCount: 1,
  wavePhaseDeg: 0,
  waveSpanDeg: 100,
  waveSharpness: 0.45,
  waveAsymmetry: 0,
  waveCharacter: 1,
  innerText: '',
  innerDateText: '',
  outerText: '',
  textDepthMm: 0.35,
  textSizeMm: 1.5,
  dateTextSizeMm: 1.35,
  textAngleDeg: 0,
  font: 'tengwar-annatar-italic',
  innerTengwarKeys: '',
  outerTengwarKeys: '',
  metal: 'gold',
  quality: 'normal',
  cutaway: false,
}

/** Common US ring sizes → approximate inner diameter (mm) */
export const RING_SIZE_PRESETS: { label: string; diameterMm: number }[] = [
  { label: 'US 5', diameterMm: 15.7 },
  { label: 'US 6', diameterMm: 16.5 },
  { label: 'US 7', diameterMm: 17.3 },
  { label: 'US 8', diameterMm: 18.2 },
  { label: 'US 9', diameterMm: 19.0 },
  { label: 'US 10', diameterMm: 19.8 },
  { label: 'US 11', diameterMm: 20.6 },
  { label: 'US 12', diameterMm: 21.4 },
]

export const METAL_COLORS: Record<MetalFinish, number> = {
  gold: 0xc9a227,
  'rose-gold': 0xb76e79,
  silver: 0xc0c0c0,
  platinum: 0xe5e4e2,
  black: 0x2a2a2a,
}

export const FONT_PATHS: Record<RingParams['font'], string> = {
  'tengwar-annatar': '/fonts/TengwarAnnatar.ttf',
  'tengwar-annatar-italic': '/fonts/TengwarAnnatar-Italic.ttf',
  'ring-inscription': '/fonts/CinzelDecorative-Regular.ttf',
  'elvish-uncial': '/fonts/UncialAntiqua.ttf',
  cinzel: '/fonts/Cinzel-Variable.ttf',
}

/** Modern Latin face for the inner date (digits / dots). */
export const DATE_FONT_PATH = '/fonts/Inter-Regular.ttf'

export const FONT_LABELS: Record<RingParams['font'], string> = {
  'tengwar-annatar': 'Tengwar Annatar',
  'tengwar-annatar-italic': 'Tengwar Annatar Italic',
  'ring-inscription': 'Ring Inscription (Cinzel Decorative)',
  'elvish-uncial': 'Elvish Uncial',
  cinzel: 'Cinzel (classic)',
}
