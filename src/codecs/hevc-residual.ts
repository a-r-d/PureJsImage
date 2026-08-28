import { invalidInput } from '../errors.ts'
import type { HevcCabacContext } from './hevc-cabac.ts'
import type { HevcIntraCabacContexts } from './hevc-contexts.ts'

interface CabacSource {
  decodeBypass(): 0 | 1
  decodeBypassBits(count: number): number
  decodeDecision(context: HevcCabacContext): 0 | 1
}

export interface HevcScanPosition {
  readonly x: number
  readonly y: number
}

export type HevcScanType = 0 | 1 | 2

export const hevcScanOrder = (
  log2Size: number,
  type: HevcScanType,
): readonly HevcScanPosition[] => {
  if (!Number.isInteger(log2Size) || log2Size < 0 || log2Size > 5) {
    throw invalidInput('HEVC scan size is invalid')
  }
  const size = 1 << log2Size
  const output: HevcScanPosition[] = []
  if (type === 1) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) output.push({ x, y })
    }
    return output
  }
  if (type === 2) {
    for (let x = 0; x < size; x += 1) {
      for (let y = 0; y < size; y += 1) output.push({ x, y })
    }
    return output
  }
  let x = 0
  let y = 0
  while (output.length < size * size) {
    while (y >= 0) {
      if (x < size && y < size) output.push({ x, y })
      y -= 1
      x += 1
    }
    y = x
    x = 0
  }
  return output
}

const scanTypeFor = (log2Size: number, component: number, intraMode: number): HevcScanType => {
  if (log2Size === 2 || (log2Size === 3 && component === 0)) {
    if (intraMode >= 6 && intraMode <= 14) return 2
    if (intraMode >= 22 && intraMode <= 30) return 1
  }
  return 0
}

const decodeTruncatedUnary = (
  decoder: CabacSource,
  maximum: number,
  contextForBin: (binIndex: number) => HevcCabacContext,
): number => {
  for (let value = 0; value < maximum; value += 1) {
    if (decoder.decodeDecision(contextForBin(value)) === 0) return value
  }
  return maximum
}

const lastSignificantCoordinate = (prefix: number, decoder: CabacSource): number => {
  if (prefix <= 3) return prefix
  const suffixBits = (prefix >>> 1) - 1
  const suffix = decoder.decodeBypassBits(suffixBits)
  return (1 << suffixBits) * (2 + (prefix & 1)) + suffix
}

const decodeExpGolombBypass = (decoder: CabacSource, initialOrder: number): number => {
  let order = initialOrder
  let value = 0
  while (decoder.decodeBypass() === 1) {
    if (order > 24) throw invalidInput('HEVC coefficient escape value is unreasonably large')
    value += 2 ** order
    order += 1
  }
  value += decoder.decodeBypassBits(order)
  if (!Number.isSafeInteger(value)) throw invalidInput('HEVC coefficient escape value overflows')
  return value
}

const decodeRemainingLevel = (decoder: CabacSource, riceParameter: number): number => {
  let prefix = 0
  while (prefix < 4 && decoder.decodeBypass() === 1) prefix += 1
  if (prefix < 4) {
    return (prefix << riceParameter) + decoder.decodeBypassBits(riceParameter)
  }
  return (4 << riceParameter) + decodeExpGolombBypass(decoder, riceParameter + 1)
}

const significantContext = (
  component: number,
  log2Size: number,
  scanType: HevcScanType,
  x: number,
  y: number,
  codedSubBlocks: Uint8Array,
  subBlockSize: number,
): number => {
  if (log2Size === 2) {
    const map = [0, 1, 4, 5, 2, 3, 4, 5, 6, 6, 8, 8, 7, 7, 8, 8] as const
    return (component === 0 ? 0 : 27) + (map[y * 4 + x] ?? 0)
  }
  if (x + y === 0) return component === 0 ? 0 : 27
  const subX = x >>> 2
  const subY = y >>> 2
  const right = subX + 1 < subBlockSize ? (codedSubBlocks[subY * subBlockSize + subX + 1] ?? 0) : 0
  const below =
    subY + 1 < subBlockSize ? (codedSubBlocks[(subY + 1) * subBlockSize + subX] ?? 0) : 0
  const previous = right + (below << 1)
  const localX = x & 3
  const localY = y & 3
  let context =
    previous === 0
      ? localX + localY === 0
        ? 2
        : localX + localY < 3
          ? 1
          : 0
      : previous === 1
        ? localY === 0
          ? 2
          : localY === 1
            ? 1
            : 0
        : previous === 2
          ? localX === 0
            ? 2
            : localX === 1
              ? 1
              : 0
          : 2
  if (component === 0) {
    if (subX + subY > 0) context += 3
    context += log2Size === 3 ? (scanType === 0 ? 9 : 15) : 21
    return context
  }
  context += log2Size === 3 ? 9 : 12
  return 27 + context
}

export interface HevcResidualOptions {
  readonly component: 0 | 1 | 2
  readonly intraMode: number
  readonly log2Size: number
  readonly signDataHiding: boolean
  readonly transformSkipEnabled: boolean
  readonly transquantBypass: boolean
}

export interface HevcResidualBlock {
  readonly coefficients: Int32Array
  readonly size: number
  readonly transformSkipped: boolean
}

export const decodeHevcResidual = (
  decoder: CabacSource,
  contexts: HevcIntraCabacContexts,
  options: HevcResidualOptions,
): HevcResidualBlock => {
  const { component, intraMode, log2Size, signDataHiding, transquantBypass } = options
  if (log2Size < 2 || log2Size > 5) throw invalidInput('HEVC transform size is invalid')
  if (intraMode < 0 || intraMode > 34) throw invalidInput('HEVC intra prediction mode is invalid')
  const size = 1 << log2Size
  const coefficientCount = size * size
  const coefficients = new Int32Array(coefficientCount)
  const transformSkipped =
    options.transformSkipEnabled &&
    !transquantBypass &&
    log2Size <= 2 &&
    decoder.decodeDecision(
      contexts.context(contexts.transformSkip, component === 0 ? 0 : 1, 'transform skip'),
    ) === 1
  const scanType = scanTypeFor(log2Size, component, intraMode)
  const prefixMaximum = log2Size * 2 - 1
  const lastXPrefix = decodeTruncatedUnary(decoder, prefixMaximum, (binIndex) => {
    const offset = component === 0 ? 3 * (log2Size - 2) + ((log2Size - 1) >> 2) : 15
    const shift = component === 0 ? (log2Size + 1) >> 2 : log2Size - 2
    return contexts.context(contexts.lastSignificantX, (binIndex >> shift) + offset, 'last X')
  })
  const lastYPrefix = decodeTruncatedUnary(decoder, prefixMaximum, (binIndex) => {
    const offset = component === 0 ? 3 * (log2Size - 2) + ((log2Size - 1) >> 2) : 15
    const shift = component === 0 ? (log2Size + 1) >> 2 : log2Size - 2
    return contexts.context(contexts.lastSignificantY, (binIndex >> shift) + offset, 'last Y')
  })
  let lastX = lastSignificantCoordinate(lastXPrefix, decoder)
  let lastY = lastSignificantCoordinate(lastYPrefix, decoder)
  if (scanType === 2) [lastX, lastY] = [lastY, lastX]
  if (lastX >= size || lastY >= size)
    throw invalidInput('HEVC last significant coefficient is outside its block')

  const subBlockSize = 1 << (log2Size - 2)
  const subBlockScan = hevcScanOrder(log2Size - 2, scanType)
  const coefficientScan = hevcScanOrder(2, scanType)
  let lastSubBlock = -1
  let lastScanPosition = -1
  for (let subIndex = 0; subIndex < subBlockScan.length; subIndex += 1) {
    const sub = subBlockScan[subIndex]
    if (!sub) continue
    for (let position = 0; position < coefficientScan.length; position += 1) {
      const local = coefficientScan[position]
      if (local && sub.x * 4 + local.x === lastX && sub.y * 4 + local.y === lastY) {
        lastSubBlock = subIndex
        lastScanPosition = position
      }
    }
  }
  if (lastSubBlock < 0 || lastScanPosition < 0) {
    throw invalidInput('HEVC last significant coefficient scan position is invalid')
  }

  const codedSubBlocks = new Uint8Array(subBlockSize * subBlockSize)
  const lastSub = subBlockScan[lastSubBlock]
  if (!lastSub) throw invalidInput('HEVC last coefficient sub-block is missing')
  codedSubBlocks[lastSub.y * subBlockSize + lastSub.x] = 1
  codedSubBlocks[0] = 1
  coefficients[lastY * size + lastX] = 1
  let previousGreaterContext = 1
  let previousGreaterFlag = 0

  for (let subIndex = lastSubBlock; subIndex >= 0; subIndex -= 1) {
    const sub = subBlockScan[subIndex]
    if (!sub) throw invalidInput('HEVC coefficient sub-block scan is invalid')
    const subOffset = sub.y * subBlockSize + sub.x
    let inferDc = false
    if (subIndex < lastSubBlock && subIndex > 0) {
      const right = sub.x + 1 < subBlockSize ? (codedSubBlocks[subOffset + 1] ?? 0) : 0
      const below = sub.y + 1 < subBlockSize ? (codedSubBlocks[subOffset + subBlockSize] ?? 0) : 0
      const contextIndex = (component === 0 ? 0 : 2) + Math.min(right + below, 1)
      codedSubBlocks[subOffset] = decoder.decodeDecision(
        contexts.context(contexts.codedSubBlock, contextIndex, 'coded sub-block'),
      )
      inferDc = true
    }
    const significantPositions: number[] = []
    const start = subIndex === lastSubBlock ? lastScanPosition - 1 : 15
    if (subIndex === lastSubBlock) significantPositions.push(lastScanPosition)
    if (codedSubBlocks[subOffset] === 1) {
      for (let position = start; position >= 0; position -= 1) {
        const local = coefficientScan[position]
        if (!local) throw invalidInput('HEVC coefficient scan position is missing')
        const x = sub.x * 4 + local.x
        const y = sub.y * 4 + local.y
        let significant = position === 0 && inferDc
        if (position > 0 || !inferDc) {
          const contextIndex = significantContext(
            component,
            log2Size,
            scanType,
            x,
            y,
            codedSubBlocks,
            subBlockSize,
          )
          significant =
            decoder.decodeDecision(
              contexts.context(
                contexts.significantCoefficient,
                contextIndex,
                'significant coefficient',
              ),
            ) === 1
          if (significant) inferDc = false
        }
        if (significant) {
          significantPositions.push(position)
          coefficients[y * size + x] = 1
        }
      }
    }
    if (significantPositions.length === 0) continue
    significantPositions.sort((left, right) => right - left)
    const greaterOne = new Map<number, number>()
    let greaterContextSet = subIndex === 0 || component > 0 ? 0 : 2
    let greaterContext = 1
    if (subIndex !== lastSubBlock) {
      let lastContext = previousGreaterContext
      if (lastContext > 0) lastContext = previousGreaterFlag === 1 ? 0 : lastContext + 1
      if (lastContext === 0) greaterContextSet += 1
    }
    let lastGreaterPosition = -1
    let decodedGreaterCount = 0
    for (const position of significantPositions) {
      if (decodedGreaterCount >= 8) break
      if (decodedGreaterCount > 0 && greaterContext > 0) {
        greaterContext = previousGreaterFlag === 1 ? 0 : greaterContext + 1
      }
      const contextIndex =
        greaterContextSet * 4 + Math.min(3, greaterContext) + (component === 0 ? 0 : 16)
      const flag = decoder.decodeDecision(
        contexts.context(contexts.coefficientGreaterOne, contextIndex, 'coefficient greater-one'),
      )
      greaterOne.set(position, flag)
      previousGreaterFlag = flag
      if (flag === 1 && lastGreaterPosition < 0) lastGreaterPosition = position
      decodedGreaterCount += 1
    }
    previousGreaterContext = greaterContext
    const greaterTwo =
      lastGreaterPosition < 0
        ? 0
        : decoder.decodeDecision(
            contexts.context(
              contexts.coefficientGreaterTwo,
              greaterContextSet + (component === 0 ? 0 : 4),
              'coefficient greater-two',
            ),
          )
    const firstPosition = significantPositions[significantPositions.length - 1]
    const lastPosition = significantPositions[0]
    if (firstPosition === undefined || lastPosition === undefined) {
      throw invalidInput('HEVC significant coefficient positions are invalid')
    }
    const hideSign = !transquantBypass && lastPosition - firstPosition > 3
    const signs = new Map<number, number>()
    for (const position of significantPositions) {
      if (!signDataHiding || !hideSign || position !== firstPosition) {
        signs.set(position, decoder.decodeBypass())
      }
    }
    let previousAbsoluteLevel = 0
    let riceParameter = 0
    let significantIndex = 0
    let sumAbsoluteLevels = 0
    for (const position of significantPositions) {
      const greaterOneFlag = greaterOne.get(position) ?? 0
      const greaterTwoFlag = position === lastGreaterPosition ? greaterTwo : 0
      const baseLevel = 1 + greaterOneFlag + greaterTwoFlag
      const expectedBase = significantIndex < 8 ? (position === lastGreaterPosition ? 3 : 2) : 1
      let remaining = 0
      let decodedRemaining = false
      if (baseLevel === expectedBase) {
        riceParameter = Math.min(
          riceParameter + (previousAbsoluteLevel > 3 * (1 << riceParameter) ? 1 : 0),
          4,
        )
        remaining = decodeRemainingLevel(decoder, riceParameter)
        decodedRemaining = true
      }
      const absoluteLevel = baseLevel + remaining
      if (absoluteLevel > 1 << 20)
        throw invalidInput('HEVC coefficient magnitude is unreasonably large')
      sumAbsoluteLevels += absoluteLevel
      const local = coefficientScan[position]
      if (!local) throw invalidInput('HEVC coefficient scan position is missing')
      const x = sub.x * 4 + local.x
      const y = sub.y * 4 + local.y
      let sign = signs.get(position) ?? 0
      if (
        signDataHiding &&
        hideSign &&
        position === firstPosition &&
        (sumAbsoluteLevels & 1) === 1
      ) {
        sign = 1
      }
      coefficients[y * size + x] = sign === 1 ? -absoluteLevel : absoluteLevel
      if (decodedRemaining) previousAbsoluteLevel = absoluteLevel
      significantIndex += 1
    }
  }
  return { coefficients, size, transformSkipped }
}
