/** First-party bounded-region driver for the attributed offline perceptual model. */
import { displayLinearPlanes, downsampleDisplay } from './libjxl-display-loss.ts'
import {
  type PerceptualImage,
  perceptualQuadraticMaps,
  preparePerceptualLinear,
} from './libjxl-perceptual-local-port.ts'
import { mixPerceptualScales, perceptualDirectionalMap } from './libjxl-perceptual-malta-port.ts'
import type { AuditWindow } from './local-rate-audit.ts'

// Fine support: adaptation 2 + LF 16 + MF 7 + HF 3 + mask 6 + erosion 3 = 37.
// Half-resolution support covers at most 75 source pixels; 76 also preserves
// even sampling phase. This is derived support, not a fitted quality parameter.
const halo = 76
export interface LocalPerceptualReference {
  readonly width: number
  readonly height: number
  readonly box: AuditWindow
  readonly crop: AuditWindow
  readonly fine: PerceptualImage
  readonly half: PerceptualImage
}
function cropPixels(rgba: Uint8Array, width: number, height: number, crop: AuditWindow) {
  if (rgba.length !== width * height * 4) throw new Error('Local image extent differs')
  const pixels = new Uint8Array(crop.width * crop.height * 4)
  for (let y = 0; y < crop.height; y++) {
    const start = ((crop.y + y) * width + crop.x) * 4
    pixels.set(rgba.subarray(start, start + crop.width * 4), y * crop.width * 4)
  }
  return pixels
}
export function prepareLocalPerceptualReference(
  rgba: Uint8Array,
  width: number,
  height: number,
  box: AuditWindow,
): LocalPerceptualReference {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 16 ||
    height < 16 ||
    [box.x, box.y, box.width, box.height].some((v) => !Number.isSafeInteger(v)) ||
    box.x < 0 ||
    box.y < 0 ||
    box.width < 1 ||
    box.height < 1 ||
    box.width > 256 ||
    box.height > 256 ||
    box.x + box.width > width ||
    box.y + box.height > height
  )
    throw new Error('Invalid local perceptual window')
  const left = Math.max(0, 2 * Math.floor((box.x - halo) / 2)),
    top = Math.max(0, 2 * Math.floor((box.y - halo) / 2)),
    right = Math.min(width, 2 * Math.ceil((box.x + box.width + halo) / 2)),
    bottom = Math.min(height, 2 * Math.ceil((box.y + box.height + halo) / 2)),
    crop = { x: left, y: top, width: right - left, height: bottom - top },
    rgb = displayLinearPlanes(cropPixels(rgba, width, height, crop), crop.width, crop.height)
  return {
    width,
    height,
    box: { ...box },
    crop,
    fine: preparePerceptualLinear(rgb, crop.width, crop.height),
    half: preparePerceptualLinear(
      downsampleDisplay(rgb, crop.width, crop.height),
      Math.ceil(crop.width / 2),
      Math.ceil(crop.height / 2),
    ),
  }
}
/** Computes only the requested map window; source buffers stay bounded by 410x410. */
export function localPerceptualMap(
  reference: LocalPerceptualReference,
  rgba: Uint8Array,
): Float64Array {
  const { crop, box } = reference,
    rgb = displayLinearPlanes(
      cropPixels(rgba, reference.width, reference.height, crop),
      crop.width,
      crop.height,
    ),
    fine = preparePerceptualLinear(rgb, crop.width, crop.height),
    half = preparePerceptualLinear(
      downsampleDisplay(rgb, crop.width, crop.height),
      Math.ceil(crop.width / 2),
      Math.ceil(crop.height / 2),
    ),
    fineMap = perceptualDirectionalMap(
      reference.fine,
      fine,
      perceptualQuadraticMaps(reference.fine, fine).asymmetric,
    ),
    halfMap = perceptualDirectionalMap(
      reference.half,
      half,
      perceptualQuadraticMaps(reference.half, half).asymmetric,
    ),
    combined = mixPerceptualScales(fineMap, halfMap, crop.width, crop.height),
    output = new Float64Array(box.width * box.height)
  for (let y = 0; y < box.height; y++) {
    const start = (box.y - crop.y + y) * crop.width + box.x - crop.x
    output.set(combined.subarray(start, start + box.width), y * box.width)
  }
  return output
}
