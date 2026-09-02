import type { PixelColorSemantics } from '../../../src/color.ts'
import { linearToSrgb } from '../../../src/codecs/icc.ts'
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
): format is 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16' =>
  format === 'gray8' ||
  format === 'gray16' ||
  format === 'rgb8' ||
  format === 'rgb16' ||
  format === 'rgba8' ||
  format === 'rgba16'

const sample = (block: PixelBlock, sourceX: number, sourceY: number, channel: number): number => {
  if (!isJpegXlWorkbenchPreviewPixelFormat(block.format)) {
    throw new Error(`Workbench preview does not support ${block.format}`)
  }
  const channels = block.format.startsWith('gray') ? 1 : block.format.startsWith('rgba') ? 4 : 3
  const bytesPerSample = block.format.endsWith('16') ? 2 : 1
  const localX = sourceX - block.x
  const localY = sourceY - block.y
  if (localX < 0 || localY < 0 || localX >= block.width || localY >= block.height) return 0
  if (channel === 3 && channels !== 4) return bytesPerSample === 1 ? 255 : 65_535
  const selectedChannel = channels === 1 ? 0 : channel
  const offset = localY * block.stride + (localX * channels + selectedChannel) * bytesPerSample
  if (bytesPerSample === 1) return block.data[offset] ?? 0
  return (block.data[offset] ?? 0) * 256 + (block.data[offset + 1] ?? 0)
}

export const jpegXlWorkbenchPreviewPixel = (
  block: PixelBlock,
  sourceX: number,
  sourceY: number,
  mode: JpegXlWorkbenchPreviewMode,
): readonly [number, number, number, number] => {
  if (!isJpegXlWorkbenchPreviewPixelFormat(block.format)) {
    throw new Error(`Workbench preview does not support ${block.format}`)
  }
  const maximum = block.format.endsWith('16') ? 65_535 : 255
  const display = (channel: number): number => {
    const value = sample(block, sourceX, sourceY, channel)
    return mode === 'linear'
      ? linearJpegXlWorkbenchPreviewByte(value / maximum)
      : Math.round((value * 255) / maximum)
  }
  const alpha = Math.round((sample(block, sourceX, sourceY, 3) * 255) / maximum)
  return Object.freeze([display(0), display(1), display(2), alpha])
}
