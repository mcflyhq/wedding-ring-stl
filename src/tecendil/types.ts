/** Open Tecendil-compatible mode file (from arnog/tecendil-js, JSON form). */
export interface TecendilMode {
  name: string
  languageCode?: string
  info?: string
  rrule?: boolean
  wordPattern?: string
  normalizeVowels?: boolean
  tehtarFollow?: boolean
  preprocess?: Record<string, string>
  map: Record<string, string>
  words?: Record<string, string>
}

export type TengwaToken =
  | { kind: 'tengwa'; name: string }
  | { kind: 'tehta'; name: string }

/** One Annatar column after tehta attachment. */
export interface AnnatarColumn {
  tengwa: string
  above?: string
  below?: string
  following?: string
  tildeAbove?: boolean
  tildeBelow?: boolean
}

export type TranscribeModeId =
  | 'brazilian-portuguese'
  | 'spanish'
  | 'english-classical'
  | 'italian'
  | 'dutch'
  | 'sindarin'
  | 'quenya'
  | 'beleriand'
  | 'general-use'
