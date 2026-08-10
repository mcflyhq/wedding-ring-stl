import * as THREE from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'

/**
 * Export a mesh to a **binary STL** for jewelry / lost-wax / SLA printing.
 *
 * Print-oriented defaults (industry practice for fine jewelry):
 * - Units: **millimeters** (1 scene unit = 1 mm)
 * - Binary STL (smaller, widely supported; ASTM F42 / ISO/ASTM 52900 workflows)
 * - Geometry is cloned, normals recomputed, and converted to non-indexed
 *   triangles for maximum slicer compatibility
 *
 * Recommended for casting / resin:
 * - Engraving depth ≥ 0.25–0.35 mm
 * - Feature width ≥ 0.3 mm
 * - Mesh quality **High** (≈0.08 mm) or **Extra** (≈0.06 mm inner-wall edges)
 * - Watertight solid (we export the displaced band only)
 */
export function exportMeshToStl(
  object: THREE.Object3D,
  filename = 'wedding-ring.stl',
  binary = true,
): void {
  const exporter = new STLExporter()

  // Clone and prepare a print-friendly mesh tree
  const exportRoot = new THREE.Group()
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.geometry) return
    // Skip preview ink meshes — only the solid band with carved recesses
    if (child.name === 'inscription-glyph') return

    const geom = child.geometry.clone()
    // Non-indexed triangles are the most portable for STL exporters/slicers
    const nonIndexed = geom.index ? geom.toNonIndexed() : geom
    nonIndexed.computeVertexNormals()
    // Bake world transform into vertices
    nonIndexed.applyMatrix4(child.matrixWorld)

    const mesh = new THREE.Mesh(nonIndexed)
    exportRoot.add(mesh)
    if (geom !== nonIndexed) geom.dispose()
  })

  // Ensure matrix world is current
  exportRoot.updateMatrixWorld(true)

  if (binary) {
    const result = exporter.parse(exportRoot, { binary: true }) as DataView
    const buffer = result.buffer.slice(
      result.byteOffset,
      result.byteOffset + result.byteLength,
    ) as ArrayBuffer
    const blob = new Blob([buffer], { type: 'model/stl' })
    triggerDownload(blob, filename)
  } else {
    const result = exporter.parse(exportRoot, { binary: false }) as string
    const blob = new Blob([result], { type: 'model/stl' })
    triggerDownload(blob, filename)
  }

  // Dispose clones
  exportRoot.traverse((c) => {
    if (c instanceof THREE.Mesh) c.geometry.dispose()
  })
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
