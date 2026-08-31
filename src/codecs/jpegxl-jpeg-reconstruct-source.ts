import { throwIfAborted, type AbortOptions } from '../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import type { ImageLimitOptions } from '../limits.ts'
import { resolveLimits } from '../limits.ts'
import type { ImageSink } from '../sink.ts'
import { createImageSource, type ImageInput, readExactly } from '../source.ts'
import type { JpegCoefficientComponent, JpegCoefficientImage } from './jpeg-coefficients.ts'
import {
  inspectJpegXlSource,
  JpegXlCodestreamSource,
  type JpegXlBoxSummary,
} from './jpegxl-container.ts'
import { readJpegXlSourceFrameStructure } from './jpegxl-decode.ts'
import {
  reconstructJpegFromCoefficientImage,
  type JpegXlJpegReconstructionMetadata,
} from './jpegxl-jpeg-reconstruct.ts'
import {
  decodeJpegXlJpegReconstructionBlobs,
  parseJpegXlJpegReconstructionHeader,
  type JpegXlJpegReconstructionBlobs,
  type JpegXlJpegReconstructionHeader,
} from './jpegxl-jpeg-reconstruction.ts'
import type { JpegXlLimitOptions } from './jpegxl-limits.ts'
import { resolveJpegXlLimits } from './jpegxl-limits.ts'
import {
  decodeJpegXlJpegAcGroup,
  decodeJpegXlJpegDcGroup,
  decodeJpegXlJpegHfGlobal,
  decodeJpegXlJpegLfGlobal,
  type JpegXlJpegAcGroup,
  type JpegXlJpegDcGroup,
} from './jpegxl-vardct-jpeg.ts'

export interface ReconstructJpegFromJpegXlOptions extends AbortOptions {
  readonly limits?: Readonly<ImageLimitOptions & JpegXlLimitOptions>
  readonly sink?: ImageSink
}

export interface DecodedJpegXlJpegReconstruction {
  readonly reconstruction: JpegXlJpegReconstructionHeader
  readonly blobs: JpegXlJpegReconstructionBlobs
  readonly image: JpegCoefficientImage
  readonly metadata: JpegXlJpegReconstructionMetadata
  readonly maximumOutputBytes: number
}

const payloadForBox = async (
  source: Awaited<ReturnType<typeof createImageSource>>,
  box: Readonly<JpegXlBoxSummary>,
  options: Readonly<AbortOptions>,
): Promise<Uint8Array> =>
  readExactly(source, box.offset + box.length - box.payloadBytes, box.payloadBytes, options)

const rawSampling = (mode: number): readonly [number, number] => {
  if (mode === 0) return Object.freeze([0, 0])
  if (mode === 1) return Object.freeze([1, 1])
  if (mode === 2) return Object.freeze([1, 0])
  if (mode === 3) return Object.freeze([0, 1])
  throw invalidInput('JPEG XL chroma subsampling mode is invalid')
}

const actualShifts = (
  modes: readonly [number, number, number],
): readonly (readonly [number, number])[] => {
  const raw = modes.map(rawSampling)
  const maximumHorizontal = Math.max(...raw.map(([horizontal]) => horizontal))
  const maximumVertical = Math.max(...raw.map(([, vertical]) => vertical))
  return Object.freeze(
    raw.map(([horizontal, vertical]): readonly [number, number] =>
      Object.freeze([maximumHorizontal - horizontal, maximumVertical - vertical] as const),
    ),
  )
}

const paddedBlockDimensions = (
  width: number,
  height: number,
  chromaSubsampling: readonly [number, number, number],
): readonly [number, number] => {
  const raw = chromaSubsampling.map(rawSampling)
  const horizontalAlignment = 2 ** Math.max(...raw.map(([horizontal]) => horizontal))
  const verticalAlignment = 2 ** Math.max(...raw.map(([, vertical]) => vertical))
  const visibleBlockWidth = Math.ceil(width / 8)
  const visibleBlockHeight = Math.ceil(height / 8)
  return Object.freeze([
    Math.ceil(visibleBlockWidth / horizontalAlignment) * horizontalAlignment,
    Math.ceil(visibleBlockHeight / verticalAlignment) * verticalAlignment,
  ] as const)
}

const checkedInt16 = (value: number): number => {
  if (!Number.isInteger(value) || value < -32_768 || value > 32_767) {
    throw invalidInput('JPEG XL coefficient exceeds signed 16-bit storage')
  }
  return value
}

const jpegChannelOrder = (colorTransform: 'none' | 'ycbcr'): readonly [number, number, number] =>
  colorTransform === 'ycbcr' ? Object.freeze([1, 0, 2]) : Object.freeze([0, 1, 2])

const transposeQuantization = (table: Int32Array<ArrayBufferLike>): Int32Array => {
  if (table.length !== 64) {
    throw unsupportedOperation('Exact JPEG reconstruction requires an 8x8 quantization table')
  }
  const output = new Int32Array(64)
  for (let position = 0; position < output.length; position += 1) {
    output[position] = table[(position & 7) * 8 + (position >>> 3)] ?? 0
  }
  return output
}

const mergeAcGroup = (
  destination: readonly Int16Array<ArrayBufferLike>[],
  destinationWidths: readonly number[],
  group: Readonly<JpegXlJpegAcGroup>,
  groupBlockX: number,
  groupBlockY: number,
  shifts: readonly (readonly [number, number])[],
  colorTransform: 'none' | 'ycbcr',
): void => {
  const channelOrder = jpegChannelOrder(colorTransform)
  for (let component = 0; component < destination.length; component += 1) {
    const internalChannel = channelOrder[component]
    if (internalChannel === undefined) {
      throw invalidInput('JPEG XL coefficient channel order is incomplete')
    }
    const shift = shifts[internalChannel]
    const output = destination[component]
    const outputWidth = destinationWidths[component]
    const source = group.componentCoefficients[component]
    const sourceWidth = group.componentBlockWidths[component]
    const sourceHeight = group.componentBlockHeights[component]
    if (!shift || !output || !outputWidth || !source || !sourceWidth || !sourceHeight) {
      throw invalidInput('JPEG XL coefficient group component is missing')
    }
    const destinationX = groupBlockX >> shift[0]
    const destinationY = groupBlockY >> shift[1]
    for (let y = 0; y < sourceHeight; y += 1) {
      for (let x = 0; x < sourceWidth; x += 1) {
        const sourceBase = (y * sourceWidth + x) * 64
        const destinationBase = ((destinationY + y) * outputWidth + destinationX + x) * 64
        for (let coefficient = 0; coefficient < 64; coefficient += 1) {
          output[destinationBase + coefficient] = checkedInt16(
            source[sourceBase + coefficient] ?? 0,
          )
        }
      }
    }
  }
}

const buildCoefficientImage = (
  width: number,
  height: number,
  chromaSubsampling: readonly [number, number, number],
  componentIds: readonly number[],
  componentQuantizationTables: readonly number[],
  quantization: readonly Int32Array<ArrayBufferLike>[],
  coefficients: readonly Int16Array<ArrayBufferLike>[],
  restartInterval: number,
  progressive: boolean,
  colorTransform: 'none' | 'ycbcr',
): JpegCoefficientImage => {
  if (componentIds.length !== 3 || componentQuantizationTables.length !== 3) {
    throw unsupportedOperation('Exact JPEG reconstruction currently requires three components')
  }
  const raw = chromaSubsampling.map(rawSampling)
  const maximumHorizontalSampling = 2 ** Math.max(...raw.map(([horizontal]) => horizontal))
  const maximumVerticalSampling = 2 ** Math.max(...raw.map(([, vertical]) => vertical))
  const shifts = actualShifts(chromaSubsampling)
  const mcusPerLine = Math.ceil(width / (maximumHorizontalSampling * 8))
  const mcusPerColumn = Math.ceil(height / (maximumVerticalSampling * 8))
  const components: JpegCoefficientComponent[] = []
  const channelOrder = jpegChannelOrder(colorTransform)
  for (let component = 0; component < 3; component += 1) {
    const internalChannel = channelOrder[component]
    if (internalChannel === undefined) {
      throw invalidInput('JPEG XL reconstruction channel order is incomplete')
    }
    const channelRaw = raw[internalChannel]
    const shift = shifts[internalChannel]
    const table = quantization[internalChannel]
    const componentCoefficients = coefficients[component]
    if (!channelRaw || !shift || !table || !componentCoefficients) {
      throw invalidInput('JPEG XL reconstruction component data is missing')
    }
    const horizontalSampling = 2 ** channelRaw[0]
    const verticalSampling = 2 ** channelRaw[1]
    const blocksPerLine = Math.ceil((width * horizontalSampling) / maximumHorizontalSampling / 8)
    const blocksPerColumn = Math.ceil((height * verticalSampling) / maximumVerticalSampling / 8)
    const blocksPerLineForMcu = mcusPerLine * horizontalSampling
    const blocksPerColumnForMcu = mcusPerColumn * verticalSampling
    if (
      componentCoefficients.length !== blocksPerLineForMcu * blocksPerColumnForMcu * 64 ||
      blocksPerLine > blocksPerLineForMcu ||
      blocksPerColumn > blocksPerColumnForMcu
    ) {
      throw unsupportedOperation('JPEG XL edge sampling requires padded coefficient support')
    }
    components.push(
      Object.freeze({
        id: componentIds[component] ?? 0,
        horizontalSampling,
        verticalSampling,
        quantizationTable: componentQuantizationTables[component] ?? 0,
        blocksPerLine,
        blocksPerColumn,
        blocksPerLineForMcu,
        blocksPerColumnForMcu,
        quantization: transposeQuantization(table),
        coefficients: componentCoefficients,
      }),
    )
  }
  const coefficientBytes = components.reduce(
    (total, component) => total + component.coefficients.byteLength,
    0,
  )
  return Object.freeze({
    width,
    height,
    progressive,
    colorTransform: colorTransform === 'ycbcr' ? 'ycbcr' : 'rgb',
    maximumHorizontalSampling,
    maximumVerticalSampling,
    mcusPerLine,
    mcusPerColumn,
    restartInterval,
    components: Object.freeze(components),
    scans: Object.freeze([]),
    coefficientBytes,
  })
}

export const decodeJpegXlJpegReconstruction = async (
  input: ImageInput,
  options: Readonly<ReconstructJpegFromJpegXlOptions> = {},
): Promise<DecodedJpegXlJpegReconstruction> => {
  const imageLimits = resolveLimits(options.limits)
  const jpegXlLimits = resolveJpegXlLimits(options.limits)
  const source = await createImageSource(input, imageLimits, options)
  throwIfAborted(options.signal)
  const structure = await inspectJpegXlSource(source, jpegXlLimits, options)
  const reconstructionBox = structure.metadataBoxes.find(({ type }) => type === 'jbrd')
  if (!reconstructionBox) {
    throw unsupportedOperation('JPEG XL file has no exact JPEG reconstruction data')
  }
  const reconstructionPayload = await payloadForBox(source, reconstructionBox, options)
  const reconstruction = parseJpegXlJpegReconstructionHeader(reconstructionPayload, jpegXlLimits)
  const blobs = decodeJpegXlJpegReconstructionBlobs(
    reconstructionPayload,
    reconstruction,
    jpegXlLimits,
  )
  const logical = new JpegXlCodestreamSource(source, structure)
  const frame = await readJpegXlSourceFrameStructure(
    logical,
    imageLimits,
    options,
    jpegXlLimits.maxHeaderBytes,
  )
  if (
    frame.encoding !== 'vardct' ||
    (frame.colorTransform !== 'ycbcr' && frame.colorTransform !== 'none') ||
    frame.bitDepth !== 8 ||
    frame.passCount !== 1
  ) {
    throw unsupportedOperation(
      'Exact JPEG reconstruction currently requires single-pass 8-bit JPEG-derived VarDCT',
    )
  }
  const sections = await Promise.all(
    frame.sections.map(({ offset, length }) => readExactly(logical, offset, length, options)),
  )
  const lfSection = sections[0]
  if (!lfSection) throw invalidInput('JPEG XL LF global section is missing')
  const combinedSection = sections.length === 1
  const lfGlobal = decodeJpegXlJpegLfGlobal(lfSection, 0, !combinedSection)
  const correlation = lfGlobal.colorCorrelation
  if (
    correlation.colorFactor !== 84 ||
    correlation.baseCorrelationX !== 0 ||
    correlation.baseCorrelationB !== 0 ||
    correlation.yToXDc !== 0 ||
    correlation.yToBDc !== 0
  ) {
    throw unsupportedOperation('JPEG XL color correlation is not exact-JPEG compatible')
  }
  const [fullBlockWidth, fullBlockHeight] = paddedBlockDimensions(
    frame.width,
    frame.height,
    frame.chromaSubsampling,
  )
  const dcGroupsAcross = Math.ceil(fullBlockWidth / 256)
  const dcGroupsDown = Math.ceil(fullBlockHeight / 256)
  if (dcGroupsAcross * dcGroupsDown !== frame.dcGroupCount) {
    throw invalidInput('JPEG XL DC group geometry is inconsistent')
  }
  const dcGroups: JpegXlJpegDcGroup[] = []
  for (let group = 0; group < frame.dcGroupCount; group += 1) {
    throwIfAborted(options.signal)
    const groupX = group % dcGroupsAcross
    const groupY = Math.floor(group / dcGroupsAcross)
    const blockWidth = Math.min(256, fullBlockWidth - groupX * 256)
    const blockHeight = Math.min(256, fullBlockHeight - groupY * 256)
    const section = combinedSection ? lfSection : sections[1 + group]
    if (!section) throw invalidInput('JPEG XL DC group section is missing')
    dcGroups.push(
      decodeJpegXlJpegDcGroup(
        section,
        {
          blockWidth,
          blockHeight,
          chromaSubsampling: frame.chromaSubsampling,
          groupId: group,
          dcGroupCount: frame.dcGroupCount,
        },
        lfGlobal.globalModularCode,
        combinedSection && group === 0 ? lfGlobal.endingBitPosition : 0,
        !combinedSection,
      ),
    )
  }
  const hfSection = combinedSection ? lfSection : sections[1 + frame.dcGroupCount]
  if (!hfSection) throw invalidInput('JPEG XL HF global section is missing')
  const groupCount = frame.groupsAcross * frame.groupsDown
  const hfGlobal = decodeJpegXlJpegHfGlobal(
    hfSection,
    { dcGroupCount: frame.dcGroupCount, groupCount, passCount: frame.passCount },
    lfGlobal,
    combinedSection ? (dcGroups.at(-1)?.endingBitPosition ?? 0) : 0,
    !combinedSection,
  )
  if (
    hfGlobal.dct8QuantizationDenominator === undefined ||
    Math.abs(hfGlobal.dct8QuantizationDenominator - 1 / (8 * 255)) > 1e-8 ||
    !hfGlobal.dct8Quantization
  ) {
    throw unsupportedOperation('JPEG XL quantization is not exact-JPEG compatible')
  }
  const hfPass = hfGlobal.passes[0]
  if (!hfPass) throw invalidInput('JPEG XL HF pass is missing')
  const shifts = actualShifts(frame.chromaSubsampling)
  const channelOrder = jpegChannelOrder(frame.colorTransform)
  const componentWidths = channelOrder.map(
    (channel) => fullBlockWidth >> (shifts[channel]?.[0] ?? 0),
  )
  const componentHeights = channelOrder.map(
    (channel) => fullBlockHeight >> (shifts[channel]?.[1] ?? 0),
  )
  const requiredCoefficientBytes = componentWidths.reduce(
    (total, width, component) =>
      total + BigInt(width) * BigInt(componentHeights[component] ?? 0) * 64n * 2n,
    0n,
  )
  if (requiredCoefficientBytes > BigInt(imageLimits.maxDecodedBytes)) {
    throw limitExceeded(
      `JPEG XL coefficients require ${requiredCoefficientBytes} bytes; maxDecodedBytes is ${imageLimits.maxDecodedBytes}`,
    )
  }
  const coefficients = componentWidths.map(
    (width, component) => new Int16Array(width * (componentHeights[component] ?? 0) * 64),
  )
  for (let group = 0; group < groupCount; group += 1) {
    throwIfAborted(options.signal)
    const groupX = group % frame.groupsAcross
    const groupY = Math.floor(group / frame.groupsAcross)
    const globalBlockX = groupX * 32
    const globalBlockY = groupY * 32
    const blockWidth = Math.min(32, fullBlockWidth - globalBlockX)
    const blockHeight = Math.min(32, fullBlockHeight - globalBlockY)
    const dcGroupX = Math.floor(globalBlockX / 256)
    const dcGroupY = Math.floor(globalBlockY / 256)
    const dcGroupIndex = dcGroupY * dcGroupsAcross + dcGroupX
    const dcGroup = dcGroups[dcGroupIndex]
    const section = combinedSection ? lfSection : sections[2 + frame.dcGroupCount + group]
    if (!dcGroup || !section) throw invalidInput('JPEG XL AC group data is missing')
    const decoded = decodeJpegXlJpegAcGroup(
      section,
      {
        blockX: globalBlockX - dcGroupX * 256,
        blockY: globalBlockY - dcGroupY * 256,
        blockWidth,
        blockHeight,
        chromaSubsampling: frame.chromaSubsampling,
        histogramCount: hfGlobal.histogramCount,
        colorTransform: frame.colorTransform,
      },
      lfGlobal,
      hfPass,
      dcGroup,
      combinedSection && group === 0 ? hfGlobal.endingBitPosition : 0,
      true,
    )
    mergeAcGroup(
      coefficients,
      componentWidths,
      decoded,
      globalBlockX,
      globalBlockY,
      shifts,
      frame.colorTransform,
    )
  }
  if (frame.colorTransform === 'none') {
    for (let component = 0; component < coefficients.length; component += 1) {
      const internalChannel = channelOrder[component]
      const table =
        internalChannel === undefined ? undefined : hfGlobal.dct8Quantization[internalChannel]
      const plane = coefficients[component]
      const dcQuantization = table?.[0]
      if (!plane || !dcQuantization || 1024 % dcQuantization !== 0) {
        throw unsupportedOperation('JPEG XL RGB DC level shift is not integral')
      }
      const offset = 1024 / dcQuantization
      for (let block = 0; block < plane.length / 64; block += 1) {
        plane[block * 64] = checkedInt16((plane[block * 64] ?? 0) - offset)
      }
    }
  }
  const image = buildCoefficientImage(
    frame.width,
    frame.height,
    frame.chromaSubsampling,
    reconstruction.componentIds,
    reconstruction.componentQuantizationTables,
    hfGlobal.dct8Quantization,
    coefficients,
    reconstruction.restartInterval ?? 0,
    reconstruction.markerOrder.includes(0xc2),
    frame.colorTransform,
  )
  const exifBox = structure.metadataBoxes.find(({ type }) => type === 'Exif')
  const xmpBox = structure.metadataBoxes.find(({ type }) => type === 'xml ')
  const metadata = {
    ...(exifBox ? { exif: await payloadForBox(source, exifBox, options) } : {}),
    ...(xmpBox ? { xmp: await payloadForBox(source, xmpBox, options) } : {}),
  }
  return Object.freeze({
    reconstruction,
    blobs,
    image,
    metadata: Object.freeze(metadata),
    maximumOutputBytes: jpegXlLimits.maxReconstructedJpegBytes,
  })
}

export const reconstructJpegFromJpegXl = async (
  input: ImageInput,
  options: Readonly<ReconstructJpegFromJpegXlOptions> = {},
): Promise<Uint8Array> => {
  try {
    const decoded = await decodeJpegXlJpegReconstruction(input, options)
    const output = reconstructJpegFromCoefficientImage(
      decoded.reconstruction,
      decoded.blobs,
      decoded.image,
      decoded.metadata,
      decoded.maximumOutputBytes,
    )
    if (options.sink) {
      await options.sink.write(output)
      await options.sink.close()
    }
    return output
  } catch (error) {
    await options.sink?.abort(error)
    throw error
  }
}
