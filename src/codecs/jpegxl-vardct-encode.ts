import type { PixelColorSemantics } from '../color.ts'
import { invalidInput, unsupportedOperation } from '../errors.ts'
import { defaultImageLimits, type ImageLimits, validateImageDimensions } from '../limits.ts'
import { createStructuredRgbMatrix, nclxToLinear, nclxToLinearSrgbMatrix } from './icc.ts'
import {
  allocateJpegXlArray,
  JpegXlEncoderMemory,
  withJpegXlMemory,
  withJpegXlMemoryAsync,
} from './jpegxl-encoder-memory.ts'
import { invalidJpegXlInput, isJpegXlLimitExceeded } from './jpegxl-errors.ts'
import {
  encodeVarDctCoefficientSections,
  encodeVarDctCoefficientSectionsAsync,
  learnJpegXlForwardCoefficientOrders,
  type VarDctCoefficientGeometry,
  type VarDctCoefficientPlane,
  varDctCodestreamParts,
} from './jpegxl-jpeg-encode.ts'
import {
  encodeHybridUintPacked,
  hasSmallVisiblePalette,
  packSigned,
} from './jpegxl-modular-encode.ts'
import {
  defaultJpegXlDct4x8Dequantization,
  defaultJpegXlDct8Dequantization,
  defaultJpegXlDct16Dequantization,
  defaultJpegXlHornussDequantization,
  defaultJpegXlQuantizationBiases,
} from './jpegxl-vardct-quantization.ts'

const strategyTables = (strategy: number): readonly Float64Array[] =>
  strategy === 0
    ? defaultJpegXlDct8Dequantization
    : strategy === 1
      ? defaultJpegXlHornussDequantization
      : defaultJpegXlDct4x8Dequantization

export interface JpegXlForwardColor {
  readonly primaries: PixelColorSemantics['primaries']
  readonly transfer: PixelColorSemantics['transfer']
  readonly storageBytes?: 1 | 2
  readonly chromaticities?: PixelColorSemantics['chromaticities']
  readonly alpha?: PixelColorSemantics['alpha']
  readonly alphaBitDepth?: number
  readonly intensityTarget?: number
}
const defaultForwardMatrix = Float32Array.of(
  0.3,
  0.622,
  0.078,
  0.23,
  0.692,
  0.078,
  0.2434226894556144,
  0.20476744435558894,
  0.5518098669709147,
)

const linearSrgb = Float32Array.from({ length: 256 }, (_, value) => {
  const encoded = value / 255
  return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4
})
const bias = 0.0037930732552754493
const biasRoot = Math.cbrt(bias)
// The default sRGB matrix maps 8-bit RGB into [0, 1]. The extra endpoint
// covers its final floating-point rounding at white without a hot-loop clamp.
const lookupCubeRoot = (linear: number, table: Float32Array): number => {
  const scaled = linear * 16_384
  const index = scaled | 0
  const left = table[index] ?? 0
  return left + ((table[index + 1] ?? left) - left) * (scaled - index)
}

import {
  forwardJpegXlDct8,
  forwardJpegXlDct16,
  forwardJpegXlDctHalves,
  forwardJpegXlHornuss,
} from './jpegxl-vardct-forward-transforms.ts'

export { forwardJpegXlDct8 } from './jpegxl-vardct-forward-transforms.ts'

const strategyCandidates = Uint8Array.of(1, 12, 13)
const dct16Quantizers = Uint8Array.of(4, 5, 6, 7, 8, 9, 10, 12, 16)

// The AC writer emits each coefficient through the final nonzero scan position.
// This natural scan is the starting order before its image-level order adaptation.
const naturalAcScanRank = new Uint8Array(64)
{
  let scan = 1
  for (let diagonal = 1; diagonal < 15; diagonal++) {
    for (let step = 0; step <= diagonal; step++) {
      const x = (diagonal & 1) !== 0 ? diagonal - step : step
      const y = (diagonal & 1) !== 0 ? step : diagonal - step
      if (x < 8 && y < 8) naturalAcScanRank[y * 8 + x] = scan++
    }
  }
}

// The mixed-linear matrix is the inverse of the repository decoder's default opsin matrix.
const fillXybBlock = (
  pixels: Uint8Array,
  width: number,
  height: number,
  blockX: number,
  blockY: number,
  xPlane: Float32Array,
  yPlane: Float32Array,
  bPlane: Float32Array,
  channels: 3 | 4,
  transfer: Float32Array,
  matrix: Float32Array,
): void => {
  const m0 = matrix[0] ?? 0,
    m1 = matrix[1] ?? 0,
    m2 = matrix[2] ?? 0,
    m3 = matrix[3] ?? 0,
    m4 = matrix[4] ?? 0,
    m5 = matrix[5] ?? 0,
    m6 = matrix[6] ?? 0,
    m7 = matrix[7] ?? 0,
    m8 = matrix[8] ?? 0
  for (let y = 0; y < 8; y++) {
    const row = Math.min(height - 1, blockY * 8 + y) * width
    for (let x = 0; x < 8; x++) {
      const offset = (row + Math.min(width - 1, blockX * 8 + x)) * channels
      const red = transfer[pixels[offset] ?? 0] ?? 0
      const green = transfer[pixels[offset + 1] ?? 0] ?? 0
      const blue = transfer[pixels[offset + 2] ?? 0] ?? 0
      const mixedRed = Math.cbrt(m0 * red + m1 * green + m2 * blue + bias) - biasRoot
      const mixedGreen = Math.cbrt(m3 * red + m4 * green + m5 * blue + bias) - biasRoot
      const mixedBlue = Math.cbrt(m6 * red + m7 * green + m8 * blue + bias) - biasRoot
      const index = y * 8 + x
      xPlane[index] = (mixedRed - mixedGreen) / 2
      yPlane[index] = (mixedRed + mixedGreen) / 2
      bPlane[index] = mixedBlue - (mixedRed + mixedGreen) / 2
    }
  }
}

const fillXybBlockAligned = (
  pixels: Uint8Array,
  width: number,
  blockX: number,
  blockY: number,
  xPlane: Float32Array,
  yPlane: Float32Array,
  bPlane: Float32Array,
  transfer: Float32Array,
  matrix: Float32Array,
): void => {
  const m0 = matrix[0] ?? 0,
    m1 = matrix[1] ?? 0,
    m2 = matrix[2] ?? 0,
    m3 = matrix[3] ?? 0,
    m4 = matrix[4] ?? 0,
    m5 = matrix[5] ?? 0,
    m6 = matrix[6] ?? 0,
    m7 = matrix[7] ?? 0,
    m8 = matrix[8] ?? 0
  for (let y = 0; y < 8; y++) {
    let offset = ((blockY * 8 + y) * width + blockX * 8) * 3
    for (let x = 0; x < 8; x++, offset += 3) {
      const red = transfer[pixels[offset] ?? 0] ?? 0
      const green = transfer[pixels[offset + 1] ?? 0] ?? 0
      const blue = transfer[pixels[offset + 2] ?? 0] ?? 0
      const mixedRed = Math.cbrt(m0 * red + m1 * green + m2 * blue + bias) - biasRoot
      const mixedGreen = Math.cbrt(m3 * red + m4 * green + m5 * blue + bias) - biasRoot
      const mixedBlue = Math.cbrt(m6 * red + m7 * green + m8 * blue + bias) - biasRoot
      const index = y * 8 + x
      xPlane[index] = (mixedRed - mixedGreen) / 2
      yPlane[index] = (mixedRed + mixedGreen) / 2
      bPlane[index] = mixedBlue - (mixedRed + mixedGreen) / 2
    }
  }
}

const fillXybBlockAlignedFast = (
  pixels: Uint8Array,
  width: number,
  blockX: number,
  blockY: number,
  xPlane: Float32Array,
  yPlane: Float32Array,
  bPlane: Float32Array,
  transfer: Float32Array,
  matrix: Float32Array,
  cubeRootTable: Float32Array,
): void => {
  const m0 = matrix[0] ?? 0,
    m1 = matrix[1] ?? 0,
    m2 = matrix[2] ?? 0,
    m3 = matrix[3] ?? 0,
    m4 = matrix[4] ?? 0,
    m5 = matrix[5] ?? 0,
    m6 = matrix[6] ?? 0,
    m7 = matrix[7] ?? 0,
    m8 = matrix[8] ?? 0
  for (let y = 0; y < 8; y++) {
    let offset = ((blockY * 8 + y) * width + blockX * 8) * 3
    for (let x = 0; x < 8; x++, offset += 3) {
      const red = transfer[pixels[offset] ?? 0] ?? 0
      const green = transfer[pixels[offset + 1] ?? 0] ?? 0
      const blue = transfer[pixels[offset + 2] ?? 0] ?? 0
      const mixedRed = lookupCubeRoot(m0 * red + m1 * green + m2 * blue, cubeRootTable)
      const mixedGreen = lookupCubeRoot(m3 * red + m4 * green + m5 * blue, cubeRootTable)
      const mixedBlue = lookupCubeRoot(m6 * red + m7 * green + m8 * blue, cubeRootTable)
      const index = y * 8 + x
      xPlane[index] = (mixedRed - mixedGreen) / 2
      yPlane[index] = (mixedRed + mixedGreen) / 2
      bPlane[index] = mixedBlue - (mixedRed + mixedGreen) / 2
    }
  }
}

const fillXybBlock16 = (
  pixels: Uint8Array,
  width: number,
  height: number,
  blockX: number,
  blockY: number,
  xPlane: Float32Array,
  yPlane: Float32Array,
  bPlane: Float32Array,
  channels: 3 | 4,
  transfer: Float32Array,
  matrix: Float32Array,
): void => {
  const m0 = matrix[0] ?? 0,
    m1 = matrix[1] ?? 0,
    m2 = matrix[2] ?? 0,
    m3 = matrix[3] ?? 0,
    m4 = matrix[4] ?? 0,
    m5 = matrix[5] ?? 0,
    m6 = matrix[6] ?? 0,
    m7 = matrix[7] ?? 0,
    m8 = matrix[8] ?? 0
  for (let y = 0; y < 8; y++) {
    const row = Math.min(height - 1, blockY * 8 + y) * width
    for (let x = 0; x < 8; x++) {
      const offset = (row + Math.min(width - 1, blockX * 8 + x)) * channels * 2
      const red = transfer[((pixels[offset + 0] ?? 0) << 8) | (pixels[offset + 1] ?? 0)] ?? 0
      const green = transfer[((pixels[offset + 2] ?? 0) << 8) | (pixels[offset + 3] ?? 0)] ?? 0
      const blue = transfer[((pixels[offset + 4] ?? 0) << 8) | (pixels[offset + 5] ?? 0)] ?? 0
      const mixedRed = Math.cbrt(m0 * red + m1 * green + m2 * blue + bias) - biasRoot
      const mixedGreen = Math.cbrt(m3 * red + m4 * green + m5 * blue + bias) - biasRoot
      const mixedBlue = Math.cbrt(m6 * red + m7 * green + m8 * blue + bias) - biasRoot
      const index = y * 8 + x
      xPlane[index] = (mixedRed - mixedGreen) / 2
      yPlane[index] = (mixedRed + mixedGreen) / 2
      bPlane[index] = mixedBlue - (mixedRed + mixedGreen) / 2
    }
  }
}

/** Synchronous forward path used by conformance tools; public encoding uses the async path. */
export const encodeJpegXlVarDct8 = (
  pixels: Uint8Array,
  width: number,
  height: number,
  distance: number,
  memory?: JpegXlEncoderMemory,
  channels: 1 | 3 | 4 = 3,
  effort: 1 | 3 | 5 | 7 = 3,
  imageHeader?: Uint8Array,
  sampleDepth = 8,
  progressive = false,
  color?: JpegXlForwardColor,
): readonly Uint8Array[] => {
  const owned = memory ?? new JpegXlEncoderMemory(268_435_456)
  try {
    const encode = (compressionSearch: boolean) =>
      withJpegXlMemory(owned, () => {
        const steps = prepare8(
          pixels,
          width,
          height,
          distance,
          owned,
          channels,
          effort,
          imageHeader,
          sampleDepth,
          progressive,
          color,
          defaultImageLimits,
          'conservative',
          compressionSearch,
        )
        let next = steps.next()
        while (!next.done) next = steps.next()
        const geometry = next.value
        const baseline = varDctCodestreamParts(
          { width, height },
          geometry,
          encodeVarDctCoefficientSections(geometry),
        )
        if (!usesForwardCoefficientOrderSearch(geometry)) return baseline
        try {
          return withJpegXlMemory(owned, () => {
            const learning = learnJpegXlForwardCoefficientOrders(geometry)
            let next = learning.next()
            while (!next.done) next = learning.next()
            const alternateGeometry = { ...geometry, forwardCoefficientOrders: next.value }
            const alternate = varDctCodestreamParts(
              { width, height },
              alternateGeometry,
              encodeVarDctCoefficientSections(alternateGeometry),
            )
            let selected =
              codestreamPartBytes(alternate) < codestreamPartBytes(baseline) ? alternate : baseline
            for (const candidate of [geometry, alternateGeometry]) {
              try {
                selected = withJpegXlMemory(owned, () => {
                  const familyGeometry = { ...candidate, forwardFamilyContexts: true }
                  const family = varDctCodestreamParts(
                    { width, height },
                    familyGeometry,
                    encodeVarDctCoefficientSections(familyGeometry),
                  )
                  return codestreamPartBytes(family) < codestreamPartBytes(selected)
                    ? family
                    : selected
                })
              } catch (error) {
                if (!isJpegXlLimitExceeded(error)) throw error
                break
              }
            }
            return selected
          })
        } catch (error) {
          if (!isJpegXlLimitExceeded(error)) throw error
          return baseline
        }
      })
    try {
      return encode(true)
    } catch (error) {
      if (!isJpegXlLimitExceeded(error)) throw error
      return encode(false)
    }
  } finally {
    if (!memory) owned.close()
  }
}

export interface JpegXlForwardFrameOptions {
  readonly reference?: boolean
  readonly patchGlobalSection?: (section: Uint8Array) => Uint8Array
  readonly strategyPolicy?: 'rate-distortion'
  readonly compressionSearch?: boolean
}

const usesForwardCoefficientOrderSearch = (
  geometry: Readonly<VarDctCoefficientGeometry>,
): boolean =>
  geometry.effort === 7 &&
  geometry.loadAcGroup !== undefined &&
  geometry.groupsAcross * geometry.groupsDown > 1 &&
  geometry.fullBlockWidth * geometry.fullBlockHeight >= 1_024

const codestreamPartBytes = (parts: readonly Uint8Array[]): number =>
  parts.reduce((total, part) => total + part.byteLength, 0)

const forwardFrameParts = (
  width: number,
  height: number,
  geometry: Readonly<VarDctCoefficientGeometry>,
  sections: readonly Uint8Array[],
  frame: Readonly<JpegXlForwardFrameOptions>,
): readonly Uint8Array[] => {
  const global = sections[0]
  if (!global) throw invalidJpegXlInput('VarDCT global section is missing')
  const selectedSections = frame.patchGlobalSection
    ? [frame.patchGlobalSection(global), ...sections.slice(1)]
    : sections
  return varDctCodestreamParts({ width, height }, geometry, selectedSections, {
    reference: frame.reference === true,
    patches: frame.patchGlobalSection !== undefined,
  })
}

const encodeJpegXlVarDct8CandidateAsync = (
  pixels: Uint8Array,
  width: number,
  height: number,
  distance: number,
  memory: JpegXlEncoderMemory,
  checkpoint: () => Promise<void>,
  channels: 1 | 3 | 4 = 3,
  effort: 1 | 3 | 5 | 7 = 3,
  imageHeader?: Uint8Array,
  sampleDepth = 8,
  progressive = false,
  color?: JpegXlForwardColor,
  limits: Readonly<ImageLimits> = defaultImageLimits,
  frame: Readonly<JpegXlForwardFrameOptions> = {},
): Promise<readonly Uint8Array[]> =>
  withJpegXlMemoryAsync(memory, async () => {
    const steps = prepare8(
      pixels,
      width,
      height,
      distance,
      memory,
      channels,
      effort,
      imageHeader,
      sampleDepth,
      progressive,
      color,
      limits,
      frame.strategyPolicy ?? 'conservative',
      frame.compressionSearch !== false,
    )
    await checkpoint()
    let next = steps.next()
    while (!next.done) {
      await checkpoint()
      next = steps.next()
    }
    const geometry = next.value
    const sections = await encodeVarDctCoefficientSectionsAsync(geometry, checkpoint)
    await checkpoint()
    const baseline = forwardFrameParts(width, height, geometry, sections, frame)
    if (!usesForwardCoefficientOrderSearch(geometry)) return baseline
    try {
      return await withJpegXlMemoryAsync(memory, async () => {
        const learning = learnJpegXlForwardCoefficientOrders(geometry)
        let next = learning.next()
        try {
          while (!next.done) {
            await checkpoint()
            next = learning.next()
          }
        } finally {
          learning.return([])
        }
        const alternateGeometry = { ...geometry, forwardCoefficientOrders: next.value }
        const alternateSections = await encodeVarDctCoefficientSectionsAsync(
          alternateGeometry,
          checkpoint,
        )
        await checkpoint()
        const alternate = forwardFrameParts(
          width,
          height,
          alternateGeometry,
          alternateSections,
          frame,
        )
        let selected =
          codestreamPartBytes(alternate) < codestreamPartBytes(baseline) ? alternate : baseline
        for (const candidate of [geometry, alternateGeometry]) {
          try {
            selected = await withJpegXlMemoryAsync(memory, async () => {
              const familyGeometry = { ...candidate, forwardFamilyContexts: true }
              const familySections = await encodeVarDctCoefficientSectionsAsync(
                familyGeometry,
                checkpoint,
              )
              await checkpoint()
              const family = forwardFrameParts(width, height, familyGeometry, familySections, frame)
              return codestreamPartBytes(family) < codestreamPartBytes(selected) ? family : selected
            })
          } catch (error) {
            if (!isJpegXlLimitExceeded(error)) throw error
            break
          }
        }
        return selected
      })
    } catch (error) {
      if (!isJpegXlLimitExceeded(error)) throw error
      return baseline
    }
  })

export const encodeJpegXlVarDct8Async = async (
  pixels: Uint8Array,
  width: number,
  height: number,
  distance: number,
  memory: JpegXlEncoderMemory,
  checkpoint: () => Promise<void>,
  channels: 1 | 3 | 4 = 3,
  effort: 1 | 3 | 5 | 7 = 3,
  imageHeader?: Uint8Array,
  sampleDepth = 8,
  progressive = false,
  color?: JpegXlForwardColor,
  limits: Readonly<ImageLimits> = defaultImageLimits,
  frame: Readonly<JpegXlForwardFrameOptions> = {},
): Promise<readonly Uint8Array[]> => {
  try {
    return await encodeJpegXlVarDct8CandidateAsync(
      pixels,
      width,
      height,
      distance,
      memory,
      checkpoint,
      channels,
      effort,
      imageHeader,
      sampleDepth,
      progressive,
      color,
      limits,
      frame,
    )
  } catch (error) {
    if (!isJpegXlLimitExceeded(error) || frame.compressionSearch === false) throw error
    return encodeJpegXlVarDct8CandidateAsync(
      pixels,
      width,
      height,
      distance,
      memory,
      checkpoint,
      channels,
      effort,
      imageHeader,
      sampleDepth,
      progressive,
      color,
      limits,
      { ...frame, compressionSearch: false },
    )
  }
}

function* prepare8(
  pixels: Uint8Array,
  width: number,
  height: number,
  distance: number,
  memory: JpegXlEncoderMemory,
  channels: 1 | 3 | 4,
  effort: 1 | 3 | 5 | 7,
  imageHeader: Uint8Array | undefined,
  sampleDepth: number,
  progressive: boolean,
  color: JpegXlForwardColor | undefined,
  limits: Readonly<ImageLimits> = defaultImageLimits,
  strategyPolicy: 'conservative' | 'rate-distortion' = 'conservative',
  compressionSearch = true,
): Generator<void, VarDctCoefficientGeometry, undefined> {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw invalidJpegXlInput('dimensions must be positive safe integers')
  if (!Number.isInteger(sampleDepth) || sampleDepth < 8 || sampleDepth > 16)
    throw invalidJpegXlInput('forward sample depth must be between 8 and 16')
  const sampleBytes = color?.storageBytes ?? (sampleDepth === 8 ? 1 : 2)
  if ((sampleDepth !== 8 || sampleBytes === 2 || channels === 1) && !imageHeader)
    throw invalidJpegXlInput('high-depth and grayscale encoding require an explicit image header')
  validateImageDimensions(width, height, 1, limits, channels * sampleBytes)
  if (pixels.length !== width * height * channels * sampleBytes)
    throw invalidJpegXlInput('RGB8 extent is inconsistent')
  if (!Number.isFinite(distance) || distance < 0.25 || distance > 25)
    throw invalidJpegXlInput('forward conformance distance must be between 0.25 and 25')
  const blockQuantization = 4
  const globalScale = Math.round(65536 / (distance * blockQuantization))
  const effectiveDistance = 65536 / globalScale / blockQuantization
  const sdrAlpha =
    effort === 7 &&
    channels === 4 &&
    sampleDepth === 8 &&
    sampleBytes === 1 &&
    (color?.primaries ?? 'srgb') === 'srgb' &&
    (color?.transfer.kind ?? 'srgb') === 'srgb'
  let rgbDcPolicy = channels === 3
  let smallVisiblePalette: boolean | undefined
  if (
    sdrAlpha &&
    (distance > 1 || (compressionSearch && width * height > 4_194_304)) &&
    (width * height <= 4_194_304 || (compressionSearch && width * height <= 16_777_216)) &&
    (color?.alphaBitDepth ?? 8) === 8
  ) {
    rgbDcPolicy = true
    for (let offset = 3; offset < pixels.length; offset += 4) {
      if (pixels[offset] !== 255) {
        rgbDcPolicy = false
        break
      }
    }
    if (rgbDcPolicy) {
      try {
        // Artwork with few visible colors keeps its established DC policy.
        smallVisiblePalette = hasSmallVisiblePalette(pixels, memory)
        rgbDcPolicy = !smallVisiblePalette
      } catch (error) {
        if (!isJpegXlLimitExceeded(error)) throw error
        rgbDcPolicy = false
      }
    }
  }
  let alphaPaletteSearch = true
  if (
    sdrAlpha &&
    !progressive &&
    width * height <= 1_048_576 &&
    (color?.alphaBitDepth ?? 8) === 8
  ) {
    try {
      // Keep the established exact Modular artwork candidate's selection floor.
      alphaPaletteSearch = !(smallVisiblePalette ?? hasSmallVisiblePalette(pixels, memory))
    } catch (error) {
      if (!isJpegXlLimitExceeded(error)) throw error
      alphaPaletteSearch = false
    }
  }
  // Keep fine DC precision outside the measured SDR experiments.
  // Modest channel-specific steps reduce SDR DC payload without coarse color blocks.
  const moderateSdrDc =
    distance > 1 &&
    effort !== 1 &&
    rgbDcPolicy &&
    sampleDepth === 8 &&
    sampleBytes === 1 &&
    (color?.primaries ?? 'srgb') === 'srgb' &&
    (color?.transfer.kind ?? 'srgb') === 'srgb'
  const finerSdrAc =
    effort === 7 &&
    channels === 3 &&
    sampleDepth === 8 &&
    sampleBytes === 1 &&
    distance >= 2 &&
    distance <= 4 &&
    (color?.primaries ?? 'srgb') === 'srgb' &&
    (color?.transfer.kind ?? 'srgb') === 'srgb'
  const brightPqAc = effort === 7 && channels === 3 && color?.transfer.kind === 'pq'
  const originalDarkAc =
    compressionSearch &&
    sdrAlpha &&
    rgbDcPolicy &&
    !progressive &&
    width * height > 4_194_304 &&
    distance <= 1
  const originalPhotoAc =
    compressionSearch &&
    sdrAlpha &&
    rgbDcPolicy &&
    !progressive &&
    width * height > 4_194_304 &&
    distance > 1
  const moderateAlphaDc = sdrAlpha
  const dcQuantization = moderateSdrDc
    ? originalPhotoAc
      ? [distance < 2 ? 1 / 8192 : 1 / 16384, 1 / 2048, 1 / 1024]
      : [1 / 16384, 1 / 4096, 1 / 2048]
    : moderateAlphaDc
      ? [1 / 8192, 1 / 1024, 1 / 512]
      : [1 / 16384, 1 / 16384, 1 / 16384]
  const fullBlockWidth = Math.ceil(width / 8)
  const fullBlockHeight = Math.ceil(height / 8)
  const deferredDcGroups =
    effort === 1 &&
    channels !== 4 &&
    !progressive &&
    Math.ceil(fullBlockWidth / 32) * Math.ceil(fullBlockHeight / 32) > 1 &&
    Math.ceil(fullBlockWidth / 32) * Math.ceil(fullBlockHeight / 32) <= 256
  const colorTilesAcross = Math.ceil(fullBlockWidth / 8)
  const colorTilesDown = Math.ceil(fullBlockHeight / 8)
  const covarianceY = allocateJpegXlArray(memory, Float32Array, colorTilesAcross * colorTilesDown)
  const covarianceX = allocateJpegXlArray(memory, Float32Array, colorTilesAcross * colorTilesDown)
  const covarianceB = allocateJpegXlArray(memory, Float32Array, colorTilesAcross * colorTilesDown)
  const colorCorrelationX = allocateJpegXlArray(
    memory,
    Int32Array,
    colorTilesAcross * colorTilesDown,
  )
  const colorCorrelationB = allocateJpegXlArray(
    memory,
    Int32Array,
    colorTilesAcross * colorTilesDown,
  )
  const blockQuantizationMap = allocateJpegXlArray(
    memory,
    Int32Array,
    fullBlockWidth * fullBlockHeight,
  )
  blockQuantizationMap.fill(blockQuantization)
  const fineRateMap = originalDarkAc
    ? allocateJpegXlArray(memory, Uint8Array, fullBlockWidth * fullBlockHeight)
    : undefined
  const blockStrategyMap =
    effort >= 5
      ? allocateJpegXlArray(memory, Int32Array, fullBlockWidth * fullBlockHeight)
      : undefined
  const components: VarDctCoefficientPlane[] = Array.from({ length: 3 }, () => ({
    blocksPerLineForMcu: fullBlockWidth,
    blocksPerColumnForMcu: fullBlockHeight,
    coefficients: allocateJpegXlArray(memory, Int32Array, fullBlockWidth * fullBlockHeight),
    coefficientStride: 1,
  }))
  const quantization = defaultJpegXlDct8Dequantization.map(() => {
    const table = allocateJpegXlArray(memory, Int32Array, 64)
    for (let position = 0; position < 64; position++) table[position] = 1
    return table
  })
  const xPlane = allocateJpegXlArray(memory, Float32Array, 64)
  const yPlane = allocateJpegXlArray(memory, Float32Array, 64)
  const bPlane = allocateJpegXlArray(memory, Float32Array, 64)
  const planes = [xPlane, yPlane, bPlane]
  const intermediate = allocateJpegXlArray(memory, Float32Array, 64)
  const transformed = allocateJpegXlArray(memory, Float32Array, 64)
  const colorTransfer = color?.transfer ?? { kind: 'srgb' }
  const primaryCode =
    color?.primaries === 'rec2020' ? 9 : color?.primaries === 'display-p3' ? 12 : 1
  const transfer =
    sampleDepth === 8 && colorTransfer.kind === 'srgb'
      ? linearSrgb
      : allocateJpegXlArray(memory, Float32Array, 2 ** sampleDepth)
  if (transfer !== linearSrgb) {
    const maximum = 2 ** sampleDepth - 1
    const transferCode =
      colorTransfer.kind === 'linear'
        ? 8
        : colorTransfer.kind === 'pq'
          ? 16
          : colorTransfer.kind === 'hlg'
            ? 18
            : colorTransfer.kind === 'bt709'
              ? 1
              : 13
    for (let value = 0; value <= maximum; value++) {
      const encoded = value / maximum
      transfer[value] =
        colorTransfer.kind === 'gamma'
          ? encoded ** colorTransfer.exponent
          : nclxToLinear(transferCode, encoded) * (colorTransfer.kind === 'pq' ? 203 / 255 : 1)
    }
  }
  const matrix =
    primaryCode === 1 && !color?.chromaticities
      ? defaultForwardMatrix
      : allocateJpegXlArray(memory, Float32Array, 9)
  if (matrix !== defaultForwardMatrix) {
    const sourceMatrix = color?.chromaticities
      ? createStructuredRgbMatrix(color.primaries, color.chromaticities)
      : nclxToLinearSrgbMatrix(primaryCode)
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 3; column++) {
        let value = 0
        for (let inner = 0; inner < 3; inner++)
          value +=
            (defaultForwardMatrix[row * 3 + inner] ?? 0) * (sourceMatrix[inner * 3 + column] ?? 0)
        matrix[row * 3 + column] = value
      }
    }
  }
  const cubeRootTable =
    effort === 1 &&
    channels === 3 &&
    sampleBytes === 1 &&
    (width & 7) === 0 &&
    (height & 7) === 0 &&
    primaryCode === 1 &&
    colorTransfer.kind === 'srgb'
      ? allocateJpegXlArray(memory, Float32Array, 16_386)
      : undefined
  if (cubeRootTable) {
    for (let index = 0; index < cubeRootTable.length; index++)
      cubeRootTable[index] = Math.cbrt(index / 16_384 + bias) - biasRoot
  }
  // Select the storage kernel once. Grayscale never expands to an RGB bitmap.
  const defaultFillColor =
    channels === 1
      ? (blockX: number, blockY: number) => {
          xPlane.fill(0)
          bPlane.fill(0)
          for (let y = 0; y < 8; y++) {
            const row = Math.min(height - 1, blockY * 8 + y) * width
            for (let x = 0; x < 8; x++) {
              const offset = (row + Math.min(width - 1, blockX * 8 + x)) * sampleBytes
              const value =
                sampleBytes === 1
                  ? (pixels[offset] ?? 0)
                  : ((pixels[offset] ?? 0) << 8) | (pixels[offset + 1] ?? 0)
              yPlane[y * 8 + x] = Math.cbrt((transfer[value] ?? 0) + bias) - biasRoot
            }
          }
        }
      : sampleBytes === 1
        ? channels === 3 && (width & 7) === 0 && (height & 7) === 0
          ? cubeRootTable
            ? (blockX: number, blockY: number) =>
                fillXybBlockAlignedFast(
                  pixels,
                  width,
                  blockX,
                  blockY,
                  xPlane,
                  yPlane,
                  bPlane,
                  transfer,
                  matrix,
                  cubeRootTable,
                )
            : (blockX: number, blockY: number) =>
                fillXybBlockAligned(
                  pixels,
                  width,
                  blockX,
                  blockY,
                  xPlane,
                  yPlane,
                  bPlane,
                  transfer,
                  matrix,
                )
          : (blockX: number, blockY: number) =>
              fillXybBlock(
                pixels,
                width,
                height,
                blockX,
                blockY,
                xPlane,
                yPlane,
                bPlane,
                channels,
                transfer,
                matrix,
              )
        : (blockX: number, blockY: number) =>
            fillXybBlock16(
              pixels,
              width,
              height,
              blockX,
              blockY,
              xPlane,
              yPlane,
              bPlane,
              channels,
              transfer,
              matrix,
            )
  const hlg = colorTransfer.kind === 'hlg'
  const associated = color?.alpha === 'premultiplied'
  const sourceMatrix = hlg
    ? createStructuredRgbMatrix(color?.primaries ?? 'srgb', color?.chromaticities)
    : undefined
  const lumaRed = sourceMatrix
    ? 0.2126 * (sourceMatrix[0] ?? 0) +
      0.7152 * (sourceMatrix[3] ?? 0) +
      0.0722 * (sourceMatrix[6] ?? 0)
    : 0
  const lumaGreen = sourceMatrix
    ? 0.2126 * (sourceMatrix[1] ?? 0) +
      0.7152 * (sourceMatrix[4] ?? 0) +
      0.0722 * (sourceMatrix[7] ?? 0)
    : 0
  const lumaBlue = sourceMatrix
    ? 0.2126 * (sourceMatrix[2] ?? 0) +
      0.7152 * (sourceMatrix[5] ?? 0) +
      0.0722 * (sourceMatrix[8] ?? 0)
    : 0
  const target = color?.intensityTarget ?? 1000
  const hlgExponent = 1.2 * 1.111 ** Math.log2(target / 1000) - 1
  const alphaMaximum = 2 ** (color?.alphaBitDepth ?? sampleDepth) - 1
  const maximum = 2 ** sampleDepth - 1
  const fillColor =
    hlg || associated
      ? (blockX: number, blockY: number) => {
          for (let y = 0; y < 8; y++) {
            const row = Math.min(height - 1, blockY * 8 + y) * width
            for (let x = 0; x < 8; x++) {
              const offset = (row + Math.min(width - 1, blockX * 8 + x)) * channels * sampleBytes
              const r =
                sampleBytes === 1
                  ? (pixels[offset] ?? 0)
                  : ((pixels[offset] ?? 0) << 8) | (pixels[offset + 1] ?? 0)
              const go = offset + (channels === 1 ? 0 : sampleBytes)
              const bo = offset + (channels === 1 ? 0 : sampleBytes * 2)
              const g =
                sampleBytes === 1
                  ? (pixels[go] ?? 0)
                  : ((pixels[go] ?? 0) << 8) | (pixels[go + 1] ?? 0)
              const b =
                sampleBytes === 1
                  ? (pixels[bo] ?? 0)
                  : ((pixels[bo] ?? 0) << 8) | (pixels[bo + 1] ?? 0)
              const ao = offset + 3 * sampleBytes
              const alpha = associated
                ? (sampleBytes === 1
                    ? (pixels[ao] ?? 0)
                    : ((pixels[ao] ?? 0) << 8) | (pixels[ao + 1] ?? 0)) / alphaMaximum
                : 1
              // Interpolate only when straightening associated source codes.
              const ri = alpha === 0 ? 0 : Math.min(maximum, r / alpha)
              const gi = alpha === 0 ? 0 : Math.min(maximum, g / alpha)
              const bi = alpha === 0 ? 0 : Math.min(maximum, b / alpha)
              const rl = Math.floor(ri),
                gl = Math.floor(gi),
                bl = Math.floor(bi)
              const red =
                (transfer[rl] ?? 0) +
                ((transfer[Math.min(maximum, rl + 1)] ?? 0) - (transfer[rl] ?? 0)) * (ri - rl)
              const green =
                (transfer[gl] ?? 0) +
                ((transfer[Math.min(maximum, gl + 1)] ?? 0) - (transfer[gl] ?? 0)) * (gi - gl)
              const blue =
                (transfer[bl] ?? 0) +
                ((transfer[Math.min(maximum, bl + 1)] ?? 0) - (transfer[bl] ?? 0)) * (bi - bl)
              const luminance = hlg
                ? Math.max(0, red * lumaRed + green * lumaGreen + blue * lumaBlue)
                : 1
              const scale =
                (hlg ? (luminance === 0 ? 0 : (luminance ** hlgExponent * target) / 255) : 1) *
                alpha
              const first =
                Math.cbrt(
                  ((matrix[0] ?? 0) * red + (matrix[1] ?? 0) * green + (matrix[2] ?? 0) * blue) *
                    scale +
                    bias,
                ) - biasRoot
              const second =
                Math.cbrt(
                  ((matrix[3] ?? 0) * red + (matrix[4] ?? 0) * green + (matrix[5] ?? 0) * blue) *
                    scale +
                    bias,
                ) - biasRoot
              const third =
                Math.cbrt(
                  ((matrix[6] ?? 0) * red + (matrix[7] ?? 0) * green + (matrix[8] ?? 0) * blue) *
                    scale +
                    bias,
                ) - biasRoot
              const index = y * 8 + x
              xPlane[index] = (first - second) / 2
              yPlane[index] = (first + second) / 2
              bPlane[index] = third - (first + second) / 2
            }
          }
        }
      : defaultFillColor
  const alphaMask =
    channels === 4 && effort > 1 ? allocateJpegXlArray(memory, Uint8Array, 64) : undefined
  const fill = alphaMask
    ? (blockX: number, blockY: number) => {
        fillColor(blockX, blockY)
        let visible = 0,
          sumX = 0,
          sumY = 0,
          sumB = 0
        for (let y = 0; y < 8; y++) {
          const row = Math.min(height - 1, blockY * 8 + y) * width
          for (let x = 0; x < 8; x++) {
            const position = y * 8 + x
            const offset = ((row + Math.min(width - 1, blockX * 8 + x)) * 4 + 3) * sampleBytes
            const alpha = (pixels[offset] ?? 0) | (pixels[offset + sampleBytes - 1] ?? 0)
            alphaMask[position] = alpha === 0 ? 0 : 1
            if (alpha !== 0) {
              visible++
              sumX += xPlane[position] ?? 0
              sumY += yPlane[position] ?? 0
              sumB += bPlane[position] ?? 0
            }
          }
        }
        if (visible === 64) return
        const meanX = visible ? sumX / visible : 0
        const meanY = visible ? sumY / visible : 0
        const meanB = visible ? sumB / visible : 0
        for (let position = 0; position < 64; position++) {
          if (alphaMask[position] !== 0) continue
          xPlane[position] = meanX
          yPlane[position] = meanY
          bPlane[position] = meanB
        }
      }
    : fillColor
  const means = allocateJpegXlArray(memory, Float32Array, 3)
  for (let blockY = 0; !deferredDcGroups && blockY < fullBlockHeight; blockY++) {
    for (let blockX = 0; blockX < fullBlockWidth; blockX++) {
      fill(blockX, blockY)
      const offset = blockY * fullBlockWidth + blockX
      for (let channel = 0; channel < 3; channel++) {
        const plane = planes[channel]
        const component = components[channel]
        if (!plane || !component) throw invalidJpegXlInput('forward channel is missing')
        let sum = 0
        for (let position = 0; position < 64; position++) sum += plane[position] ?? 0
        means[channel] = sum / 64
        component.coefficients[offset] = Math.round(
          sum / (64 * effectiveDistance * (dcQuantization[channel] ?? 0)),
        )
      }
      if (effort > 1) {
        let yy = 0,
          xy = 0,
          by = 0,
          gradient = 0
        for (let position = 0; position < 64; position++) {
          const sampleY = yPlane[position] ?? 0
          const deltaY = sampleY - (means[1] ?? 0)
          yy += deltaY * deltaY
          xy += ((xPlane[position] ?? 0) - (means[0] ?? 0)) * deltaY
          by += ((bPlane[position] ?? 0) - (means[2] ?? 0)) * deltaY
          if ((position & 7) !== 0) gradient += (sampleY - (yPlane[position - 1] ?? 0)) ** 2
          if (position >= 8) gradient += (sampleY - (yPlane[position - 8] ?? 0)) ** 2
        }
        const tile = Math.floor(blockY / 8) * colorTilesAcross + Math.floor(blockX / 8)
        covarianceY[tile] = (covarianceY[tile] ?? 0) + yy
        covarianceX[tile] = (covarianceX[tile] ?? 0) + xy
        covarianceB[tile] = (covarianceB[tile] ?? 0) + by
        const activity = gradient / Math.max(yy, 1e-12)
        if (fineRateMap) {
          const meanY = means[1] ?? 0
          fineRateMap[offset] =
            yy >= 0.000064 &&
            yy < 0.005 &&
            ((meanY > 0.5 && activity < 1.5) || (meanY < 0.5 && activity > 1.5))
              ? 1
              : 0
        }
        blockQuantizationMap[offset] = moderateAlphaDc
          ? (originalDarkAc &&
              ((means[1] ?? 0) < 0.3 || ((means[1] ?? 0) < 0.5 && activity > 1.5)) &&
              yy >= 0.000064 &&
              yy < 0.001) ||
            (originalPhotoAc &&
              ((distance < 2 &&
                (((means[1] ?? 0) < 0.3 && gradient > 0.01 && yy < 0.05) ||
                  ((means[1] ?? 0) < 0.5 && activity > 2 && yy >= 0.000064 && yy < 0.005))) ||
                (distance >= 4 && (means[1] ?? 0) > 0.5 && yy >= 0.000064 && yy < 0.005)))
            ? 8
            : 7
          : yy < 0.000064 || activity < 0.15
            ? 6
            : finerSdrAc
              ? 5
              : 4
        if (brightPqAc && (means[1] ?? 0) >= 0.5 && blockQuantizationMap[offset] === 4)
          blockQuantizationMap[offset] = 5
        // Spend extra AC precision on strong SDR edges and thin PQ edges.
        if (finerSdrAc && gradient > 0.01) blockQuantizationMap[offset] = 6
        if (brightPqAc && distance >= 2 && distance <= 4 && gradient > 0.01 && activity > 3)
          blockQuantizationMap[offset] = 6
      }
    }
    yield
  }
  if (effort > 1) {
    for (let tile = 0; tile < covarianceY.length; tile++) {
      const variance = covarianceY[tile] ?? 0
      if (variance < 1e-9) continue
      colorCorrelationX[tile] = Math.max(
        -128,
        Math.min(127, Math.round((84 * (covarianceX[tile] ?? 0)) / variance)),
      )
      colorCorrelationB[tile] = Math.max(
        -128,
        Math.min(127, Math.round((84 * (covarianceB[tile] ?? 0)) / variance)),
      )
    }
  }
  memory.release(covarianceY)
  memory.release(covarianceX)
  memory.release(covarianceB)
  const acRateWeightY = originalDarkAc || originalPhotoAc ? 0.1 : 0.05
  let currentAcRateWeightY = acRateWeightY
  const fillCorrelated = (blockX: number, blockY: number): void => {
    if (fineRateMap)
      currentAcRateWeightY =
        fineRateMap[blockY * fullBlockWidth + blockX] === 1 ? 0.05 : acRateWeightY
    fill(blockX, blockY)
    const tile = Math.floor(blockY / 8) * colorTilesAcross + Math.floor(blockX / 8)
    const ratioX = (colorCorrelationX[tile] ?? 0) / 84
    const ratioB = (colorCorrelationB[tile] ?? 0) / 84
    for (let position = 0; position < 64; position++) {
      xPlane[position] = (xPlane[position] ?? 0) - ratioX * (yPlane[position] ?? 0)
      bPlane[position] = (bPlane[position] ?? 0) - ratioB * (yPlane[position] ?? 0)
    }
  }
  const transform = (strategy: number, plane: Float32Array): void => {
    if (strategy === 1) forwardJpegXlHornuss(plane, transformed)
    else if (strategy === 12 || strategy === 13)
      forwardJpegXlDctHalves(plane, intermediate, transformed, strategy === 13)
    else forwardJpegXlDct8(plane, intermediate, transformed)
  }
  const coarse =
    compressionSearch &&
    moderateSdrDc &&
    effort === 7 &&
    (distance >= 6 || originalPhotoAc) &&
    channels === 4 &&
    !progressive &&
    width * height <= 16_777_216
  const acRateWeightChroma = originalDarkAc || originalPhotoAc ? 0.04 : 0.02
  const rateAwareAc = (normalized: number, channel: number): number => {
    const bias = defaultJpegXlQuantizationBiases[channel] ?? 1
    const weight = channel === 1 ? currentAcRateWeightY : acRateWeightChroma
    const magnitude = Math.abs(normalized),
      lower = Math.floor(magnitude),
      upper = lower + 1
    const lowValue = lower === 0 ? 0 : lower === 1 ? bias : lower - 0.145 / lower
    const highValue = upper === 1 ? bias : upper - 0.145 / upper
    const lowCost =
      (magnitude - lowValue) ** 2 + weight * (lower === 0 ? 0 : 1 + 2 * Math.log2(1 + lower))
    const highCost = (magnitude - highValue) ** 2 + weight * (1 + 2 * Math.log2(1 + upper))
    const value = highCost < lowCost ? upper : lower
    return normalized < 0 ? -value : value
  }
  const quantizeAc: (normalized: number, channel: number) => number =
    coarse || originalDarkAc ? rateAwareAc : Math.round
  const epfMaximumSharpness = channels === 4 ? 2 : 3
  let epfSharpnessMap =
    blockStrategyMap &&
    distance >= 2 &&
    (channels !== 4 || (effort === 7 && moderateSdrDc)) &&
    colorTransfer.kind === 'srgb' &&
    primaryCode === 1
      ? allocateJpegXlArray(memory, Uint8Array, fullBlockWidth * fullBlockHeight)
      : undefined
  if (blockStrategyMap) {
    const alternatePolicy = strategyPolicy === 'rate-distortion'
    const errors = allocateJpegXlArray(memory, Float32Array, 3)
    const baselineErrors = allocateJpegXlArray(memory, Float32Array, 3)
    const coefficientErrors = allocateJpegXlArray(memory, Float32Array, 64)
    // Compare estimated token cost only when every coding channel's reconstructed
    // error is no worse than DCT8. Hornuss is not orthogonal, so its error is
    // reconstructed algebraically; rectangular halves have half-block weights.
    const measureStrategy = (strategy: number, localScale: number): number => {
      let bits = 0
      for (let channel = 0; channel < 3; channel++) {
        const plane = planes[channel],
          table = strategyTables(strategy)[channel]
        if (!plane || !table) throw invalidInput('Missing strategy plane')
        transform(strategy, plane)
        let squared = 0,
          nonzero = 0,
          lastNonzero = 0
        coefficientErrors[0] = 0
        for (let position = 1; position < 64; position++) {
          const step = localScale * (table[position] ?? 0)
          const value = quantizeAc((transformed[position] ?? 0) / step, channel)
          if (Math.abs(value) > 4095) return Infinity
          const decoded =
            value === 0
              ? 0
              : Math.abs(value) === 1
                ? Math.sign(value) * (defaultJpegXlQuantizationBiases[channel] ?? 1)
                : value - 0.145 / value
          const error = (transformed[position] ?? 0) - decoded * step
          coefficientErrors[position] = error
          squared +=
            error * error * ((strategy === 12 || strategy === 13) && position !== 8 ? 0.5 : 1)
          if (value !== 0) {
            bits += 1 + 2 * Math.log2(1 + Math.abs(value))
            if (alternatePolicy) {
              nonzero++
              lastNonzero = Math.max(lastNonzero, naturalAcScanRank[position] ?? 0)
            }
          }
        }
        // The alternate estimate includes zero tokens up to the final nonzero.
        if (alternatePolicy) bits += 0.4 * (lastNonzero - nonzero)
        if (strategy === 1) {
          squared = 0
          const c01 = coefficientErrors[1] ?? 0,
            c10 = coefficientErrors[8] ?? 0,
            c11 = coefficientErrors[9] ?? 0
          for (let cellY = 0; cellY < 2; cellY++)
            for (let cellX = 0; cellX < 2; cellX++) {
              const mean =
                (cellY === 0 ? c01 : -c01) +
                (cellX === 0 ? c10 : -c10) +
                (cellX === cellY ? c11 : -c11)
              let sum = 0,
                squares = 0
              for (let y = 0; y < 4; y++)
                for (let x = 0; x < 4; x++) {
                  if (x === 0 && y === 0) continue
                  const error = coefficientErrors[(cellY + y * 2) * 8 + cellX + x * 2] ?? 0
                  sum += error
                  squares += error * error
                }
              const center = mean - sum / 16
              squared += (squares + 2 * center * sum + 16 * center * center) / 64
            }
        }
        errors[channel] = squared
      }
      return bits
    }
    for (let y = 0; y < fullBlockHeight; y++) {
      for (let x = 0; x < fullBlockWidth; x++) {
        fillCorrelated(x, y)
        const index = y * fullBlockWidth + x
        let localScale = 65536 / globalScale / (blockQuantizationMap[index] ?? blockQuantization)
        errors.fill(Infinity)
        let baselineBits = measureStrategy(0, localScale)
        // Refine excessive loss of local contrast before choosing a transform. Mean-normalized
        // DCT energy equals pixel variance. The floors avoid spending bits on
        // tiny residuals, including decorrelated X chroma.
        // One bounded refinement retains the existing quantizer as the fallback.
        if (effort === 7 && channels === 3 && distance > 1 && distance < 5) {
          let relativeError = 0
          for (let channel = 0; channel < 3; channel++) {
            const plane = planes[channel]
            if (!plane) throw invalidInput('Missing refinement channel')
            let sum = 0,
              squares = 0
            for (let position = 0; position < 64; position++) {
              const sample = plane[position] ?? 0
              sum += sample
              squares += sample * sample
            }
            const variance = Math.max(0, squares / 64 - (sum / 64) ** 2)
            relativeError = Math.max(
              relativeError,
              (errors[channel] ?? 0) / (variance + (channel === 0 ? 0.00000001 : 0.000001)),
            )
          }
          const current = blockQuantizationMap[index] ?? blockQuantization
          const target = Math.min(8, Math.ceil(current * Math.sqrt(relativeError / 0.04)))
          // Fade toward the surrounding quality ranges without a large endpoint jump.
          const strength = Math.min(1, distance - 1, 5 - distance)
          const refined = current + Math.round(Math.max(0, target - current) * strength)
          if (refined > current) {
            blockQuantizationMap[index] = refined
            localScale = 65536 / globalScale / refined
            baselineBits = measureStrategy(0, localScale)
          }
        }
        baselineErrors.set(errors)
        let best = 0,
          selectedError = baselineErrors[1] ?? 0
        if (alternatePolicy) {
          const baselineDistortion =
            2 * (baselineErrors[1] ?? 0) + (baselineErrors[0] ?? 0) + (baselineErrors[2] ?? 0)
          const lambda = (baselineDistortion * 2) / Math.max(8, baselineBits)
          let bestCost = baselineDistortion + lambda * baselineBits
          for (let candidate = 0; candidate < strategyCandidates.length; candidate++) {
            const strategy = strategyCandidates[candidate] ?? 0
            const bits = measureStrategy(strategy, localScale)
            const distortion =
              2 * (errors[1] ?? Infinity) + (errors[0] ?? Infinity) + (errors[2] ?? Infinity)
            const cost = distortion + lambda * (bits + 2)
            if (bits + 2 < baselineBits && cost < bestCost) {
              bestCost = cost
              best = strategy
              selectedError = errors[1] ?? 0
            }
          }
        } else {
          let bestBits = baselineBits
          for (let candidate = 0; candidate < strategyCandidates.length; candidate++) {
            const strategy = strategyCandidates[candidate] ?? 0
            const bits = measureStrategy(strategy, localScale)
            if (
              bits + 2 < bestBits &&
              (errors[0] ?? Infinity) <= (baselineErrors[0] ?? 0) + 1e-12 &&
              (errors[1] ?? Infinity) <= (baselineErrors[1] ?? 0) + 1e-12 &&
              (errors[2] ?? Infinity) <= (baselineErrors[2] ?? 0) + 1e-12
            ) {
              bestBits = bits
              best = strategy
              selectedError = errors[1] ?? 0
            }
          }
        }
        blockStrategyMap[index] = best
        if (epfSharpnessMap) {
          // Map quantization RMS through the normative EPF sigma relationship.
          // 1.17157287525381 is 4 - 2*sqrt(2); development calibration caps strength at 3.
          epfSharpnessMap[index] = Math.min(
            epfMaximumSharpness,
            Math.round(
              (Math.sqrt(selectedError) * 255 * 7 * 1.17157287525381) / (localScale * 0.46),
            ),
          )
        }
      }
      yield
    }
    memory.release(errors)
    memory.release(baselineErrors)
    memory.release(coefficientErrors)
  }
  if (epfSharpnessMap) {
    let active = 0
    for (const sharpness of epfSharpnessMap) active += sharpness > 0 ? 1 : 0
    if (active * 2 < epfSharpnessMap.length) {
      memory.release(epfSharpnessMap)
      epfSharpnessMap = undefined
    }
  }
  const groupsAcross = Math.ceil(fullBlockWidth / 32)
  // Estimate transform cost from natural-order hybrid tokens, zeros and nonzero counts.
  const dct16Eligible = coarse && blockStrategyMap !== undefined
  const dct16Planes = dct16Eligible
    ? Array.from({ length: 3 }, () => allocateJpegXlArray(memory, Float32Array, 256))
    : undefined
  const dct16Intermediate = dct16Eligible
    ? allocateJpegXlArray(memory, Float32Array, 256)
    : undefined
  const dct16Transformed = dct16Eligible
    ? Array.from({ length: 3 }, () => allocateJpegXlArray(memory, Float32Array, 256))
    : undefined
  const fillDct16 = (blockX: number, blockY: number, correlated: boolean): void => {
    if (!dct16Planes) throw invalidInput('Missing DCT16 tile')
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        if (correlated) fillCorrelated(blockX + dx, blockY + dy)
        else fill(blockX + dx, blockY + dy)
        for (let channel = 0; channel < 3; channel++) {
          const source = planes[channel],
            destination = dct16Planes[channel]
          if (!source || !destination) throw invalidInput('Missing DCT16 color')
          for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
              destination[(dy * 8 + y) * 16 + dx * 8 + x] = source[y * 8 + x] ?? 0
        }
      }
  }
  if (dct16Eligible && dct16Planes && dct16Intermediate && dct16Transformed && blockStrategyMap) {
    const counts = allocateJpegXlArray(memory, Uint32Array, 3 * 9 * 256),
      totals = allocateJpegXlArray(memory, Uint32Array, 3 * 9)
    const costs = allocateJpegXlArray(memory, Float64Array, 3 * 9 * 256)
    const quantized8 = allocateJpegXlArray(memory, Int16Array, 3 * 64),
      quantized16 = allocateJpegXlArray(memory, Int16Array, 3 * 256)
    const error8 = allocateJpegXlArray(memory, Float64Array, 3 * 64),
      error16 = allocateJpegXlArray(memory, Float64Array, 3 * 256)
    const baselineError = allocateJpegXlArray(memory, Float64Array, 3),
      candidateError = allocateJpegXlArray(memory, Float64Array, 3)
    const dc16 = allocateJpegXlArray(memory, Int32Array, 3 * 4),
      dcErrors = allocateJpegXlArray(memory, Float64Array, 3)
    const order8 = allocateJpegXlArray(memory, Uint16Array, 64),
      order16 = allocateJpegXlArray(memory, Uint16Array, 256)
    for (let position = 0; position < 64; position++)
      order8[naturalAcScanRank[position] ?? 0] = position
    let nextOrder = 4
    for (let diagonal = 0; diagonal < 31; diagonal++)
      for (let step = 0; step <= diagonal; step++) {
        let x = step,
          y = diagonal - step
        if ((diagonal & 1) !== 0) [x, y] = [y, x]
        if (x >= 16 || y >= 16) continue
        if (x < 2 && y < 2) order16[y * 2 + x] = y * 16 + x
        else order16[nextOrder++] = y * 16 + x
      }
    if (nextOrder !== 256) throw invalidInput('DCT16 rate order incomplete')
    const config = { splitExponent: 3, msbInToken: 1, lsbInToken: 0 }
    const decoded = (value: number, channel: number): number =>
      value === 0
        ? 0
        : Math.abs(value) === 1
          ? Math.sign(value) * (defaultJpegXlQuantizationBiases[channel] ?? 1)
          : value - 0.145 / value
    const tokens = (
      values: Int16Array,
      channel: number,
      order: Uint16Array,
      area: number,
      learn: boolean,
    ): number => {
      const offset = channel * order.length
      let last = area - 1,
        nonzero = 0,
        bits = 0
      for (let scan = area; scan < order.length; scan++)
        if ((values[offset + (order[scan] ?? 0)] ?? 0) !== 0) {
          last = scan
          nonzero++
        }
      const countPacked = encodeHybridUintPacked(nonzero, config),
        countContext = channel * 9 + 8
      if (learn) {
        const at = countContext * 256 + (countPacked & 255)
        counts[at] = (counts[at] ?? 0) + 1
        totals[countContext] = (totals[countContext] ?? 0) + 1
      } else
        bits += (costs[countContext * 256 + (countPacked & 255)] ?? 16) + ((countPacked >>> 8) & 31)
      for (let scan = area; scan <= last; scan++) {
        const value = values[offset + (order[scan] ?? 0)] ?? 0,
          packed = encodeHybridUintPacked(packSigned(value), config),
          context = channel * 9 + Math.min(7, Math.floor(scan / area / 8))
        if (learn) {
          const at = context * 256 + (packed & 255)
          counts[at] = (counts[at] ?? 0) + 1
          totals[context] = (totals[context] ?? 0) + 1
        } else bits += (costs[context * 256 + (packed & 255)] ?? 16) + ((packed >>> 8) & 31)
      }
      return bits
    }
    const quantize8 = (x: number, y: number): void => {
      fillCorrelated(x, y)
      const scale =
        65536 / globalScale / (blockQuantizationMap[y * fullBlockWidth + x] ?? blockQuantization)
      for (let channel = 0; channel < 3; channel++) {
        const plane = planes[channel],
          table = defaultJpegXlDct8Dequantization[channel]
        if (!plane || !table) throw invalidInput('Missing baseline DCT8')
        forwardJpegXlDct8(plane, intermediate, transformed)
        quantized8[channel * 64] = 0
        error8[channel * 64] = 0
        for (let position = 1; position < 64; position++) {
          const step = scale * (table[position] ?? 0),
            value = quantizeAc((transformed[position] ?? 0) / step, channel)
          if (Math.abs(value) > 4095)
            throw unsupportedOperation('JPEG XL DCT8 AC coefficient exceeds 4095')
          quantized8[channel * 64 + position] = value
          error8[channel * 64 + position] =
            (transformed[position] ?? 0) - decoded(value, channel) * step
        }
      }
    }
    for (let y = 0; y < fullBlockHeight; y++) {
      for (let x = 0; x < fullBlockWidth; x++)
        if (blockStrategyMap[y * fullBlockWidth + x] === 0) {
          quantize8(x, y)
          for (let channel = 0; channel < 3; channel++) tokens(quantized8, channel, order8, 1, true)
        }
      yield
    }
    for (let context = 0; context < 27; context++)
      for (let token = 0; token < 256; token++)
        costs[context * 256 + token] = Math.log2(
          ((totals[context] ?? 0) + 256) / ((counts[context * 256 + token] ?? 0) + 1),
        )
    const resampleScale =
      1 / (Math.cos(Math.PI / 32) * Math.cos(Math.PI / 16) * Math.cos(Math.PI / 8))
    for (let y = 0; y + 1 < fullBlockHeight; y += 2) {
      for (let x = 0; x + 1 < fullBlockWidth; x += 2) {
        const at = y * fullBlockWidth + x
        if (
          blockStrategyMap[at] !== 0 ||
          blockStrategyMap[at + 1] !== 0 ||
          blockStrategyMap[at + fullBlockWidth] !== 0 ||
          blockStrategyMap[at + fullBlockWidth + 1] !== 0
        )
          continue
        baselineError.fill(0)
        const tile = Math.floor(y / 8) * colorTilesAcross + Math.floor(x / 8),
          ratioX = (colorCorrelationX[tile] ?? 0) / 84,
          ratioB = (colorCorrelationB[tile] ?? 0) / 84
        let baselineBits = 0
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) {
            quantize8(x + dx, y + dy)
            for (let channel = 0; channel < 3; channel++)
              baselineBits += tokens(quantized8, channel, order8, 1, false)
            for (let position = 1; position < 64; position++) {
              const ey = error8[64 + position] ?? 0,
                ex = (error8[position] ?? 0) + ratioX * ey,
                eb = (error8[128 + position] ?? 0) + ratioB * ey
              baselineError[0] = (baselineError[0] ?? 0) + (ex * ex) / 4
              baselineError[1] = (baselineError[1] ?? 0) + (ey * ey) / 4
              baselineError[2] = (baselineError[2] ?? 0) + (eb * eb) / 4
            }
            fill(x + dx, y + dy)
            for (let channel = 0; channel < 3; channel++) {
              const plane = planes[channel],
                component = components[channel]
              if (!plane || !component) throw invalidInput('Missing baseline DC')
              let sum = 0
              for (let p = 0; p < 64; p++) sum += plane[p] ?? 0
              const error =
                sum / 64 -
                (component.coefficients[(y + dy) * fullBlockWidth + x + dx] ?? 0) *
                  effectiveDistance *
                  (dcQuantization[channel] ?? 0)
              baselineError[channel] = (baselineError[channel] ?? 0) + (error * error) / 4
            }
          }
        fillDct16(x, y, false)
        for (let channel = 0; channel < 3; channel++) {
          const plane = dct16Planes[channel],
            coefficients = dct16Transformed[channel]
          if (!plane || !coefficients) throw invalidInput('Missing candidate DC')
          forwardJpegXlDct16(plane, dct16Intermediate, coefficients)
          const c00 = coefficients[0] ?? 0,
            c10 = (coefficients[16] ?? 0) / resampleScale,
            c01 = (coefficients[1] ?? 0) / resampleScale,
            c11 = (coefficients[17] ?? 0) / (resampleScale * resampleScale),
            step = effectiveDistance * (dcQuantization[channel] ?? 0)
          const a = Math.round((c00 + c10 + c01 + c11) / step),
            b = Math.round((c00 - c10 + c01 - c11) / step),
            c = Math.round((c00 + c10 - c01 - c11) / step),
            d = Math.round((c00 - c10 - c01 + c11) / step)
          dc16[channel * 4] = a
          dc16[channel * 4 + 1] = b
          dc16[channel * 4 + 2] = c
          dc16[channel * 4 + 3] = d
          dcErrors[channel] =
            (c00 - ((a + b + c + d) * step) / 4) ** 2 +
            ((coefficients[16] ?? 0) - ((a - b + c - d) * step * resampleScale) / 4) ** 2 +
            ((coefficients[1] ?? 0) - ((a + b - c - d) * step * resampleScale) / 4) ** 2 +
            ((coefficients[17] ?? 0) -
              ((a - b - c + d) * step * resampleScale * resampleScale) / 4) **
              2
        }
        fillDct16(x, y, true)
        for (let channel = 0; channel < 3; channel++) {
          const plane = dct16Planes[channel],
            coefficients = dct16Transformed[channel]
          if (!plane || !coefficients) throw invalidInput('Missing candidate AC')
          forwardJpegXlDct16(plane, dct16Intermediate, coefficients)
        }
        let bestBits = baselineBits * 0.97 - 2,
          bestQuantizer = 0
        for (let quantizerIndex = 0; quantizerIndex < dct16Quantizers.length; quantizerIndex++) {
          const quantizer = dct16Quantizers[quantizerIndex] ?? 4
          const scale = 65536 / globalScale / quantizer
          let inRange = true
          quantized16.fill(0)
          error16.fill(0)
          candidateError.set(dcErrors)
          for (let channel = 0; channel < 3; channel++) {
            const coefficients = dct16Transformed[channel],
              table = defaultJpegXlDct16Dequantization[channel]
            if (!coefficients || !table) throw invalidInput('Missing DCT16 matrix')
            for (let p = 0; p < 256; p++) {
              if (p >>> 4 < 2 && (p & 15) < 2) continue
              const step = scale * (table[p] ?? 0),
                value = quantizeAc((coefficients[p] ?? 0) / step, channel)
              if (Math.abs(value) > 4095) {
                inRange = false
                break
              }
              quantized16[channel * 256 + p] = value
              error16[channel * 256 + p] = (coefficients[p] ?? 0) - decoded(value, channel) * step
            }
          }
          if (!inRange) continue
          for (let p = 0; p < 256; p++) {
            const ey = error16[256 + p] ?? 0,
              ex = (error16[p] ?? 0) + ratioX * ey,
              eb = (error16[512 + p] ?? 0) + ratioB * ey
            candidateError[0] = (candidateError[0] ?? 0) + ex * ex
            candidateError[1] = (candidateError[1] ?? 0) + ey * ey
            candidateError[2] = (candidateError[2] ?? 0) + eb * eb
          }
          if (
            (candidateError[0] ?? Infinity) > (baselineError[0] ?? 0) + 1e-15 ||
            (candidateError[1] ?? Infinity) > (baselineError[1] ?? 0) + 1e-15 ||
            (candidateError[2] ?? Infinity) > (baselineError[2] ?? 0) + 1e-15
          )
            continue
          let bits = 0
          for (let channel = 0; channel < 3; channel++)
            bits += tokens(quantized16, channel, order16, 4, false)
          if (bits < bestBits) {
            bestBits = bits
            bestQuantizer = quantizer
          }
        }
        if (bestQuantizer === 0) continue
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) {
            const index = (y + dy) * fullBlockWidth + x + dx
            blockStrategyMap[index] = 4
            blockQuantizationMap[index] = bestQuantizer
            for (let channel = 0; channel < 3; channel++) {
              const component = components[channel]
              if (!component) throw invalidInput('Missing selected DC')
              component.coefficients[index] = dc16[channel * 4 + dy * 2 + dx] ?? 0
            }
          }
      }
      yield
    }
    for (const scratch of [
      counts,
      totals,
      costs,
      quantized8,
      quantized16,
      error8,
      error16,
      baselineError,
      candidateError,
      dc16,
      dcErrors,
      order8,
      order16,
    ])
      memory.release(scratch)
  }
  const hasDct16 = blockStrategyMap?.includes(4) ?? false
  const groupCoefficientOffsets = hasDct16
    ? allocateJpegXlArray(memory, Int32Array, 32 * 32)
    : undefined
  const acStorage = Array.from({ length: 3 }, () =>
    allocateJpegXlArray(memory, Int16Array, 32 * 32 * 64),
  )
  const fastAcInverse =
    effort === 1
      ? defaultJpegXlDct8Dequantization.map((table) => {
          const inverse = allocateJpegXlArray(memory, Float32Array, 64)
          for (let position = 1; position < 64; position++)
            inverse[position] = 1 / (effectiveDistance * (table[position] ?? 0))
          return inverse
        })
      : undefined
  const fillAcGroup = (group: number): readonly VarDctCoefficientPlane[] => {
    const originX = (group % groupsAcross) * 32
    const originY = Math.floor(group / groupsAcross) * 32
    const blocksAcross = Math.min(32, fullBlockWidth - originX)
    const blocksDown = Math.min(32, fullBlockHeight - originY)
    groupCoefficientOffsets?.fill(-1, 0, blocksAcross * blocksDown)
    let cursor = 0
    for (let y = 0; y < blocksDown; y++) {
      for (let x = 0; x < blocksAcross; x++) {
        const globalIndex = (originY + y) * fullBlockWidth + originX + x,
          strategy = blockStrategyMap?.[globalIndex] ?? 0
        if (strategy === 4 && ((x & 1) !== 0 || (y & 1) !== 0)) continue
        const localIndex = y * blocksAcross + x,
          offset = groupCoefficientOffsets ? cursor : localIndex * 64
        if (groupCoefficientOffsets) {
          groupCoefficientOffsets[localIndex] = offset
          cursor += strategy === 4 ? 256 : 64
        }
        const localScale =
          65536 / globalScale / (blockQuantizationMap[globalIndex] ?? blockQuantization)
        if (strategy === 4) {
          if (!dct16Planes || !dct16Intermediate || !dct16Transformed)
            throw invalidInput('Missing DCT16 group scratch')
          fillDct16(originX + x, originY + y, true)
          for (let channel = 0; channel < 3; channel++) {
            const plane = dct16Planes[channel],
              coefficients = dct16Transformed[channel],
              destination = acStorage[channel],
              table = defaultJpegXlDct16Dequantization[channel]
            if (!plane || !coefficients || !destination || !table)
              throw invalidInput('Missing DCT16 group color')
            forwardJpegXlDct16(plane, dct16Intermediate, coefficients)
            destination.fill(0, offset, offset + 256)
            for (let p = 0; p < 256; p++) {
              if (p >>> 4 < 2 && (p & 15) < 2) continue
              const value = quantizeAc(
                (coefficients[p] ?? 0) / (localScale * (table[p] ?? 0)),
                channel,
              )
              if (Math.abs(value) > 4095) throw unsupportedOperation('DCT16 AC range')
              destination[offset + p] = value
            }
          }
          continue
        }
        fillCorrelated(originX + x, originY + y)

        for (let channel = 0; channel < 3; channel++) {
          const plane = planes[channel]
          const destination = acStorage[channel]
          const table = strategyTables(strategy)[channel]
          if (!plane || !destination || !table)
            throw invalidJpegXlInput('forward AC channel is missing')
          if (deferredDcGroups) {
            const component = components[channel]
            if (!component) throw invalidJpegXlInput('forward DC channel is missing')
            let sum = 0
            for (let position = 0; position < 64; position++) sum += plane[position] ?? 0
            component.coefficients[(originY + y) * fullBlockWidth + originX + x] = Math.round(
              sum / (64 * effectiveDistance * (dcQuantization[channel] ?? 0)),
            )
          }
          transform(strategy, plane)
          destination[offset] = 0
          const inverse = fastAcInverse?.[channel]
          for (let position = 1; position < 64; position++) {
            const value = quantizeAc(
              inverse
                ? (transformed[position] ?? 0) * (inverse[position] ?? 0)
                : (transformed[position] ?? 0) / (localScale * (table[position] ?? 0)),
              channel,
            )
            if (value < -4095 || value > 4095)
              throw unsupportedOperation('JPEG XL AC coefficient exceeds range')
            destination[offset + (position & 7) * 8 + (position >>> 3)] = value
          }
        }
      }
    }
    return acStorage.map((coefficients) => ({
      blocksPerLineForMcu: blocksAcross,
      blocksPerColumnForMcu: blocksDown,
      coefficients,
      ...(groupCoefficientOffsets
        ? { coefficientOffsets: groupCoefficientOffsets.subarray(0, blocksAcross * blocksDown) }
        : {}),
    }))
  }
  const passStorage = progressive
    ? acStorage.map(() => allocateJpegXlArray(memory, Int16Array, 32 * 32 * 64))
    : undefined
  let cachedGroup = -1
  let cachedPlanes: readonly VarDctCoefficientPlane[] = []
  const loadAcGroup = passStorage
    ? (group: number, pass: number): readonly VarDctCoefficientPlane[] => {
        if (cachedGroup !== group) {
          cachedPlanes = fillAcGroup(group)
          cachedGroup = group
        }
        return cachedPlanes.map((plane, channel) => {
          const destination = passStorage[channel]
          if (!destination) throw invalidJpegXlInput('progressive channel is missing')
          const count = plane.blocksPerLineForMcu * plane.blocksPerColumnForMcu * 64
          destination.set(plane.coefficients.subarray(0, count))
          if (pass === 0) {
            for (let block = 0; block < count; block += 64) {
              for (let y = 0; y < 4; y++) destination.fill(0, block + y * 8 + 4, block + y * 8 + 8)
              destination.fill(0, block + 32, block + 64)
            }
          } else {
            for (let block = 0; block < count; block += 64)
              for (let y = 0; y < 4; y++) destination.fill(0, block + y * 8, block + y * 8 + 4)
          }
          return { ...plane, coefficients: destination }
        })
      }
    : (group: number): readonly VarDctCoefficientPlane[] => {
        if (cachedGroup !== group) {
          cachedPlanes = fillAcGroup(group)
          cachedGroup = group
        }
        return cachedPlanes
      }
  const first = components[0]
  const second = components[1]
  const third = components[2]
  if (!first || !second || !third) throw invalidJpegXlInput('forward channel mapping is missing')
  const alphaStorage =
    channels === 4 ? allocateJpegXlArray(memory, Int32Array, 256 * 256) : undefined
  const alpha = alphaStorage
    ? {
        paletteSearch: alphaPaletteSearch,
        loadGroup: (group: number) => {
          const originX = (group % groupsAcross) * 256
          const originY = Math.floor(group / groupsAcross) * 256
          const groupWidth = Math.min(256, width - originX)
          const groupHeight = Math.min(256, height - originY)
          for (let y = 0; y < groupHeight; y++) {
            for (let x = 0; x < groupWidth; x++) {
              const offset = (((originY + y) * width + originX + x) * 4 + 3) * sampleBytes
              alphaStorage[y * groupWidth + x] =
                sampleBytes === 1
                  ? (pixels[offset] ?? 0)
                  : ((pixels[offset] ?? 0) << 8) | (pixels[offset + 1] ?? 0)
            }
          }
          return {
            width: groupWidth,
            height: groupHeight,
            values: alphaStorage.subarray(0, groupWidth * groupHeight),
          }
        },
      }
    : undefined
  const geometry: VarDctCoefficientGeometry = {
    colorTransform: 'xyb',
    forwardAcIterationSearch: originalDarkAc || originalPhotoAc,
    forwardAdvancedModularSearch:
      coarse ||
      (compressionSearch && sdrAlpha && rgbDcPolicy && width * height > 4_194_304 && !progressive),
    ...(blockStrategyMap ? { blockStrategyMap } : {}),
    ...(epfSharpnessMap ? { epfSharpnessMap } : {}),
    chromaSubsampling: [0, 0, 0],
    shifts: [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    fullBlockWidth,
    fullBlockHeight,
    groupsAcross,
    groupsDown: Math.ceil(fullBlockHeight / 32),
    dcGroupsAcross: Math.ceil(fullBlockWidth / 256),
    dcGroupsDown: Math.ceil(fullBlockHeight / 256),
    internalComponents: components,
    dcPlaneComponents: [second, first, third],
    quantization,
    dcQuantization,
    ...(moderateAlphaDc ? { adaptiveLfSmoothing: true } : {}),
    defaultQuantization: true,
    globalScale,
    blockQuantization,
    quantDc: blockQuantization,
    blockQuantizationMap,
    colorCorrelationX,
    colorCorrelationB,
    effort,
    progressive,
    baseCorrelationB: 1,
    loadAcGroup,
    deferredDcGroups,
    memory,
    ...(alpha ? { alpha } : {}),
    ...(imageHeader ? { imageHeader } : {}),
  }
  return geometry
}
