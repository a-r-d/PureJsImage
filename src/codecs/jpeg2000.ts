import type { DecodeRequest, ImageCodec, ImageDecoder, ImageMetadata } from '../codec.ts'
import { invalidInput, limitExceeded, truncatedInput, unsupportedOperation } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import { validateImageDimensions } from '../limits.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { ImageSource } from '../source.ts'
import { readExactly } from '../source.ts'
import { decodeJpeg2000CodeBlock, type Jpeg2000Subband } from './jpeg2000-tier1.ts'
import { inverseJpeg2000Wavelet, type Jpeg2000ResolutionCoefficients } from './jpeg2000-wavelet.ts'

const signature = Uint8Array.of(0, 0, 0, 12, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a)
const blockRows = 32
const maximumBoxes = 4096
const maximumComponents = 16
const maximumTiles = 65_536
const maximumDecompositionLevels = 16
const maximumLayers = 16_384
const maximumPackets = 4_194_304
const maximumCodeBlocks = 4_194_304

const isJp2 = (header: Uint8Array): boolean => {
  if (header.byteLength < signature.byteLength) return false
  for (let index = 0; index < signature.byteLength; index += 1) {
    if (header[index] !== signature[index]) return false
  }
  return true
}

const be16 = (data: Uint8Array, offset: number, message = 'JPEG 2000 value'): number => {
  const high = data[offset]
  const low = data[offset + 1]
  if (high === undefined || low === undefined) throw truncatedInput(`${message} is truncated`)
  return high * 256 + low
}

const be32 = (data: Uint8Array, offset: number, message = 'JPEG 2000 value'): number => {
  const a = data[offset]
  const b = data[offset + 1]
  const c = data[offset + 2]
  const d = data[offset + 3]
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    throw truncatedInput(`${message} is truncated`)
  }
  return a * 16_777_216 + b * 65_536 + c * 256 + d
}

const fourcc = (data: Uint8Array, offset: number): string => {
  const a = data[offset]
  const b = data[offset + 1]
  const c = data[offset + 2]
  const d = data[offset + 3]
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    throw truncatedInput('JP2 box type is truncated')
  }
  return String.fromCharCode(a, b, c, d)
}

interface Jp2Box {
  readonly type: string
  readonly start: number
  readonly content: number
  readonly end: number
}

const readBox = async (source: ImageSource, start: number, parentEnd: number): Promise<Jp2Box> => {
  if (start + 8 > parentEnd) throw truncatedInput(`JP2 box header at ${start} is truncated`)
  const header = await readExactly(source, start, Math.min(16, parentEnd - start))
  const length32 = be32(header, 0, 'JP2 box length')
  const type = fourcc(header, 4)
  let headerBytes = 8
  let length = length32
  if (length32 === 1) {
    if (header.byteLength < 16) throw truncatedInput(`JP2 extended box ${type} is truncated`)
    const extended = BigInt(be32(header, 8)) * 0x1_0000_0000n + BigInt(be32(header, 12))
    if (extended > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw limitExceeded(`JP2 box ${type} length exceeds safe integer range`)
    }
    length = Number(extended)
    headerBytes = 16
  } else if (length32 === 0) {
    length = parentEnd - start
  }
  if (length < headerBytes) throw invalidInput(`JP2 box ${type} length ${length} is invalid`)
  const end = start + length
  if (!Number.isSafeInteger(end) || end > parentEnd) {
    throw truncatedInput(`JP2 box ${type} exceeds its containing extent`)
  }
  return { type, start, content: start + headerBytes, end }
}

interface Jp2Header {
  readonly width: number
  readonly height: number
  readonly components: number
  readonly bitDepths: readonly number[]
  readonly signed: readonly boolean[]
  readonly colorSpace: 'gray' | 'srgb' | 'sycc'
  readonly codestreamOffset: number
  readonly codestreamLength: number
}

interface MutableJp2Header {
  width?: number
  height?: number
  components?: number
  sharedBitDepth?: number
  sharedSigned?: boolean
  bitDepths?: readonly number[]
  signed?: readonly boolean[]
  colorSpace?: 'gray' | 'srgb' | 'sycc'
}

const parseImageHeaderBox = (data: Uint8Array, header: MutableJp2Header): void => {
  if (data.byteLength !== 14) throw invalidInput('JP2 ihdr box must contain 14 bytes')
  const height = be32(data, 0, 'JP2 image height')
  const width = be32(data, 4, 'JP2 image width')
  const components = be16(data, 8, 'JP2 component count')
  const bpc = data[10]
  const compression = data[11]
  const unknownColor = data[12]
  const intellectualProperty = data[13]
  if (bpc === undefined || compression === undefined || unknownColor === undefined) {
    throw truncatedInput('JP2 ihdr box is truncated')
  }
  if (width < 1 || height < 1 || components < 1) throw invalidInput('JP2 dimensions are invalid')
  if (components > maximumComponents) {
    throw limitExceeded(`JP2 component count ${components} exceeds ${maximumComponents}`)
  }
  if (compression !== 7)
    throw unsupportedOperation(`JP2 compression type ${compression} is unsupported`)
  if (unknownColor !== 0) throw unsupportedOperation('JP2 unknown color space is unsupported')
  if (intellectualProperty !== 0) {
    throw unsupportedOperation('JP2 intellectual-property protected input is unsupported')
  }
  header.width = width
  header.height = height
  header.components = components
  if (bpc !== 0xff) {
    header.sharedBitDepth = (bpc & 0x7f) + 1
    header.sharedSigned = (bpc & 0x80) !== 0
  }
}

const parseBitsPerComponentBox = (data: Uint8Array, header: MutableJp2Header): void => {
  if (header.components === undefined) throw invalidInput('JP2 bpcc precedes ihdr')
  if (header.sharedBitDepth !== undefined) {
    throw invalidInput('JP2 bpcc is present when ihdr declares a shared bit depth')
  }
  if (data.byteLength !== header.components) {
    throw invalidInput('JP2 bpcc component count disagrees with ihdr')
  }
  const depths: number[] = []
  const signed: boolean[] = []
  for (const value of data) {
    depths.push((value & 0x7f) + 1)
    signed.push((value & 0x80) !== 0)
  }
  header.bitDepths = depths
  header.signed = signed
}

const parseColorBox = (data: Uint8Array, header: MutableJp2Header): void => {
  if (data.byteLength < 3) throw truncatedInput('JP2 colr box is truncated')
  const method = data[0]
  const precedence = data[1]
  const approximation = data[2]
  if (method === undefined || precedence === undefined || approximation === undefined) {
    throw truncatedInput('JP2 colr box is truncated')
  }
  if (precedence !== 0 || approximation !== 0) {
    throw unsupportedOperation('JP2 non-zero color precedence or approximation is unsupported')
  }
  if (method === 2) throw unsupportedOperation('JP2 embedded ICC color is not implemented')
  if (method !== 1 || data.byteLength !== 7) {
    throw unsupportedOperation(`JP2 color specification method ${method} is unsupported`)
  }
  const enumerated = be32(data, 3, 'JP2 enumerated color space')
  const colorSpace =
    enumerated === 16 ? 'srgb' : enumerated === 17 ? 'gray' : enumerated === 18 ? 'sycc' : undefined
  if (!colorSpace)
    throw unsupportedOperation(`JP2 enumerated color space ${enumerated} is unsupported`)
  if (header.colorSpace !== undefined && header.colorSpace !== colorSpace) {
    throw invalidInput('JP2 colr boxes contradict each other')
  }
  header.colorSpace = colorSpace
}

const parseJp2Header = async (
  source: ImageSource,
  box: Jp2Box,
  state: MutableJp2Header,
  boxCounter: { value: number },
): Promise<void> => {
  let position = box.content
  let sawIhdr = false
  while (position < box.end) {
    boxCounter.value += 1
    if (boxCounter.value > maximumBoxes) throw limitExceeded('JP2 box count exceeds limit')
    const child = await readBox(source, position, box.end)
    const length = child.end - child.content
    if (child.type === 'ihdr') {
      if (sawIhdr) throw invalidInput('JP2 contains duplicate ihdr boxes')
      if (position !== box.content) throw invalidInput('JP2 ihdr must be first in jp2h')
      parseImageHeaderBox(await readExactly(source, child.content, length), state)
      sawIhdr = true
    } else if (child.type === 'bpcc') {
      parseBitsPerComponentBox(await readExactly(source, child.content, length), state)
    } else if (child.type === 'colr') {
      parseColorBox(await readExactly(source, child.content, length), state)
    } else if (child.type === 'pclr' || child.type === 'cmap' || child.type === 'cdef') {
      throw unsupportedOperation(`JP2 ${child.type} channel mapping is not implemented`)
    } else if (child.type === 'res ') {
      // Resolution metadata is bounded by the validated superbox and is not
      // needed to reconstruct pixels yet.
    }
    position = child.end
  }
  if (!sawIhdr) throw invalidInput('JP2 header is missing ihdr')
}

const describeContainer = async (source: ImageSource, limits: ImageLimits): Promise<Jp2Header> => {
  if (source.size < signature.byteLength) throw truncatedInput('JP2 signature box is truncated')
  const signatureBytes = await readExactly(source, 0, signature.byteLength)
  if (!isJp2(signatureBytes)) throw invalidInput('JP2 signature box is invalid')
  const mutable: MutableJp2Header = {}
  const boxCounter = { value: 1 }
  let position = signature.byteLength
  let sawFtyp = false
  let sawHeader = false
  let codestreamOffset: number | undefined
  let codestreamLength: number | undefined
  while (position < source.size) {
    boxCounter.value += 1
    if (boxCounter.value > maximumBoxes) throw limitExceeded('JP2 box count exceeds limit')
    const box = await readBox(source, position, source.size)
    const length = box.end - box.content
    if (box.type === 'jP  ') throw invalidInput('JP2 contains a duplicate signature box')
    if (box.type === 'ftyp') {
      if (sawFtyp) throw invalidInput('JP2 contains duplicate ftyp boxes')
      if (position !== signature.byteLength)
        throw invalidInput('JP2 ftyp must follow the signature')
      const data = await readExactly(source, box.content, length)
      if (data.byteLength < 8 || (data.byteLength - 8) % 4 !== 0) {
        throw invalidInput('JP2 ftyp box has an invalid length')
      }
      const brand = fourcc(data, 0)
      let compatible = brand === 'jp2 '
      for (let offset = 8; offset < data.byteLength; offset += 4) {
        if (fourcc(data, offset) === 'jp2 ') compatible = true
      }
      if (!compatible) throw unsupportedOperation(`JP2 brand ${brand} is unsupported`)
      if (brand !== 'jp2 ') throw unsupportedOperation(`JPX/JPM brand ${brand} is unsupported`)
      sawFtyp = true
    } else if (box.type === 'jp2h') {
      if (!sawFtyp) throw invalidInput('JP2 header precedes ftyp')
      if (sawHeader) throw invalidInput('JP2 contains duplicate jp2h boxes')
      if (codestreamOffset !== undefined) throw invalidInput('JP2 header follows codestream')
      await parseJp2Header(source, box, mutable, boxCounter)
      sawHeader = true
    } else if (box.type === 'jp2c') {
      if (!sawHeader) throw invalidInput('JP2 codestream precedes jp2h')
      if (codestreamOffset !== undefined) {
        throw unsupportedOperation('JP2 multiple codestreams are unsupported')
      }
      if (length < 4) throw truncatedInput('JP2 codestream box is truncated')
      codestreamOffset = box.content
      codestreamLength = length
    }
    position = box.end
  }
  if (!sawFtyp || !sawHeader || codestreamOffset === undefined || codestreamLength === undefined) {
    throw invalidInput('JP2 is missing ftyp, jp2h, or jp2c')
  }
  const { width, height, components, colorSpace } = mutable
  if (width === undefined || height === undefined || components === undefined || !colorSpace) {
    throw invalidInput('JP2 required image metadata is missing')
  }
  validateImageDimensions(width, height, 1, limits)
  const bitDepths =
    mutable.bitDepths ??
    (mutable.sharedBitDepth === undefined
      ? undefined
      : Array.from({ length: components }, () => mutable.sharedBitDepth ?? 0))
  const signed =
    mutable.signed ??
    (mutable.sharedSigned === undefined
      ? undefined
      : Array.from({ length: components }, () => mutable.sharedSigned ?? false))
  if (!bitDepths || !signed) throw invalidInput('JP2 bit-depth metadata is missing')
  if (bitDepths.some((depth) => depth < 1 || depth > 16)) {
    throw unsupportedOperation('JP2 component precision above 16 bits is unsupported')
  }
  return {
    width,
    height,
    components,
    bitDepths,
    signed,
    colorSpace,
    codestreamOffset,
    codestreamLength,
  }
}

interface ComponentSpec {
  readonly precision: number
  readonly signed: boolean
  readonly xSampling: number
  readonly ySampling: number
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

interface SizeMarker {
  readonly capabilities: number
  readonly xSize: number
  readonly ySize: number
  readonly xOrigin: number
  readonly yOrigin: number
  readonly tileWidth: number
  readonly tileHeight: number
  readonly tileXOrigin: number
  readonly tileYOrigin: number
  readonly components: readonly ComponentSpec[]
}

interface CodingStyle {
  readonly customPrecincts: boolean
  readonly sop: boolean
  readonly eph: boolean
  readonly progression: 0 | 1 | 2 | 3 | 4
  readonly layers: number
  readonly transformComponents: boolean
  readonly decompositionLevels: number
  readonly codeBlockWidthExponent: number
  readonly codeBlockHeightExponent: number
  readonly segmentationSymbols: boolean
  readonly reversible: boolean
  readonly precincts: readonly { readonly x: number; readonly y: number }[]
}

interface QuantStep {
  readonly exponent: number
  readonly mantissa: number
}

interface Quantization {
  readonly style: 0 | 1 | 2
  readonly guardBits: number
  readonly steps: readonly QuantStep[]
}

interface CodeBlockChunk {
  readonly start: number
  readonly end: number
  readonly codingPasses: number
}

interface PrecinctState {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
  inclusion?: InclusionTree
  zeroPlanes?: ValueTree
}

interface CodeBlock {
  readonly x: number
  readonly y: number
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
  readonly clippedX0: number
  readonly clippedY0: number
  readonly clippedX1: number
  readonly clippedY1: number
  readonly precinctIndex: number
  readonly precinct: PrecinctState
  readonly band: Jpeg2000Subband
  lblock: number
  included: boolean
  zeroBitPlanes: number
  readonly chunks: CodeBlockChunk[]
}

interface Subband {
  readonly type: Jpeg2000Subband
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
  readonly blocks: readonly CodeBlock[]
}

interface Resolution {
  readonly level: number
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
  readonly precinctWidth: number
  readonly precinctHeight: number
  readonly precinctColumns: number
  readonly precinctRows: number
  readonly bands: readonly Subband[]
}

interface TileComponent {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
  readonly style: CodingStyle
  readonly quantization: Quantization
  resolutions: readonly Resolution[]
}

interface Tile {
  readonly index: number
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
  readonly components: readonly TileComponent[]
  readonly style: CodingStyle
  packets: readonly Packet[]
  nextPacket: number
  decoded: boolean
}

interface Packet {
  readonly layer: number
  readonly resolution: number
  readonly component: number
  readonly precinct: number
  readonly positionX: number
  readonly positionY: number
  readonly blocks: readonly CodeBlock[]
}

interface ParsedCodestream {
  readonly size: SizeMarker
  readonly tiles: readonly Tile[]
  readonly lossless: boolean
  readonly resolutionLevels: number
}

const parseSizeMarker = (payload: Uint8Array, limits: ImageLimits): SizeMarker => {
  if (payload.byteLength < 36) throw truncatedInput('JPEG 2000 SIZ marker is truncated')
  const capabilities = be16(payload, 0, 'JPEG 2000 capabilities')
  const xSize = be32(payload, 2, 'JPEG 2000 Xsiz')
  const ySize = be32(payload, 6, 'JPEG 2000 Ysiz')
  const xOrigin = be32(payload, 10, 'JPEG 2000 XOsiz')
  const yOrigin = be32(payload, 14, 'JPEG 2000 YOsiz')
  const tileWidth = be32(payload, 18, 'JPEG 2000 XTsiz')
  const tileHeight = be32(payload, 22, 'JPEG 2000 YTsiz')
  const tileXOrigin = be32(payload, 26, 'JPEG 2000 XTOsiz')
  const tileYOrigin = be32(payload, 30, 'JPEG 2000 YTOsiz')
  const count = be16(payload, 34, 'JPEG 2000 component count')
  if (capabilities > 2) {
    throw unsupportedOperation(`JPEG 2000 capabilities value ${capabilities} is unsupported`)
  }
  if (payload.byteLength !== 36 + count * 3) {
    throw invalidInput('JPEG 2000 SIZ component table length is invalid')
  }
  if (count < 1 || count > maximumComponents) {
    throw limitExceeded(`JPEG 2000 component count ${count} exceeds ${maximumComponents}`)
  }
  if (
    xOrigin >= xSize ||
    yOrigin >= ySize ||
    tileWidth < 1 ||
    tileHeight < 1 ||
    tileXOrigin > xOrigin ||
    tileYOrigin > yOrigin
  ) {
    throw invalidInput('JPEG 2000 reference grid or tile origin is invalid')
  }
  validateImageDimensions(xSize - xOrigin, ySize - yOrigin, 1, limits)
  const components: ComponentSpec[] = []
  for (let index = 0; index < count; index += 1) {
    const offset = 36 + index * 3
    const precisionByte = payload[offset]
    const xSampling = payload[offset + 1]
    const ySampling = payload[offset + 2]
    if (precisionByte === undefined || xSampling === undefined || ySampling === undefined) {
      throw truncatedInput('JPEG 2000 SIZ component is truncated')
    }
    const precision = (precisionByte & 0x7f) + 1
    if (precision > 16) {
      throw unsupportedOperation(`JPEG 2000 ${precision}-bit components are unsupported`)
    }
    if (xSampling < 1 || ySampling < 1) {
      throw invalidInput('JPEG 2000 component sampling factors must be positive')
    }
    components.push({
      precision,
      signed: (precisionByte & 0x80) !== 0,
      xSampling,
      ySampling,
      x0: Math.ceil(xOrigin / xSampling),
      y0: Math.ceil(yOrigin / ySampling),
      x1: Math.ceil(xSize / xSampling),
      y1: Math.ceil(ySize / ySampling),
    })
  }
  const tileColumns = Math.ceil((xSize - tileXOrigin) / tileWidth)
  const tileRows = Math.ceil((ySize - tileYOrigin) / tileHeight)
  if (tileColumns * tileRows > maximumTiles) {
    throw limitExceeded(`JPEG 2000 tile count exceeds ${maximumTiles}`)
  }
  return {
    capabilities,
    xSize,
    ySize,
    xOrigin,
    yOrigin,
    tileWidth,
    tileHeight,
    tileXOrigin,
    tileYOrigin,
    components,
  }
}

const parseCodingStyle = (
  payload: Uint8Array,
  componentSpecific: boolean,
  componentBytes: 1 | 2,
  base: CodingStyle | undefined,
): { readonly component?: number; readonly style: CodingStyle } => {
  let position = 0
  let component: number | undefined
  if (componentSpecific) {
    component = componentBytes === 1 ? payload[0] : be16(payload, 0, 'JPEG 2000 COC component')
    if (component === undefined) throw truncatedInput('JPEG 2000 COC component is truncated')
    position += componentBytes
  }
  const flags = payload[position]
  if (flags === undefined) throw truncatedInput('JPEG 2000 coding style is truncated')
  position += 1
  let progression = base?.progression ?? 0
  let layers = base?.layers ?? 1
  let transformComponents = base?.transformComponents ?? false
  if (!componentSpecific) {
    const progressionValue = payload[position]
    if (
      progressionValue !== 0 &&
      progressionValue !== 1 &&
      progressionValue !== 2 &&
      progressionValue !== 3 &&
      progressionValue !== 4
    ) {
      throw unsupportedOperation(`JPEG 2000 progression order ${progressionValue} is unsupported`)
    }
    progression = progressionValue
    layers = be16(payload, position + 1, 'JPEG 2000 layer count')
    const transformValue = payload[position + 3]
    if (transformValue !== 0 && transformValue !== 1) {
      throw invalidInput('JPEG 2000 multiple-component transform flag is invalid')
    }
    transformComponents = transformValue === 1
    position += 4
  }
  const decompositionLevels = payload[position]
  const codeBlockWidth = payload[position + 1]
  const codeBlockHeight = payload[position + 2]
  const blockStyle = payload[position + 3]
  const transform = payload[position + 4]
  if (
    decompositionLevels === undefined ||
    codeBlockWidth === undefined ||
    codeBlockHeight === undefined ||
    blockStyle === undefined ||
    transform === undefined
  ) {
    throw truncatedInput('JPEG 2000 coding style parameters are truncated')
  }
  position += 5
  if (decompositionLevels > maximumDecompositionLevels) {
    throw limitExceeded(`JPEG 2000 decomposition level count exceeds ${maximumDecompositionLevels}`)
  }
  if (layers < 1 || layers > maximumLayers) {
    throw limitExceeded(`JPEG 2000 layer count ${layers} exceeds ${maximumLayers}`)
  }
  const codeBlockWidthExponent = (codeBlockWidth & 0x0f) + 2
  const codeBlockHeightExponent = (codeBlockHeight & 0x0f) + 2
  if (
    (codeBlockWidth & 0xf0) !== 0 ||
    (codeBlockHeight & 0xf0) !== 0 ||
    codeBlockWidthExponent > 10 ||
    codeBlockHeightExponent > 10 ||
    codeBlockWidthExponent + codeBlockHeightExponent > 12
  ) {
    throw unsupportedOperation('JPEG 2000 code-block dimensions are unsupported')
  }
  if ((blockStyle & 0xc0) !== 0) throw invalidInput('JPEG 2000 reserved code-block flags are set')
  if ((blockStyle & 0x1f) !== 0) {
    throw unsupportedOperation(
      'JPEG 2000 arithmetic bypass, context reset, pass termination, vertical causal, and predictable termination styles are not implemented',
    )
  }
  if (transform !== 0 && transform !== 1) {
    throw unsupportedOperation(`JPEG 2000 wavelet transform ${transform} is unsupported`)
  }
  const customPrecincts = (flags & 1) !== 0
  if ((flags & 0xf8) !== 0) throw invalidInput('JPEG 2000 reserved coding-style flags are set')
  const precincts: { x: number; y: number }[] = []
  if (customPrecincts) {
    if (payload.byteLength - position !== decompositionLevels + 1) {
      throw invalidInput('JPEG 2000 precinct size table length is invalid')
    }
    for (let level = 0; level <= decompositionLevels; level += 1) {
      const value = payload[position + level]
      if (value === undefined) throw truncatedInput('JPEG 2000 precinct size is truncated')
      precincts.push({ x: value & 0x0f, y: value >>> 4 })
    }
  } else {
    if (position !== payload.byteLength) throw invalidInput('JPEG 2000 COD has trailing bytes')
    for (let level = 0; level <= decompositionLevels; level += 1) precincts.push({ x: 15, y: 15 })
  }
  return {
    ...(component === undefined ? {} : { component }),
    style: {
      customPrecincts,
      sop: componentSpecific ? (base?.sop ?? false) : (flags & 2) !== 0,
      eph: componentSpecific ? (base?.eph ?? false) : (flags & 4) !== 0,
      progression,
      layers,
      transformComponents,
      decompositionLevels,
      codeBlockWidthExponent,
      codeBlockHeightExponent,
      segmentationSymbols: (blockStyle & 0x20) !== 0,
      reversible: transform === 1,
      precincts,
    },
  }
}

const parseQuantization = (
  payload: Uint8Array,
  componentBytes: 0 | 1 | 2,
): { readonly component?: number; readonly quantization: Quantization } => {
  let position = 0
  let component: number | undefined
  if (componentBytes === 1) {
    component = payload[position]
    position += 1
  } else if (componentBytes === 2) {
    component = be16(payload, position, 'JPEG 2000 QCC component')
    position += 2
  }
  const sq = payload[position]
  if (sq === undefined) throw truncatedInput('JPEG 2000 quantization marker is truncated')
  position += 1
  const styleValue = sq & 0x1f
  if (styleValue !== 0 && styleValue !== 1 && styleValue !== 2) {
    throw unsupportedOperation(`JPEG 2000 quantization style ${styleValue} is unsupported`)
  }
  const style: 0 | 1 | 2 = styleValue
  const bytesPerStep = style === 0 ? 1 : 2
  if ((payload.byteLength - position) % bytesPerStep !== 0 || position === payload.byteLength) {
    throw invalidInput('JPEG 2000 quantization step table length is invalid')
  }
  const steps: QuantStep[] = []
  while (position < payload.byteLength) {
    if (style === 0) {
      const value = payload[position]
      if (value === undefined) throw truncatedInput('JPEG 2000 quantization step is truncated')
      steps.push({ exponent: value >>> 3, mantissa: 0 })
      position += 1
    } else {
      const value = be16(payload, position, 'JPEG 2000 quantization step')
      steps.push({ exponent: value >>> 11, mantissa: value & 0x07ff })
      position += 2
    }
  }
  return {
    ...(component === undefined ? {} : { component }),
    quantization: { style, guardBits: sq >>> 5, steps },
  }
}

const tileBounds = (
  size: SizeMarker,
  index: number,
): { x0: number; y0: number; x1: number; y1: number } => {
  const columns = Math.ceil((size.xSize - size.tileXOrigin) / size.tileWidth)
  const rows = Math.ceil((size.ySize - size.tileYOrigin) / size.tileHeight)
  if (index < 0 || index >= columns * rows)
    throw invalidInput(`JPEG 2000 tile index ${index} is invalid`)
  const column = index % columns
  const row = Math.floor(index / columns)
  return {
    x0: Math.max(size.xOrigin, size.tileXOrigin + column * size.tileWidth),
    y0: Math.max(size.yOrigin, size.tileYOrigin + row * size.tileHeight),
    x1: Math.min(size.xSize, size.tileXOrigin + (column + 1) * size.tileWidth),
    y1: Math.min(size.ySize, size.tileYOrigin + (row + 1) * size.tileHeight),
  }
}

const buildSubband = (
  type: Jpeg2000Subband,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  resolution: { precinctColumns: number; precinctWidth: number; precinctHeight: number },
  codeBlockWidthExponent: number,
  codeBlockHeightExponent: number,
  nonzeroResolution: boolean,
  blockCounter: { value: number },
): Subband => {
  const bandPrecinctWidth = resolution.precinctWidth >>> (nonzeroResolution ? 1 : 0)
  const bandPrecinctHeight = resolution.precinctHeight >>> (nonzeroResolution ? 1 : 0)
  if (bandPrecinctWidth < 1 || bandPrecinctHeight < 1) {
    throw invalidInput('JPEG 2000 precinct is too small for its resolution')
  }
  const blockWidth = 2 ** codeBlockWidthExponent
  const blockHeight = 2 ** codeBlockHeightExponent
  const firstBlockX = Math.floor(x0 / blockWidth)
  const firstBlockY = Math.floor(y0 / blockHeight)
  const lastBlockX = Math.ceil(x1 / blockWidth)
  const lastBlockY = Math.ceil(y1 / blockHeight)
  const precincts = new Map<number, PrecinctState>()
  const temporary: {
    x: number
    y: number
    x0: number
    y0: number
    x1: number
    y1: number
    clippedX0: number
    clippedY0: number
    clippedX1: number
    clippedY1: number
    precinctIndex: number
  }[] = []
  for (let blockY = firstBlockY; blockY < lastBlockY; blockY += 1) {
    for (let blockX = firstBlockX; blockX < lastBlockX; blockX += 1) {
      const clippedX0 = Math.max(x0, blockX * blockWidth)
      const clippedY0 = Math.max(y0, blockY * blockHeight)
      const clippedX1 = Math.min(x1, (blockX + 1) * blockWidth)
      const clippedY1 = Math.min(y1, (blockY + 1) * blockHeight)
      if (clippedX0 >= clippedX1 || clippedY0 >= clippedY1) continue
      const precinctX = Math.floor((clippedX0 - x0) / bandPrecinctWidth)
      const precinctY = Math.floor((clippedY0 - y0) / bandPrecinctHeight)
      const precinctIndex = precinctY * resolution.precinctColumns + precinctX
      temporary.push({
        x: blockX,
        y: blockY,
        x0: blockX * blockWidth,
        y0: blockY * blockHeight,
        x1: (blockX + 1) * blockWidth,
        y1: (blockY + 1) * blockHeight,
        clippedX0,
        clippedY0,
        clippedX1,
        clippedY1,
        precinctIndex,
      })
      const existing = precincts.get(precinctIndex)
      if (existing) {
        precincts.set(precinctIndex, {
          minX: Math.min(existing.minX, blockX),
          minY: Math.min(existing.minY, blockY),
          maxX: Math.max(existing.maxX, blockX),
          maxY: Math.max(existing.maxY, blockY),
        })
      } else {
        precincts.set(precinctIndex, { minX: blockX, minY: blockY, maxX: blockX, maxY: blockY })
      }
      blockCounter.value += 1
      if (blockCounter.value > maximumCodeBlocks)
        throw limitExceeded('JPEG 2000 code-block count exceeds limit')
    }
  }
  const blocks: CodeBlock[] = temporary.map((block) => {
    const precinct = precincts.get(block.precinctIndex)
    if (!precinct) throw invalidInput('JPEG 2000 code-block precinct is missing')
    return {
      ...block,
      precinct,
      band: type,
      lblock: 3,
      included: false,
      zeroBitPlanes: 0,
      chunks: [],
    }
  })
  return { type, x0, y0, x1, y1, blocks }
}

const buildResolutions = (
  component: Omit<TileComponent, 'resolutions'>,
  blockCounter: { value: number },
): readonly Resolution[] => {
  const levels = component.style.decompositionLevels
  const resolutions: Resolution[] = []
  for (let level = 0; level <= levels; level += 1) {
    const scale = 2 ** (levels - level)
    const x0 = Math.ceil(component.x0 / scale)
    const y0 = Math.ceil(component.y0 / scale)
    const x1 = Math.ceil(component.x1 / scale)
    const y1 = Math.ceil(component.y1 / scale)
    const precinct = component.style.precincts[level]
    if (!precinct) throw invalidInput('JPEG 2000 precinct size is missing')
    const precinctWidth = 2 ** precinct.x
    const precinctHeight = 2 ** precinct.y
    const precinctColumns =
      x1 > x0 ? Math.ceil(x1 / precinctWidth) - Math.floor(x0 / precinctWidth) : 0
    const precinctRows =
      y1 > y0 ? Math.ceil(y1 / precinctHeight) - Math.floor(y0 / precinctHeight) : 0
    const blockWidthExponent = Math.min(
      component.style.codeBlockWidthExponent,
      precinct.x - (level > 0 ? 1 : 0),
    )
    const blockHeightExponent = Math.min(
      component.style.codeBlockHeightExponent,
      precinct.y - (level > 0 ? 1 : 0),
    )
    if (blockWidthExponent < 0 || blockHeightExponent < 0) {
      throw invalidInput('JPEG 2000 code-block exponent is incompatible with precinct size')
    }
    const geometry = { precinctColumns, precinctWidth, precinctHeight }
    const bands: Subband[] = []
    if (level === 0) {
      bands.push(
        buildSubband(
          'LL',
          x0,
          y0,
          x1,
          y1,
          geometry,
          blockWidthExponent,
          blockHeightExponent,
          false,
          blockCounter,
        ),
      )
    } else {
      const bandScale = 2 ** (levels - level + 1)
      bands.push(
        buildSubband(
          'HL',
          Math.ceil(component.x0 / bandScale - 0.5),
          Math.ceil(component.y0 / bandScale),
          Math.ceil(component.x1 / bandScale - 0.5),
          Math.ceil(component.y1 / bandScale),
          geometry,
          blockWidthExponent,
          blockHeightExponent,
          true,
          blockCounter,
        ),
        buildSubband(
          'LH',
          Math.ceil(component.x0 / bandScale),
          Math.ceil(component.y0 / bandScale - 0.5),
          Math.ceil(component.x1 / bandScale),
          Math.ceil(component.y1 / bandScale - 0.5),
          geometry,
          blockWidthExponent,
          blockHeightExponent,
          true,
          blockCounter,
        ),
        buildSubband(
          'HH',
          Math.ceil(component.x0 / bandScale - 0.5),
          Math.ceil(component.y0 / bandScale - 0.5),
          Math.ceil(component.x1 / bandScale - 0.5),
          Math.ceil(component.y1 / bandScale - 0.5),
          geometry,
          blockWidthExponent,
          blockHeightExponent,
          true,
          blockCounter,
        ),
      )
    }
    resolutions.push({
      level,
      x0,
      y0,
      x1,
      y1,
      precinctWidth,
      precinctHeight,
      precinctColumns,
      precinctRows,
      bands,
    })
  }
  return resolutions
}

const comparePackets =
  (progression: number) =>
  (left: Packet, right: Packet): number => {
    const compare = (a: number, b: number): number => a - b
    if (progression === 0) {
      return (
        compare(left.layer, right.layer) ||
        compare(left.resolution, right.resolution) ||
        compare(left.component, right.component) ||
        compare(left.positionY, right.positionY) ||
        compare(left.positionX, right.positionX)
      )
    }
    if (progression === 1) {
      return (
        compare(left.resolution, right.resolution) ||
        compare(left.layer, right.layer) ||
        compare(left.component, right.component) ||
        compare(left.positionY, right.positionY) ||
        compare(left.positionX, right.positionX)
      )
    }
    if (progression === 2) {
      return (
        compare(left.resolution, right.resolution) ||
        compare(left.positionY, right.positionY) ||
        compare(left.positionX, right.positionX) ||
        compare(left.component, right.component) ||
        compare(left.layer, right.layer)
      )
    }
    if (progression === 3) {
      return (
        compare(left.positionY, right.positionY) ||
        compare(left.positionX, right.positionX) ||
        compare(left.component, right.component) ||
        compare(left.resolution, right.resolution) ||
        compare(left.layer, right.layer)
      )
    }
    return (
      compare(left.component, right.component) ||
      compare(left.positionY, right.positionY) ||
      compare(left.positionX, right.positionX) ||
      compare(left.resolution, right.resolution) ||
      compare(left.layer, right.layer)
    )
  }

const buildPackets = (tile: Tile, size: SizeMarker): readonly Packet[] => {
  const packets: Packet[] = []
  for (let componentIndex = 0; componentIndex < tile.components.length; componentIndex += 1) {
    const component = tile.components[componentIndex]
    const sampling = size.components[componentIndex]
    if (!component || !sampling) throw invalidInput('JPEG 2000 tile component is missing')
    const levels = component.style.decompositionLevels
    for (const resolution of component.resolutions) {
      const scale = 2 ** (levels - resolution.level)
      const firstPrecinctX = Math.floor(resolution.x0 / resolution.precinctWidth)
      const firstPrecinctY = Math.floor(resolution.y0 / resolution.precinctHeight)
      for (let precinctY = 0; precinctY < resolution.precinctRows; precinctY += 1) {
        for (let precinctX = 0; precinctX < resolution.precinctColumns; precinctX += 1) {
          const precinct = precinctY * resolution.precinctColumns + precinctX
          const blocks: CodeBlock[] = []
          for (const band of resolution.bands) {
            for (const block of band.blocks) {
              if (block.precinctIndex === precinct) blocks.push(block)
            }
          }
          const positionX =
            (firstPrecinctX + precinctX) * resolution.precinctWidth * scale * sampling.xSampling
          const positionY =
            (firstPrecinctY + precinctY) * resolution.precinctHeight * scale * sampling.ySampling
          for (let layer = 0; layer < component.style.layers; layer += 1) {
            packets.push({
              layer,
              resolution: resolution.level,
              component: componentIndex,
              precinct,
              positionX,
              positionY,
              blocks,
            })
            if (packets.length > maximumPackets)
              throw limitExceeded('JPEG 2000 packet count exceeds limit')
          }
        }
      }
    }
  }
  packets.sort(comparePackets(tile.style.progression))
  return packets
}

const createTile = (options: {
  readonly index: number
  readonly size: SizeMarker
  readonly defaultStyle: CodingStyle
  readonly componentStyles: ReadonlyMap<number, CodingStyle>
  readonly defaultQuantization: Quantization
  readonly componentQuantizations: ReadonlyMap<number, Quantization>
  readonly blockCounter: { value: number }
}): Tile => {
  const bounds = tileBounds(options.size, options.index)
  const components: TileComponent[] = []
  for (let index = 0; index < options.size.components.length; index += 1) {
    const specification = options.size.components[index]
    if (!specification) throw invalidInput('JPEG 2000 component specification is missing')
    const style = options.componentStyles.get(index) ?? options.defaultStyle
    const quantization = options.componentQuantizations.get(index) ?? options.defaultQuantization
    const component: TileComponent = {
      x0: Math.ceil(bounds.x0 / specification.xSampling),
      y0: Math.ceil(bounds.y0 / specification.ySampling),
      x1: Math.ceil(bounds.x1 / specification.xSampling),
      y1: Math.ceil(bounds.y1 / specification.ySampling),
      style,
      quantization,
      resolutions: [],
    }
    component.resolutions = buildResolutions(component, options.blockCounter)
    components.push(component)
  }
  const tile: Tile = {
    index: options.index,
    ...bounds,
    components,
    style: options.defaultStyle,
    packets: [],
    nextPacket: 0,
    decoded: false,
  }
  tile.packets = buildPackets(tile, options.size)
  return tile
}

interface TreeLevel {
  readonly width: number
  readonly values: Uint16Array
  cursor: number
}

class ValueTree {
  readonly #levels: TreeLevel[] = []
  #level = 0
  value = 0

  constructor(width: number, height: number) {
    while (true) {
      this.#levels.push({ width, values: new Uint16Array(width * height), cursor: 0 })
      if (width === 1 && height === 1) break
      width = Math.ceil(width / 2)
      height = Math.ceil(height / 2)
    }
  }

  reset(x: number, y: number): void {
    let value = 0
    let found = this.#levels.length
    for (let levelIndex = 0; levelIndex < this.#levels.length; levelIndex += 1) {
      const level = this.#levels[levelIndex]
      if (!level) throw invalidInput('JPEG 2000 tag tree level is missing')
      const cursor = y * level.width + x
      level.cursor = cursor
      const stored = level.values[cursor] ?? 0
      if (stored !== 0) {
        value = stored - 1
        found = levelIndex
        break
      }
      x >>>= 1
      y >>>= 1
    }
    this.#level = Math.max(0, found - 1)
    const level = this.#levels[this.#level]
    if (!level) throw invalidInput('JPEG 2000 tag tree is empty')
    level.values[level.cursor] = value + 1
    this.value = value
  }

  increment(): void {
    const level = this.#levels[this.#level]
    if (!level) throw invalidInput('JPEG 2000 tag tree state is invalid')
    const value = (level.values[level.cursor] ?? 1) + 1
    level.values[level.cursor] = value
    this.value = value - 1
  }

  descend(): boolean {
    const level = this.#levels[this.#level]
    if (!level) throw invalidInput('JPEG 2000 tag tree state is invalid')
    const value = level.values[level.cursor] ?? 1
    this.#level -= 1
    if (this.#level < 0) {
      this.value = value - 1
      return false
    }
    const next = this.#levels[this.#level]
    if (!next) throw invalidInput('JPEG 2000 tag tree state is invalid')
    next.values[next.cursor] = value
    return true
  }
}

class InclusionTree {
  readonly #levels: TreeLevel[] = []
  #level = 0

  constructor(width: number, height: number, initial: number) {
    while (true) {
      const values = new Uint16Array(width * height)
      values.fill(initial + 1)
      this.#levels.push({ width, values, cursor: 0 })
      if (width === 1 && height === 1) break
      width = Math.ceil(width / 2)
      height = Math.ceil(height / 2)
    }
  }

  reset(x: number, y: number, threshold: number): boolean {
    for (let levelIndex = 0; levelIndex < this.#levels.length; levelIndex += 1) {
      const level = this.#levels[levelIndex]
      if (!level) throw invalidInput('JPEG 2000 inclusion tree level is missing')
      const cursor = y * level.width + x
      level.cursor = cursor
      const stored = level.values[cursor]
      if (stored === 0xffff) {
        this.#level = levelIndex - 1
        return true
      }
      if ((stored ?? 0) - 1 > threshold) {
        this.#level = levelIndex
        this.#propagate()
        return false
      }
      x >>>= 1
      y >>>= 1
    }
    this.#level = this.#levels.length - 1
    return true
  }

  exclude(threshold: number): void {
    const level = this.#levels[this.#level]
    if (!level) throw invalidInput('JPEG 2000 inclusion tree state is invalid')
    level.values[level.cursor] = threshold + 2
    this.#propagate()
  }

  #propagate(): void {
    const source = this.#levels[this.#level]
    if (!source) throw invalidInput('JPEG 2000 inclusion tree state is invalid')
    const value = source.values[source.cursor] ?? 0
    for (let levelIndex = this.#level - 1; levelIndex >= 0; levelIndex -= 1) {
      const level = this.#levels[levelIndex]
      if (level) level.values[level.cursor] = value
    }
  }

  descend(): boolean {
    const level = this.#levels[this.#level]
    if (!level) throw invalidInput('JPEG 2000 inclusion tree state is invalid')
    const value = level.values[level.cursor] ?? 0
    level.values[level.cursor] = 0xffff
    this.#level -= 1
    if (this.#level < 0) return false
    const next = this.#levels[this.#level]
    if (!next) throw invalidInput('JPEG 2000 inclusion tree state is invalid')
    next.values[next.cursor] = value
    return true
  }
}

class PacketBitReader {
  readonly #data: Uint8Array
  readonly #end: number
  #position: number
  #buffer = 0
  #bits = 0
  #stuffed = false

  constructor(data: Uint8Array, start: number, end: number) {
    this.#data = data
    this.#position = start
    this.#end = end
  }

  get position(): number {
    return this.#position
  }

  read(count: number): number {
    if (count < 0 || count > 31) throw invalidInput('JPEG 2000 packet bit count is invalid')
    while (this.#bits < count) {
      const value = this.#data[this.#position]
      if (value === undefined || this.#position >= this.#end) {
        throw truncatedInput('JPEG 2000 packet header exceeds its tile-part')
      }
      this.#position += 1
      if (this.#stuffed) {
        if ((value & 0x80) !== 0) throw invalidInput('JPEG 2000 packet stuffing bit is not zero')
        this.#buffer = this.#buffer * 128 + value
        this.#bits += 7
      } else {
        this.#buffer = this.#buffer * 256 + value
        this.#bits += 8
      }
      this.#stuffed = value === 0xff
      if (this.#bits > 48) throw invalidInput('JPEG 2000 packet bit buffer overflow')
    }
    this.#bits -= count
    const divisor = 2 ** this.#bits
    const value = Math.floor(this.#buffer / divisor) % 2 ** count
    this.#buffer %= divisor
    return value
  }

  align(): void {
    this.#buffer = 0
    this.#bits = 0
    this.#stuffed = false
  }

  skip(bytes: number): void {
    if (this.#bits !== 0) throw invalidInput('JPEG 2000 packet reader is not byte aligned')
    if (this.#position + bytes > this.#end)
      throw truncatedInput('JPEG 2000 packet marker is truncated')
    this.#position += bytes
  }

  byte(offset = 0): number | undefined {
    return this.#data[this.#position + offset]
  }
}

const codingPassCount = (bits: PacketBitReader): number => {
  if (bits.read(1) === 0) return 1
  if (bits.read(1) === 0) return 2
  const short = bits.read(2)
  if (short < 3) return short + 3
  const medium = bits.read(5)
  if (medium < 31) return medium + 6
  return bits.read(7) + 37
}

const floorLog2 = (value: number): number => {
  if (value < 1) throw invalidInput('JPEG 2000 logarithm input is invalid')
  return Math.floor(Math.log2(value))
}

const parsePacketData = (data: Uint8Array, start: number, end: number, tile: Tile): number => {
  const bits = new PacketBitReader(data, start, end)
  while (tile.nextPacket < tile.packets.length && bits.position < end) {
    bits.align()
    if (tile.style.sop) {
      if (bits.byte() !== 0xff || bits.byte(1) !== 0x91) {
        throw invalidInput('JPEG 2000 SOP marker is missing')
      }
      if (bits.byte(2) !== 0 || bits.byte(3) !== 4) {
        throw invalidInput('JPEG 2000 SOP marker length is invalid')
      }
      bits.skip(6)
    }
    const packet = tile.packets[tile.nextPacket]
    if (!packet) throw invalidInput('JPEG 2000 packet sequence is invalid')
    tile.nextPacket += 1
    if (bits.read(1) === 0) continue
    const contributions: { block: CodeBlock; length: number; codingPasses: number }[] = []
    for (const block of packet.blocks) {
      const blockX = block.x - block.precinct.minX
      const blockY = block.y - block.precinct.minY
      let included = false
      let first = false
      if (block.included) {
        included = bits.read(1) === 1
      } else {
        const width = block.precinct.maxX - block.precinct.minX + 1
        const height = block.precinct.maxY - block.precinct.minY + 1
        block.precinct.inclusion ??= new InclusionTree(width, height, packet.layer)
        block.precinct.zeroPlanes ??= new ValueTree(width, height)
        const tree = block.precinct.inclusion
        if (tree.reset(blockX, blockY, packet.layer)) {
          while (true) {
            if (bits.read(1) === 1) {
              if (!tree.descend()) {
                block.included = true
                included = true
                first = true
                break
              }
            } else {
              tree.exclude(packet.layer)
              break
            }
          }
        }
      }
      if (!included) continue
      if (first) {
        const zeroTree = block.precinct.zeroPlanes
        if (!zeroTree) throw invalidInput('JPEG 2000 zero-plane tree is missing')
        zeroTree.reset(blockX, blockY)
        while (true) {
          if (bits.read(1) === 1) {
            if (!zeroTree.descend()) break
          } else {
            zeroTree.increment()
          }
        }
        block.zeroBitPlanes = zeroTree.value
      }
      const passes = codingPassCount(bits)
      while (bits.read(1) === 1) {
        block.lblock += 1
        if (block.lblock > 31) throw limitExceeded('JPEG 2000 Lblock exceeds safe packet length')
      }
      const lengthBits = block.lblock + floorLog2(passes)
      const length = bits.read(lengthBits)
      if (length < 1) throw invalidInput('JPEG 2000 code-block contribution is empty')
      contributions.push({ block, length, codingPasses: passes })
    }
    bits.align()
    if (tile.style.eph) {
      if (bits.byte() !== 0xff || bits.byte(1) !== 0x92) {
        throw invalidInput('JPEG 2000 EPH marker is missing')
      }
      bits.skip(2)
    }
    for (const contribution of contributions) {
      const chunkStart = bits.position
      const chunkEnd = chunkStart + contribution.length
      if (chunkEnd > end) throw truncatedInput('JPEG 2000 code-block data exceeds tile-part')
      contribution.block.chunks.push({
        start: chunkStart,
        end: chunkEnd,
        codingPasses: contribution.codingPasses,
      })
      bits.skip(contribution.length)
    }
  }
  return bits.position
}

const segmentPayload = (
  data: Uint8Array,
  markerStart: number,
  limit: number,
): { payload: Uint8Array; end: number } => {
  if (markerStart + 4 > limit) throw truncatedInput('JPEG 2000 marker segment is truncated')
  const length = be16(data, markerStart + 2, 'JPEG 2000 marker length')
  if (length < 2) throw invalidInput('JPEG 2000 marker length is invalid')
  const end = markerStart + 2 + length
  if (end > limit) throw truncatedInput('JPEG 2000 marker segment exceeds its containing extent')
  return { payload: data.subarray(markerStart + 4, end), end }
}

const parseCodestream = (data: Uint8Array, limits: ImageLimits): ParsedCodestream => {
  if (data.byteLength < 6 || be16(data, 0) !== 0xff4f) {
    throw invalidInput('JPEG 2000 SOC marker is missing')
  }
  let position = 2
  let size: SizeMarker | undefined
  let defaultStyle: CodingStyle | undefined
  let defaultQuantization: Quantization | undefined
  const componentStyles = new Map<number, CodingStyle>()
  const componentQuantizations = new Map<number, Quantization>()
  const tiles = new Map<number, Tile>()
  const blockCounter = { value: 0 }
  let sawEnd = false

  while (position + 2 <= data.byteLength) {
    const marker = be16(data, position, 'JPEG 2000 marker')
    if (marker === 0xffd9) {
      position += 2
      sawEnd = true
      break
    }
    if (marker === 0xff51) {
      if (size) throw invalidInput('JPEG 2000 contains duplicate SIZ markers')
      const segment = segmentPayload(data, position, data.byteLength)
      size = parseSizeMarker(segment.payload, limits)
      position = segment.end
      continue
    }
    if (marker === 0xff52) {
      if (!size) throw invalidInput('JPEG 2000 COD precedes SIZ')
      if (defaultStyle) throw invalidInput('JPEG 2000 contains duplicate main COD markers')
      const segment = segmentPayload(data, position, data.byteLength)
      defaultStyle = parseCodingStyle(
        segment.payload,
        false,
        size.components.length < 257 ? 1 : 2,
        undefined,
      ).style
      position = segment.end
      continue
    }
    if (marker === 0xff53) {
      if (!size || !defaultStyle) throw invalidInput('JPEG 2000 COC precedes SIZ or COD')
      const segment = segmentPayload(data, position, data.byteLength)
      const parsed = parseCodingStyle(
        segment.payload,
        true,
        size.components.length < 257 ? 1 : 2,
        defaultStyle,
      )
      if (parsed.component === undefined || parsed.component >= size.components.length) {
        throw invalidInput('JPEG 2000 COC component index is invalid')
      }
      if (componentStyles.has(parsed.component))
        throw invalidInput('JPEG 2000 duplicate main COC marker')
      componentStyles.set(parsed.component, parsed.style)
      position = segment.end
      continue
    }
    if (marker === 0xff5c) {
      if (defaultQuantization) throw invalidInput('JPEG 2000 contains duplicate main QCD markers')
      const segment = segmentPayload(data, position, data.byteLength)
      defaultQuantization = parseQuantization(segment.payload, 0).quantization
      position = segment.end
      continue
    }
    if (marker === 0xff5d) {
      if (!size) throw invalidInput('JPEG 2000 QCC precedes SIZ')
      const segment = segmentPayload(data, position, data.byteLength)
      const parsed = parseQuantization(segment.payload, size.components.length < 257 ? 1 : 2)
      if (parsed.component === undefined || parsed.component >= size.components.length) {
        throw invalidInput('JPEG 2000 QCC component index is invalid')
      }
      if (componentQuantizations.has(parsed.component))
        throw invalidInput('JPEG 2000 duplicate main QCC marker')
      componentQuantizations.set(parsed.component, parsed.quantization)
      position = segment.end
      continue
    }
    if (marker === 0xff90) {
      if (!size || !defaultStyle || !defaultQuantization) {
        throw invalidInput('JPEG 2000 tile-part precedes required main-header markers')
      }
      const segment = segmentPayload(data, position, data.byteLength)
      if (segment.payload.byteLength !== 8)
        throw invalidInput('JPEG 2000 SOT marker length is invalid')
      const tileIndex = be16(segment.payload, 0, 'JPEG 2000 tile index')
      const tilePartLength = be32(segment.payload, 2, 'JPEG 2000 tile-part length')
      const partIndex = segment.payload[6]
      const partCount = segment.payload[7]
      if (partIndex !== 0 || (partCount !== 0 && partCount !== 1)) {
        throw unsupportedOperation('JPEG 2000 multiple tile-parts per tile are not implemented')
      }
      if (tilePartLength === 0)
        throw unsupportedOperation('JPEG 2000 open-ended tile-parts are unsupported')
      const tileEnd = position + tilePartLength
      if (tileEnd > data.byteLength || tileEnd <= segment.end) {
        throw truncatedInput('JPEG 2000 tile-part extent is invalid')
      }
      if (tiles.has(tileIndex)) throw invalidInput(`JPEG 2000 tile ${tileIndex} is duplicated`)
      let tileStyle = defaultStyle
      let tileQuantization = defaultQuantization
      const tileComponentStyles = new Map(componentStyles)
      const tileComponentQuantizations = new Map(componentQuantizations)
      let headerPosition = segment.end
      let sawData = false
      while (headerPosition + 2 <= tileEnd) {
        const tileMarker = be16(data, headerPosition, 'JPEG 2000 tile marker')
        if (tileMarker === 0xff93) {
          headerPosition += 2
          sawData = true
          break
        }
        const tileSegment = segmentPayload(data, headerPosition, tileEnd)
        if (tileMarker === 0xff52) {
          tileStyle = parseCodingStyle(
            tileSegment.payload,
            false,
            size.components.length < 257 ? 1 : 2,
            undefined,
          ).style
        } else if (tileMarker === 0xff53) {
          const parsed = parseCodingStyle(
            tileSegment.payload,
            true,
            size.components.length < 257 ? 1 : 2,
            tileStyle,
          )
          if (parsed.component === undefined || parsed.component >= size.components.length) {
            throw invalidInput('JPEG 2000 tile COC component index is invalid')
          }
          tileComponentStyles.set(parsed.component, parsed.style)
        } else if (tileMarker === 0xff5c) {
          tileQuantization = parseQuantization(tileSegment.payload, 0).quantization
        } else if (tileMarker === 0xff5d) {
          const parsed = parseQuantization(
            tileSegment.payload,
            size.components.length < 257 ? 1 : 2,
          )
          if (parsed.component === undefined || parsed.component >= size.components.length) {
            throw invalidInput('JPEG 2000 tile QCC component index is invalid')
          }
          tileComponentQuantizations.set(parsed.component, parsed.quantization)
        } else if (tileMarker === 0xff58 || tileMarker === 0xff64) {
          // PLT and COM are bounded hints and do not alter reconstruction.
        } else {
          throw unsupportedOperation(
            `JPEG 2000 tile marker 0x${tileMarker.toString(16)} is unsupported`,
          )
        }
        headerPosition = tileSegment.end
      }
      if (!sawData) throw invalidInput('JPEG 2000 SOD marker is missing')
      const tile = createTile({
        index: tileIndex,
        size,
        defaultStyle: tileStyle,
        componentStyles: tileComponentStyles,
        defaultQuantization: tileQuantization,
        componentQuantizations: tileComponentQuantizations,
        blockCounter,
      })
      const consumed = parsePacketData(data, headerPosition, tileEnd, tile)
      if (tile.nextPacket !== tile.packets.length) {
        throw truncatedInput(
          `JPEG 2000 tile ${tileIndex} contains ${tile.nextPacket} of ${tile.packets.length} packets`,
        )
      }
      if (consumed !== tileEnd) {
        throw invalidInput(`JPEG 2000 tile ${tileIndex} has unconsumed packet data`)
      }
      tile.decoded = true
      tiles.set(tileIndex, tile)
      position = tileEnd
      continue
    }
    if (marker === 0xff55 || marker === 0xff57 || marker === 0xff64) {
      const segment = segmentPayload(data, position, data.byteLength)
      position = segment.end
      continue
    }
    if (marker === 0xff5e || marker === 0xff5f || marker === 0xff60 || marker === 0xff61) {
      throw unsupportedOperation(`JPEG 2000 marker 0x${marker.toString(16)} is not implemented`)
    }
    throw unsupportedOperation(`JPEG 2000 marker 0x${marker.toString(16)} is unsupported`)
  }
  if (!sawEnd) throw truncatedInput('JPEG 2000 EOC marker is missing')
  if (position !== data.byteLength) throw invalidInput('JPEG 2000 data follows EOC')
  if (!size || !defaultStyle || !defaultQuantization) {
    throw invalidInput('JPEG 2000 main header is incomplete')
  }
  const expectedTiles =
    Math.ceil((size.xSize - size.tileXOrigin) / size.tileWidth) *
    Math.ceil((size.ySize - size.tileYOrigin) / size.tileHeight)
  if (tiles.size !== expectedTiles) {
    throw invalidInput(`JPEG 2000 contains ${tiles.size} of ${expectedTiles} required tiles`)
  }
  return {
    size,
    tiles: [...tiles.values()].sort((left, right) => left.index - right.index),
    lossless: [...tiles.values()].every((tile) =>
      tile.components.every((component) => component.style.reversible),
    ),
    resolutionLevels:
      1 +
      Math.max(
        ...[...tiles.values()].flatMap((tile) =>
          tile.components.map((component) => component.style.decompositionLevels),
        ),
      ),
  }
}

interface ReconstructedComponent {
  readonly x0: number
  readonly y0: number
  readonly width: number
  readonly height: number
  readonly values: Float32Array
}

const gainLog2 = (band: Jpeg2000Subband): number => (band === 'HH' ? 2 : band === 'LL' ? 0 : 1)

const quantStep = (
  quantization: Quantization,
  sequentialIndex: number,
  resolutionLevel: number,
): QuantStep => {
  if (quantization.style === 1) {
    const derived = quantization.steps[0]
    if (!derived) throw invalidInput('JPEG 2000 derived quantization step is missing')
    return {
      exponent: derived.exponent + (resolutionLevel > 0 ? 1 - resolutionLevel : 0),
      mantissa: derived.mantissa,
    }
  }
  const step = quantization.steps[sequentialIndex]
  if (!step) throw invalidInput('JPEG 2000 quantization step table is too short')
  return step
}

const decodeBand = (
  codestream: Uint8Array,
  target: Float32Array,
  levelWidth: number,
  levelX0: number,
  levelY0: number,
  band: Subband,
  delta: number,
  magnitudeBits: number,
  reversible: boolean,
  segmentationSymbols: boolean,
): void => {
  const bandWidth = band.x1 - band.x0
  const horizontalHigh = band.type === 'HL' || band.type === 'HH' ? 1 - (levelX0 & 1) : levelX0 & 1
  const verticalHigh =
    (band.type === 'LH' || band.type === 'HH' ? 1 - (levelY0 & 1) : levelY0 & 1) * levelWidth
  for (const block of band.blocks) {
    if (block.chunks.length === 0) continue
    let byteLength = 0
    let codingPasses = 0
    for (const chunk of block.chunks) {
      byteLength += chunk.end - chunk.start
      codingPasses += chunk.codingPasses
    }
    const encoded = new Uint8Array(byteLength)
    let write = 0
    for (const chunk of block.chunks) {
      const bytes = codestream.subarray(chunk.start, chunk.end)
      encoded.set(bytes, write)
      write += bytes.byteLength
    }
    const blockWidth = block.clippedX1 - block.clippedX0
    const blockHeight = block.clippedY1 - block.clippedY0
    const decoded = decodeJpeg2000CodeBlock({
      data: encoded,
      width: blockWidth,
      height: blockHeight,
      band: block.band,
      zeroBitPlanes: block.zeroBitPlanes,
      codingPasses,
      segmentationSymbols,
    })
    let bandOffset = block.clippedX0 - band.x0 + (block.clippedY0 - band.y0) * bandWidth
    let coefficient = 0
    for (let y = 0; y < blockHeight; y += 1) {
      const bandRow = Math.floor(bandOffset / bandWidth)
      const interleaveOffset =
        2 * bandRow * (levelWidth - bandWidth) + horizontalHigh + verticalHigh
      for (let x = 0; x < blockWidth; x += 1) {
        const magnitude = decoded.magnitude[coefficient] ?? 0
        if (magnitude !== 0) {
          const corrected = (magnitude + (reversible ? 0 : 0.5)) * delta
          const signed = decoded.negative[coefficient] === 1 ? -corrected : corrected
          const planes = decoded.decodedBitPlanes[coefficient] ?? 0
          const value =
            reversible && planes >= magnitudeBits ? signed : signed * 2 ** (magnitudeBits - planes)
          const targetOffset = band.type === 'LL' ? bandOffset : interleaveOffset + bandOffset * 2
          if (targetOffset < 0 || targetOffset >= target.length) {
            throw invalidInput(
              `JPEG 2000 ${band.type} coefficient ${targetOffset} maps outside ${target.length} values`,
            )
          }
          target[targetOffset] = value
        }
        bandOffset += 1
        coefficient += 1
      }
      bandOffset += bandWidth - blockWidth
    }
  }
}

const reconstructComponent = (
  codestream: Uint8Array,
  tile: Tile,
  componentIndex: number,
  specification: ComponentSpec,
): ReconstructedComponent => {
  const component = tile.components[componentIndex]
  if (!component) throw invalidInput('JPEG 2000 tile component is missing')
  const levels: Jpeg2000ResolutionCoefficients[] = []
  let sequentialStep = 0
  for (const resolution of component.resolutions) {
    const width = resolution.x1 - resolution.x0
    const height = resolution.y1 - resolution.y0
    const values = new Float32Array(width * height)
    for (const band of resolution.bands) {
      const step = quantStep(component.quantization, sequentialStep, resolution.level)
      if (component.quantization.style !== 1) sequentialStep += 1
      const delta = component.style.reversible
        ? 1
        : 2 ** (specification.precision + gainLog2(band.type) - step.exponent) *
          (1 + step.mantissa / 2048)
      const magnitudeBits = component.quantization.guardBits + step.exponent - 1
      if (magnitudeBits < 0 || magnitudeBits > 31) {
        throw unsupportedOperation(
          `JPEG 2000 coefficient magnitude ${magnitudeBits} is unsupported`,
        )
      }
      decodeBand(
        codestream,
        values,
        width,
        resolution.x0,
        resolution.y0,
        band,
        delta,
        magnitudeBits,
        component.style.reversible,
        component.style.segmentationSymbols,
      )
    }
    levels.push({ x0: resolution.x0, y0: resolution.y0, width, height, values })
  }
  const reconstructed = inverseJpeg2000Wavelet(levels, component.style.reversible)
  return {
    x0: component.x0,
    y0: component.y0,
    width: reconstructed.width,
    height: reconstructed.height,
    values: reconstructed.values,
  }
}

const clampByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)))

const normalizedSample = (value: number, specification: ComponentSpec): number => {
  const shifted = specification.signed ? value : value + 2 ** (specification.precision - 1)
  const maximum = 2 ** specification.precision - 1
  return clampByte((shifted * 255) / maximum)
}

const componentValueAt = (
  component: ReconstructedComponent,
  specification: ComponentSpec,
  referenceX: number,
  referenceY: number,
): number => {
  const x = Math.ceil(referenceX / specification.xSampling) - component.x0
  const y = Math.ceil(referenceY / specification.ySampling) - component.y0
  const clampedX = Math.max(0, Math.min(component.width - 1, x))
  const clampedY = Math.max(0, Math.min(component.height - 1, y))
  return component.values[clampedY * component.width + clampedX] ?? 0
}

const reconstructPixels = (
  codestream: Uint8Array,
  parsed: ParsedCodestream,
  colorSpace: Jp2Header['colorSpace'],
): { readonly data: Uint8Array; readonly format: 'gray8' | 'rgb8' } => {
  const width = parsed.size.xSize - parsed.size.xOrigin
  const height = parsed.size.ySize - parsed.size.yOrigin
  const grayscale = colorSpace === 'gray'
  const format = grayscale ? 'gray8' : 'rgb8'
  const channels = grayscale ? 1 : 3
  const output = new Uint8Array(width * height * channels)
  for (const tile of parsed.tiles) {
    const components = parsed.size.components.map((specification, index) =>
      reconstructComponent(codestream, tile, index, specification),
    )
    if (components.length !== (grayscale ? 1 : 3)) {
      throw unsupportedOperation(
        `JP2 ${colorSpace} output requires ${grayscale ? 1 : 3} components`,
      )
    }
    const first = components[0]
    const firstSpec = parsed.size.components[0]
    if (!first || !firstSpec) throw invalidInput('JPEG 2000 primary component is missing')
    const useTransform = tile.style.transformComponents
    if (useTransform && components.length !== 3) {
      throw invalidInput('JPEG 2000 multiple-component transform requires three components')
    }
    if (
      useTransform &&
      parsed.size.components.some(
        (item) =>
          item.precision !== firstSpec.precision || item.xSampling !== 1 || item.ySampling !== 1,
      )
    ) {
      throw unsupportedOperation(
        'JPEG 2000 transformed components must share precision and full sampling',
      )
    }
    for (let referenceY = tile.y0; referenceY < tile.y1; referenceY += 1) {
      for (let referenceX = tile.x0; referenceX < tile.x1; referenceX += 1) {
        const target =
          ((referenceY - parsed.size.yOrigin) * width + (referenceX - parsed.size.xOrigin)) *
          channels
        if (grayscale) {
          output[target] = normalizedSample(
            componentValueAt(first, firstSpec, referenceX, referenceY),
            firstSpec,
          )
          continue
        }
        const second = components[1]
        const third = components[2]
        const secondSpec = parsed.size.components[1]
        const thirdSpec = parsed.size.components[2]
        if (!second || !third || !secondSpec || !thirdSpec) {
          throw invalidInput('JPEG 2000 color components are missing')
        }
        let red: number
        let green: number
        let blue: number
        if (useTransform) {
          const y = componentValueAt(first, firstSpec, referenceX, referenceY)
          const u = componentValueAt(second, secondSpec, referenceX, referenceY)
          const v = componentValueAt(third, thirdSpec, referenceX, referenceY)
          const offset = firstSpec.signed ? 0 : 2 ** (firstSpec.precision - 1)
          const maximum = 2 ** firstSpec.precision - 1
          if (tile.style.reversible) {
            const g = y + offset - Math.floor((u + v) / 4)
            red = ((g + v) * 255) / maximum
            green = (g * 255) / maximum
            blue = ((g + u) * 255) / maximum
          } else {
            const luminance = y + offset
            red = ((luminance + 1.402 * v) * 255) / maximum
            green = ((luminance - 0.34413 * u - 0.71414 * v) * 255) / maximum
            blue = ((luminance + 1.772 * u) * 255) / maximum
          }
        } else if (colorSpace === 'sycc') {
          const y = normalizedSample(
            componentValueAt(first, firstSpec, referenceX, referenceY),
            firstSpec,
          )
          const cb =
            normalizedSample(
              componentValueAt(second, secondSpec, referenceX, referenceY),
              secondSpec,
            ) - 128
          const cr =
            normalizedSample(
              componentValueAt(third, thirdSpec, referenceX, referenceY),
              thirdSpec,
            ) - 128
          red = y + 1.402 * cr
          green = y - 0.344136 * cb - 0.714136 * cr
          blue = y + 1.772 * cb
        } else {
          red = normalizedSample(
            componentValueAt(first, firstSpec, referenceX, referenceY),
            firstSpec,
          )
          green = normalizedSample(
            componentValueAt(second, secondSpec, referenceX, referenceY),
            secondSpec,
          )
          blue = normalizedSample(
            componentValueAt(third, thirdSpec, referenceX, referenceY),
            thirdSpec,
          )
        }
        output[target] = clampByte(red)
        output[target + 1] = clampByte(green)
        output[target + 2] = clampByte(blue)
      }
    }
  }
  return { data: output, format }
}

interface Jpeg2000Description {
  readonly container: Jp2Header
  readonly codestream: Uint8Array
  readonly parsed: ParsedCodestream
}

const describeJpeg2000 = async (
  source: ImageSource,
  limits: ImageLimits,
): Promise<Jpeg2000Description> => {
  const container = await describeContainer(source, limits)
  const codestream = await readExactly(
    source,
    container.codestreamOffset,
    container.codestreamLength,
  )
  const parsed = parseCodestream(codestream, limits)
  const width = parsed.size.xSize - parsed.size.xOrigin
  const height = parsed.size.ySize - parsed.size.yOrigin
  if (width !== container.width || height !== container.height) {
    throw invalidInput('JP2 ihdr dimensions disagree with JPEG 2000 SIZ')
  }
  if (parsed.size.components.length !== container.components) {
    throw invalidInput('JP2 ihdr component count disagrees with JPEG 2000 SIZ')
  }
  for (let index = 0; index < container.components; index += 1) {
    const component = parsed.size.components[index]
    if (!component) throw invalidInput('JPEG 2000 component is missing')
    if (
      component.precision !== container.bitDepths[index] ||
      component.signed !== container.signed[index]
    ) {
      throw invalidInput(`JP2 component ${index} precision disagrees with JPEG 2000 SIZ`)
    }
  }
  if (container.signed.some(Boolean)) {
    throw unsupportedOperation('Signed JP2 display components are not implemented')
  }
  if (
    (container.colorSpace === 'gray' && container.components !== 1) ||
    (container.colorSpace !== 'gray' && container.components !== 3)
  ) {
    throw unsupportedOperation(`JP2 ${container.colorSpace} component mapping is unsupported`)
  }
  return { container, codestream, parsed }
}

const metadataFor = (description: Jpeg2000Description): ImageMetadata => ({
  width: description.container.width,
  height: description.container.height,
  format: 'jp2',
  mimeType: 'image/jp2',
  hasAlpha: false,
  colorSpace:
    description.container.colorSpace === 'gray'
      ? 'gray'
      : description.container.colorSpace === 'sycc'
        ? 'sYCC'
        : 'sRGB',
  bitDepth: Math.max(...description.container.bitDepths),
  frames: 1,
  components: description.container.components,
  channels: description.container.colorSpace === 'gray' ? 1 : 3,
  channelBitDepths: description.container.bitDepths,
  lossless: description.parsed.lossless,
  tiles: description.parsed.tiles.length,
  resolutionLevels: description.parsed.resolutionLevels,
})

const decodeRegion = (
  width: number,
  height: number,
  request: DecodeRequest,
): { x: number; y: number; width: number; height: number } => {
  const x = request.x ?? 0
  const y = request.y ?? 0
  const regionWidth = request.width ?? width - x
  const regionHeight = request.height ?? height - y
  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(regionWidth) ||
    !Number.isSafeInteger(regionHeight) ||
    x < 0 ||
    y < 0 ||
    regionWidth < 1 ||
    regionHeight < 1 ||
    x + regionWidth > width ||
    y + regionHeight > height
  ) {
    throw invalidInput('JPEG 2000 decode region is invalid')
  }
  return { x, y, width: regionWidth, height: regionHeight }
}

class Jpeg2000Decoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat: PixelFormat
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: false,
    scaledDecode: false,
    progressive: false,
  })
  readonly #description: Jpeg2000Description

  constructor(description: Jpeg2000Description) {
    this.#description = description
    this.width = description.container.width
    this.height = description.container.height
    this.pixelFormat = description.container.colorSpace === 'gray' ? 'gray8' : 'rgb8'
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const region = decodeRegion(this.width, this.height, request)
    const pixels = reconstructPixels(
      this.#description.codestream,
      this.#description.parsed,
      this.#description.container.colorSpace,
    )
    const channels = pixels.format === 'gray8' ? 1 : 3
    const stride = region.width * channels
    for (let outputY = 0; outputY < region.height; outputY += blockRows) {
      const rows = Math.min(blockRows, region.height - outputY)
      const data = new Uint8Array(stride * rows)
      for (let localY = 0; localY < rows; localY += 1) {
        const source = ((region.y + outputY + localY) * this.width + region.x) * channels
        data.set(pixels.data.subarray(source, source + stride), localY * stride)
      }
      yield {
        x: 0,
        y: outputY,
        width: region.width,
        height: rows,
        stride,
        format: pixels.format,
        data,
      }
    }
  }
}

export const jpeg2000Codec: ImageCodec = {
  format: 'jp2',
  mimeTypes: ['image/jp2'],
  minimumBytes: 12,
  detect: isJp2,
  metadata: async (source, limits) => metadataFor(await describeJpeg2000(source, limits)),
  createDecoder: async (source, limits) =>
    new Jpeg2000Decoder(await describeJpeg2000(source, limits)),
}
