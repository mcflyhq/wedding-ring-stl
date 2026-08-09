import type { TecendilMode } from '../types'
import beleriand from './beleriand.json' with { type: 'json' }
import brazilianPortuguese from './brazilian-portuguese.json' with { type: 'json' }
import dutch from './dutch.json' with { type: 'json' }
import englishClassical from './english-classical.json' with { type: 'json' }
import italian from './italian.json' with { type: 'json' }
import quenya from './quenya.json' with { type: 'json' }
import sindarin from './sindarin.json' with { type: 'json' }
import spanish from './spanish.json' with { type: 'json' }

export const TECENDIL_MODES: Record<string, TecendilMode> = {
  'brazilian-portuguese': brazilianPortuguese as TecendilMode,
  spanish: spanish as TecendilMode,
  'english-classical': englishClassical as TecendilMode,
  italian: italian as TecendilMode,
  dutch: dutch as TecendilMode,
  sindarin: sindarin as TecendilMode,
  quenya: quenya as TecendilMode,
  beleriand: beleriand as TecendilMode,
}

export const TECENDIL_MODE_OPTIONS: { id: string; label: string }[] = [
  { id: 'brazilian-portuguese', label: 'Português BR' },
  { id: 'spanish', label: 'Spanish' },
  { id: 'english-classical', label: 'English (classical)' },
  { id: 'italian', label: 'Italian' },
  { id: 'dutch', label: 'Dutch' },
  { id: 'sindarin', label: 'Sindarin' },
  { id: 'quenya', label: 'Quenya' },
  { id: 'beleriand', label: 'Beleriand' },
  { id: 'general-use', label: 'General Use (tengwarjs)' },
]
