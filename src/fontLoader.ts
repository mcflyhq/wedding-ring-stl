import { parse, type Font } from 'opentype.js'
import { DATE_FONT_PATH, FONT_PATHS, type RingParams } from './types'

// Cache the promise, not just the parsed result. The 2D preview and 3D builder
// start together on boot, so this also deduplicates concurrent fetch + parse work.
const fontPromises = new Map<string, Promise<Font>>()

export function loadFontFromPath(path: string): Promise<Font> {
  const cached = fontPromises.get(path)
  if (cached) return cached

  const pending = fetch(path)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to fetch font (${res.status}): ${path}`)
      return res.arrayBuffer()
    })
    .then((buffer) => parse(buffer))
    .catch((err) => {
      fontPromises.delete(path)
      throw err
    })

  fontPromises.set(path, pending)
  return pending
}

export function loadRingFont(key: RingParams['font']): Promise<Font> {
  return loadFontFromPath(FONT_PATHS[key])
}

export function loadDateFont(): Promise<Font> {
  return loadFontFromPath(DATE_FONT_PATH)
}
