import { throwIfAborted } from '../abort.ts'
import { invalidInput } from '../errors.ts'
import type { JpegXlExtraChannel } from './jpegxl-decode.ts'
import type { JpegXlPatch } from './jpegxl-frame-features.ts'

type Plane = Float32Array | Float64Array
const clamp = (value: number): number => Math.max(0, Math.min(1, value))

/** Patch rows are committed together so every channel reads the original alpha. */
export const applyJpegXlPatch = (
  target: readonly Plane[],
  stride: number,
  reference: readonly Plane[],
  referenceWidth: number,
  referenceHeight: number,
  colorChannels: number,
  extras: readonly JpegXlExtraChannel[],
  patch: Readonly<JpegXlPatch>,
  signal?: AbortSignal,
): void => {
  if (
    patch.referenceX + patch.width > referenceWidth ||
    patch.referenceY + patch.height > referenceHeight
  )
    throw invalidInput('JPEG XL patch exceeds its reference')
  const row = new Float64Array(patch.width * target.length)
  const hasAlpha = extras.some((channel) => channel.type === 0)
  for (let y = 0; y < patch.height; y++) {
    throwIfAborted(signal)
    const destination = (patch.y + y) * stride + patch.x
    const source = (patch.referenceY + y) * referenceWidth + patch.referenceX
    for (let c = 0; c < target.length; c++) {
      const blend = patch.blending?.[c < colorChannels ? 0 : c - colorChannels + 1]
      const mode = blend?.mode ?? patch.blendMode
      const alphaIndex = colorChannels + (blend?.alphaChannel ?? 0)
      const associated = extras[blend?.alphaChannel ?? 0]?.associatedAlpha ?? false
      const background = target[c],
        foreground = reference[c]
      if (!background || (!foreground && mode !== 0))
        throw invalidInput('JPEG XL patch channel is missing')
      for (let x = 0; x < patch.width; x++) {
        const back = background[destination + x]!,
          front = foreground?.[source + x] ?? 0
        let value = back
        if (mode === 1) value = front
        else if (mode === 2) value = back + front
        else if (mode === 3) value = back * (blend?.clamp ? clamp(front) : front)
        else if (mode >= 4) {
          if (!hasAlpha) value = mode < 6 ? front : back + front
          else {
            const below = mode === 5 || mode === 7
            const topValue = below ? back : front,
              bottomValue = below ? front : back
            const topAlpha = below
              ? target[alphaIndex]?.[destination + x]
              : reference[alphaIndex]?.[source + x]
            const bottomAlpha = below
              ? reference[alphaIndex]?.[source + x]
              : target[alphaIndex]?.[destination + x]
            if (topAlpha === undefined || bottomAlpha === undefined)
              throw invalidInput('JPEG XL patch alpha is missing')
            const a = blend?.clamp ? clamp(topAlpha) : topAlpha
            if (mode >= 6) value = c === alphaIndex ? bottomValue : bottomValue + a * topValue
            else {
              const combined = a + bottomAlpha * (1 - a)
              value =
                c === alphaIndex
                  ? combined
                  : associated
                    ? topValue + bottomValue * (1 - a)
                    : combined <= 0
                      ? 0
                      : (a * topValue + bottomAlpha * (1 - a) * bottomValue) / combined
            }
          }
        }
        row[c * patch.width + x] = value
      }
    }
    // A color blend also produces its selected alpha, regardless of the extra-channel mode.
    const color = patch.blending?.[0]
    if (hasAlpha && color && (color.mode === 4 || color.mode === 5)) {
      const index = colorChannels + color.alphaChannel
      for (let x = 0; x < patch.width; x++) {
        const a =
          (color.mode === 5 ? target[index]?.[destination + x] : reference[index]?.[source + x]) ??
          0
        const b =
          (color.mode === 5 ? reference[index]?.[source + x] : target[index]?.[destination + x]) ??
          0
        const top = color.clamp ? clamp(a) : a
        row[index * patch.width + x] = top + b * (1 - top)
      }
    }
    for (let c = 0; c < target.length; c++)
      target[c]?.set(row.subarray(c * patch.width, (c + 1) * patch.width), destination)
  }
}
