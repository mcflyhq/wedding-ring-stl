import * as THREE from 'three'
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg'

/**
 * CSG-subtract solid date digits from the band.
 *
 * Kept in its own module so the boolean engine is downloaded and parsed only
 * when a manufacturing-quality build is explicitly requested.
 */
export function carveDateWithCsg(
  bandGeom: THREE.BufferGeometry,
  cutter: THREE.BufferGeometry,
): THREE.BufferGeometry {
  try {
    const ringClone = bandGeom.clone()
    const cutClone = cutter.clone()
    ringClone.computeVertexNormals()
    cutClone.computeVertexNormals()

    const ringBrush = new Brush(ringClone)
    ringBrush.updateMatrixWorld(true)
    ringBrush.prepareGeometry()

    const cutBrush = new Brush(cutClone)
    cutBrush.updateMatrixWorld(true)
    cutBrush.prepareGeometry()

    const evaluator = new Evaluator()
    evaluator.useGroups = false
    const result = evaluator.evaluate(ringBrush, cutBrush, SUBTRACTION)
    const out = result.geometry
    out.computeVertexNormals()

    ringClone.dispose()
    cutClone.dispose()
    return out
  } catch (err) {
    console.warn('Date CSG carve failed - falling back to displacement only', err)
    return bandGeom
  }
}
