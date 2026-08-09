import * as THREE from 'three'

export type LightPreset = 'dawn' | 'midday' | 'dusk'

export interface SceneLights {
  key: THREE.DirectionalLight
  fill: THREE.DirectionalLight
  rim: THREE.DirectionalLight
  ambient: THREE.AmbientLight
}

export const LIGHT_PRESET_LABELS: Record<LightPreset, string> = {
  dawn: 'Dawn',
  midday: 'Midday',
  dusk: 'Dusk',
}

interface PresetConfig {
  background: number
  fog: number
  exposure: number
  envIntensity: number
  key: { color: number; intensity: number; position: [number, number, number] }
  fill: { color: number; intensity: number; position: [number, number, number] }
  rim: { color: number; intensity: number; position: [number, number, number] }
  ambient: { color: number; intensity: number }
}

const PRESETS: Record<LightPreset, PresetConfig> = {
  // Cool blue hour → warm low sun from the side
  dawn: {
    background: 0x0a0c12,
    fog: 0x0a0c12,
    exposure: 1.05,
    envIntensity: 0.85,
    key: { color: 0xffc9a0, intensity: 1.15, position: [28, 8, 12] },
    fill: { color: 0x6a8ab8, intensity: 0.45, position: [-22, 14, -8] },
    rim: { color: 0xffe0b8, intensity: 0.55, position: [-8, 6, 28] },
    ambient: { color: 0x4a5568, intensity: 0.28 },
  },
  // Neutral studio / clear sky
  midday: {
    background: 0x0c0b0a,
    fog: 0x0c0b0a,
    exposure: 1.15,
    envIntensity: 1.05,
    key: { color: 0xfff0d5, intensity: 1.45, position: [18, 36, 14] },
    fill: { color: 0xb8c8ff, intensity: 0.4, position: [-28, 12, -12] },
    rim: { color: 0xffe4a8, intensity: 0.4, position: [0, -12, 28] },
    ambient: { color: 0x505050, intensity: 0.35 },
  },
  // Warm amber key, cool residual sky fill
  dusk: {
    background: 0x0c0908,
    fog: 0x0c0908,
    exposure: 1.0,
    envIntensity: 0.75,
    key: { color: 0xff9a5c, intensity: 1.25, position: [-26, 6, 18] },
    fill: { color: 0x5a6a9a, intensity: 0.38, position: [20, 16, -14] },
    rim: { color: 0xffc078, intensity: 0.65, position: [12, 4, -26] },
    ambient: { color: 0x3a3038, intensity: 0.26 },
  },
}

export function createSceneLights(scene: THREE.Scene): SceneLights {
  const key = new THREE.DirectionalLight(0xfff0d5, 1.4)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  scene.add(key)

  const fill = new THREE.DirectionalLight(0xb8c8ff, 0.35)
  scene.add(fill)

  const rim = new THREE.DirectionalLight(0xffe4a8, 0.45)
  scene.add(rim)

  const ambient = new THREE.AmbientLight(0x404040, 0.35)
  scene.add(ambient)

  return { key, fill, rim, ambient }
}

export function applyLightPreset(
  preset: LightPreset,
  lights: SceneLights,
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
): void {
  const cfg = PRESETS[preset]

  scene.background = new THREE.Color(cfg.background)
  if (scene.fog instanceof THREE.Fog) {
    scene.fog.color.setHex(cfg.fog)
  }

  renderer.toneMappingExposure = cfg.exposure

  const applyDir = (
    light: THREE.DirectionalLight,
    c: PresetConfig['key'],
  ) => {
    light.color.setHex(c.color)
    light.intensity = c.intensity
    light.position.set(...c.position)
  }

  applyDir(lights.key, cfg.key)
  applyDir(lights.fill, cfg.fill)
  applyDir(lights.rim, cfg.rim)
  lights.ambient.color.setHex(cfg.ambient.color)
  lights.ambient.intensity = cfg.ambient.intensity

  // Nudge metal env reflections with the preset mood
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (m instanceof THREE.MeshStandardMaterial) {
        m.envMapIntensity = cfg.envIntensity * (obj.name === 'inscription-glyph' ? 0.5 : 1)
      }
    }
  })
}

/** Show/hide dark inscription fill meshes without rebuilding the ring. */
export function setInkVisible(root: THREE.Object3D, visible: boolean): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.name === 'inscription-glyph') {
      obj.visible = visible
    }
  })
}
