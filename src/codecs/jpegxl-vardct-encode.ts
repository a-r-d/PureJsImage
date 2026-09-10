import type { PixelColorSemantics } from '../color.ts'
import { invalidInput, unsupportedOperation } from '../errors.ts'
import { defaultImageLimits, validateImageDimensions } from '../limits.ts'
import { nclxToLinear, nclxToLinearSrgbMatrix } from './icc.ts'
import {
  allocateJpegXlArray,
  JpegXlEncoderMemory,
  withJpegXlMemory,
  withJpegXlMemoryAsync,
} from './jpegxl-encoder-memory.ts'
import {
  encodeVarDctCoefficientSections,
  encodeVarDctCoefficientSectionsAsync,
  type VarDctCoefficientGeometry,
  type VarDctCoefficientPlane,
  varDctCodestreamParts,
} from './jpegxl-jpeg-encode.ts'
import {
  defaultJpegXlDct4x8Dequantization,
  defaultJpegXlDct8Dequantization,
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

import {
  forwardJpegXlDct8,
  forwardJpegXlDctHalves,
  forwardJpegXlHornuss,
} from './jpegxl-vardct-forward-transforms.ts'

export { forwardJpegXlDct8 } from './jpegxl-vardct-forward-transforms.ts'

const strategyCandidates = Uint8Array.of(1, 12, 13)

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
    return withJpegXlMemory(owned, () => {
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
      )
      let next = steps.next()
      while (!next.done) next = steps.next()
      const geometry = next.value
      return varDctCodestreamParts(
        { width, height },
        geometry,
        encodeVarDctCoefficientSections(geometry),
      )
    })
  } finally {
    if (!memory) owned.close()
  }
}

export const encodeJpegXlVarDct8Async = (
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
    return varDctCodestreamParts({ width, height }, geometry, sections)
  })

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
): Generator<void, VarDctCoefficientGeometry, undefined> {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw invalidInput('JPEG XL dimensions must be positive safe integers')
  if (!Number.isInteger(sampleDepth) || sampleDepth < 8 || sampleDepth > 16)
    throw invalidInput('JPEG XL forward sample depth must be between 8 and 16')
  const sampleBytes = color?.storageBytes ?? (sampleDepth === 8 ? 1 : 2)
  if ((sampleDepth !== 8 || sampleBytes === 2 || channels === 1) && !imageHeader)
    throw invalidInput('JPEG XL high-depth and grayscale encoding require an explicit image header')
  validateImageDimensions(width, height, channels * sampleBytes, defaultImageLimits)
  if (pixels.length !== width * height * channels * sampleBytes)
    throw invalidInput('JPEG XL RGB8 extent is inconsistent')
  if (!Number.isFinite(distance) || distance < 0.25 || distance > 25)
    throw invalidInput('JPEG XL forward conformance distance must be between 0.25 and 25')
  const blockQuantization = 4
  const globalScale = Math.round(65536 / (distance * blockQuantization))
  const effectiveDistance = 65536 / globalScale / blockQuantization
  // Keep fine DC precision for high-quality, alpha and native-depth output.
  // Modest channel-specific steps reduce SDR DC payload without coarse color blocks.
  const moderateSdrDc =
    distance > 1 &&
    effort !== 1 &&
    channels === 3 &&
    sampleDepth === 8 &&
    sampleBytes === 1 &&
    (color?.primaries ?? 'srgb') === 'srgb' &&
    (color?.transfer.kind ?? 'srgb') === 'srgb'
  const dcQuantization = moderateSdrDc
    ? [1 / 16384, 1 / 4096, 1 / 2048]
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
    const transferCode = colorTransfer.kind === 'linear' ? 8 : colorTransfer.kind === 'pq' ? 16 : 13
    for (let value = 0; value <= maximum; value++) {
      const encoded = value / maximum
      transfer[value] =
        colorTransfer.kind === 'gamma'
          ? encoded ** colorTransfer.exponent
          : nclxToLinear(transferCode, encoded) * (colorTransfer.kind === 'pq' ? 203 / 255 : 1)
    }
  }
  const matrix =
    primaryCode === 1 ? defaultForwardMatrix : allocateJpegXlArray(memory, Float32Array, 9)
  if (matrix !== defaultForwardMatrix) {
    const sourceMatrix = nclxToLinearSrgbMatrix(primaryCode)
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
  // Select the storage kernel once. Grayscale never expands to an RGB bitmap.
  const fillColor =
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
        ? (blockX: number, blockY: number) =>
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
        if (!plane || !component) throw invalidInput('JPEG XL forward channel is missing')
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
        blockQuantizationMap[offset] = yy < 0.000064 || activity < 0.15 ? 6 : 4
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
  const fillCorrelated = (blockX: number, blockY: number): void => {
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
  let epfSharpnessMap =
    blockStrategyMap &&
    distance >= 2 &&
    channels !== 4 &&
    colorTransfer.kind === 'srgb' &&
    primaryCode === 1
      ? allocateJpegXlArray(memory, Uint8Array, fullBlockWidth * fullBlockHeight)
      : undefined
  if (blockStrategyMap) {
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
        let squared = 0
        coefficientErrors[0] = 0
        for (let position = 1; position < 64; position++) {
          const step = localScale * (table[position] ?? 0)
          const value = Math.round((transformed[position] ?? 0) / step)
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
          if (value !== 0) bits += 1 + 2 * Math.log2(1 + Math.abs(value))
        }
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
        const localScale = 65536 / globalScale / (blockQuantizationMap[index] ?? blockQuantization)
        errors.fill(Infinity)
        let bestBits = measureStrategy(0, localScale),
          best = 0,
          selectedError = errors[1] ?? 0
        baselineErrors.set(errors)
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
        blockStrategyMap[index] = best
        if (epfSharpnessMap) {
          // Map quantization RMS through the normative EPF sigma relationship.
          // 1.17157287525381 is 4 - 2*sqrt(2); development calibration caps strength at 3.
          epfSharpnessMap[index] = Math.min(
            3,
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
  const acStorage = Array.from({ length: 3 }, () =>
    allocateJpegXlArray(memory, Int16Array, 32 * 32 * 64),
  )
  const fillAcGroup = (group: number): readonly VarDctCoefficientPlane[] => {
    const originX = (group % groupsAcross) * 32
    const originY = Math.floor(group / groupsAcross) * 32
    const blocksAcross = Math.min(32, fullBlockWidth - originX)
    const blocksDown = Math.min(32, fullBlockHeight - originY)
    for (let y = 0; y < blocksDown; y++) {
      for (let x = 0; x < blocksAcross; x++) {
        fillCorrelated(originX + x, originY + y)
        const strategy = blockStrategyMap?.[(originY + y) * fullBlockWidth + originX + x] ?? 0
        const localScale =
          65536 /
          globalScale /
          (blockQuantizationMap[(originY + y) * fullBlockWidth + originX + x] ?? blockQuantization)
        const offset = (y * blocksAcross + x) * 64
        for (let channel = 0; channel < 3; channel++) {
          const plane = planes[channel]
          const destination = acStorage[channel]
          const table = strategyTables(strategy)[channel]
          if (!plane || !destination || !table)
            throw invalidInput('JPEG XL forward AC channel is missing')
          if (deferredDcGroups) {
            const component = components[channel]
            if (!component) throw invalidInput('JPEG XL forward DC channel is missing')
            let sum = 0
            for (let position = 0; position < 64; position++) sum += plane[position] ?? 0
            component.coefficients[(originY + y) * fullBlockWidth + originX + x] = Math.round(
              sum / (64 * effectiveDistance * (dcQuantization[channel] ?? 0)),
            )
          }
          transform(strategy, plane)
          for (let position = 1; position < 64; position++) {
            const value = Math.round(
              (transformed[position] ?? 0) / (localScale * (table[position] ?? 0)),
            )
            if (value < -4095 || value > 4095)
              throw unsupportedOperation(
                'JPEG XL forward AC coefficient exceeds the entropy subset',
              )
            destination[offset + (position & 7) * 8 + (position >>> 3)] = value
          }
        }
      }
    }
    return acStorage.map((coefficients) => ({
      blocksPerLineForMcu: blocksAcross,
      blocksPerColumnForMcu: blocksDown,
      coefficients,
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
          if (!destination) throw invalidInput('JPEG XL progressive channel is missing')
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
  if (!first || !second || !third) throw invalidInput('JPEG XL forward channel mapping is missing')
  const alphaStorage =
    channels === 4 ? allocateJpegXlArray(memory, Int32Array, 256 * 256) : undefined
  const alpha = alphaStorage
    ? {
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
