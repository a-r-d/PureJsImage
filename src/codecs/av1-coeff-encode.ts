import { invalidInput, unsupportedOperation } from '../errors.ts'
import type { Av1CoefficientBlock } from './av1-coeff.ts'
import { coefficientQ0Defaults } from './av1-coeff-q0.ts'
import { coefficientQ1Defaults, coefficientQ3Defaults } from './av1-coeff-q1-q3.ts'
import { coefficientQ2Defaults } from './av1-coeff-q2.ts'
import type { Av1SymbolEncoder } from './av1-symbol-encode.ts'

const defaultScan4x4 = [0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15] as const
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
const coefficientContextOffsets = [
  [0, 1, 6, 6, 21],
  [1, 6, 6, 21, 21],
  [6, 6, 21, 21, 21],
  [6, 21, 21, 21, 21],
  [21, 21, 21, 21, 21],
] as const
const dcSignDefaults = [
  [16000, 13056, 18816],
  [15232, 12928, 17280],
] as const
const maximumGolombValue = 2 ** 20 - 1

const makeCdf = (values: readonly number[]): Uint16Array => new Uint16Array(values)

/**
 * Encodes the coefficient syntax consumed by Av1CoefficientDecoder.
 *
 * The initial encoder supports the transform subset required by the constrained AVIF encoder:
 * one 4x4, transform-type-0 block with 8-bit quantizer contexts. Coefficient skip syntax is
 * outside this class, so an all-zero block must be handled by its caller.
 */
export class Av1CoefficientEncoder {
  readonly #symbols: Av1SymbolEncoder
  readonly #eobPoint4x4: readonly (readonly Uint16Array[])[]
  readonly #eobExtra4x4: readonly (readonly Uint16Array[])[]
  readonly #dcSign = dcSignDefaults.map((plane) => plane.map((value) => makeCdf([value, 32768, 0])))
  readonly #baseEob4x4: readonly (readonly Uint16Array[])[]
  readonly #base4x4: readonly (readonly Uint16Array[])[]
  readonly #range4x4: readonly (readonly Uint16Array[])[]
  readonly #magnitudes = new Int32Array(16)

  constructor(symbols: Av1SymbolEncoder, quantizerContext: number) {
    if (!Number.isInteger(quantizerContext) || quantizerContext < 0 || quantizerContext > 3) {
      throw unsupportedOperation(
        `AV1 nonzero coefficients for quantizer context ${quantizerContext}`,
      )
    }
    this.#symbols = symbols
    const defaults =
      quantizerContext === 0
        ? coefficientQ0Defaults
        : quantizerContext === 1
          ? coefficientQ1Defaults
          : quantizerContext === 2
            ? coefficientQ2Defaults
            : coefficientQ3Defaults
    this.#eobPoint4x4 = defaults.eob4.map((plane) => plane.map(makeCdf))
    this.#eobExtra4x4 = defaults.extra4.map((plane) => plane.map(makeCdf))
    this.#baseEob4x4 = defaults.baseEob4.map((plane) => plane.map(makeCdf))
    this.#base4x4 = defaults.base4.map((plane) => plane.map(makeCdf))
    this.#range4x4 = defaults.range4.map((plane) => plane.map(makeCdf))
  }

  write(
    plane: 0 | 1 | 2,
    width: 4,
    height: 4,
    transformType: 0,
    coefficients: Int32Array,
    dcSignContext = 0,
  ): Av1CoefficientBlock {
    if (plane !== 0 && plane !== 1 && plane !== 2) {
      throw unsupportedOperation(`AV1 coefficient plane ${plane}`)
    }
    if (width !== 4 || height !== 4 || transformType !== 0) {
      throw unsupportedOperation(
        `AV1 coefficient encoding supports only 4x4 transform type 0, not ${width}x${height} transform type ${transformType}`,
      )
    }
    if (coefficients.length !== 16) {
      throw invalidInput(
        `AV1 4x4 coefficient block has ${coefficients.length} entries instead of 16`,
      )
    }
    if (!Number.isInteger(dcSignContext) || dcSignContext < 0 || dcSignContext > 2) {
      throw invalidInput(`Invalid AV1 DC sign context: ${dcSignContext}`)
    }

    let eob = 0
    for (let scanIndex = 0; scanIndex < defaultScan4x4.length; scanIndex += 1) {
      const position = defaultScan4x4[scanIndex]
      if (position === undefined) throw invalidInput('AV1 coefficient scan is invalid')
      if (Math.abs(coefficients[position] ?? 0) > maximumGolombValue + 14) {
        throw unsupportedOperation(
          'AV1 coefficient magnitude exceeds the supported 20-bit Golomb range',
        )
      }
      if (coefficients[position] !== 0) eob = scanIndex + 1
    }
    if (eob === 0) {
      throw unsupportedOperation(
        'AV1 all-zero coefficient blocks require caller-managed skip syntax',
      )
    }

    const planeType = plane === 0 ? 0 : 1
    const eobPoint = eob === 1 ? 1 : Math.floor(Math.log2(eob - 1)) + 2
    const eobCdf = this.#eobPoint4x4[planeType]?.[0]
    if (!eobCdf) throw invalidInput('AV1 EOB CDF is missing')
    this.#symbols.writeSymbol(eobCdf, eobPoint - 1)
    if (eobPoint >= 3) {
      const baseEob = 2 ** (eobPoint - 2) + 1
      let extra = eob - baseEob
      const highBitValue = 2 ** (eobPoint - 3)
      const extraCdf = this.#eobExtra4x4[planeType]?.[eobPoint - 3]
      if (!extraCdf) throw invalidInput('AV1 EOB extra CDF is missing')
      const highBit = extra >= highBitValue ? 1 : 0
      this.#symbols.writeSymbol(extraCdf, highBit)
      extra -= highBit * highBitValue
      for (let shift = eobPoint - 4; shift >= 0; shift -= 1) {
        this.#symbols.writeBoolean((extra >>> shift) & 1)
      }
    }

    const magnitudes = this.#magnitudes
    magnitudes.fill(0)
    for (let scanIndex = eob - 1; scanIndex >= 0; scanIndex -= 1) {
      const position = defaultScan4x4[scanIndex]
      if (position === undefined) throw invalidInput('AV1 coefficient scan is invalid')
      const magnitude = Math.abs(coefficients[position] ?? 0)
      const codedLevel = Math.min(magnitude, 15)
      if (scanIndex === eob - 1) {
        const coefficientContext = scanIndex === 0 ? 0 : scanIndex <= 2 ? 1 : scanIndex <= 4 ? 2 : 3
        const baseEobCdf = this.#baseEob4x4[planeType]?.[coefficientContext]
        if (!baseEobCdf) throw invalidInput('AV1 coefficient EOB base CDF is missing')
        this.#symbols.writeSymbol(baseEobCdf, Math.min(codedLevel, 3) - 1)
      } else {
        const coefficientContext = this.#baseContext(magnitudes, position)
        const baseCdf = this.#base4x4[planeType]?.[coefficientContext]
        if (!baseCdf) {
          throw invalidInput(`AV1 coefficient base context ${coefficientContext} is missing`)
        }
        this.#symbols.writeSymbol(baseCdf, Math.min(codedLevel, 3))
      }
      if (codedLevel > 2) {
        let remaining = codedLevel - 3
        for (let index = 0; index < 4; index += 1) {
          const context = this.#rangeContext(magnitudes, position)
          const rangeCdf = this.#range4x4[planeType]?.[context]
          if (!rangeCdf) throw invalidInput(`AV1 coefficient range context ${context} is missing`)
          const extra = Math.min(remaining, 3)
          this.#symbols.writeSymbol(rangeCdf, extra)
          remaining -= extra
          if (extra < 3) break
        }
      }
      magnitudes[position] = codedLevel
    }

    let dcCategory = 0
    let levelContext = 0
    for (let scanIndex = 0; scanIndex < eob; scanIndex += 1) {
      const position = defaultScan4x4[scanIndex]
      if (position === undefined) throw invalidInput('AV1 coefficient scan is invalid')
      const coefficient = coefficients[position] ?? 0
      const magnitude = Math.abs(coefficient)
      if (magnitude === 0) continue
      const sign = coefficient < 0 ? 1 : 0
      if (scanIndex === 0) {
        const signCdf = this.#dcSign[planeType]?.[dcSignContext]
        if (!signCdf) throw invalidInput('AV1 DC sign CDF is missing')
        this.#symbols.writeSymbol(signCdf, sign)
      } else {
        this.#symbols.writeBoolean(sign)
      }
      if (magnitude > 14) this.#writeGolomb(magnitude - 14)
      levelContext += magnitude
      if (position === 0) dcCategory = sign === 1 ? 1 : 2
    }

    return { coefficients, dcCategory, eob, levelContext: Math.min(63, levelContext) }
  }

  #baseContext(magnitudes: Int32Array, position: number): number {
    const row = Math.floor(position / 4)
    const column = position % 4
    let magnitude = 0
    for (const [rowOffset, columnOffset] of significantOffsets) {
      const referenceRow = row + rowOffset
      const referenceColumn = column + columnOffset
      if (referenceRow < 4 && referenceColumn < 4) {
        magnitude += Math.min(magnitudes[referenceRow * 4 + referenceColumn] ?? 0, 3)
      }
    }
    const base = Math.min((magnitude + 1) >> 1, 4)
    if (position === 0) return 0
    return base + (coefficientContextOffsets[Math.min(row, 4)]?.[Math.min(column, 4)] ?? 0)
  }

  #rangeContext(magnitudes: Int32Array, position: number): number {
    const row = Math.floor(position / 4)
    const column = position % 4
    let magnitude = 0
    for (const [rowOffset, columnOffset] of magnitudeOffsets) {
      const referenceRow = row + rowOffset
      const referenceColumn = column + columnOffset
      if (referenceRow < 4 && referenceColumn < 4) {
        magnitude += Math.min(magnitudes[referenceRow * 4 + referenceColumn] ?? 0, 15)
      }
    }
    const base = Math.min((magnitude + 1) >> 1, 6)
    if (position === 0) return base
    return base + (row < 2 && column < 2 ? 7 : 14)
  }

  #writeGolomb(value: number): void {
    const length = Math.floor(Math.log2(value)) + 1
    for (let index = 1; index < length; index += 1) this.#symbols.writeBoolean(0)
    this.#symbols.writeBoolean(1)
    for (let shift = length - 2; shift >= 0; shift -= 1) {
      this.#symbols.writeBoolean((value >>> shift) & 1)
    }
  }
}
