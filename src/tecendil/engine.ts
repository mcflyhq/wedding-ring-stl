/**
 * Tecendil-compatible transcription engine.
 *
 * Mode files use the open format published at arnog/tecendil-js (preprocess +
 * map + words + tengwar literals). Encoding to Annatar/Dan-Smith keys is ours —
 * no network calls to tecendil.com.
 */

import type { AnnatarColumn, TecendilMode, TengwaToken } from './types'
import { columnsToAnnatarKeys, normalizeTehtaName, normalizeTengwaName } from './annatarEncode'
import { TECENDIL_MODES } from './modes'

// ─── Mode loading ────────────────────────────────────────────────────────────

export function loadMode(id: string): TecendilMode {
  const mode = TECENDIL_MODES[id]
  if (!mode) throw new Error(`Unknown Tecendil mode: ${id}`)
  return mode
}

export function listModeIds(): string[] {
  return Object.keys(TECENDIL_MODES)
}

// ─── Preprocess ──────────────────────────────────────────────────────────────

function applyPreprocess(text: string, preprocess: Record<string, string> | undefined): string {
  if (!preprocess) return text
  let out = text
  // Longer keys first so multi-char patterns win
  const entries = Object.entries(preprocess).sort((a, b) => b[0].length - a[0].length)
  for (const [pattern, replacement] of entries) {
    if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
      // /regex/flags form (Tecendil style often omits flags → case-sensitive)
      const last = pattern.lastIndexOf('/')
      const body = pattern.slice(1, last)
      const flags = pattern.slice(last + 1) || 'g'
      try {
        const re = new RegExp(body, flags.includes('g') ? flags : flags + 'g')
        out = out.replace(re, replacement)
      } catch {
        /* skip bad regex */
      }
    } else {
      // literal replace, global case-insensitive for letters
      const re = new RegExp(escapeRegExp(pattern), 'gi')
      out = out.replace(re, replacement)
    }
  }
  return out
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeVowels(text: string): string {
  return text
    .replace(/[āáàä]/gi, (c) => (c === c.toUpperCase() ? 'Â' : 'â'))
    .replace(/[ēéèë]/gi, (c) => (c === c.toUpperCase() ? 'Ê' : 'ê'))
    .replace(/[īíìï]/gi, (c) => (c === c.toUpperCase() ? 'Î' : 'î'))
    .replace(/[ōóòö]/gi, (c) => (c === c.toUpperCase() ? 'Ô' : 'ô'))
    .replace(/[ūúùü]/gi, (c) => (c === c.toUpperCase() ? 'Û' : 'û'))
    .replace(/aa/gi, 'â')
    .replace(/ee/gi, 'ê')
    .replace(/ii/gi, 'î')
    .replace(/oo/gi, 'ô')
    .replace(/uu/gi, 'û')
}

// ─── Map rules ───────────────────────────────────────────────────────────────

interface CompiledRule {
  raw: string
  pattern: string
  /** lower-case for matching */
  match: string
  value: string
  startAnchor: boolean
  endAnchor: boolean
  length: number
}

function compileRules(map: Record<string, string>): CompiledRule[] {
  const rules: CompiledRule[] = []
  for (const [raw, value] of Object.entries(map)) {
    let pattern = raw
    let startAnchor = false
    let endAnchor = false
    if (pattern.startsWith('^')) {
      startAnchor = true
      pattern = pattern.slice(1)
    }
    if (pattern.endsWith('$')) {
      endAnchor = true
      pattern = pattern.slice(0, -1)
    }
    rules.push({
      raw,
      pattern,
      match: pattern.toLowerCase(),
      value,
      startAnchor,
      endAnchor,
      length: pattern.length,
    })
  }
  // Longest first
  rules.sort((a, b) => b.length - a.length || a.raw.localeCompare(b.raw))
  return rules
}

function matchRule(
  word: string,
  index: number,
  rules: CompiledRule[],
): { rule: CompiledRule; consumed: number } | null {
  const lower = word.toLowerCase()
  const atStart = index === 0
  for (const rule of rules) {
    if (rule.startAnchor && !atStart) continue
    if (rule.length === 0) continue
    const slice = lower.slice(index, index + rule.length)
    if (slice !== rule.match) continue
    const endIndex = index + rule.length
    if (rule.endAnchor && endIndex !== word.length) continue
    // Prefer end-anchored rules only when at end; already checked
    return { rule, consumed: rule.length }
  }
  return null
}

// ─── Literal parsing ─────────────────────────────────────────────────────────

export function parseLiterals(literal: string): TengwaToken[] {
  const tokens: TengwaToken[] = []
  const re = /\{([^}]*)\}|\[([^\]]*)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(literal)) !== null) {
    if (m[1] !== undefined) {
      tokens.push({ kind: 'tengwa', name: m[1]!.trim() })
    } else if (m[2] !== undefined) {
      tokens.push({ kind: 'tehta', name: m[2]!.trim() })
    }
  }
  return tokens
}

/**
 * Attach tehtar to tengwar columns.
 *
 * Tecendil vowel maps are usually `[tehta]{}` (tehta on a short carrier).
 * Consonant + following vowel often expands to `{tinco}[tehta]{}` — the tehta
 * belongs on the carrier, NOT on tinco. Look-ahead of 3 tokens is required.
 */
export function tokensToColumns(tokens: TengwaToken[]): AnnatarColumn[] {
  const columns: AnnatarColumn[] = []
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]!
    const n1 = tokens[i + 1]
    const n2 = tokens[i + 2]

    // [tehta]{}  or  [tehta]{named}
    if (t.kind === 'tehta' && n1?.kind === 'tengwa') {
      const tengwaName = n1.name === '' ? 'short-carrier' : normalizeTengwaName(n1.name)
      const tehta = normalizeTehtaName(t.name)
      columns.push(makeColumnWithTehta(tengwaName, tehta))
      i += 2
      continue
    }

    // {tengwa}[tehta]{} → bare tengwa, then carrier+tehta
    if (
      t.kind === 'tengwa' &&
      n1?.kind === 'tehta' &&
      n2?.kind === 'tengwa' &&
      n2.name === ''
    ) {
      pushTengwa(columns, t.name)
      columns.push(makeColumnWithTehta('short-carrier', normalizeTehtaName(n1.name)))
      i += 3
      continue
    }

    // {tengwa}[tehta] where tehta is a hook / sa-rince
    if (t.kind === 'tengwa' && n1?.kind === 'tehta') {
      const tehta = normalizeTehtaName(n1.name)
      const tengwaName = t.name === '' ? 'short-carrier' : normalizeTengwaName(t.name)
      if (tehta === 's-final' || tehta === 's') {
        columns.push({ tengwa: tengwaName, following: tehta })
      } else if (t.name === '') {
        columns.push(makeColumnWithTehta('short-carrier', tehta))
      } else {
        // tehta on this tengwa (no following empty carrier)
        columns.push(makeColumnWithTehta(tengwaName, tehta))
      }
      i += 2
      continue
    }

    if (t.kind === 'tengwa') {
      pushTengwa(columns, t.name)
      i++
      continue
    }

    // orphan tehta → new carrier (do not steal previous consonant)
    if (t.kind === 'tehta') {
      columns.push(makeColumnWithTehta('short-carrier', normalizeTehtaName(t.name)))
      i++
    }
  }
  return columns
}

function pushTengwa(columns: AnnatarColumn[], rawName: string): void {
  if (rawName === '') {
    columns.push({ tengwa: 'short-carrier' })
    return
  }
  const name = normalizeTengwaName(rawName)
  if (name === 's-final' || name === 's') {
    const prev = columns[columns.length - 1]
    if (prev && !prev.following) prev.following = name
    else columns.push({ tengwa: 'short-carrier', following: name })
  } else {
    columns.push({ tengwa: name })
  }
}

function makeColumnWithTehta(tengwa: string, tehta: string): AnnatarColumn {
  const col: AnnatarColumn = { tengwa }
  applyTehta(col, tehta)
  return col
}

function applyTehta(col: AnnatarColumn, tehta: string): void {
  if (tehta === 'tilde-above') col.tildeAbove = true
  else if (tehta === 'tilde-below') col.tildeBelow = true
  else if (tehta === 's-final' || tehta === 's') col.following = tehta
  else if (tehta.endsWith('-below') || tehta === 'i-below' || tehta === 'o-below') col.below = tehta
  else col.above = tehta
}

// ─── Word transcription ──────────────────────────────────────────────────────

function transcribeWord(word: string, mode: TecendilMode, rules: CompiledRule[]): AnnatarColumn[] {
  if (!word) return []

  const words = mode.words
  if (words) {
    const key = word.toLowerCase()
    if (words[key]) return tokensToColumns(parseLiterals(words[key]!))
    // try without trailing punctuation already stripped
  }

  // Greedy longest-match scan
  const literalParts: string[] = []
  let i = 0
  while (i < word.length) {
    const hit = matchRule(word, i, rules)
    if (hit) {
      literalParts.push(hit.rule.value)
      i += hit.consumed
      continue
    }
    // Unknown char — skip letters silently? Keep as pass-through gap
    const ch = word[i]!
    // punctuation handled outside
    if (/\s/.test(ch)) {
      i++
      continue
    }
    // single-char fallback: try case variants already in lower match
    // Skip one char to avoid infinite loop
    i++
  }

  return tokensToColumns(parseLiterals(literalParts.join('')))
}

function defaultPunctuation(ch: string): AnnatarColumn[] | null {
  switch (ch) {
    case ',':
    case ';':
      return [{ tengwa: 'comma' }]
    case '.':
    case '!':
    case '?':
    case ':':
      return [{ tengwa: 'full-stop' }]
    case '-':
    case '–':
    case '—':
      return [{ tengwa: 'full-stop' }]
    case '(':
    case ')':
    case '[':
    case ']':
    case '"':
    case "'":
    case '“':
    case '”':
    case '‘':
    case '’':
      return []
    default:
      return null
  }
}

/**
 * Transcribe Latin (or mixed) text with a Tecendil mode → Annatar key string.
 */
export function transcribeWithMode(text: string, mode: TecendilMode): string {
  let prepared = text.normalize('NFC').trim()
  if (!prepared) return ''

  if (mode.normalizeVowels) prepared = normalizeVowels(prepared)
  prepared = applyPreprocess(prepared, mode.preprocess)

  const rules = compileRules(mode.map)
  const wordChar = mode.wordPattern
    ? new RegExp(`^[${mode.wordPattern}]$`, 'u')
    : /^[\p{L}\p{M}_*~]$/u

  // Tokenize into words vs separators
  const chunks: { type: 'word' | 'sep'; value: string }[] = []
  let buf = ''
  const flushWord = () => {
    if (buf) {
      chunks.push({ type: 'word', value: buf })
      buf = ''
    }
  }

  for (const ch of prepared) {
    if (wordChar.test(ch) || ch === '_' || ch === '*') {
      buf += ch
    } else {
      flushWord()
      chunks.push({ type: 'sep', value: ch })
    }
  }
  flushWord()

  const out: string[] = []
  for (const chunk of chunks) {
    if (chunk.type === 'sep') {
      if (/\s/.test(chunk.value)) {
        out.push(' ')
        continue
      }
      const punct = defaultPunctuation(chunk.value)
      if (punct && punct.length) out.push(columnsToAnnatarKeys(punct))
      continue
    }
    // strip * markers used by some modes for "literal vowel" after matching
    const word = chunk.value
    const cols = transcribeWord(word, mode, rules)
    out.push(columnsToAnnatarKeys(cols))
  }

  // collapse multi-spaces
  return out.join('').replace(/ +/g, ' ').trim()
}

export function transcribeModeId(text: string, modeId: string): string {
  const mode = loadMode(modeId)
  return transcribeWithMode(text, mode)
}
