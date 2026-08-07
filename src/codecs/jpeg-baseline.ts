import { invalidInput, truncatedInput } from '../errors.ts'
import type { PixelBlock } from '../pixel.ts'

const zigZag = Int32Array.of(
  0,
  1,
  8,
  16,
  9,
  2,
  3,
  10,
  17,
  24,
  32,
  25,
  18,
  11,
  4,
  5,
  12,
  19,
  26,
  33,
  40,
  48,
  41,
  34,
  27,
  20,
  13,
  6,
  7,
  14,
  21,
  28,
  35,
  42,
  49,
  56,
  57,
  50,
  43,
  36,
  29,
  22,
  15,
  23,
  30,
  37,
  44,
  51,
  58,
  59,
  52,
  45,
  38,
  31,
  39,
  46,
  53,
  60,
  61,
  54,
  47,
  55,
  62,
  63,
)

const idctBasis = Float64Array.from({ length: 64 }, (_, index) => {
  const frequency = Math.floor(index / 8)
  const position = index % 8
  const normalization = frequency === 0 ? Math.SQRT1_2 : 1
  return 0.5 * normalization * Math.cos(((2 * position + 1) * frequency * Math.PI) / 16)
})

interface HuffmanTable {
  readonly counts: Uint8Array
  readonly symbols: Uint8Array
  readonly firstCodes: Int32Array
  readonly firstSymbols: Int32Array
}

interface FrameComponent {
  readonly id: number
  readonly horizontalSampling: number
  readonly verticalSampling: number
  readonly quantization: Int32Array
  readonly dcTable: HuffmanTable
  readonly acTable: HuffmanTable
}

interface RenderComponent {
  readonly horizontalSampling: number
  readonly verticalSampling: number
}

interface RenderJpeg {
  readonly components: readonly RenderComponent[]
  readonly maximumHorizontalSampling: number
  readonly maximumVerticalSampling: number
  readonly mcusPerLine: number
}

export interface BaselineJpeg {
  readonly data: Uint8Array
  readonly width: number
  readonly height: number
  readonly components: readonly FrameComponent[]
  readonly maximumHorizontalSampling: number
  readonly maximumVerticalSampling: number
  readonly mcusPerLine: number
  readonly mcusPerColumn: number
  readonly restartInterval: number
  readonly scanOffset: number
}

export interface JpegRegion {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

interface ParsedComponent {
  readonly id: number
  readonly horizontalSampling: number
  readonly verticalSampling: number
  readonly quantizationId: number
  dcTableId?: number
  acTableId?: number
}

interface ParsedFrame {
  readonly width: number
  readonly height: number
  readonly components: readonly ParsedComponent[]
}

const byte = (data: ArrayLike<number>, index: number): number => data[index] ?? 0

const readUint16 = (data: Uint8Array, offset: number): number => {
  if (offset < 0 || offset + 2 > data.byteLength) throw truncatedInput('JPEG segment is truncated')
  return byte(data, offset) * 256 + byte(data, offset + 1)
}

const segmentEnd = (data: Uint8Array, offset: number): number => {
  const length = readUint16(data, offset)
  if (length < 2 || offset + length > data.byteLength)
    throw truncatedInput('JPEG segment is truncated')
  return offset + length
}

const huffmanTable = (counts: Uint8Array, symbols: Uint8Array): HuffmanTable => {
  const firstCodes = new Int32Array(16)
  const firstSymbols = new Int32Array(16)
  let code = 0
  let symbol = 0
  for (let index = 0; index < 16; index += 1) {
    const count = byte(counts, index)
    firstCodes[index] = code
    firstSymbols[index] = symbol
    if (code + count > 1 << (index + 1)) throw invalidInput('JPEG Huffman table is oversubscribed')
    code = (code + count) << 1
    symbol += count
  }
  return { counts, symbols, firstCodes, firstSymbols }
}

const parseQuantizationTables = (
  data: Uint8Array,
  start: number,
  end: number,
  tables: Map<number, Int32Array>,
): void => {
  let offset = start
  while (offset < end) {
    const specification = byte(data, offset)
    offset += 1
    const precision = specification >>> 4
    const table = new Int32Array(64)
    if (precision !== 0 && precision !== 1)
      throw invalidInput('JPEG quantization table precision is invalid')
    const sampleBytes = precision + 1
    if (offset + 64 * sampleBytes > end)
      throw truncatedInput('JPEG quantization table is truncated')
    for (let index = 0; index < 64; index += 1) {
      const target = byte(zigZag, index)
      table[target] = precision === 0 ? byte(data, offset) : readUint16(data, offset)
      offset += sampleBytes
    }
    tables.set(specification & 15, table)
  }
}

const parseHuffmanTables = (
  data: Uint8Array,
  start: number,
  end: number,
  dcTables: Map<number, HuffmanTable>,
  acTables: Map<number, HuffmanTable>,
): void => {
  let offset = start
  while (offset < end) {
    const specification = byte(data, offset)
    offset += 1
    if (offset + 16 > end) throw truncatedInput('JPEG Huffman table counts are truncated')
    const counts = data.slice(offset, offset + 16)
    offset += 16
    let symbolCount = 0
    for (const count of counts) symbolCount += count
    if (symbolCount < 1 || offset + symbolCount > end)
      throw truncatedInput('JPEG Huffman table symbols are truncated')
    const table = huffmanTable(counts, data.slice(offset, offset + symbolCount))
    offset += symbolCount
    const tableClass = specification >>> 4
    if (tableClass === 0) dcTables.set(specification & 15, table)
    else if (tableClass === 1) acTables.set(specification & 15, table)
    else throw invalidInput('JPEG Huffman table class is invalid')
  }
}

const parseFrame = (data: Uint8Array, start: number, end: number): ParsedFrame => {
  if (end - start < 6) throw truncatedInput('JPEG frame header is truncated')
  if (byte(data, start) !== 8) throw invalidInput('JPEG precision must be 8 bits')
  const height = readUint16(data, start + 1)
  const width = readUint16(data, start + 3)
  const componentCount = byte(data, start + 5)
  if ((componentCount !== 1 && componentCount !== 3) || start + 6 + componentCount * 3 !== end) {
    throw invalidInput('JPEG must contain one or three components')
  }
  const components: ParsedComponent[] = []
  let blocksPerMcu = 0
  for (let index = 0; index < componentCount; index += 1) {
    const offset = start + 6 + index * 3
    const sampling = byte(data, offset + 1)
    const horizontalSampling = sampling >>> 4
    const verticalSampling = sampling & 15
    if (
      horizontalSampling < 1 ||
      horizontalSampling > 4 ||
      verticalSampling < 1 ||
      verticalSampling > 4
    ) {
      throw invalidInput('JPEG component sampling factor is invalid')
    }
    blocksPerMcu += horizontalSampling * verticalSampling
    components.push({
      id: byte(data, offset),
      horizontalSampling,
      verticalSampling,
      quantizationId: byte(data, offset + 2),
    })
  }
  if (blocksPerMcu > 10) throw invalidInput('JPEG sampling factors exceed ten blocks per MCU')
  return { width, height, components }
}

export const parseBaselineJpeg = (data: Uint8Array): BaselineJpeg | undefined => {
  if (data.byteLength < 4 || readUint16(data, 0) !== 0xffd8)
    throw invalidInput('JPEG start marker is missing')
  const quantizationTables = new Map<number, Int32Array>()
  const dcTables = new Map<number, HuffmanTable>()
  const acTables = new Map<number, HuffmanTable>()
  let frame: ParsedFrame | undefined
  let restartInterval = 0
  let offset = 2

  while (offset < data.byteLength) {
    while (byte(data, offset) === 0xff) offset += 1
    if (offset >= data.byteLength) throw truncatedInput('JPEG marker is truncated')
    const marker = byte(data, offset)
    offset += 1
    if (marker === 0xd9) throw invalidInput('JPEG ended before image data')
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd8))
      throw invalidInput('JPEG contains an unexpected standalone marker')
    const end = segmentEnd(data, offset)
    const start = offset + 2

    if (marker === 0xdb) parseQuantizationTables(data, start, end, quantizationTables)
    else if (marker === 0xc4) parseHuffmanTables(data, start, end, dcTables, acTables)
    else if (marker === 0xc0) frame = parseFrame(data, start, end)
    else if (marker === 0xc1 || marker === 0xc2) return undefined
    else if (marker === 0xdd) {
      if (end - start !== 2) throw invalidInput('JPEG restart interval is invalid')
      restartInterval = readUint16(data, start)
    } else if (marker === 0xda) {
      if (!frame) throw invalidInput('JPEG scan appears before its frame')
      const selectors = byte(data, start)
      if (selectors !== frame.components.length || start + 1 + selectors * 2 + 3 !== end) {
        return undefined
      }
      for (let index = 0; index < selectors; index += 1) {
        const selectorOffset = start + 1 + index * 2
        const component = frame.components.find(
          (candidate) => candidate.id === byte(data, selectorOffset),
        )
        if (!component) throw invalidInput('JPEG scan references an unknown component')
        const tables = byte(data, selectorOffset + 1)
        component.dcTableId = tables >>> 4
        component.acTableId = tables & 15
      }
      const spectralOffset = start + 1 + selectors * 2
      if (
        byte(data, spectralOffset) !== 0 ||
        byte(data, spectralOffset + 1) !== 63 ||
        byte(data, spectralOffset + 2) !== 0
      ) {
        return undefined
      }
      let maximumHorizontalSampling = 1
      let maximumVerticalSampling = 1
      const components: FrameComponent[] = []
      for (const component of frame.components) {
        const quantization = quantizationTables.get(component.quantizationId)
        const dcTable =
          component.dcTableId === undefined ? undefined : dcTables.get(component.dcTableId)
        const acTable =
          component.acTableId === undefined ? undefined : acTables.get(component.acTableId)
        if (!quantization || !dcTable || !acTable)
          throw invalidInput('JPEG scan references a missing coding table')
        maximumHorizontalSampling = Math.max(
          maximumHorizontalSampling,
          component.horizontalSampling,
        )
        maximumVerticalSampling = Math.max(maximumVerticalSampling, component.verticalSampling)
        components.push({ ...component, quantization, dcTable, acTable })
      }
      return {
        data,
        width: frame.width,
        height: frame.height,
        components,
        maximumHorizontalSampling,
        maximumVerticalSampling,
        mcusPerLine: Math.ceil(frame.width / (8 * maximumHorizontalSampling)),
        mcusPerColumn: Math.ceil(frame.height / (8 * maximumVerticalSampling)),
        restartInterval,
        scanOffset: end,
      }
    }
    offset = end
  }
  throw truncatedInput('JPEG is missing image data')
}

class EntropyReader {
  readonly #data: Uint8Array
  #offset: number
  #bits = 0
  #bitCount = 0

  constructor(data: Uint8Array, offset: number) {
    this.#data = data
    this.#offset = offset
  }

  readBit(): number {
    if (this.#bitCount === 0) {
      if (this.#offset >= this.#data.byteLength)
        throw truncatedInput('JPEG entropy data is truncated')
      this.#bits = byte(this.#data, this.#offset)
      this.#offset += 1
      if (this.#bits === 0xff) {
        const stuffed = byte(this.#data, this.#offset)
        this.#offset += 1
        if (stuffed !== 0) throw invalidInput(`Unexpected JPEG marker ff${stuffed.toString(16)}`)
      }
      this.#bitCount = 8
    }
    this.#bitCount -= 1
    return (this.#bits >>> this.#bitCount) & 1
  }

  readBits(length: number): number {
    let value = 0
    for (let index = 0; index < length; index += 1) value = (value << 1) | this.readBit()
    return value
  }

  receiveAndExtend(length: number): number {
    if (length === 0) return 0
    const value = this.readBits(length)
    return value >= 1 << (length - 1) ? value : value + (-1 << length) + 1
  }

  restart(expected: number): void {
    this.#bitCount = 0
    while (byte(this.#data, this.#offset) === 0xff) this.#offset += 1
    const marker = byte(this.#data, this.#offset)
    this.#offset += 1
    if (marker !== 0xd0 + (expected & 7)) {
      throw invalidInput(`Expected JPEG restart marker ${expected & 7}`)
    }
  }

  scanEnd(): number {
    this.#bitCount = 0
    if (byte(this.#data, this.#offset) !== 0xff)
      throw invalidInput('JPEG scan contains trailing entropy data')
    return this.#offset
  }

  finish(): void {
    this.#bitCount = 0
    while (this.#offset < this.#data.byteLength && byte(this.#data, this.#offset) !== 0xff) {
      this.#offset += 1
    }
    while (byte(this.#data, this.#offset) === 0xff) this.#offset += 1
    if (byte(this.#data, this.#offset) !== 0xd9) {
      throw invalidInput('Baseline JPEG contains additional unsupported scans')
    }
  }
}

const decodeHuffman = (reader: EntropyReader, table: HuffmanTable): number => {
  let code = 0
  for (let length = 0; length < 16; length += 1) {
    code = (code << 1) | reader.readBit()
    const count = byte(table.counts, length)
    const offset = code - byte(table.firstCodes, length)
    if (offset >= 0 && offset < count) {
      const symbol = table.symbols[byte(table.firstSymbols, length) + offset]
      if (symbol === undefined) throw invalidInput('JPEG Huffman symbol is missing')
      return symbol
    }
  }
  throw invalidInput('JPEG Huffman code is invalid')
}

const decodeBlock = (
  reader: EntropyReader,
  component: FrameComponent,
  predictor: number,
  coefficients: Int32Array,
): number => {
  coefficients.fill(0)
  const dcLength = decodeHuffman(reader, component.dcTable)
  if (dcLength > 16) throw invalidInput('JPEG DC coefficient is invalid')
  const nextPredictor = predictor + reader.receiveAndExtend(dcLength)
  coefficients[0] = nextPredictor
  let index = 1
  while (index < 64) {
    const symbol = decodeHuffman(reader, component.acTable)
    const zeroes = symbol >>> 4
    const length = symbol & 15
    if (length === 0) {
      if (zeroes !== 15) break
      index += 16
      continue
    }
    index += zeroes
    if (index >= 64) throw invalidInput('JPEG AC coefficient exceeds its block')
    coefficients[byte(zigZag, index)] = reader.receiveAndExtend(length)
    index += 1
  }
  return nextPredictor
}

const inverseDct = (
  coefficients: ArrayLike<number>,
  quantization: Int32Array,
  workspace: Float64Array,
  output: Uint8Array,
  coefficientOffset = 0,
): void => {
  workspace.fill(0)
  let activeRows = 0
  for (let vertical = 0; vertical < 8; vertical += 1) {
    for (let horizontal = 0; horizontal < 8; horizontal += 1) {
      const index = vertical * 8 + horizontal
      const coefficient = byte(coefficients, coefficientOffset + index)
      if (coefficient === 0) continue
      activeRows |= 1 << vertical
      const scaled = coefficient * byte(quantization, index)
      for (let x = 0; x < 8; x += 1) {
        const target = vertical * 8 + x
        workspace[target] = (workspace[target] ?? 0) + scaled * (idctBasis[horizontal * 8 + x] ?? 0)
      }
    }
  }
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      let value = 0
      for (let vertical = 0; vertical < 8; vertical += 1) {
        if ((activeRows & (1 << vertical)) === 0) continue
        value += (idctBasis[vertical * 8 + y] ?? 0) * (workspace[vertical * 8 + x] ?? 0)
      }
      const sample = Math.round(value + 128)
      output[y * 8 + x] = sample < 0 ? 0 : sample > 255 ? 255 : sample
    }
  }
}

const componentPlanes = (jpeg: RenderJpeg): Uint8Array[] =>
  jpeg.components.map(
    (component) =>
      new Uint8Array(
        jpeg.mcusPerLine * component.horizontalSampling * 8 * component.verticalSampling * 8,
      ),
  )

const writeBlock = (
  plane: Uint8Array,
  planeWidth: number,
  block: Uint8Array,
  blockX: number,
  blockY: number,
): void => {
  for (let row = 0; row < 8; row += 1) {
    plane.set(block.subarray(row * 8, row * 8 + 8), (blockY * 8 + row) * planeWidth + blockX * 8)
  }
}

const clamp = (value: number): number => (value < 0 ? 0 : value > 255 ? 255 : value)

const renderRows = (
  jpeg: RenderJpeg,
  planes: readonly Uint8Array[],
  mcuRow: number,
  region: JpegRegion,
): PixelBlock | undefined => {
  const rowStart = mcuRow * jpeg.maximumVerticalSampling * 8
  const first = Math.max(region.y, rowStart)
  const last = Math.min(region.y + region.height, rowStart + jpeg.maximumVerticalSampling * 8)
  if (first >= last) return undefined
  const height = last - first
  const stride = region.width * 3
  const data = new Uint8Array(stride * height)
  const luminance = jpeg.components[0]
  const luminancePlane = planes[0]
  if (!luminance || !luminancePlane) throw invalidInput('JPEG luminance component is missing')
  const luminanceWidth = jpeg.mcusPerLine * luminance.horizontalSampling * 8

  for (let row = 0; row < height; row += 1) {
    const sourceY = first + row - rowStart
    for (let x = 0; x < region.width; x += 1) {
      const sourceX = region.x + x
      const luminanceX = Math.floor(
        (sourceX * luminance.horizontalSampling) / jpeg.maximumHorizontalSampling,
      )
      const luminanceY = Math.floor(
        (sourceY * luminance.verticalSampling) / jpeg.maximumVerticalSampling,
      )
      const y = byte(luminancePlane, luminanceY * luminanceWidth + luminanceX)
      const target = row * stride + x * 3
      if (jpeg.components.length === 1) {
        data[target] = y
        data[target + 1] = y
        data[target + 2] = y
        continue
      }
      const blueDifference = jpeg.components[1]
      const redDifference = jpeg.components[2]
      const bluePlane = planes[1]
      const redPlane = planes[2]
      if (!blueDifference || !redDifference || !bluePlane || !redPlane) {
        throw invalidInput('JPEG chroma components are missing')
      }
      const blueWidth = jpeg.mcusPerLine * blueDifference.horizontalSampling * 8
      const redWidth = jpeg.mcusPerLine * redDifference.horizontalSampling * 8
      const blueX = Math.floor(
        (sourceX * blueDifference.horizontalSampling) / jpeg.maximumHorizontalSampling,
      )
      const redX = Math.floor(
        (sourceX * redDifference.horizontalSampling) / jpeg.maximumHorizontalSampling,
      )
      const blueY = Math.floor(
        (sourceY * blueDifference.verticalSampling) / jpeg.maximumVerticalSampling,
      )
      const redY = Math.floor(
        (sourceY * redDifference.verticalSampling) / jpeg.maximumVerticalSampling,
      )
      const cb = byte(bluePlane, blueY * blueWidth + blueX) - 128
      const cr = byte(redPlane, redY * redWidth + redX) - 128
      data[target] = clamp(y + 1.402 * cr)
      data[target + 1] = clamp(y - 0.3441363 * cb - 0.71413636 * cr)
      data[target + 2] = clamp(y + 1.772 * cb)
    }
  }
  return {
    x: 0,
    y: first - region.y,
    width: region.width,
    height,
    stride,
    format: 'rgb8',
    data,
  }
}

export const decodeBaselineJpeg = async function* (
  jpeg: BaselineJpeg,
  region: JpegRegion,
): AsyncGenerator<PixelBlock> {
  const reader = new EntropyReader(jpeg.data, jpeg.scanOffset)
  const predictors = new Int32Array(jpeg.components.length)
  const coefficients = new Int32Array(64)
  const workspace = new Float64Array(64)
  const block = new Uint8Array(64)
  let mcu = 0
  let restart = 0

  for (let mcuRow = 0; mcuRow < jpeg.mcusPerColumn; mcuRow += 1) {
    const planes = componentPlanes(jpeg)
    for (let mcuColumn = 0; mcuColumn < jpeg.mcusPerLine; mcuColumn += 1) {
      if (jpeg.restartInterval > 0 && mcu > 0 && mcu % jpeg.restartInterval === 0) {
        reader.restart(restart)
        restart += 1
        predictors.fill(0)
      }
      for (let componentIndex = 0; componentIndex < jpeg.components.length; componentIndex += 1) {
        const component = jpeg.components[componentIndex]
        const plane = planes[componentIndex]
        if (!component || !plane) throw invalidInput('JPEG component storage is missing')
        const planeWidth = jpeg.mcusPerLine * component.horizontalSampling * 8
        for (let blockY = 0; blockY < component.verticalSampling; blockY += 1) {
          for (let blockX = 0; blockX < component.horizontalSampling; blockX += 1) {
            predictors[componentIndex] = decodeBlock(
              reader,
              component,
              byte(predictors, componentIndex),
              coefficients,
            )
            inverseDct(coefficients, component.quantization, workspace, block)
            writeBlock(
              plane,
              planeWidth,
              block,
              mcuColumn * component.horizontalSampling + blockX,
              blockY,
            )
          }
        }
      }
      mcu += 1
    }
    const output = renderRows(jpeg, planes, mcuRow, region)
    if (output) yield output
  }
  reader.finish()
}

interface ProgressiveFrameComponent extends RenderComponent {
  readonly id: number
  readonly quantizationId: number
  readonly blocksPerLine: number
  readonly blocksPerColumn: number
  readonly blocksPerLineForMcu: number
  readonly blocksPerColumnForMcu: number
  readonly coefficients: Int16Array
  readonly successiveBits: Int8Array
}

interface ProgressiveComponent extends ProgressiveFrameComponent {
  readonly quantization: Int32Array
}

export interface ProgressiveJpeg extends RenderJpeg {
  readonly width: number
  readonly height: number
  readonly components: readonly ProgressiveComponent[]
  readonly mcusPerColumn: number
}

interface ProgressiveScanComponent {
  readonly component: ProgressiveFrameComponent
  readonly componentIndex: number
  readonly dcTable?: HuffmanTable
  readonly acTable?: HuffmanTable
}

interface ProgressiveScan {
  readonly components: readonly ProgressiveScanComponent[]
  readonly spectralStart: number
  readonly spectralEnd: number
  readonly successiveHigh: number
  readonly successiveLow: number
}

interface ProgressiveState {
  eobRun: number
}

const coefficientOffset = (
  component: ProgressiveFrameComponent,
  blockX: number,
  blockY: number,
): number => (blockY * component.blocksPerLineForMcu + blockX) * 64

const setCoefficient = (coefficients: Int16Array, index: number, value: number): void => {
  if (value < -32_768 || value > 32_767)
    throw invalidInput('Progressive JPEG coefficient exceeds 16-bit storage')
  coefficients[index] = value
}

const decodeProgressiveDcFirst = (
  reader: EntropyReader,
  selected: ProgressiveScanComponent,
  predictors: Int32Array,
  blockOffset: number,
  successiveLow: number,
): void => {
  if (!selected.dcTable) throw invalidInput('Progressive JPEG DC table is missing')
  const length = decodeHuffman(reader, selected.dcTable)
  if (length > 11) throw invalidInput('Progressive JPEG DC coefficient is invalid')
  const predictor = byte(predictors, selected.componentIndex) + reader.receiveAndExtend(length)
  predictors[selected.componentIndex] = predictor
  setCoefficient(selected.component.coefficients, blockOffset, predictor * 2 ** successiveLow)
}

const decodeProgressiveDcRefinement = (
  reader: EntropyReader,
  component: ProgressiveFrameComponent,
  blockOffset: number,
  successiveLow: number,
): void => {
  if (reader.readBit() === 0) return
  const value = byte(component.coefficients, blockOffset)
  setCoefficient(component.coefficients, blockOffset, value | (1 << successiveLow))
}

const decodeProgressiveAcFirst = (
  reader: EntropyReader,
  selected: ProgressiveScanComponent,
  blockOffset: number,
  scan: ProgressiveScan,
  state: ProgressiveState,
): void => {
  if (!selected.acTable) throw invalidInput('Progressive JPEG AC table is missing')
  if (state.eobRun > 0) {
    state.eobRun -= 1
    return
  }
  let spectral = scan.spectralStart
  while (spectral <= scan.spectralEnd) {
    const symbol = decodeHuffman(reader, selected.acTable)
    const zeroes = symbol >>> 4
    const length = symbol & 15
    if (length === 0) {
      if (zeroes === 15) {
        spectral += 16
        continue
      }
      state.eobRun = (1 << zeroes) + reader.readBits(zeroes) - 1
      return
    }
    if (length > 10) throw invalidInput('Progressive JPEG AC coefficient is invalid')
    spectral += zeroes
    if (spectral > scan.spectralEnd)
      throw invalidInput('Progressive JPEG AC coefficient exceeds its spectral band')
    const target = blockOffset + byte(zigZag, spectral)
    setCoefficient(
      selected.component.coefficients,
      target,
      reader.receiveAndExtend(length) * 2 ** scan.successiveLow,
    )
    spectral += 1
  }
}

const refineNonzeroCoefficient = (
  reader: EntropyReader,
  coefficients: Int16Array,
  index: number,
  bit: number,
): void => {
  const value = byte(coefficients, index)
  if (reader.readBit() === 0 || (Math.abs(value) & bit) !== 0) return
  setCoefficient(coefficients, index, value + (value > 0 ? bit : -bit))
}

const decodeProgressiveAcRefinement = (
  reader: EntropyReader,
  selected: ProgressiveScanComponent,
  blockOffset: number,
  scan: ProgressiveScan,
  state: ProgressiveState,
): void => {
  if (!selected.acTable) throw invalidInput('Progressive JPEG AC table is missing')
  const coefficients = selected.component.coefficients
  const bit = 1 << scan.successiveLow
  let spectral = scan.spectralStart

  if (state.eobRun > 0) {
    for (; spectral <= scan.spectralEnd; spectral += 1) {
      const target = blockOffset + byte(zigZag, spectral)
      if (byte(coefficients, target) !== 0)
        refineNonzeroCoefficient(reader, coefficients, target, bit)
    }
    state.eobRun -= 1
    return
  }

  while (spectral <= scan.spectralEnd) {
    const symbol = decodeHuffman(reader, selected.acTable)
    let zeroes = symbol >>> 4
    const length = symbol & 15
    let newCoefficient = 0
    if (length === 0) {
      if (zeroes !== 15) {
        state.eobRun = (1 << zeroes) + reader.readBits(zeroes) - 1
        for (; spectral <= scan.spectralEnd; spectral += 1) {
          const target = blockOffset + byte(zigZag, spectral)
          if (byte(coefficients, target) !== 0)
            refineNonzeroCoefficient(reader, coefficients, target, bit)
        }
        return
      }
      zeroes = 16
    } else {
      if (length !== 1) throw invalidInput('Progressive JPEG AC refinement coefficient is invalid')
      newCoefficient = reader.readBit() === 1 ? bit : -bit
    }

    while (spectral <= scan.spectralEnd) {
      const target = blockOffset + byte(zigZag, spectral)
      if (byte(coefficients, target) !== 0) {
        refineNonzeroCoefficient(reader, coefficients, target, bit)
      } else {
        if (zeroes === 0) break
        zeroes -= 1
      }
      spectral += 1
    }
    if (newCoefficient !== 0) {
      if (spectral > scan.spectralEnd)
        throw invalidInput('Progressive JPEG AC refinement exceeds its spectral band')
      setCoefficient(coefficients, blockOffset + byte(zigZag, spectral), newCoefficient)
      spectral += 1
    }
  }
}

const validateProgressiveScan = (scan: ProgressiveScan): void => {
  const { spectralStart, spectralEnd, successiveHigh, successiveLow } = scan
  if (
    spectralStart > spectralEnd ||
    spectralEnd > 63 ||
    successiveHigh > 13 ||
    successiveLow > 13 ||
    (successiveHigh !== 0 && successiveHigh !== successiveLow + 1)
  ) {
    throw invalidInput('Progressive JPEG scan parameters are invalid')
  }
  if (spectralStart === 0 && spectralEnd !== 0)
    throw invalidInput('Progressive JPEG DC scan must contain only coefficient zero')
  if (spectralStart > 0 && scan.components.length !== 1)
    throw invalidInput('Progressive JPEG AC scan must contain one component')

  for (const selected of scan.components) {
    const progression = selected.component.successiveBits
    for (let spectral = spectralStart; spectral <= spectralEnd; spectral += 1) {
      const previous = progression[spectral] ?? -1
      if (
        (successiveHigh === 0 && previous !== -1) ||
        (successiveHigh !== 0 && previous !== successiveHigh)
      ) {
        throw invalidInput('Progressive JPEG scan order is invalid')
      }
      progression[spectral] = successiveLow
    }
  }
}

const decodeProgressiveScan = (
  data: Uint8Array,
  offset: number,
  scan: ProgressiveScan,
  mcusPerLine: number,
  mcusPerColumn: number,
  restartInterval: number,
): number => {
  validateProgressiveScan(scan)
  const reader = new EntropyReader(data, offset)
  const predictors = new Int32Array(
    Math.max(...scan.components.map((selected) => selected.componentIndex)) + 1,
  )
  const state: ProgressiveState = { eobRun: 0 }
  const single = scan.components.length === 1 ? scan.components[0] : undefined
  const scanMcusPerLine = single ? single.component.blocksPerLine : mcusPerLine
  const scanMcusPerColumn = single ? single.component.blocksPerColumn : mcusPerColumn
  let mcu = 0
  let restart = 0

  for (let mcuY = 0; mcuY < scanMcusPerColumn; mcuY += 1) {
    for (let mcuX = 0; mcuX < scanMcusPerLine; mcuX += 1) {
      if (restartInterval > 0 && mcu > 0 && mcu % restartInterval === 0) {
        reader.restart(restart)
        restart += 1
        predictors.fill(0)
        state.eobRun = 0
      }
      for (const selected of scan.components) {
        const blocksWide = single ? 1 : selected.component.horizontalSampling
        const blocksHigh = single ? 1 : selected.component.verticalSampling
        for (let blockY = 0; blockY < blocksHigh; blockY += 1) {
          for (let blockX = 0; blockX < blocksWide; blockX += 1) {
            const x = single ? mcuX : mcuX * blocksWide + blockX
            const y = single ? mcuY : mcuY * blocksHigh + blockY
            const target = coefficientOffset(selected.component, x, y)
            if (scan.spectralStart === 0) {
              if (scan.successiveHigh === 0) {
                decodeProgressiveDcFirst(reader, selected, predictors, target, scan.successiveLow)
              } else {
                decodeProgressiveDcRefinement(
                  reader,
                  selected.component,
                  target,
                  scan.successiveLow,
                )
              }
            } else if (scan.successiveHigh === 0) {
              decodeProgressiveAcFirst(reader, selected, target, scan, state)
            } else {
              decodeProgressiveAcRefinement(reader, selected, target, scan, state)
            }
          }
        }
      }
      mcu += 1
    }
  }
  return reader.scanEnd()
}

const progressiveFrameComponents = (
  frame: ParsedFrame,
  maximumHorizontalSampling: number,
  maximumVerticalSampling: number,
  mcusPerLine: number,
  mcusPerColumn: number,
): ProgressiveFrameComponent[] =>
  frame.components.map((component) => {
    const blocksPerLine = Math.ceil(
      (Math.ceil(frame.width / 8) * component.horizontalSampling) / maximumHorizontalSampling,
    )
    const blocksPerColumn = Math.ceil(
      (Math.ceil(frame.height / 8) * component.verticalSampling) / maximumVerticalSampling,
    )
    const blocksPerLineForMcu = mcusPerLine * component.horizontalSampling
    const blocksPerColumnForMcu = mcusPerColumn * component.verticalSampling
    const successiveBits = new Int8Array(64)
    successiveBits.fill(-1)
    return {
      ...component,
      blocksPerLine,
      blocksPerColumn,
      blocksPerLineForMcu,
      blocksPerColumnForMcu,
      coefficients: new Int16Array(blocksPerLineForMcu * blocksPerColumnForMcu * 64),
      successiveBits,
    }
  })

export const parseProgressiveJpeg = (
  data: Uint8Array,
  validateDimensions: (width: number, height: number) => void,
): ProgressiveJpeg | undefined => {
  if (data.byteLength < 4 || readUint16(data, 0) !== 0xffd8)
    throw invalidInput('JPEG start marker is missing')
  const quantizationTables = new Map<number, Int32Array>()
  const dcTables = new Map<number, HuffmanTable>()
  const acTables = new Map<number, HuffmanTable>()
  let frame: ParsedFrame | undefined
  let components: ProgressiveFrameComponent[] | undefined
  let maximumHorizontalSampling = 1
  let maximumVerticalSampling = 1
  let mcusPerLine = 0
  let mcusPerColumn = 0
  let restartInterval = 0
  let sawScan = false
  let offset = 2

  while (offset < data.byteLength) {
    while (byte(data, offset) === 0xff) offset += 1
    if (offset >= data.byteLength) throw truncatedInput('JPEG marker is truncated')
    const marker = byte(data, offset)
    offset += 1
    if (marker === 0xd9) {
      if (!frame || !components || !sawScan)
        throw invalidInput('Progressive JPEG ended before image data')
      const outputComponents: ProgressiveComponent[] = components.map((component) => {
        const quantization = quantizationTables.get(component.quantizationId)
        if (!quantization)
          throw invalidInput('Progressive JPEG component references a missing quantization table')
        return { ...component, quantization }
      })
      return {
        width: frame.width,
        height: frame.height,
        components: outputComponents,
        maximumHorizontalSampling,
        maximumVerticalSampling,
        mcusPerLine,
        mcusPerColumn,
      }
    }
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd8))
      throw invalidInput('JPEG contains an unexpected standalone marker')
    const end = segmentEnd(data, offset)
    const start = offset + 2

    if (marker === 0xdb) parseQuantizationTables(data, start, end, quantizationTables)
    else if (marker === 0xc4) parseHuffmanTables(data, start, end, dcTables, acTables)
    else if (marker === 0xc0 || marker === 0xc1) return undefined
    else if (marker === 0xc2) {
      if (frame) throw invalidInput('Progressive JPEG contains multiple frames')
      frame = parseFrame(data, start, end)
      validateDimensions(frame.width, frame.height)
      for (const component of frame.components) {
        maximumHorizontalSampling = Math.max(
          maximumHorizontalSampling,
          component.horizontalSampling,
        )
        maximumVerticalSampling = Math.max(maximumVerticalSampling, component.verticalSampling)
      }
      mcusPerLine = Math.ceil(frame.width / (8 * maximumHorizontalSampling))
      mcusPerColumn = Math.ceil(frame.height / (8 * maximumVerticalSampling))
      components = progressiveFrameComponents(
        frame,
        maximumHorizontalSampling,
        maximumVerticalSampling,
        mcusPerLine,
        mcusPerColumn,
      )
    } else if (marker === 0xdd) {
      if (end - start !== 2) throw invalidInput('JPEG restart interval is invalid')
      restartInterval = readUint16(data, start)
    } else if (marker === 0xda) {
      if (!frame || !components) throw invalidInput('JPEG scan appears before its frame')
      const selectorCount = byte(data, start)
      if (
        selectorCount < 1 ||
        selectorCount > components.length ||
        start + 1 + selectorCount * 2 + 3 !== end
      ) {
        throw invalidInput('Progressive JPEG scan header is invalid')
      }
      const selected: ProgressiveScanComponent[] = []
      const selectedIds = new Set<number>()
      for (let index = 0; index < selectorCount; index += 1) {
        const selectorOffset = start + 1 + index * 2
        const selectedId = byte(data, selectorOffset)
        if (selectedIds.has(selectedId))
          throw invalidInput('Progressive JPEG scan repeats a component')
        selectedIds.add(selectedId)
        const component = components.find((candidate) => candidate.id === selectedId)
        if (!component) throw invalidInput('JPEG scan references an unknown component')
        const componentIndex = components.indexOf(component)
        const tables = byte(data, selectorOffset + 1)
        const dcTable = dcTables.get(tables >>> 4)
        const acTable = acTables.get(tables & 15)
        selected.push({
          component,
          componentIndex,
          ...(dcTable ? { dcTable } : {}),
          ...(acTable ? { acTable } : {}),
        })
      }
      const spectralOffset = start + 1 + selectorCount * 2
      const successive = byte(data, spectralOffset + 2)
      const scan: ProgressiveScan = {
        components: selected,
        spectralStart: byte(data, spectralOffset),
        spectralEnd: byte(data, spectralOffset + 1),
        successiveHigh: successive >>> 4,
        successiveLow: successive & 15,
      }
      offset = decodeProgressiveScan(data, end, scan, mcusPerLine, mcusPerColumn, restartInterval)
      sawScan = true
      continue
    }
    offset = end
  }
  throw truncatedInput('Progressive JPEG is missing its end marker')
}

export const decodeProgressiveJpeg = async function* (
  jpeg: ProgressiveJpeg,
  region: JpegRegion,
): AsyncGenerator<PixelBlock> {
  const workspace = new Float64Array(64)
  const block = new Uint8Array(64)
  for (let mcuRow = 0; mcuRow < jpeg.mcusPerColumn; mcuRow += 1) {
    const planes = componentPlanes(jpeg)
    for (let componentIndex = 0; componentIndex < jpeg.components.length; componentIndex += 1) {
      const component = jpeg.components[componentIndex]
      const plane = planes[componentIndex]
      if (!component || !plane) throw invalidInput('JPEG component storage is missing')
      const planeWidth = jpeg.mcusPerLine * component.horizontalSampling * 8
      for (let blockY = 0; blockY < component.verticalSampling; blockY += 1) {
        const sourceBlockY = mcuRow * component.verticalSampling + blockY
        for (let blockX = 0; blockX < component.blocksPerLineForMcu; blockX += 1) {
          inverseDct(
            component.coefficients,
            component.quantization,
            workspace,
            block,
            coefficientOffset(component, blockX, sourceBlockY),
          )
          writeBlock(plane, planeWidth, block, blockX, blockY)
        }
      }
    }
    const output = renderRows(jpeg, planes, mcuRow, region)
    if (output) yield output
  }
}
