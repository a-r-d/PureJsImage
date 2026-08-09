import { invalidInput, unsupportedOperation } from '../errors.ts'
import type { Av1SymbolDecoder } from './av1-symbol.ts'
import { coefficientQ0Defaults } from './av1-coeff-q0.ts'
import { coefficientQ1Defaults, coefficientQ3Defaults } from './av1-coeff-q1-q3.ts'
import { coefficientQ2Defaults } from './av1-coeff-q2.ts'
import { av1LargeScans } from './av1-scans.ts'

const defaultScan4x4 = [0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15] as const
const defaultScan8x8 = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
  13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52,
  45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
] as const
const defaultScan4x8 = [
  0, 1, 4, 2, 5, 8, 3, 6, 9, 12, 7, 10, 13, 16, 11, 14, 17, 20, 15, 18, 21, 24, 19, 22, 25, 28, 23,
  26, 29, 27, 30, 31,
] as const
const defaultScan8x4 = [
  0, 8, 1, 16, 9, 2, 24, 17, 10, 3, 25, 18, 11, 4, 26, 19, 12, 5, 27, 20, 13, 6, 28, 21, 14, 7, 29,
  22, 15, 30, 23, 31,
] as const
const significantOffsets = [
  [0, 1],
  [1, 0],
  [1, 1],
  [0, 2],
  [2, 0],
] as const
const magnitudeOffsets = [
  [0, 1],
  [1, 0],
  [1, 1],
] as const
const significantOffsetsByClass = [
  significantOffsets,
  [
    [0, 1],
    [1, 0],
    [0, 2],
    [0, 3],
    [0, 4],
  ],
  [
    [0, 1],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
  ],
] as const
const magnitudeOffsetsByClass = [
  magnitudeOffsets,
  [
    [0, 1],
    [1, 0],
    [0, 2],
  ],
  [
    [0, 1],
    [1, 0],
    [2, 0],
  ],
] as const
const coefficientContextOffsets = [
  [0, 1, 6, 6, 21],
  [1, 6, 6, 21, 21],
  [6, 6, 21, 21, 21],
  [6, 21, 21, 21, 21],
  [21, 21, 21, 21, 21],
] as const

const makeCdf = (values: readonly number[]): Uint16Array => new Uint16Array(values)
const dcSignDefaults = [
  [16000, 13056, 18816],
  [15232, 12928, 17280],
] as const
const transformClass = (transformType: number): 0 | 1 | 2 => {
  if (transformType === 11 || transformType === 13 || transformType === 15) return 1
  if (transformType === 10 || transformType === 12 || transformType === 14) return 2
  return 0
}

const transformSizeContext = (width: CoefficientDimension, height: CoefficientDimension): number =>
  (Math.log2(width >> 2) + Math.log2(height >> 2) + 1) >> 1

type CoefficientDimension = 4 | 8 | 16 | 32 | 64
const generatedScans = new Map<number, Uint16Array>()

const generatedScan = (
  width: CoefficientDimension,
  height: CoefficientDimension,
  txClass: 1 | 2,
): Uint16Array => {
  const key = width * 1024 + height * 4 + txClass
  const cached = generatedScans.get(key)
  if (cached) return cached
  const scan = new Uint16Array(width * height)
  if (txClass === 1) {
    for (let index = 0; index < scan.length; index += 1) {
      scan[index] = (index % height) * width + Math.floor(index / height)
    }
  } else {
    for (let index = 0; index < scan.length; index += 1) scan[index] = index
  }
  generatedScans.set(key, scan)
  return scan
}

const scanFor = (
  width: CoefficientDimension,
  height: CoefficientDimension,
  transformType: number,
): ArrayLike<number> => {
  const txClass = transformClass(transformType)
  if (txClass === 1 || txClass === 2) return generatedScan(width, height, txClass)
  if (width === 4 && height === 4) return defaultScan4x4
  if (width === 8 && height === 8) return defaultScan8x8
  if (width === 4 && height === 8) return defaultScan4x8
  if (width === 8 && height === 4) return defaultScan8x4
  if (width === 4 && height === 16) return av1LargeScans.default4x16
  if (width === 16 && height === 4) return av1LargeScans.default16x4
  if (width === 8 && height === 16) return av1LargeScans.default8x16
  if (width === 16 && height === 8) return av1LargeScans.default16x8
  if (width === 16 && height === 16) return av1LargeScans.default16x16
  if (width === 8 && height === 32) return av1LargeScans.default8x32
  if (width === 32 && height === 8) return av1LargeScans.default32x8
  if (width === 16 && height === 32) return av1LargeScans.default16x32
  if (width === 32 && height === 16) return av1LargeScans.default32x16
  if (width === 32 && height === 32) return av1LargeScans.default32x32
  throw unsupportedOperation(`AV1 ${width}x${height} coefficient scan`)
}

export interface Av1CoefficientBlock {
  readonly coefficients: Int32Array
  readonly dcCategory: number
  readonly eob: number
  readonly levelContext: number
}

export class Av1CoefficientDecoder {
  readonly #symbols: Av1SymbolDecoder
  readonly #quantizerContext: number
  readonly #eobPoint4x4: readonly (readonly Uint16Array[])[]
  readonly #eobPoint4x8: readonly (readonly Uint16Array[])[]
  readonly #eobPoint8x8: readonly (readonly Uint16Array[])[]
  readonly #eobPoint8x16: readonly (readonly Uint16Array[])[]
  readonly #eobPoint16x16: readonly (readonly Uint16Array[])[]
  readonly #eobPoint16x32: readonly (readonly Uint16Array[])[]
  readonly #eobPoint32x32: readonly (readonly Uint16Array[])[]
  readonly #eobExtra4x4: readonly (readonly Uint16Array[])[]
  readonly #eobExtra8x8: readonly (readonly Uint16Array[])[]
  readonly #eobExtra16x16: readonly (readonly Uint16Array[])[]
  readonly #eobExtra32x32: readonly (readonly Uint16Array[])[]
  readonly #eobExtra64x64: readonly (readonly Uint16Array[])[]
  readonly #dcSign = dcSignDefaults.map((plane) => plane.map((value) => makeCdf([value, 32768, 0])))
  readonly #baseEob4x4: readonly (readonly Uint16Array[])[]
  readonly #baseEob8x8: readonly (readonly Uint16Array[])[]
  readonly #baseEob16x16: readonly (readonly Uint16Array[])[]
  readonly #baseEob32x32: readonly (readonly Uint16Array[])[]
  readonly #baseEob64x64: readonly (readonly Uint16Array[])[]
  readonly #base4x4: readonly (readonly Uint16Array[])[]
  readonly #base8x8: readonly (readonly Uint16Array[])[]
  readonly #base16x16: readonly (readonly Uint16Array[])[]
  readonly #base32x32: readonly (readonly Uint16Array[])[]
  readonly #base64x64: readonly (readonly Uint16Array[])[]
  readonly #range4x4: readonly (readonly Uint16Array[])[]
  readonly #range8x8: readonly (readonly Uint16Array[])[]
  readonly #range16x16: readonly (readonly Uint16Array[])[]
  readonly #range32x32: readonly (readonly Uint16Array[])[]
  constructor(symbols: Av1SymbolDecoder, quantizerContext: number) {
    this.#symbols = symbols
    this.#quantizerContext = quantizerContext
    const defaults =
      quantizerContext === 0
        ? coefficientQ0Defaults
        : quantizerContext === 1
          ? coefficientQ1Defaults
          : quantizerContext === 2
            ? coefficientQ2Defaults
            : coefficientQ3Defaults
    this.#eobPoint4x4 = defaults.eob4.map((plane) => plane.map(makeCdf))
    this.#eobPoint4x8 = defaults.eob4x8.map((plane) => plane.map(makeCdf))
    this.#eobPoint8x8 = defaults.eob8.map((plane) => plane.map(makeCdf))
    this.#eobPoint8x16 = defaults.eob8x16.map((plane) => plane.map(makeCdf))
    this.#eobPoint16x16 = defaults.eob16.map((plane) => plane.map(makeCdf))
    this.#eobPoint16x32 = defaults.eob16x32.map((plane) => [makeCdf(plane)])
    this.#eobPoint32x32 = defaults.eob32.map((plane) => [makeCdf(plane)])
    this.#eobExtra4x4 = defaults.extra4.map((plane) => plane.map(makeCdf))
    this.#eobExtra8x8 = defaults.extra8.map((plane) => plane.map(makeCdf))
    this.#eobExtra16x16 = defaults.extra16.map((plane) => plane.map(makeCdf))
    this.#eobExtra32x32 = defaults.extra32.map((plane) => plane.map(makeCdf))
    this.#eobExtra64x64 = defaults.extra64.map((plane) => plane.map(makeCdf))
    this.#baseEob4x4 = defaults.baseEob4.map((plane) => plane.map(makeCdf))
    this.#baseEob8x8 = defaults.baseEob8.map((plane) => plane.map(makeCdf))
    this.#baseEob16x16 = defaults.baseEob16.map((plane) => plane.map(makeCdf))
    this.#baseEob32x32 = defaults.baseEob32.map((plane) => plane.map(makeCdf))
    this.#baseEob64x64 = defaults.baseEob64.map((plane) => plane.map(makeCdf))
    this.#base4x4 = defaults.base4.map((plane) => plane.map(makeCdf))
    this.#base8x8 = defaults.base8.map((plane) => plane.map(makeCdf))
    this.#base16x16 = defaults.base16.map((plane) => plane.map(makeCdf))
    this.#base32x32 = defaults.base32.map((plane) => plane.map(makeCdf))
    this.#base64x64 = defaults.base64.map((plane) => plane.map(makeCdf))
    this.#range4x4 = defaults.range4.map((plane) => plane.map(makeCdf))
    this.#range8x8 = defaults.range8.map((plane) => plane.map(makeCdf))
    this.#range16x16 = defaults.range16.map((plane) => plane.map(makeCdf))
    this.#range32x32 = defaults.range32.map((plane) => plane.map(makeCdf))
  }

  read(
    plane: 0 | 1 | 2,
    width: CoefficientDimension,
    height: CoefficientDimension,
    transformType: number,
    dcSignContext = 0,
  ): Av1CoefficientBlock {
    if (this.#quantizerContext < 0 || this.#quantizerContext > 3) {
      throw unsupportedOperation(
        `AV1 nonzero coefficients for quantizer context ${this.#quantizerContext}`,
      )
    }
    if (transformType < 0 || transformType > 15) {
      throw unsupportedOperation(`Phase B2 does not support AV1 transform type ${transformType}`)
    }
    const planeType = plane === 0 ? 0 : 1
    const adjustedWidth = Math.min(width, 32) as 4 | 8 | 16 | 32
    const adjustedHeight = Math.min(height, 32) as 4 | 8 | 16 | 32
    const scan = scanFor(adjustedWidth, adjustedHeight, transformType)
    const area = adjustedWidth * adjustedHeight
    const classContext = transformClass(transformType) === 0 ? 0 : 1
    const eobPoints =
      area === 16
        ? this.#eobPoint4x4
        : area === 32
          ? this.#eobPoint4x8
          : area === 64
            ? this.#eobPoint8x8
            : area === 128
              ? this.#eobPoint8x16
              : area === 256
                ? this.#eobPoint16x16
                : area === 512
                  ? this.#eobPoint16x32
                  : this.#eobPoint32x32
    const eobCdf = eobPoints[planeType]?.[area >= 512 ? 0 : classContext]
    const sizeContext = transformSizeContext(width, height)
    const eobExtra =
      sizeContext === 0
        ? this.#eobExtra4x4
        : sizeContext === 1
          ? this.#eobExtra8x8
          : sizeContext === 2
            ? this.#eobExtra16x16
            : sizeContext === 3
              ? this.#eobExtra32x32
              : this.#eobExtra64x64
    const baseEob =
      sizeContext === 0
        ? this.#baseEob4x4
        : sizeContext === 1
          ? this.#baseEob8x8
          : sizeContext === 2
            ? this.#baseEob16x16
            : sizeContext === 3
              ? this.#baseEob32x32
              : this.#baseEob64x64
    const base =
      sizeContext === 0
        ? this.#base4x4
        : sizeContext === 1
          ? this.#base8x8
          : sizeContext === 2
            ? this.#base16x16
            : sizeContext === 3
              ? this.#base32x32
              : this.#base64x64
    const range =
      sizeContext === 0
        ? this.#range4x4
        : sizeContext === 1
          ? this.#range8x8
          : sizeContext === 2
            ? this.#range16x16
            : this.#range32x32
    if (!eobCdf) throw invalidInput('AV1 EOB CDF is missing')
    const eobPoint = this.#symbols.readSymbol(eobCdf) + 1
    let eob = eobPoint < 2 ? eobPoint : 2 ** (eobPoint - 2) + 1
    if (eobPoint >= 3) {
      const extraCdf = eobExtra[planeType]?.[eobPoint - 3]
      if (!extraCdf) throw invalidInput('AV1 EOB extra CDF is missing')
      const highBit = this.#symbols.readSymbol(extraCdf)
      if (highBit === 1) eob += 2 ** (eobPoint - 3)
      for (let index = 1; index < eobPoint - 2; index += 1) {
        const shift = eobPoint - 3 - index
        const bit = this.#symbols.readBoolean()
        eob += bit * 2 ** shift
      }
    }
    if (eob < 1 || eob > area) throw invalidInput(`Invalid AV1 ${width}x${height} EOB: ${eob}`)

    const coefficients = new Int32Array(area)
    for (let scanIndex = eob - 1; scanIndex >= 0; scanIndex -= 1) {
      const position = scan[scanIndex]
      if (position === undefined) throw invalidInput('AV1 coefficient scan is invalid')
      let level: number
      let coefficientContext: number
      if (scanIndex === eob - 1) {
        coefficientContext =
          scanIndex === 0 ? 0 : scanIndex <= area / 8 ? 1 : scanIndex <= area / 4 ? 2 : 3
        const baseEobCdf = baseEob[planeType]?.[coefficientContext]
        if (!baseEobCdf) throw invalidInput('AV1 coefficient EOB base CDF is missing')
        level = this.#symbols.readSymbol(baseEobCdf) + 1
      } else {
        coefficientContext = this.#baseContext(
          coefficients,
          position,
          adjustedWidth,
          adjustedHeight,
          transformType,
          Math.sign(width - height),
        )
        const baseCdf = base[planeType]?.[coefficientContext]
        if (!baseCdf)
          throw invalidInput(`AV1 coefficient base context ${coefficientContext} is missing`)
        level = this.#symbols.readSymbol(baseCdf)
      }
      if (level > 2) {
        for (let index = 0; index < 4; index += 1) {
          const context = this.#rangeContext(
            coefficients,
            position,
            adjustedWidth,
            adjustedHeight,
            transformType,
          )
          const rangeCdf = range[planeType]?.[context]
          if (!rangeCdf) throw invalidInput(`AV1 coefficient range context ${context} is missing`)
          const extra = this.#symbols.readSymbol(rangeCdf)
          level += extra
          if (extra < 3) break
        }
      }
      coefficients[position] = level
    }

    let dcCategory = 0
    let levelContext = 0
    for (let scanIndex = 0; scanIndex < eob; scanIndex += 1) {
      const position = scan[scanIndex]
      if (position === undefined) throw invalidInput('AV1 coefficient scan is invalid')
      let magnitude = coefficients[position] ?? 0
      if (magnitude === 0) continue
      let sign: number
      if (scanIndex === 0) {
        const signCdf = this.#dcSign[planeType]?.[dcSignContext]
        if (!signCdf) throw invalidInput('AV1 DC sign CDF is missing')
        sign = this.#symbols.readSymbol(signCdf)
      } else sign = this.#symbols.readBoolean()
      if (magnitude > 14) {
        let length = 0
        do {
          length += 1
          if (length > 20) throw invalidInput('AV1 coefficient magnitude exceeds 20 bits')
        } while (this.#symbols.readBoolean() === 0)
        let value = 1
        for (let index = length - 2; index >= 0; index -= 1) {
          value = value * 2 + this.#symbols.readBoolean()
        }
        magnitude = value + 14
      }
      levelContext += magnitude
      if (position === 0) dcCategory = sign === 1 ? 1 : 2
      coefficients[position] = sign === 1 ? -magnitude : magnitude
    }
    if (adjustedWidth === width && adjustedHeight === height) {
      return { coefficients, dcCategory, eob, levelContext: Math.min(63, levelContext) }
    }
    const expanded = new Int32Array(width * height)
    for (let row = 0; row < adjustedHeight; row += 1) {
      expanded.set(
        coefficients.subarray(row * adjustedWidth, row * adjustedWidth + adjustedWidth),
        row * width,
      )
    }
    return { coefficients: expanded, dcCategory, eob, levelContext: Math.min(63, levelContext) }
  }

  #baseContext(
    coefficients: Int32Array,
    position: number,
    width: CoefficientDimension,
    height: CoefficientDimension,
    transformType: number,
    rectangularDirection: number,
  ): number {
    const row = Math.floor(position / width)
    const column = position % width
    const txClass = transformClass(transformType)
    let magnitude = 0
    for (const [rowOffset, columnOffset] of significantOffsetsByClass[txClass]) {
      const referenceRow = row + rowOffset
      const referenceColumn = column + columnOffset
      if (referenceRow < height && referenceColumn < width) {
        magnitude += Math.min(
          Math.abs(coefficients[referenceRow * width + referenceColumn] ?? 0),
          3,
        )
      }
    }
    const base = Math.min((magnitude + 1) >> 1, 4)
    if (txClass !== 0) {
      const index = txClass === 1 ? column : row
      const offset = [26, 31, 36][Math.min(index, 2)]
      if (offset === undefined) throw invalidInput('AV1 coefficient position context is invalid')
      return base + offset
    }
    if (position === 0) return 0
    const offsets =
      rectangularDirection < 0
        ? [
            [0, 11, 11, 11, width === 4 ? 0 : 11],
            [11, 11, 11, 11, width === 4 ? 0 : 11],
            [6, 6, 21, 21, width === 4 ? 0 : 21],
            [6, 21, 21, 21, width === 4 ? 0 : 21],
            [21, 21, 21, 21, width === 4 ? 0 : 21],
          ]
        : rectangularDirection > 0
          ? [
              [0, 16, 6, 6, 21],
              [16, 16, 6, 21, 21],
              [16, 16, 21, 21, 21],
              [16, 16, 21, 21, 21],
              height === 4 ? [0, 0, 0, 0, 0] : [16, 16, 21, 21, 21],
            ]
          : coefficientContextOffsets
    return base + (offsets[Math.min(row, 4)]?.[Math.min(column, 4)] ?? 0)
  }

  #rangeContext(
    coefficients: Int32Array,
    position: number,
    width: CoefficientDimension,
    height: CoefficientDimension,
    transformType: number,
  ): number {
    const row = Math.floor(position / width)
    const column = position % width
    const txClass = transformClass(transformType)
    let magnitude = 0
    for (const [rowOffset, columnOffset] of magnitudeOffsetsByClass[txClass]) {
      const referenceRow = row + rowOffset
      const referenceColumn = column + columnOffset
      if (referenceRow < height && referenceColumn < width) {
        magnitude += Math.min(
          Math.abs(coefficients[referenceRow * width + referenceColumn] ?? 0),
          15,
        )
      }
    }
    const base = Math.min((magnitude + 1) >> 1, 6)
    if (position === 0) return base
    if (txClass === 0) return base + (row < 2 && column < 2 ? 7 : 14)
    if (txClass === 1) return base + (column === 0 ? 7 : 14)
    return base + (row === 0 ? 7 : 14)
  }
}
