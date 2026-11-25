import type { ImageMetadata, PreservedMetadata } from '../codec.ts'
import { invalidInput, limitExceeded, truncatedInput, unsupportedOperation } from '../errors.ts'
import { type ImageLimits, validateImageDimensions } from '../limits.ts'
import { iccColorSpace } from '../metadata.ts'
import { type ImageSource, readExactly } from '../source.ts'
import { MAX_ICC_PROFILE_BYTES } from './icc-limits.ts'
import { signature, isJp2 } from './jpeg2000-signature.ts'
const maximumBoxes = 4096
const maximumComponents = 16
const maximumTiles = 65_536
const maximumDecompositionLevels = 16
const maximumLayers = 16_384

export const be16 = (data: Uint8Array, offset: number, message = 'JPEG 2000 value'): number => {
  const high = data[offset]
  const low = data[offset + 1]
  if (high === undefined || low === undefined) throw truncatedInput(`${message} is truncated`)
  return high * 256 + low
}

export const be32 = (data: Uint8Array, offset: number, message = 'JPEG 2000 value'): number => {
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

export interface Jp2PaletteColumn {
  readonly bitDepth: number
  readonly signed: boolean
  readonly values: Int32Array
}

interface Jp2Palette {
  readonly entries: number
  readonly columns: readonly Jp2PaletteColumn[]
}

export interface Jp2ChannelMapping {
  readonly component: number
  readonly paletteColumn?: number
}

export interface Jp2ChannelDefinition {
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

export interface Jp2Header {
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

export const describeContainer = async (
  source: ImageSource,
  limits: ImageLimits,
): Promise<Jp2Header> => {
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

export interface ComponentSpec {
  readonly precision: number
  readonly signed: boolean
  readonly xSampling: number
  readonly ySampling: number
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

export interface SizeMarker {
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

export interface CodingStyle {
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

export interface QuantStep {
  readonly exponent: number
  readonly mantissa: number
}

export interface Quantization {
  readonly style: 0 | 1 | 2
  readonly guardBits: number
  readonly steps: readonly QuantStep[]
}

export const parseSizeMarker = (payload: Uint8Array, limits: ImageLimits): SizeMarker => {
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

export const parseCodingStyle = (
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

export const parseQuantization = (
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

export const parseRoiShift = (
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

export interface Jp2DisplayLayout {
  readonly alphaChannel?: number
  readonly colorChannels: readonly number[]
  readonly format: 'gray8' | 'rgb8' | 'rgba8'
  readonly outputChannels: 1 | 3 | 4
  readonly premultiplied: boolean
}

export const displayLayout = (container: Jp2Header): Jp2DisplayLayout => {
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

interface Jpeg2000Inspection {
  readonly container: Jp2Header
  readonly size: SizeMarker
  readonly lossless?: boolean
  readonly resolutionLevels: number
  readonly tiles: number
}

export const validateContainerSize = (container: Jp2Header, size: SizeMarker): void => {
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
  const componentQuantizations = new Map<number, Quantization>()
  const componentRoiShifts = new Set<number>()
  let defaultQuantization: Quantization | undefined
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
      defaultQuantization = parseQuantization(payload, 0).quantization
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
      componentQuantizations.set(parsed.component, parsed.quantization)
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
  if (!size || !defaultStyle || !sawQuantization || !defaultQuantization) {
    throw invalidInput('JPEG 2000 main header is incomplete')
  }
  if (position + 2 > end) throw truncatedInput('JPEG 2000 first tile-part is missing')
  validateContainerSize(container, size)
  displayLayout(container)
  const styles = size.components.map(
    (_, component) => componentStyles.get(component) ?? defaultStyle,
  )
  const quantizations = size.components.map(
    (_, component) => componentQuantizations.get(component) ?? defaultQuantization,
  )
  const reversibleTransform = styles.every((style) => style.reversible)
  const unquantized = quantizations.every((quantization) => quantization.style === 0)
  return {
    container,
    size,
    ...(reversibleTransform && unquantized ? {} : { lossless: false as const }),
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
    ...(inspection.lossless === undefined ? {} : { lossless: inspection.lossless }),
    tiles: inspection.tiles,
    resolutionLevels: inspection.resolutionLevels,
  }
}

export const preservedJpeg2000Metadata = async (
  source: ImageSource,
  limits: ImageLimits,
): Promise<PreservedMetadata> => {
  const container = await describeContainer(source, limits)
  return container.icc ? { icc: Uint8Array.from(container.icc) } : {}
}

export const readJpeg2000Metadata = async (
  source: ImageSource,
  limits: ImageLimits,
): Promise<ImageMetadata> => metadataFor(await inspectJpeg2000(source, limits))
