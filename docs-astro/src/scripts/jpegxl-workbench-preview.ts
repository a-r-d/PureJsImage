import { linearToSrgb } from '../../../src/codecs/icc.ts'
import type { PixelColorSemantics } from '../../../src/color.ts'
import type { PixelBlock, PixelFormat } from '../../../src/pixel.ts'

export type JpegXlWorkbenchPreviewMode = 'srgb' | 'linear'

export const jpegXlWorkbenchPreviewMode = (
  semantics: PixelColorSemantics | undefined,
): JpegXlWorkbenchPreviewMode => {
  if (
    !semantics ||
    (semantics.family !== 'gray' && semantics.family !== 'rgb') ||
    semantics.primaries !== 'srgb' ||
    semantics.matrix !== 'identity' ||
    semantics.range !== 'full' ||
    (semantics.alpha !== 'none' && semantics.alpha !== 'straight') ||
    (semantics.transfer.kind !== 'srgb' && semantics.transfer.kind !== 'linear')
  ) {
    throw new Error('Workbench preview does not support the decoded color semantics')
  }
  return semantics.transfer.kind
}

export const linearJpegXlWorkbenchPreviewByte = (value: number): number =>
  Math.max(0, Math.min(255, Math.round(linearToSrgb(Math.max(0, Math.min(1, value))) * 255)))

export const isJpegXlWorkbenchPreviewPixelFormat = (
  format: PixelFormat,
): format is 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16' | 'rgbf32' | 'rgbaf32' =>
  format === 'gray8' ||
  format === 'gray16' ||
  format === 'rgb8' ||
  format === 'rgb16' ||
  format === 'rgba8' ||
  format === 'rgba16' ||
  format === 'rgbf32' ||
  format === 'rgbaf32'

interface EffectiveDisplayRange {
  readonly black: number
  readonly inverseWidth: number
}

export type JpegXlWorkbenchPreviewRanges = readonly [
  EffectiveDisplayRange,
  EffectiveDisplayRange,
  EffectiveDisplayRange,
  EffectiveDisplayRange,
]

const channelCount = (format: PixelBlock['format']): 1 | 3 | 4 =>
  format.startsWith('gray') ? 1 : format.startsWith('rgba') ? 4 : 3

export const jpegXlWorkbenchPreviewRanges = (block: PixelBlock): JpegXlWorkbenchPreviewRanges => {
  if (!isJpegXlWorkbenchPreviewPixelFormat(block.format)) {
    throw new Error(`Workbench preview does not support ${block.format}`)
  }
  const channels = channelCount(block.format)
  const storageWhite = block.format.endsWith('f32') ? 1 : block.format.endsWith('16') ? 65_535 : 255
  const fallback = Object.freeze({ black: 0, inverseWidth: 1 / storageWhite })
  if (block.displayRanges !== undefined) {
    if (
      block.displayRanges.length !== channels ||
      block.displayRanges.some(
        ({ black, white }) => !Number.isFinite(black) || !Number.isFinite(white) || white <= black,
      )
    ) {
      throw new Error('Workbench preview display ranges are invalid')
    }
  }
  const range = (channel: number): EffectiveDisplayRange => {
    const selected = block.displayRanges?.[channels === 1 ? 0 : channel]
    return selected === undefined
      ? fallback
      : Object.freeze({
          black: selected.black,
          inverseWidth: 1 / (selected.white - selected.black),
        })
  }
  return Object.freeze([range(0), range(1), range(2), range(3)])
}

const sample = (
  block: PixelBlock,
  sourceX: number,
  sourceY: number,
  channel: number,
  view?: DataView,
): number => {
  if (!isJpegXlWorkbenchPreviewPixelFormat(block.format)) {
    throw new Error(`Workbench preview does not support ${block.format}`)
  }
  const channels = block.format.startsWith('gray') ? 1 : block.format.startsWith('rgba') ? 4 : 3
  const bytesPerSample = block.format.endsWith('f32') ? 4 : block.format.endsWith('16') ? 2 : 1
  const localX = sourceX - block.x
  const localY = sourceY - block.y
  if (localX < 0 || localY < 0 || localX >= block.width || localY >= block.height) return 0
  if (channel === 3 && channels !== 4)
    return bytesPerSample === 4 ? 1 : bytesPerSample === 1 ? 255 : 65_535
  const selectedChannel = channels === 1 ? 0 : channel
  const offset = localY * block.stride + (localX * channels + selectedChannel) * bytesPerSample
  if (bytesPerSample === 4) {
    if (!view) throw new Error('Float preview requires a block sample view')
    return view.getFloat32(offset, false)
  }
  if (bytesPerSample === 1) return block.data[offset] ?? 0
  return (block.data[offset] ?? 0) * 256 + (block.data[offset + 1] ?? 0)
}

export const jpegXlWorkbenchPreviewPixel = (
  block: PixelBlock,
  sourceX: number,
  sourceY: number,
  mode: JpegXlWorkbenchPreviewMode,
  ranges: JpegXlWorkbenchPreviewRanges = jpegXlWorkbenchPreviewRanges(block),
  view?: DataView,
): readonly [number, number, number, number] => {
  if (!isJpegXlWorkbenchPreviewPixelFormat(block.format)) {
    throw new Error(`Workbench preview does not support ${block.format}`)
  }
  const normalize = (value: number, range: EffectiveDisplayRange): number =>
    Math.max(0, Math.min(1, (value - range.black) * range.inverseWidth))
  const display = (channel: number): number => {
    const value = normalize(
      sample(block, sourceX, sourceY, channel, view),
      ranges[channel] ?? ranges[0],
    )
    return mode === 'linear' ? linearJpegXlWorkbenchPreviewByte(value) : Math.round(value * 255)
  }
  const alpha = block.format.startsWith('rgba')
    ? Math.round(normalize(sample(block, sourceX, sourceY, 3, view), ranges[3]) * 255)
    : 255
  return Object.freeze([display(0), display(1), display(2), alpha])
}
