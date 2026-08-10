/**
 * Helpers for Tengwar Annatar fonts.
 * Transcription is intentional: paste Tecendil Annatar keys in the advanced
 * fields - no automated orthographic mode in-app.
 */

export function isTengwarFont(fontKey: string): boolean {
  return fontKey.startsWith('tengwar-annatar')
}

/**
 * Resolve the string that is actually shaped for engraving.
 * Tecendil keys win when present; otherwise the Latin field is used as-is.
 */
export function resolveInscriptionText(latin: string, tecendilKeys: string): string {
  const keys = tecendilKeys.trim()
  if (keys) return keys
  return latin.trim()
}
