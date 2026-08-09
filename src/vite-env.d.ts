/// <reference types="vite/client" />

import type { BufferGeometry, Mesh } from 'three'

declare module 'three' {
  interface BufferGeometry {
    computeBoundsTree?: (options?: object) => void
    disposeBoundsTree?: () => void
    boundsTree?: object
  }

  interface Mesh {
    raycast: Mesh['raycast']
  }
}

export {}
