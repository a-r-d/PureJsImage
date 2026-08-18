import type {
  DecodeRequest,
  ImageCodec,
  ImageDecoder,
  ImageMetadata,
  PreservedMetadata,
} from '../codec.ts'
import { invalidInput, limitExceeded, truncatedInput, unsupportedOperation } from '../errors.ts'
import type { ImageLimitOptions, ImageLimits } from '../limits.ts'
import { resolveLimits, validateImageDimensions, validateInputSize } from '../limits.ts'
import { iccColorSpace } from '../metadata.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { ImageSource } from '../source.ts'
import { readExactly } from '../source.ts'
import {
  ColorManagedDecoder,
  MAX_ICC_PROFILE_BYTES,
  parseRgbIccTransform,
  type RgbIccTransform,
} from './icc.ts'
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

type Jp2ColorSpace = 'gray' | 'srgb' | 'sycc'

interface Jp2PaletteColumn {
  readonly bitDepth: number
  readonly signed: boolean
  readonly values: Int32Array
}

interface Jp2Palette {
  readonly entries: number
  readonly columns: readonly Jp2PaletteColumn[]
}

interface Jp2ChannelMapping {
  readonly component: number
  readonly paletteColumn?: number
}

interface Jp2ChannelDefinition {
  readonly channel: number
  readonly type: 0 | 1 | 2
  readonly association: number
}

interface Jp2ColorCandidate {
  readonly approximation: number
  readonly colorSpace?: Jp2ColorSpace
  readonly icc?: Uint8Array
  readonly precedence: number
}

interface Jp2Resolution {
  readonly horizontal: number
  readonly vertical: number
}

interface Jp2Header {
  readonly width: number
  readonly height: number
  readonly components: number
  readonly bitDepths: readonly number[]
  readonly signed: readonly boolean[]
  readonly colorSpace: Jp2ColorSpace
  readonly icc?: Uint8Array
  readonly palette?: Jp2Palette
  readonly channelMappings: readonly Jp2ChannelMapping[]
  readonly channelDefinitions: readonly Jp2ChannelDefinition[]
  readonly captureResolution?: Jp2Resolution
  readonly displayResolution?: Jp2Resolution
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
  readonly colors: Jp2ColorCandidate[]
  palette?: Jp2Palette
  channelMappings?: readonly Jp2ChannelMapping[]
  channelDefinitions?: readonly Jp2ChannelDefinition[]
  captureResolution?: Jp2Resolution
  displayResolution?: Jp2Resolution
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
  if (
    bpc === undefined ||
    compression === undefined ||
    unknownColor === undefined ||
    intellectualProperty === undefined
  ) {
    throw truncatedInput('JP2 ihdr box is truncated')
  }
  if (width < 1 || height < 1 || components < 1) throw invalidInput('JP2 dimensions are invalid')
  if (components > maximumComponents) {
    throw limitExceeded(`JP2 component count ${components} exceeds ${maximumComponents}`)
  }
  if (compression !== 7) {
    throw unsupportedOperation(`JP2 compression type ${compression} is unsupported`)
  }
  if (unknownColor !== 0 && unknownColor !== 1) {
    throw invalidInput('JP2 unknown-color flag is invalid')
  }
  if (intellectualProperty !== 0 && intellectualProperty !== 1) {
    throw invalidInput('JP2 intellectual-property flag is invalid')
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
  if (header.bitDepths !== undefined) throw invalidInput('JP2 contains duplicate bpcc boxes')
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
  if (approximation > 4) throw invalidInput(`JP2 color approximation ${approximation} is invalid`)
  if (method === 1) {
    if (data.byteLength !== 7) throw invalidInput('JP2 enumerated colr box has an invalid length')
    const enumerated = be32(data, 3, 'JP2 enumerated color space')
    const colorSpace =
      enumerated === 16
        ? 'srgb'
        : enumerated === 17
          ? 'gray'
          : enumerated === 18
            ? 'sycc'
            : undefined
    header.colors.push({ approximation, precedence, ...(colorSpace ? { colorSpace } : {}) })
    return
  }
  if (method === 2) {
    const icc = Uint8Array.from(data.subarray(3))
    if (icc.byteLength > MAX_ICC_PROFILE_BYTES) {
      throw limitExceeded(`JP2 ICC profile exceeds ${MAX_ICC_PROFILE_BYTES} bytes`)
    }
    const profileSpace = iccColorSpace(icc)
    const colorSpace =
      profileSpace === 'gray' ? 'gray' : profileSpace === 'rgb' ? 'srgb' : undefined
    header.colors.push({
      approximation,
      precedence,
      ...(colorSpace ? { colorSpace } : {}),
      ...(colorSpace ? { icc } : {}),
    })
    return
  }
  header.colors.push({ approximation, precedence })
}

const parsePaletteBox = (data: Uint8Array, header: MutableJp2Header): void => {
  if (header.palette) throw invalidInput('JP2 contains duplicate pclr boxes')
  if (data.byteLength < 4) throw truncatedInput('JP2 pclr box is truncated')
  const entries = be16(data, 0, 'JP2 palette entry count')
  const columnCount = data[2]
  if (entries < 1 || columnCount === undefined || columnCount < 1) {
    throw invalidInput('JP2 palette dimensions are invalid')
  }
  if (columnCount > maximumComponents) {
    throw limitExceeded(`JP2 palette column count ${columnCount} exceeds ${maximumComponents}`)
  }
  const descriptorEnd = 3 + columnCount
  if (descriptorEnd > data.byteLength) throw truncatedInput('JP2 palette descriptors are truncated')
  const depths: number[] = []
  const signed: boolean[] = []
  const byteWidths: number[] = []
  let bytesPerEntry = 0
  for (let column = 0; column < columnCount; column += 1) {
    const descriptor = data[3 + column]
    if (descriptor === undefined) throw truncatedInput('JP2 palette descriptor is truncated')
    const bitDepth = (descriptor & 0x7f) + 1
    if (bitDepth > 16) {
      throw unsupportedOperation(`JP2 ${bitDepth}-bit palette columns are unsupported`)
    }
    const byteWidth = Math.ceil(bitDepth / 8)
    depths.push(bitDepth)
    signed.push((descriptor & 0x80) !== 0)
    byteWidths.push(byteWidth)
    bytesPerEntry += byteWidth
  }
  const expected = descriptorEnd + entries * bytesPerEntry
  if (!Number.isSafeInteger(expected) || expected !== data.byteLength) {
    throw invalidInput('JP2 palette table length is invalid')
  }
  const columns = Array.from({ length: columnCount }, (_, column) => ({
    bitDepth: depths[column] ?? 0,
    signed: signed[column] ?? false,
    values: new Int32Array(entries),
  }))
  let position = descriptorEnd
  for (let entry = 0; entry < entries; entry += 1) {
    for (let column = 0; column < columnCount; column += 1) {
      const byteWidth = byteWidths[column] ?? 0
      let value = 0
      for (let byteIndex = 0; byteIndex < byteWidth; byteIndex += 1) {
        value = value * 256 + (data[position] ?? 0)
        position += 1
      }
      const target = columns[column]
      if (!target) throw invalidInput('JP2 palette column is missing')
      if (target.signed) {
        const sign = 2 ** (target.bitDepth - 1)
        if (value >= sign) value -= 2 ** target.bitDepth
      }
      target.values[entry] = value
    }
  }
  header.palette = { entries, columns }
}

const parseComponentMappingBox = (data: Uint8Array, header: MutableJp2Header): void => {
  if (header.channelMappings) throw invalidInput('JP2 contains duplicate cmap boxes')
  if (data.byteLength === 0 || data.byteLength % 4 !== 0) {
    throw invalidInput('JP2 cmap box length is invalid')
  }
  const mappings: Jp2ChannelMapping[] = []
  for (let offset = 0; offset < data.byteLength; offset += 4) {
    const component = be16(data, offset, 'JP2 component mapping index')
    const mappingType = data[offset + 2]
    const paletteColumn = data[offset + 3]
    if (mappingType === 0) {
      if (paletteColumn !== 0) throw invalidInput('JP2 direct cmap entry has a palette column')
      mappings.push({ component })
    } else if (mappingType === 1) {
      if (paletteColumn === undefined) throw truncatedInput('JP2 cmap palette column is truncated')
      mappings.push({ component, paletteColumn })
    } else {
      throw invalidInput(`JP2 cmap mapping type ${mappingType ?? -1} is invalid`)
    }
  }
  header.channelMappings = mappings
}

const parseChannelDefinitionBox = (data: Uint8Array, header: MutableJp2Header): void => {
  if (header.channelDefinitions) throw invalidInput('JP2 contains duplicate cdef boxes')
  if (data.byteLength < 2) throw truncatedInput('JP2 cdef box is truncated')
  const count = be16(data, 0, 'JP2 channel definition count')
  if (count < 1 || data.byteLength !== 2 + count * 6) {
    throw invalidInput('JP2 cdef box length is invalid')
  }
  const definitions: Jp2ChannelDefinition[] = []
  const channels = new Set<number>()
  for (let index = 0; index < count; index += 1) {
    const offset = 2 + index * 6
    const channel = be16(data, offset, 'JP2 channel definition index')
    const typeValue = be16(data, offset + 2, 'JP2 channel definition type')
    const association = be16(data, offset + 4, 'JP2 channel association')
    if (typeValue !== 0 && typeValue !== 1 && typeValue !== 2) {
      throw unsupportedOperation(`JP2 channel type ${typeValue} is unsupported`)
    }
    if (channels.has(channel)) throw invalidInput(`JP2 channel ${channel} is defined twice`)
    channels.add(channel)
    definitions.push({ channel, type: typeValue, association })
  }
  header.channelDefinitions = definitions
}

const parseResolutionValue = (
  numerator: number,
  denominator: number,
  exponent: number,
  label: string,
): number => {
  if (denominator === 0) throw invalidInput(`JP2 ${label} resolution denominator is zero`)
  const value = (numerator / denominator) * 10 ** exponent
  if (!Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER) {
    throw limitExceeded(`JP2 ${label} resolution exceeds the safe numeric range`)
  }
  return value
}

const parseResolutionBox = (data: Uint8Array, type: 'resc' | 'resd'): Jp2Resolution => {
  if (data.byteLength !== 10) throw invalidInput(`JP2 ${type} box must contain 10 bytes`)
  const verticalExponentByte = data[8]
  const horizontalExponentByte = data[9]
  if (verticalExponentByte === undefined || horizontalExponentByte === undefined) {
    throw truncatedInput(`JP2 ${type} exponent is truncated`)
  }
  const verticalExponent =
    verticalExponentByte > 127 ? verticalExponentByte - 256 : verticalExponentByte
  const horizontalExponent =
    horizontalExponentByte > 127 ? horizontalExponentByte - 256 : horizontalExponentByte
  return {
    vertical: parseResolutionValue(
      be16(data, 0, `JP2 ${type} vertical numerator`),
      be16(data, 2, `JP2 ${type} vertical denominator`),
      verticalExponent,
      `${type} vertical`,
    ),
    horizontal: parseResolutionValue(
      be16(data, 4, `JP2 ${type} horizontal numerator`),
      be16(data, 6, `JP2 ${type} horizontal denominator`),
      horizontalExponent,
      `${type} horizontal`,
    ),
  }
}

const parseResolutionSuperbox = async (
  source: ImageSource,
  box: Jp2Box,
  state: MutableJp2Header,
  boxCounter: { value: number },
): Promise<void> => {
  let position = box.content
  while (position < box.end) {
    boxCounter.value += 1
    if (boxCounter.value > maximumBoxes) throw limitExceeded('JP2 box count exceeds limit')
    const child = await readBox(source, position, box.end)
    if (child.type !== 'resc' && child.type !== 'resd') {
      throw invalidInput(`JP2 res superbox contains invalid ${child.type} child`)
    }
    const resolution = parseResolutionBox(
      await readExactly(source, child.content, child.end - child.content),
      child.type,
    )
    if (child.type === 'resc') {
      if (state.captureResolution) throw invalidInput('JP2 contains duplicate resc boxes')
      state.captureResolution = resolution
    } else {
      if (state.displayResolution) throw invalidInput('JP2 contains duplicate resd boxes')
      state.displayResolution = resolution
    }
    position = child.end
  }
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
    } else if (child.type === 'pclr') {
      parsePaletteBox(await readExactly(source, child.content, length), state)
    } else if (child.type === 'cmap') {
      parseComponentMappingBox(await readExactly(source, child.content, length), state)
    } else if (child.type === 'cdef') {
      parseChannelDefinitionBox(await readExactly(source, child.content, length), state)
    } else if (child.type === 'res ') {
      await parseResolutionSuperbox(source, child, state, boxCounter)
    }
    position = child.end
  }
  if (!sawIhdr) throw invalidInput('JP2 header is missing ihdr')
}

const describeContainer = async (source: ImageSource, limits: ImageLimits): Promise<Jp2Header> => {
  if (source.size < signature.byteLength) throw truncatedInput('JP2 signature box is truncated')
  const signatureBytes = await readExactly(source, 0, signature.byteLength)
  if (!isJp2(signatureBytes)) throw invalidInput('JP2 signature box is invalid')
  const mutable: MutableJp2Header = { colors: [] }
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
  const { width, height, components } = mutable
  if (width === undefined || height === undefined || components === undefined) {
    throw invalidInput('JP2 required image metadata is missing')
  }
  const color = [...mutable.colors]
    .sort(
      (left, right) =>
        left.precedence - right.precedence || left.approximation - right.approximation,
    )
    .find((candidate) => candidate.colorSpace !== undefined)
  if (!color?.colorSpace) {
    throw unsupportedOperation('JP2 has no supported color specification')
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
  const channelMappings =
    mutable.channelMappings ??
    Array.from({ length: components }, (_, component): Jp2ChannelMapping => ({ component }))
  if ((mutable.palette === undefined) !== (mutable.channelMappings === undefined)) {
    throw invalidInput('JP2 palette and component mapping boxes must appear together')
  }
  for (const mapping of channelMappings) {
    if (mapping.component >= components) {
      throw invalidInput(`JP2 cmap component ${mapping.component} is outside the codestream`)
    }
    if (mapping.paletteColumn !== undefined) {
      if (!mutable.palette || mapping.paletteColumn >= mutable.palette.columns.length) {
        throw invalidInput(`JP2 cmap palette column ${mapping.paletteColumn} is invalid`)
      }
    }
  }
  const colorChannels = color.colorSpace === 'gray' ? 1 : 3
  if (mutable.channelDefinitions === undefined && channelMappings.length !== colorChannels) {
    throw unsupportedOperation('JP2 extra channels require an explicit cdef channel definition box')
  }
  const channelDefinitions =
    mutable.channelDefinitions ??
    Array.from(
      { length: colorChannels },
      (_, channel): Jp2ChannelDefinition => ({ channel, type: 0, association: channel + 1 }),
    )
  for (const definition of channelDefinitions) {
    if (definition.channel >= channelMappings.length) {
      throw invalidInput(`JP2 cdef channel ${definition.channel} is outside the channel mapping`)
    }
    const expectedColorChannels = colorChannels
    if (
      definition.type === 0 &&
      (definition.association < 1 || definition.association > expectedColorChannels)
    ) {
      throw invalidInput(`JP2 color channel association ${definition.association} is invalid`)
    }
    if (definition.type !== 0 && definition.association > expectedColorChannels) {
      throw invalidInput(`JP2 opacity channel association ${definition.association} is invalid`)
    }
  }
  return {
    width,
    height,
    components,
    bitDepths,
    signed,
    colorSpace: color.colorSpace,
    ...(color.icc ? { icc: color.icc } : {}),
    ...(mutable.palette ? { palette: mutable.palette } : {}),
    channelMappings,
    channelDefinitions,
    ...(mutable.captureResolution ? { captureResolution: mutable.captureResolution } : {}),
    ...(mutable.displayResolution ? { displayResolution: mutable.displayResolution } : {}),
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
  readonly resetContexts: boolean
  readonly verticalCausal: boolean
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
  readonly roiShift: number
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
  nextPart: number
  partCount?: number
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
  readonly endOffset: number
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
  if ((blockStyle & 0x15) !== 0) {
    throw unsupportedOperation(
      'JPEG 2000 arithmetic bypass, pass termination, and predictable termination styles are not implemented',
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
      resetContexts: (blockStyle & 0x02) !== 0,
      verticalCausal: (blockStyle & 0x08) !== 0,
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

const parseRoiShift = (
  payload: Uint8Array,
  componentBytes: 1 | 2,
): { readonly component: number; readonly shift: number } => {
  const expected = componentBytes + 2
  if (payload.byteLength !== expected) throw invalidInput('JPEG 2000 RGN marker length is invalid')
  const component = componentBytes === 1 ? payload[0] : be16(payload, 0, 'JPEG 2000 RGN component')
  const style = payload[componentBytes]
  const shift = payload[componentBytes + 1]
  if (component === undefined || style === undefined || shift === undefined) {
    throw truncatedInput('JPEG 2000 RGN marker is truncated')
  }
  if (style !== 0) {
    throw unsupportedOperation(`JPEG 2000 ROI style ${style} is unsupported`)
  }
  if (shift > 31) {
    throw unsupportedOperation(`JPEG 2000 ROI shift ${shift} is unsupported`)
  }
  return { component, shift }
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
  readonly componentRoiShifts: ReadonlyMap<number, number>
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
      roiShift: options.componentRoiShifts.get(index) ?? 0,
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
    nextPart: 0,
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

const parseCodestream = (
  data: Uint8Array,
  limits: ImageLimits,
  options: { readonly allowTrailingBytes?: boolean } = {},
): ParsedCodestream => {
  if (data.byteLength < 6 || be16(data, 0) !== 0xff4f) {
    throw invalidInput('JPEG 2000 SOC marker is missing')
  }
  let position = 2
  let size: SizeMarker | undefined
  let defaultStyle: CodingStyle | undefined
  let defaultQuantization: Quantization | undefined
  const componentRoiShifts = new Map<number, number>()
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
      if (componentQuantizations.has(parsed.component)) {
        throw invalidInput('JPEG 2000 duplicate main QCC marker')
      }
      componentQuantizations.set(parsed.component, parsed.quantization)
      position = segment.end
      continue
    }
    if (marker === 0xff5e) {
      if (!size) throw invalidInput('JPEG 2000 RGN precedes SIZ')
      const segment = segmentPayload(data, position, data.byteLength)
      const parsed = parseRoiShift(segment.payload, size.components.length < 257 ? 1 : 2)
      if (parsed.component >= size.components.length) {
        throw invalidInput('JPEG 2000 RGN component index is invalid')
      }
      if (componentRoiShifts.has(parsed.component)) {
        throw invalidInput('JPEG 2000 duplicate main RGN marker')
      }
      componentRoiShifts.set(parsed.component, parsed.shift)
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
      if (partIndex === undefined || partCount === undefined) {
        throw truncatedInput('JPEG 2000 tile-part index is truncated')
      }
      if (partCount !== 0 && (partCount < 1 || partIndex >= partCount)) {
        throw invalidInput('JPEG 2000 tile-part index exceeds its declared count')
      }
      if (tilePartLength === 0) {
        throw unsupportedOperation('JPEG 2000 open-ended tile-parts are unsupported')
      }
      const tileEnd = position + tilePartLength
      if (tileEnd > data.byteLength || tileEnd <= segment.end) {
        throw truncatedInput('JPEG 2000 tile-part extent is invalid')
      }
      let tileStyle = defaultStyle
      let tileQuantization = defaultQuantization
      const tileComponentStyles = new Map(componentStyles)
      const tileComponentRoiShifts = new Map(componentRoiShifts)
      const tileComponentQuantizations = new Map(componentQuantizations)
      let headerPosition = segment.end
      let sawData = false
      const existingTile = tiles.get(tileIndex)
      if (partIndex !== (existingTile?.nextPart ?? 0)) {
        throw invalidInput(`JPEG 2000 tile ${tileIndex} part ${partIndex} is out of order`)
      }
      if (
        existingTile?.partCount !== undefined &&
        partCount !== 0 &&
        existingTile.partCount !== partCount
      ) {
        throw invalidInput(`JPEG 2000 tile ${tileIndex} changes its tile-part count`)
      }
      while (headerPosition + 2 <= tileEnd) {
        const tileMarker = be16(data, headerPosition, 'JPEG 2000 tile marker')
        if (tileMarker === 0xff93) {
          headerPosition += 2
          sawData = true
          break
        }
        const tileSegment = segmentPayload(data, headerPosition, tileEnd)
        if (partIndex > 0 && tileMarker !== 0xff58 && tileMarker !== 0xff64) {
          throw unsupportedOperation(
            `JPEG 2000 later tile-part marker 0x${tileMarker.toString(16)} is unsupported`,
          )
        }
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
        } else if (tileMarker === 0xff5e) {
          const parsed = parseRoiShift(tileSegment.payload, size.components.length < 257 ? 1 : 2)
          if (parsed.component >= size.components.length) {
            throw invalidInput('JPEG 2000 tile RGN component index is invalid')
          }
          tileComponentRoiShifts.set(parsed.component, parsed.shift)
        } else if (tileMarker === 0xff64) {
          // COM is bounded opaque metadata and does not alter reconstruction.
        } else if (tileMarker === 0xff58) {
          throw unsupportedOperation('JPEG 2000 PLT packet-length markers are unsupported')
        } else {
          throw unsupportedOperation(
            `JPEG 2000 tile marker 0x${tileMarker.toString(16)} is unsupported`,
          )
        }
        headerPosition = tileSegment.end
      }
      if (!sawData) throw invalidInput('JPEG 2000 SOD marker is missing')
      const tile =
        existingTile ??
        createTile({
          index: tileIndex,
          size,
          defaultStyle: tileStyle,
          componentStyles: tileComponentStyles,
          defaultQuantization: tileQuantization,
          componentQuantizations: tileComponentQuantizations,
          componentRoiShifts: tileComponentRoiShifts,
          blockCounter,
        })
      if (partCount !== 0) tile.partCount = partCount
      const consumed = parsePacketData(data, headerPosition, tileEnd, tile)
      if (consumed !== tileEnd) {
        throw invalidInput(`JPEG 2000 tile ${tileIndex} has unconsumed packet data`)
      }
      tile.nextPart += 1
      if (tile.partCount !== undefined && tile.nextPart === tile.partCount) {
        if (tile.nextPacket !== tile.packets.length) {
          throw truncatedInput(
            `JPEG 2000 tile ${tileIndex} contains ${tile.nextPacket} of ${tile.packets.length} packets`,
          )
        }
      }
      tiles.set(tileIndex, tile)
      position = tileEnd
      continue
    }
    if (marker === 0xff64) {
      const segment = segmentPayload(data, position, data.byteLength)
      position = segment.end
      continue
    }
    if (
      marker === 0xff55 ||
      marker === 0xff57 ||
      marker === 0xff5f ||
      marker === 0xff60 ||
      marker === 0xff61
    ) {
      throw unsupportedOperation(`JPEG 2000 marker 0x${marker.toString(16)} is not implemented`)
    }
    throw unsupportedOperation(`JPEG 2000 marker 0x${marker.toString(16)} is unsupported`)
  }
  if (!sawEnd) throw truncatedInput('JPEG 2000 EOC marker is missing')
  if (options.allowTrailingBytes !== true && position !== data.byteLength) {
    throw invalidInput('JPEG 2000 data follows EOC')
  }
  if (!size || !defaultStyle || !defaultQuantization) {
    throw invalidInput('JPEG 2000 main header is incomplete')
  }
  const expectedTiles =
    Math.ceil((size.xSize - size.tileXOrigin) / size.tileWidth) *
    Math.ceil((size.ySize - size.tileYOrigin) / size.tileHeight)
  if (tiles.size !== expectedTiles) {
    throw invalidInput(`JPEG 2000 contains ${tiles.size} of ${expectedTiles} required tiles`)
  }
  for (const tile of tiles.values()) {
    if (tile.partCount !== undefined && tile.nextPart !== tile.partCount) {
      throw truncatedInput(
        `JPEG 2000 tile ${tile.index} contains ${tile.nextPart} of ${tile.partCount} tile-parts`,
      )
    }
    if (tile.nextPacket !== tile.packets.length) {
      throw truncatedInput(
        `JPEG 2000 tile ${tile.index} contains ${tile.nextPacket} of ${tile.packets.length} packets`,
      )
    }
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
    endOffset: position,
  }
}

interface ReconstructedComponent {
  readonly x0: number
  readonly y0: number
  readonly width: number
  readonly height: number
  readonly scale: number
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
  resetContexts: boolean,
  roiShift: number,
  segmentationSymbols: boolean,
  verticalCausal: boolean,
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
      resetContexts,
      segmentationSymbols,
      verticalCausal,
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
          const planes = decoded.decodedBitPlanes[coefficient] ?? 0
          let coefficientMagnitude =
            (magnitude + (reversible ? 0 : 0.5)) * 2 ** (magnitudeBits - planes)
          if (roiShift > 0 && coefficientMagnitude >= 2 ** roiShift) {
            coefficientMagnitude /= 2 ** roiShift
          }
          const signed =
            (decoded.negative[coefficient] === 1 ? -coefficientMagnitude : coefficientMagnitude) *
            delta
          const targetOffset = band.type === 'LL' ? bandOffset : interleaveOffset + bandOffset * 2
          if (targetOffset < 0 || targetOffset >= target.length) {
            throw invalidInput(
              `JPEG 2000 ${band.type} coefficient ${targetOffset} maps outside ${target.length} values`,
            )
          }
          target[targetOffset] = signed
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
  scaleDenominator: 1 | 2 | 4 | 8,
): ReconstructedComponent => {
  const component = tile.components[componentIndex]
  if (!component) throw invalidInput('JPEG 2000 tile component is missing')
  const requestedReduction = Math.log2(scaleDenominator)
  const selectedLevel = Math.max(0, component.style.decompositionLevels - requestedReduction)
  const componentScale = 2 ** (component.style.decompositionLevels - selectedLevel)
  const levels: Jpeg2000ResolutionCoefficients[] = []
  let sequentialStep = 0
  for (const resolution of component.resolutions) {
    const width = resolution.x1 - resolution.x0
    const height = resolution.y1 - resolution.y0
    if (resolution.level > selectedLevel) break
    const values = new Float32Array(width * height)
    for (const band of resolution.bands) {
      const step = quantStep(component.quantization, sequentialStep, resolution.level)
      if (component.quantization.style !== 1) sequentialStep += 1
      const delta = component.style.reversible
        ? 1
        : 2 ** (specification.precision + gainLog2(band.type) - step.exponent) *
          (1 + step.mantissa / 2048)
      const magnitudeBits = component.quantization.guardBits + step.exponent - 1
      const codedMagnitudeBits = magnitudeBits + component.roiShift
      if (magnitudeBits < 0 || codedMagnitudeBits > 31) {
        throw unsupportedOperation(
          `JPEG 2000 coefficient magnitude ${codedMagnitudeBits} is unsupported`,
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
        codedMagnitudeBits,
        component.style.reversible,
        component.style.resetContexts,
        component.roiShift,
        component.style.segmentationSymbols,
        component.style.verticalCausal,
      )
    }
    levels.push({ x0: resolution.x0, y0: resolution.y0, width, height, values })
  }
  const reconstructed = inverseJpeg2000Wavelet(levels, component.style.reversible)
  return {
    x0: reconstructed.x0,
    y0: reconstructed.y0,
    width: reconstructed.width,
    height: reconstructed.height,
    scale: componentScale,
    values: reconstructed.values,
  }
}

const roundHalfAwayFromZero = (value: number): number =>
  value < 0 ? -Math.round(-value) : Math.round(value)

const ycbcrTables = (() => {
  const redFromCr = new Int16Array(256)
  const greenFromCb = new Int32Array(256)
  const greenFromCr = new Int32Array(256)
  const blueFromCb = new Int16Array(256)
  for (let value = 0; value < 256; value += 1) {
    const chroma = value - 128
    redFromCr[value] = roundHalfAwayFromZero(1.402 * chroma)
    greenFromCb[value] = roundHalfAwayFromZero(65_536 * (0.5 - 0.34414 * chroma))
    greenFromCr[value] = roundHalfAwayFromZero(65_536 * -0.71414 * chroma)
    blueFromCb[value] = roundHalfAwayFromZero(1.772 * chroma)
  }
  return Object.freeze({ redFromCr, greenFromCb, greenFromCr, blueFromCb })
})()

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
  const x = Math.floor(referenceX / (specification.xSampling * component.scale)) - component.x0
  const y = Math.floor(referenceY / (specification.ySampling * component.scale)) - component.y0
  const clampedX = Math.max(0, Math.min(component.width - 1, x))
  const clampedY = Math.max(0, Math.min(component.height - 1, y))
  return component.values[clampedY * component.width + clampedX] ?? 0
}

interface Jp2DisplayLayout {
  readonly alphaChannel?: number
  readonly colorChannels: readonly number[]
  readonly format: 'gray8' | 'rgb8' | 'rgba8'
  readonly outputChannels: 1 | 3 | 4
  readonly premultiplied: boolean
}

const displayLayout = (container: Jp2Header): Jp2DisplayLayout => {
  const colorCount = container.colorSpace === 'gray' ? 1 : 3
  const colorChannels = Array.from({ length: colorCount }, () => -1)
  let alphaChannel: number | undefined
  let premultiplied = false
  for (const definition of container.channelDefinitions) {
    if (definition.type === 0) {
      const association = definition.association - 1
      if (colorChannels[association] !== -1) {
        throw invalidInput(`JP2 color association ${definition.association} is duplicated`)
      }
      colorChannels[association] = definition.channel
      continue
    }
    if (definition.association !== 0) {
      throw unsupportedOperation('JP2 per-channel opacity is unsupported')
    }
    if (alphaChannel !== undefined) {
      throw unsupportedOperation('JP2 multiple opacity channels are unsupported')
    }
    alphaChannel = definition.channel
    premultiplied = definition.type === 2
  }
  if (colorChannels.some((channel) => channel < 0)) {
    throw invalidInput('JP2 color channel definitions are incomplete')
  }
  if (alphaChannel !== undefined) {
    return { alphaChannel, colorChannels, format: 'rgba8', outputChannels: 4, premultiplied }
  }
  return container.colorSpace === 'gray'
    ? { colorChannels, format: 'gray8', outputChannels: 1, premultiplied }
    : { colorChannels, format: 'rgb8', outputChannels: 3, premultiplied }
}

const paletteSample = (value: number, column: Jp2PaletteColumn): number => {
  const shifted = column.signed ? value + 2 ** (column.bitDepth - 1) : value
  return clampByte((shifted * 255) / (2 ** column.bitDepth - 1))
}

const channelSampleAt = (
  container: Jp2Header,
  parsed: ParsedCodestream,
  components: readonly ReconstructedComponent[],
  channel: number,
  referenceX: number,
  referenceY: number,
): number => {
  const mapping = container.channelMappings[channel]
  if (!mapping) throw invalidInput(`JP2 channel mapping ${channel} is missing`)
  const component = components[mapping.component]
  const specification = parsed.size.components[mapping.component]
  if (!component || !specification) throw invalidInput('JP2 mapped component is missing')
  const value = componentValueAt(component, specification, referenceX, referenceY)
  if (mapping.paletteColumn === undefined) return normalizedSample(value, specification)
  const palette = container.palette
  const column = palette?.columns[mapping.paletteColumn]
  if (!palette || !column) throw invalidInput('JP2 mapped palette column is missing')
  const rawIndex = specification.signed
    ? Math.round(value)
    : Math.round(value + 2 ** (specification.precision - 1))
  const index = Math.max(0, Math.min(palette.entries - 1, rawIndex))
  return paletteSample(column.values[index] ?? 0, column)
}

interface ReconstructedTile {
  readonly tile: Tile
  readonly components: readonly ReconstructedComponent[]
}

const reconstructTile = (
  codestream: Uint8Array,
  parsed: ParsedCodestream,
  tile: Tile,
  scaleDenominator: 1 | 2 | 4 | 8,
): ReconstructedTile => {
  const components = parsed.size.components.map((specification, index) =>
    reconstructComponent(codestream, tile, index, specification, scaleDenominator),
  )
  if (tile.style.transformComponents) {
    const first = parsed.size.components[0]
    if (!first || components.length < 3) {
      throw invalidInput('JPEG 2000 multiple-component transform requires three components')
    }
    for (let index = 0; index < 3; index += 1) {
      const specification = parsed.size.components[index]
      if (
        !specification ||
        specification.precision !== first.precision ||
        specification.xSampling !== 1 ||
        specification.ySampling !== 1 ||
        components[index]?.scale !== components[0]?.scale
      ) {
        throw unsupportedOperation(
          'JPEG 2000 transformed components must share precision, sampling, and resolution',
        )
      }
    }
  }
  return { tile, components }
}

const transformedColorAt = (
  parsed: ParsedCodestream,
  rendered: ReconstructedTile,
  referenceX: number,
  referenceY: number,
): readonly [number, number, number] => {
  const first = rendered.components[0]
  const second = rendered.components[1]
  const third = rendered.components[2]
  const specification = parsed.size.components[0]
  const secondSpec = parsed.size.components[1]
  const thirdSpec = parsed.size.components[2]
  if (!first || !second || !third || !specification || !secondSpec || !thirdSpec) {
    throw invalidInput('JPEG 2000 transformed color components are missing')
  }
  const y = componentValueAt(first, specification, referenceX, referenceY)
  const u = componentValueAt(second, secondSpec, referenceX, referenceY)
  const v = componentValueAt(third, thirdSpec, referenceX, referenceY)
  const offset = specification.signed ? 0 : 2 ** (specification.precision - 1)
  const maximum = 2 ** specification.precision - 1
  if (rendered.tile.style.reversible) {
    const green = y + offset - Math.floor((u + v) / 4)
    return [((green + v) * 255) / maximum, (green * 255) / maximum, ((green + u) * 255) / maximum]
  }
  const luminance = y + offset
  return [
    ((luminance + 1.402 * v) * 255) / maximum,
    ((luminance - 0.34413 * u - 0.71414 * v) * 255) / maximum,
    ((luminance + 1.772 * u) * 255) / maximum,
  ]
}

const writeRenderedPixel = (
  output: Uint8Array,
  target: number,
  container: Jp2Header,
  parsed: ParsedCodestream,
  layout: Jp2DisplayLayout,
  rendered: ReconstructedTile,
  referenceX: number,
  referenceY: number,
): void => {
  if (layout.format === 'gray8') {
    output[target] = channelSampleAt(
      container,
      parsed,
      rendered.components,
      layout.colorChannels[0] ?? 0,
      referenceX,
      referenceY,
    )
    return
  }
  let red: number
  let green: number
  let blue: number
  if (container.colorSpace === 'gray') {
    red = channelSampleAt(
      container,
      parsed,
      rendered.components,
      layout.colorChannels[0] ?? 0,
      referenceX,
      referenceY,
    )
    green = red
    blue = red
  } else if (rendered.tile.style.transformComponents) {
    const mappings = layout.colorChannels.map((channel) => container.channelMappings[channel])
    if (
      mappings.some(
        (mapping, index) =>
          !mapping || mapping.paletteColumn !== undefined || mapping.component !== index,
      )
    ) {
      throw unsupportedOperation('JP2 transformed color channels use an unsupported mapping')
    }
    ;[red, green, blue] = transformedColorAt(parsed, rendered, referenceX, referenceY)
  } else {
    const first = channelSampleAt(
      container,
      parsed,
      rendered.components,
      layout.colorChannels[0] ?? 0,
      referenceX,
      referenceY,
    )
    const second = channelSampleAt(
      container,
      parsed,
      rendered.components,
      layout.colorChannels[1] ?? 1,
      referenceX,
      referenceY,
    )
    const third = channelSampleAt(
      container,
      parsed,
      rendered.components,
      layout.colorChannels[2] ?? 2,
      referenceX,
      referenceY,
    )
    if (container.colorSpace === 'sycc') {
      red = first + (ycbcrTables.redFromCr[third] ?? 0)
      green =
        first +
        (((ycbcrTables.greenFromCb[second] ?? 0) + (ycbcrTables.greenFromCr[third] ?? 0)) >> 16)
      blue = first + (ycbcrTables.blueFromCb[second] ?? 0)
    } else {
      red = first
      green = second
      blue = third
    }
  }
  let alpha = 255
  if (layout.alphaChannel !== undefined) {
    alpha = channelSampleAt(
      container,
      parsed,
      rendered.components,
      layout.alphaChannel,
      referenceX,
      referenceY,
    )
    if (layout.premultiplied && alpha > 0 && alpha < 255) {
      red = (red * 255) / alpha
      green = (green * 255) / alpha
      blue = (blue * 255) / alpha
    } else if (layout.premultiplied && alpha === 0) {
      red = 0
      green = 0
      blue = 0
    }
  }
  output[target] = clampByte(red)
  output[target + 1] = clampByte(green)
  output[target + 2] = clampByte(blue)
  if (layout.outputChannels === 4) output[target + 3] = alpha
}

const reconstructPixelBlocks = async function* (
  codestream: Uint8Array,
  parsed: ParsedCodestream,
  container: Jp2Header,
  region: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  },
  scaleDenominator: 1 | 2 | 4 | 8,
): AsyncGenerator<PixelBlock> {
  const layout = displayLayout(container)
  const regionEndX = region.x + region.width
  const regionEndY = region.y + region.height
  let tileIndex = 0
  while (tileIndex < parsed.tiles.length) {
    const firstTile = parsed.tiles[tileIndex]
    if (!firstTile) throw invalidInput('JPEG 2000 tile row is missing')
    const rowY0 = firstTile.y0
    const rowY1 = firstTile.y1
    const rowTiles: Tile[] = []
    while (tileIndex < parsed.tiles.length) {
      const tile = parsed.tiles[tileIndex]
      if (!tile || tile.y0 !== rowY0 || tile.y1 !== rowY1) break
      rowTiles.push(tile)
      tileIndex += 1
    }
    const outputRowY0 = Math.ceil((rowY0 - parsed.size.yOrigin) / scaleDenominator)
    const outputRowY1 = Math.ceil((rowY1 - parsed.size.yOrigin) / scaleDenominator)
    const rowStart = Math.max(region.y, outputRowY0)
    const rowEnd = Math.min(regionEndY, outputRowY1)
    if (rowStart >= rowEnd) continue
    const renderedTiles = rowTiles
      .filter((tile) => {
        const x0 = Math.ceil((tile.x0 - parsed.size.xOrigin) / scaleDenominator)
        const x1 = Math.ceil((tile.x1 - parsed.size.xOrigin) / scaleDenominator)
        return x0 < regionEndX && x1 > region.x
      })
      .map((tile) => reconstructTile(codestream, parsed, tile, scaleDenominator))
    for (let outputY = rowStart; outputY < rowEnd; outputY += blockRows) {
      const rows = Math.min(blockRows, rowEnd - outputY)
      const stride = region.width * layout.outputChannels
      const data = new Uint8Array(stride * rows)
      for (const rendered of renderedTiles) {
        const tileX0 = Math.ceil((rendered.tile.x0 - parsed.size.xOrigin) / scaleDenominator)
        const tileX1 = Math.ceil((rendered.tile.x1 - parsed.size.xOrigin) / scaleDenominator)
        const outputX0 = Math.max(region.x, tileX0)
        const outputX1 = Math.min(regionEndX, tileX1)
        for (let localY = 0; localY < rows; localY += 1) {
          const scaledY = outputY + localY
          const referenceY = parsed.size.yOrigin + scaledY * scaleDenominator
          for (let scaledX = outputX0; scaledX < outputX1; scaledX += 1) {
            const referenceX = parsed.size.xOrigin + scaledX * scaleDenominator
            const target = localY * stride + (scaledX - region.x) * layout.outputChannels
            writeRenderedPixel(
              data,
              target,
              container,
              parsed,
              layout,
              rendered,
              referenceX,
              referenceY,
            )
          }
        }
      }
      yield {
        x: 0,
        y: outputY - region.y,
        width: region.width,
        height: rows,
        stride,
        format: layout.format,
        data,
      }
    }
  }
}

interface Jpeg2000Inspection {
  readonly container: Jp2Header
  readonly size: SizeMarker
  readonly lossless: boolean
  readonly resolutionLevels: number
  readonly tiles: number
}

const validateContainerSize = (container: Jp2Header, size: SizeMarker): void => {
  const width = size.xSize - size.xOrigin
  const height = size.ySize - size.yOrigin
  if (width !== container.width || height !== container.height) {
    throw invalidInput('JP2 ihdr dimensions disagree with JPEG 2000 SIZ')
  }
  if (size.components.length !== container.components) {
    throw invalidInput('JP2 ihdr component count disagrees with JPEG 2000 SIZ')
  }
  for (let index = 0; index < container.components; index += 1) {
    const component = size.components[index]
    if (!component) throw invalidInput('JPEG 2000 component is missing')
    if (
      component.precision !== container.bitDepths[index] ||
      component.signed !== container.signed[index]
    ) {
      throw invalidInput(`JP2 component ${index} precision disagrees with JPEG 2000 SIZ`)
    }
  }
}

const inspectCodestreamHeader = async (
  source: ImageSource,
  container: Jp2Header,
  limits: ImageLimits,
): Promise<Jpeg2000Inspection> => {
  const start = container.codestreamOffset
  const end = start + container.codestreamLength
  if (be16(await readExactly(source, start, 2), 0, 'JPEG 2000 SOC marker') !== 0xff4f) {
    throw invalidInput('JPEG 2000 SOC marker is missing')
  }
  let position = start + 2
  let markerCount = 1
  let size: SizeMarker | undefined
  let defaultStyle: CodingStyle | undefined
  const componentStyles = new Map<number, CodingStyle>()
  const componentQuantizations = new Set<number>()
  const componentRoiShifts = new Set<number>()
  let sawQuantization = false
  while (position + 2 <= end) {
    markerCount += 1
    if (markerCount > maximumBoxes)
      throw limitExceeded('JPEG 2000 main-header marker count exceeds limit')
    const markerBytes = await readExactly(source, position, 2)
    const marker = be16(markerBytes, 0, 'JPEG 2000 main-header marker')
    if (marker === 0xff90) break
    if (marker === 0xff93 || marker === 0xffd9 || marker === 0xff4f) {
      throw invalidInput(`JPEG 2000 marker 0x${marker.toString(16)} is invalid in the main header`)
    }
    const lengthBytes = await readExactly(source, position + 2, 2)
    const length = be16(lengthBytes, 0, 'JPEG 2000 main-header marker length')
    if (length < 2) throw invalidInput('JPEG 2000 main-header marker length is invalid')
    const markerEnd = position + 2 + length
    if (!Number.isSafeInteger(markerEnd) || markerEnd > end) {
      throw truncatedInput('JPEG 2000 main-header marker exceeds the codestream')
    }
    const payload = await readExactly(source, position + 4, length - 2)
    if (marker === 0xff51) {
      if (size) throw invalidInput('JPEG 2000 contains duplicate SIZ markers')
      size = parseSizeMarker(payload, limits)
    } else if (marker === 0xff52) {
      if (!size) throw invalidInput('JPEG 2000 COD precedes SIZ')
      if (defaultStyle) throw invalidInput('JPEG 2000 contains duplicate main COD markers')
      defaultStyle = parseCodingStyle(
        payload,
        false,
        size.components.length < 257 ? 1 : 2,
        undefined,
      ).style
    } else if (marker === 0xff53) {
      if (!size || !defaultStyle) throw invalidInput('JPEG 2000 COC precedes SIZ or COD')
      const parsedStyle = parseCodingStyle(
        payload,
        true,
        size.components.length < 257 ? 1 : 2,
        defaultStyle,
      )
      if (parsedStyle.component === undefined || parsedStyle.component >= size.components.length) {
        throw invalidInput('JPEG 2000 COC component index is invalid')
      }
      if (componentStyles.has(parsedStyle.component)) {
        throw invalidInput('JPEG 2000 duplicate main COC marker')
      }
      componentStyles.set(parsedStyle.component, parsedStyle.style)
    } else if (marker === 0xff5c) {
      if (sawQuantization) throw invalidInput('JPEG 2000 contains duplicate main QCD markers')
      parseQuantization(payload, 0)
      sawQuantization = true
    } else if (marker === 0xff5d) {
      if (!size) throw invalidInput('JPEG 2000 QCC precedes SIZ')
      const parsed = parseQuantization(payload, size.components.length < 257 ? 1 : 2)
      if (parsed.component === undefined || parsed.component >= size.components.length) {
        throw invalidInput('JPEG 2000 QCC component index is invalid')
      }
      if (componentQuantizations.has(parsed.component)) {
        throw invalidInput('JPEG 2000 duplicate main QCC marker')
      }
      componentQuantizations.add(parsed.component)
    } else if (marker === 0xff5e) {
      if (!size) throw invalidInput('JPEG 2000 RGN precedes SIZ')
      const parsed = parseRoiShift(payload, size.components.length < 257 ? 1 : 2)
      if (parsed.component >= size.components.length) {
        throw invalidInput('JPEG 2000 RGN component index is invalid')
      }
      if (componentRoiShifts.has(parsed.component)) {
        throw invalidInput('JPEG 2000 duplicate main RGN marker')
      }
      componentRoiShifts.add(parsed.component)
    } else if (
      marker !== 0xff55 &&
      marker !== 0xff57 &&
      marker !== 0xff5f &&
      marker !== 0xff60 &&
      marker !== 0xff61 &&
      marker !== 0xff64
    ) {
      throw unsupportedOperation(
        `JPEG 2000 main-header marker 0x${marker.toString(16)} is unsupported`,
      )
    }
    position = markerEnd
  }
  if (!size || !defaultStyle || !sawQuantization) {
    throw invalidInput('JPEG 2000 main header is incomplete')
  }
  if (position + 2 > end) throw truncatedInput('JPEG 2000 first tile-part is missing')
  validateContainerSize(container, size)
  displayLayout(container)
  const styles = size.components.map(
    (_, component) => componentStyles.get(component) ?? defaultStyle,
  )
  return {
    container,
    size,
    lossless: styles.every((style) => style.reversible),
    resolutionLevels: 1 + Math.max(...styles.map((style) => style.decompositionLevels)),
    tiles:
      Math.ceil((size.xSize - size.tileXOrigin) / size.tileWidth) *
      Math.ceil((size.ySize - size.tileYOrigin) / size.tileHeight),
  }
}

const inspectJpeg2000 = async (
  source: ImageSource,
  limits: ImageLimits,
): Promise<Jpeg2000Inspection> => {
  const container = await describeContainer(source, limits)
  return inspectCodestreamHeader(source, container, limits)
}

interface Jpeg2000Description {
  readonly container: Jp2Header
  readonly codestream: Uint8Array
  readonly parsed: ParsedCodestream
  readonly colorTransform?: RgbIccTransform
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
  validateContainerSize(container, parsed.size)
  displayLayout(container)
  const colorTransform =
    container.icc && container.colorSpace !== 'gray'
      ? parseRgbIccTransform(container.icc)
      : undefined
  return { container, codestream, parsed, ...(colorTransform ? { colorTransform } : {}) }
}

const metadataFor = (inspection: Jpeg2000Inspection): ImageMetadata => {
  const layout = displayLayout(inspection.container)
  return {
    width: inspection.container.width,
    height: inspection.container.height,
    format: 'jp2',
    mimeType: 'image/jp2',
    hasAlpha: layout.alphaChannel !== undefined,
    colorSpace:
      inspection.container.colorSpace === 'gray'
        ? 'gray'
        : inspection.container.colorSpace === 'sycc'
          ? 'sYCC'
          : 'sRGB',
    ...(inspection.container.icc ? { colorProfile: { kind: 'icc' as const } } : {}),
    bitDepth: Math.max(...inspection.container.bitDepths),
    sampleFormat: inspection.container.signed.some(Boolean)
      ? ('signed-integer' as const)
      : ('unsigned-integer' as const),
    frames: 1,
    components: inspection.container.components,
    channels: layout.outputChannels,
    channelBitDepths: inspection.container.bitDepths,
    lossless: inspection.lossless,
    tiles: inspection.tiles,
    resolutionLevels: inspection.resolutionLevels,
  }
}

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
    regionDecode: true,
    scaledDecode: true,
    progressive: false,
  })
  readonly #description: Jpeg2000Description

  constructor(description: Jpeg2000Description) {
    this.#description = description
    this.width = description.container.width
    this.height = description.container.height
    this.pixelFormat = displayLayout(description.container).format
  }

  decode(request: DecodeRequest = {}): AsyncIterable<PixelBlock> {
    const scale = request.scaleDenominator ?? 1
    if (scale !== 1 && scale !== 2 && scale !== 4 && scale !== 8) {
      throw invalidInput('JPEG 2000 decode scale denominator must be 1, 2, 4, or 8')
    }
    const scaledWidth = Math.ceil(this.width / scale)
    const scaledHeight = Math.ceil(this.height / scale)
    const region = decodeRegion(scaledWidth, scaledHeight, request)
    return reconstructPixelBlocks(
      this.#description.codestream,
      this.#description.parsed,
      this.#description.container,
      region,
      scale,
    )
  }
}

const decoderFor = (description: Jpeg2000Description): ImageDecoder => {
  const decoder = new Jpeg2000Decoder(description)
  return description.colorTransform
    ? new ColorManagedDecoder(decoder, description.colorTransform)
    : decoder
}

export type Jpeg2000CodestreamColorSpace = 'gray' | 'rgb' | 'ycbcr'

export type Jpeg2000CodestreamOptions = ImageLimitOptions & {
  readonly colorSpace?: Jpeg2000CodestreamColorSpace
}

export const createJpeg2000CodestreamDecoder = (
  codestream: Uint8Array,
  options: Readonly<Jpeg2000CodestreamOptions> = {},
): ImageDecoder => {
  const limits = resolveLimits(options)
  validateInputSize(codestream.byteLength, limits)
  const parsed = parseCodestream(codestream, limits)
  const width = parsed.size.xSize - parsed.size.xOrigin
  const height = parsed.size.ySize - parsed.size.yOrigin
  const components = parsed.size.components
  const requestedColorSpace = options.colorSpace ?? (components.length === 1 ? 'gray' : 'rgb')
  if (
    (requestedColorSpace === 'gray' && components.length !== 1) ||
    (requestedColorSpace !== 'gray' && components.length !== 3)
  ) {
    throw unsupportedOperation(
      `JPEG 2000 ${requestedColorSpace} decoding does not support ${components.length} components`,
    )
  }
  const container: Jp2Header = {
    width,
    height,
    components: components.length,
    bitDepths: Object.freeze(components.map((component) => component.precision)),
    signed: Object.freeze(components.map((component) => component.signed)),
    colorSpace:
      requestedColorSpace === 'gray' ? 'gray' : requestedColorSpace === 'ycbcr' ? 'sycc' : 'srgb',
    channelMappings: Object.freeze(
      components.map((_, component): Jp2ChannelMapping => ({ component })),
    ),
    channelDefinitions: Object.freeze(
      Array.from(
        { length: requestedColorSpace === 'gray' ? 1 : 3 },
        (_, channel): Jp2ChannelDefinition => ({ channel, type: 0, association: channel + 1 }),
      ),
    ),
    codestreamOffset: 0,
    codestreamLength: codestream.byteLength,
  }
  return decoderFor({ container, codestream, parsed })
}

export interface Jpeg2000NativeGrayFrame {
  readonly width: number
  readonly height: number
  readonly precision: number
  readonly signed: boolean
  readonly reversible: boolean
  readonly samplesLittleEndian: Uint8Array
  readonly consumedBytes: number
}

const nativeGraySample = (value: number, specification: ComponentSpec): number => {
  const shifted = specification.signed
    ? roundHalfAwayFromZero(value)
    : roundHalfAwayFromZero(value + 2 ** (specification.precision - 1))
  if (specification.signed) {
    const minimum = -(2 ** (specification.precision - 1))
    const maximum = 2 ** (specification.precision - 1) - 1
    return Math.max(minimum, Math.min(maximum, shifted))
  }
  const maximum = 2 ** specification.precision - 1
  return Math.max(0, Math.min(maximum, shifted))
}

export const decodeJpeg2000NativeGrayFrame = (
  codestream: Uint8Array,
  options: Readonly<ImageLimitOptions & { readonly allowTrailingBytes?: boolean }> = {},
): Jpeg2000NativeGrayFrame => {
  const limits = resolveLimits(options)
  validateInputSize(codestream.byteLength, limits)
  const parsed = parseCodestream(codestream, limits, {
    ...(options.allowTrailingBytes === undefined
      ? {}
      : { allowTrailingBytes: options.allowTrailingBytes }),
  })
  const specification = parsed.size.components[0]
  if (parsed.size.components.length !== 1 || specification === undefined) {
    throw unsupportedOperation(
      `JPEG 2000 native gray decoding does not support ${parsed.size.components.length} components`,
    )
  }
  if (specification.xSampling !== 1 || specification.ySampling !== 1) {
    throw unsupportedOperation('JPEG 2000 subsampled gray components are unsupported')
  }
  const width = parsed.size.xSize - parsed.size.xOrigin
  const height = parsed.size.ySize - parsed.size.yOrigin
  validateImageDimensions(width, height, 1, limits)
  if (specification.precision < 1 || specification.precision > 16) {
    throw unsupportedOperation(
      `JPEG 2000 component precision ${specification.precision} is unsupported`,
    )
  }
  const bytesPerSample = specification.precision <= 8 ? 1 : 2
  const samples = new Uint8Array(width * height * bytesPerSample)
  let reversible = true
  for (const tile of parsed.tiles) {
    reversible = reversible && tile.style.reversible
    const rendered = reconstructTile(codestream, parsed, tile, 1)
    const component = rendered.components[0]
    if (component === undefined)
      throw invalidInput('JPEG 2000 reconstructed gray component is missing')
    const x0 = Math.max(tile.x0, parsed.size.xOrigin)
    const y0 = Math.max(tile.y0, parsed.size.yOrigin)
    const x1 = Math.min(tile.x1, parsed.size.xSize)
    const y1 = Math.min(tile.y1, parsed.size.ySize)
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const sample = nativeGraySample(
          componentValueAt(component, specification, x, y),
          specification,
        )
        const index = (y - parsed.size.yOrigin) * width + (x - parsed.size.xOrigin)
        if (bytesPerSample === 1) {
          samples[index] = sample & 0xff
          continue
        }
        samples[index * 2] = sample & 0xff
        samples[index * 2 + 1] = (sample >> 8) & 0xff
      }
    }
  }
  return Object.freeze({
    width,
    height,
    precision: specification.precision,
    signed: specification.signed,
    reversible,
    samplesLittleEndian: samples,
    consumedBytes: parsed.endOffset,
  })
}

const preservedJpeg2000Metadata = async (
  source: ImageSource,
  limits: ImageLimits,
): Promise<PreservedMetadata> => {
  const container = await describeContainer(source, limits)
  return container.icc ? { icc: Uint8Array.from(container.icc) } : {}
}

export const jpeg2000Codec: ImageCodec = {
  format: 'jp2',
  mimeTypes: ['image/jp2'],
  minimumBytes: 12,
  detect: isJp2,
  metadata: async (source, limits) => metadataFor(await inspectJpeg2000(source, limits)),
  preservedMetadata: preservedJpeg2000Metadata,
  createDecoder: async (source, limits) => decoderFor(await describeJpeg2000(source, limits)),
}
