import { loadFontFromPath } from './fontLoader'
import { DATE_FONT_PATH, FONT_PATHS, type RingParams } from './types'
import { resolveInscriptionText } from './tengwarTranscribe'

/**
 * Render a crisp 2D SVG of the primary inscription so the user can verify
 * Tecendil keys / Latin text before 3D engraving.
 */
export async function renderInscriptionPreview(
  host: HTMLElement,
  params: RingParams,
): Promise<string> {
  const encoded = resolveInscriptionText(params.innerText, params.innerTengwarKeys)
  if (!encoded) {
    host.innerHTML = '<p class="hint">No primary inscription</p>'
    return ''
  }

  const fontPath = FONT_PATHS[params.font] ?? DATE_FONT_PATH
  const font = await loadFontFromPath(fontPath)
  const usingKeys = !!params.innerTengwarKeys.trim()

  const fontSize = 42
  let path
  try {
    path = font.getPath(encoded, 0, 0, fontSize)
  } catch {
    host.innerHTML = `<p class="hint">Preview failed</p>`
    return encoded
  }

  const bb = path.getBoundingBox()
  const pad = 12
  const w = Math.max(40, bb.x2 - bb.x1 + pad * 2)
  const h = Math.max(32, bb.y2 - bb.y1 + pad * 2)
  const tx = pad - bb.x1
  const ty = pad - bb.y1
  const path2 = font.getPath(encoded, tx, ty, fontSize)
  const d = path2.toPathData(2)

  const sourceLabel = usingKeys ? 'Tecendil keys' : 'Latin text'
  host.innerHTML = `
    <svg class="annatar-preview-svg" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Inscription preview">
      <rect width="100%" height="100%" fill="transparent"/>
      <path d="${d}" fill="#e8d5a3"/>
    </svg>
    <p class="hint annatar-keys-line"><span class="keys-label">${sourceLabel}</span> <code id="annatar-keys-out">${escapeHtml(encoded)}</code></p>
  `
  return encoded
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
