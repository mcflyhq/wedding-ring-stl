import { toAnnatarEncoding } from '../src/tengwarTranscribe.ts'

const phrase = 'Além do universo, em perpetuidade.'
for (const mode of [
  'brazilian-portuguese',
  'spanish',
  'english-classical',
  'general-use',
] as const) {
  const keys = toAnnatarEncoding(phrase, mode)
  console.log(mode + ':', JSON.stringify(keys), 'len=' + keys.length)
}
for (const w of ['casa', 'amor', 'Além', 'universo', 'perpetuidade']) {
  console.log(w, '→', toAnnatarEncoding(w, 'brazilian-portuguese'))
}
