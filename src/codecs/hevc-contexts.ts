import { invalidInput } from '../errors.ts'
import { type HevcCabacContext, initializeHevcCabacContext } from './hevc-cabac.ts'

const initialize = (values: readonly number[], sliceQp: number): HevcCabacContext[] =>
  values.map((value) => initializeHevcCabacContext(value, sliceQp))

const LAST_SIGNIFICANT_PREFIX_INTRA = [
  110, 110, 124, 125, 140, 153, 125, 127, 140, 109, 111, 143, 127, 111, 79, 108, 123, 63,
] as const

const SIGNIFICANT_COEFFICIENT_INTRA = [
  111, 111, 125, 110, 110, 94, 124, 108, 124, 107, 125, 141, 179, 153, 125, 107, 125, 141, 179, 153,
  125, 107, 125, 141, 179, 153, 125, 140, 139, 182, 182, 152, 136, 152, 136, 153, 136, 139, 111,
  136, 139, 111,
] as const

const GREATER_ONE_INTRA = [
  140, 92, 137, 138, 140, 152, 138, 139, 153, 74, 149, 92, 139, 107, 122, 152, 140, 179, 166, 182,
  140, 227, 122, 197,
] as const

export class HevcIntraCabacContexts {
  readonly codedSubBlock: readonly HevcCabacContext[]
  readonly coefficientGreaterOne: readonly HevcCabacContext[]
  readonly coefficientGreaterTwo: readonly HevcCabacContext[]
  readonly cuQpDeltaAbsolute: readonly HevcCabacContext[]
  readonly intraChromaPredictionMode: readonly HevcCabacContext[]
  readonly lastSignificantX: readonly HevcCabacContext[]
  readonly lastSignificantY: readonly HevcCabacContext[]
  readonly lumaCbf: readonly HevcCabacContext[]
  readonly partMode: readonly HevcCabacContext[]
  readonly previousIntraLumaPrediction: readonly HevcCabacContext[]
  readonly saoMerge: readonly HevcCabacContext[]
  readonly saoType: readonly HevcCabacContext[]
  readonly significantCoefficient: readonly HevcCabacContext[]
  readonly splitCodingUnit: readonly HevcCabacContext[]
  readonly splitTransform: readonly HevcCabacContext[]
  readonly transformSkip: readonly HevcCabacContext[]
  readonly transquantBypass: readonly HevcCabacContext[]
  readonly chromaCbf: readonly HevcCabacContext[]

  constructor(sliceQp: number) {
    this.saoMerge = initialize([153], sliceQp)
    this.saoType = initialize([200], sliceQp)
    this.splitCodingUnit = initialize([139, 141, 157], sliceQp)
    this.transquantBypass = initialize([154], sliceQp)
    this.partMode = initialize([184], sliceQp)
    this.previousIntraLumaPrediction = initialize([184], sliceQp)
    this.intraChromaPredictionMode = initialize([63], sliceQp)
    this.splitTransform = initialize([153, 138, 138], sliceQp)
    this.lumaCbf = initialize([111, 141], sliceQp)
    this.chromaCbf = initialize([94, 138, 182, 154], sliceQp)
    this.cuQpDeltaAbsolute = initialize([154, 154], sliceQp)
    this.transformSkip = initialize([139, 139], sliceQp)
    this.lastSignificantX = initialize(LAST_SIGNIFICANT_PREFIX_INTRA, sliceQp)
    this.lastSignificantY = initialize(LAST_SIGNIFICANT_PREFIX_INTRA, sliceQp)
    this.codedSubBlock = initialize([91, 171, 134, 141], sliceQp)
    this.significantCoefficient = initialize(SIGNIFICANT_COEFFICIENT_INTRA, sliceQp)
    this.coefficientGreaterOne = initialize(GREATER_ONE_INTRA, sliceQp)
    this.coefficientGreaterTwo = initialize([138, 153, 136, 167, 152, 152], sliceQp)
  }

  context(contexts: readonly HevcCabacContext[], index: number, syntax: string): HevcCabacContext {
    if (!Number.isInteger(index) || index < 0) {
      throw invalidInput(`HEVC ${syntax} CABAC context index is invalid`)
    }
    const context = contexts[index]
    if (!context) throw invalidInput(`HEVC ${syntax} CABAC context index is out of range`)
    return context
  }

  copyFrom(source: HevcIntraCabacContexts): void {
    const targets = [
      this.saoMerge,
      this.saoType,
      this.splitCodingUnit,
      this.transquantBypass,
      this.partMode,
      this.previousIntraLumaPrediction,
      this.intraChromaPredictionMode,
      this.splitTransform,
      this.lumaCbf,
      this.chromaCbf,
      this.cuQpDeltaAbsolute,
      this.transformSkip,
      this.lastSignificantX,
      this.lastSignificantY,
      this.codedSubBlock,
      this.significantCoefficient,
      this.coefficientGreaterOne,
      this.coefficientGreaterTwo,
    ] as const
    const sources = [
      source.saoMerge,
      source.saoType,
      source.splitCodingUnit,
      source.transquantBypass,
      source.partMode,
      source.previousIntraLumaPrediction,
      source.intraChromaPredictionMode,
      source.splitTransform,
      source.lumaCbf,
      source.chromaCbf,
      source.cuQpDeltaAbsolute,
      source.transformSkip,
      source.lastSignificantX,
      source.lastSignificantY,
      source.codedSubBlock,
      source.significantCoefficient,
      source.coefficientGreaterOne,
      source.coefficientGreaterTwo,
    ] as const
    for (let group = 0; group < targets.length; group += 1) {
      const target = targets[group]
      const sourceGroup = sources[group]
      if (!target || !sourceGroup || target.length !== sourceGroup.length) {
        throw invalidInput('HEVC CABAC context snapshot is inconsistent')
      }
      for (let index = 0; index < target.length; index += 1) {
        const targetContext = target[index]
        const sourceContext = sourceGroup[index]
        if (!targetContext || !sourceContext) {
          throw invalidInput('HEVC CABAC context snapshot is truncated')
        }
        targetContext.copyFrom(sourceContext)
      }
    }
  }
}
