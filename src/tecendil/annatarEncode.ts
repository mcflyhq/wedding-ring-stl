/**
 * Map Tecendil abstract tengwa / tehta names → Dan Smith / Annatar keys.
 * Uses the same bindings as the `tengwar` package (Annatar face).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
import Bindings from 'tengwar/dan-smith.js'
// eslint-disable-next-line @typescript-eslint/no-require-imports
import TengwarAnnatar from 'tengwar/tengwar-annatar.js'
import type { AnnatarColumn } from './types'

/** Normalize Tecendil spelling variants → dan-smith keys. */
const TENGWA_ALIAS: Record<string, string> = {
  thuule: 'thule',
  thule: 'thule',
  nuumen: 'numen',
  numen: 'numen',
  oore: 'ore',
  ore: 'ore',
  roomen: 'romen',
  romen: 'romen',
  uure: 'ure',
  ure: 'ure',
  vilya: 'wilya',
  wilya: 'wilya',
  telco: 'short-carrier',
  aara: 'long-carrier',
  'short-carrier': 'short-carrier',
  'long-carrier': 'long-carrier',
  hook: 's-final',
  's-final': 's-final',
  pusta: 'full-stop',
  'double-pusta': 'full-stop',
  'triple-pusta': 'full-stop',
  'quadruple-pusta': 'full-stop',
  dash: 'full-stop',
  'wide-dash': 'full-stop',
  'exclamation-mark': 'exclamation-point',
  'question-mark': 'question-mark',
  'roman-period': 'full-stop',
  'roman-comma': 'comma',
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  // extended
  'extended-tinco': 'tinco-extended',
  'extended-parma': 'parma-extended',
  'extended-calma': 'calma-extended',
  'extended-quesse': 'quesse-extended',
  'extended-ando': 'ando-extended',
  'extended-umbar': 'umbar-extended',
  'extended-anga': 'anga-extended',
  'extended-ungwe': 'ungwe-extended',
}

/** Tecendil diacritic names → column tehta keys used by Annatar. */
const TEHTA_ALIAS: Record<string, string> = {
  'triple-dot-above': 'a',
  'triple-dot-below': 'a', // rare; fall back
  acute: 'e',
  'acute-below': 'e',
  'dot-above': 'i',
  'dot-below': 'i-below',
  'right-curl': 'o',
  'right-curl-below': 'o-below',
  'left-curl': 'u',
  'left-curl-below': 'u',
  'double-right-curl': 'ó',
  'double-left-curl': 'ú',
  'double-dot-above': 'y',
  'double-dot-below': 'y',
  'double-acute': 'í',
  'double-acute-below': 'í',
  breve: 'ó',
  'tilde-above': 'tilde-above',
  'tilde-below': 'tilde-below',
  'bar-above': 'bar-above',
  'bar-below': 'bar-below',
  'bar-inside': 'bar-below',
  'double-dot-inside': 'y',
  'dot-inside': 'i-below',
  hook: 's-final',
  'upward-hook': 's-final',
  'lifted-hook': 's',
  's-final': 's-final',
  'yanta-above': 'y',
}

const tengwarMap = Bindings.tengwar as Record<string, string>

export function normalizeTengwaName(raw: string): string {
  const key = raw.trim().toLowerCase()
  if (!key || key === '') return 'short-carrier'
  return TENGWA_ALIAS[key] ?? key
}

export function normalizeTehtaName(raw: string): string {
  const key = raw.trim().toLowerCase()
  return TEHTA_ALIAS[key] ?? key
}

/**
 * Encode abstract columns to a plain Annatar key string (Dan Smith encoding).
 */
export function columnsToAnnatarKeys(columns: AnnatarColumn[]): string {
  const parts: string[] = []
  for (const col of columns) {
    const tengwa = normalizeTengwaName(col.tengwa)
    // s-final / hook as standalone → attach to previous if possible
    if (tengwa === 's-final' || tengwa === 's') {
      const tehta = TengwarAnnatar.tehtaForTengwa(
        parts.length ? guessLastTengwa(parts) : 'tinco',
        tengwa === 's-final' ? 's-final' : 's',
      )
      if (tehta) {
        parts.push(tehta)
        continue
      }
    }

    const base = tengwarMap[tengwa] ?? tengwarMap['anna'] ?? 'h'
    parts.push(base)

    if (col.tildeAbove) {
      const t = TengwarAnnatar.tehtaForTengwa(tengwa, 'tilde-above')
      if (t) parts.push(t)
    }
    if (col.tildeBelow) {
      const t = TengwarAnnatar.tehtaForTengwa(tengwa, 'tilde-below')
      if (t) parts.push(t)
    }
    if (col.above) {
      const th = normalizeTehtaName(col.above)
      if (th === 'tilde-above') {
        const t = TengwarAnnatar.tehtaForTengwa(tengwa, 'tilde-above')
        if (t) parts.push(t)
      } else {
        const t = TengwarAnnatar.tehtaForTengwa(tengwa, th)
        if (t) parts.push(t)
      }
    }
    if (col.below) {
      const th = normalizeTehtaName(col.below)
      const t = TengwarAnnatar.tehtaForTengwa(tengwa, th)
      if (t) parts.push(t)
    }
    if (col.following) {
      const th = normalizeTehtaName(col.following)
      const t = TengwarAnnatar.tehtaForTengwa(tengwa, th)
      if (t) parts.push(t)
    }
  }
  return parts.join('')
}

/** Best-effort reverse of last base glyph (for trailing hooks). */
function guessLastTengwa(parts: string[]): string {
  // Walk back past tehta-looking chars
  const baseChars = new Set(Object.values(tengwarMap))
  for (let i = parts.length - 1; i >= 0; i--) {
    const ch = parts[i]!
    if (baseChars.has(ch)) {
      for (const [name, code] of Object.entries(tengwarMap)) {
        if (code === ch && !name.match(/^\d+$/)) return name
      }
    }
  }
  return 'tinco'
}
