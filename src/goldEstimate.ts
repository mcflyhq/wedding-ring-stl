/**
 * Plain domed (D-shape) wedding band metal estimate - 18k gold.
 *
 * Volume is the solid metal of the band only (finger hole excluded).
 * Engraving is ignored (plain ring).
 *
 * Profile: flat inner wall at r_i, semi-elliptical outer face with
 * radial semi-axis = thickness, axial semi-axis = width/2.
 *
 * Cross-section area of a semi-ellipse: A = (π/4) * t * w
 * Centroid distance from the flat edge: 4t / (3π)
 * Pappus: V = 2π · R̄ · A with R̄ = r_i + 4t/(3π)
 */

/** Typical cast 18k yellow gold density (g/cm³). Alloys vary ~15.2–15.6. */
export const DENSITY_18K_GOLD_G_PER_CM3 = 15.45

/** Mass fraction of pure gold in 18 karat */
export const GOLD_18K_PURITY = 0.75

/** Default spot for rough cost estimate (USD / troy oz of pure gold) */
export const DEFAULT_GOLD_SPOT_USD_PER_TROY_OZ = 2400

const MM3_PER_CM3 = 1000
const GRAMS_PER_TROY_OZ = 31.1034768

export interface GoldEstimate {
  /** Metal volume of the plain band (mm³) */
  volumeMm3: number
  /** Same volume in cm³ */
  volumeCm3: number
  /** Mass of 18k alloy (g) */
  mass18kGrams: number
  /** Pure gold content (g) */
  pureGoldGrams: number
  /** Pure gold content (troy oz) */
  pureGoldTroyOz: number
  /** Rough metal cost at given spot (USD) - melt value of pure gold only */
  meltValueUsd: number
  /** Spot used for melt value */
  spotUsdPerTroyOz: number
}

/**
 * Analytical volume of the plain domed ring (no engraving).
 */
export function plainDomedRingVolumeMm3(
  innerDiameterMm: number,
  bandWidthMm: number,
  bandThicknessMm: number,
): number {
  const r_i = Math.max(innerDiameterMm, 0) / 2
  const t = Math.max(bandThicknessMm, 0)
  const w = Math.max(bandWidthMm, 0)
  if (t <= 0 || w <= 0 || r_i <= 0) return 0

  // Semi-ellipse area (half of full ellipse π·t·(w/2))
  const area = (Math.PI * t * w) / 4
  // Centroid of semi-ellipse measured from the flat diameter, outward
  const centroidFromInner = (4 * t) / (3 * Math.PI)
  const pathRadius = r_i + centroidFromInner
  // Pappus's centroid theorem
  return 2 * Math.PI * pathRadius * area
}

export function estimate18kGold(
  innerDiameterMm: number,
  bandWidthMm: number,
  bandThicknessMm: number,
  spotUsdPerTroyOz: number = DEFAULT_GOLD_SPOT_USD_PER_TROY_OZ,
): GoldEstimate {
  const volumeMm3 = plainDomedRingVolumeMm3(
    innerDiameterMm,
    bandWidthMm,
    bandThicknessMm,
  )
  const volumeCm3 = volumeMm3 / MM3_PER_CM3
  const mass18kGrams = volumeCm3 * DENSITY_18K_GOLD_G_PER_CM3
  const pureGoldGrams = mass18kGrams * GOLD_18K_PURITY
  const pureGoldTroyOz = pureGoldGrams / GRAMS_PER_TROY_OZ
  const meltValueUsd = pureGoldTroyOz * spotUsdPerTroyOz

  return {
    volumeMm3,
    volumeCm3,
    mass18kGrams,
    pureGoldGrams,
    pureGoldTroyOz,
    meltValueUsd,
    spotUsdPerTroyOz,
  }
}

export function formatGrams(g: number): string {
  if (g < 0.1) return g.toFixed(3)
  return g.toFixed(2)
}

export function formatUsd(n: number): string {
  return n.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}
