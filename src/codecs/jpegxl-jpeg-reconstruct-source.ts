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
import { reconstructJpegFromCoefficientImage } from './jpegxl-jpeg-reconstruct.ts'
import {
  decodeJpegXlJpegReconstructionBlobs,
  parseJpegXlJpegReconstructionHeader,
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

const checkedInt16 = (value: number): number => {
  if (!Number.isInteger(value) || value < -32_768 || value > 32_767) {
    throw invalidInput('JPEG XL coefficient exceeds signed 16-bit storage')
  }
  return value
}

const mergeAcGroup = (
  destination: readonly Int16Array<ArrayBufferLike>[],
  destinationWidths: readonly number[],
  group: Readonly<JpegXlJpegAcGroup>,
  groupBlockX: number,
  groupBlockY: number,
  shifts: readonly (readonly [number, number])[],
): void => {
  for (let component = 0; component < destination.length; component += 1) {
    const internalChannel = component < 2 ? component ^ 1 : component
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
): JpegCoefficientImage => {
  if (componentIds.length !== 3 || componentQuantizationTables.length !== 3) {
    throw unsupportedOperation('Exact JPEG reconstruction currently requires three components')
  }
  const raw = chromaSubsampling.map(rawSampling)
  const maximumHorizontalSampling = 2 ** Math.max(...raw.map(([horizontal]) => horizontal))
  const maximumVerticalSampling = 2 ** Math.max(...raw.map(([, vertical]) => vertical))
  const shifts = actualShifts(chromaSubsampling)
  const fullBlockWidth = Math.ceil(width / 8)
  const fullBlockHeight = Math.ceil(height / 8)
  const mcusPerLine = Math.ceil(width / (maximumHorizontalSampling * 8))
  const mcusPerColumn = Math.ceil(height / (maximumVerticalSampling * 8))
  const components: JpegCoefficientComponent[] = []
  for (let component = 0; component < 3; component += 1) {
    const internalChannel = component < 2 ? component ^ 1 : component
    const channelRaw = raw[internalChannel]
    const shift = shifts[internalChannel]
    const table = quantization[internalChannel]
    const componentCoefficients = coefficients[component]
    if (!channelRaw || !shift || !table || !componentCoefficients) {
      throw invalidInput('JPEG XL reconstruction component data is missing')
    }
    const horizontalSampling = 2 ** channelRaw[0]
    const verticalSampling = 2 ** channelRaw[1]
    const blocksPerLine = fullBlockWidth >> shift[0]
    const blocksPerColumn = fullBlockHeight >> shift[1]
    const blocksPerLineForMcu = mcusPerLine * horizontalSampling
    const blocksPerColumnForMcu = mcusPerColumn * verticalSampling
    if (
      blocksPerLine !== blocksPerLineForMcu ||
      blocksPerColumn !== blocksPerColumnForMcu ||
      componentCoefficients.length !== blocksPerLine * blocksPerColumn * 64
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
        quantization: Int32Array.from(table),
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
    colorTransform: 'ycbcr',
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

export const reconstructJpegFromJpegXl = async (
  input: ImageInput,
  options: Readonly<ReconstructJpegFromJpegXlOptions> = {},
): Promise<Uint8Array> => {
  const imageLimits = resolveLimits(options.limits)
  const jpegXlLimits = resolveJpegXlLimits(options.limits)
  const source = await createImageSource(input, imageLimits, options)
  try {
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
      frame.colorTransform !== 'ycbcr' ||
      frame.bitDepth !== 8 ||
      frame.passCount !== 1
    ) {
      throw unsupportedOperation(
        'Exact JPEG reconstruction currently requires single-pass 8-bit YCbCr VarDCT',
      )
    }
    const sections = await Promise.all(
      frame.sections.map(({ offset, length }) => readExactly(logical, offset, length, options)),
    )
    const lfSection = sections[0]
    if (!lfSection) throw invalidInput('JPEG XL LF global section is missing')
    const lfGlobal = decodeJpegXlJpegLfGlobal(lfSection)
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
    const fullBlockWidth = Math.ceil(frame.width / 8)
    const fullBlockHeight = Math.ceil(frame.height / 8)
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
      const section = sections[1 + group]
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
        ),
      )
    }
    const hfSection = sections[1 + frame.dcGroupCount]
    if (!hfSection) throw invalidInput('JPEG XL HF global section is missing')
    const groupCount = frame.groupsAcross * frame.groupsDown
    const hfGlobal = decodeJpegXlJpegHfGlobal(
      hfSection,
      { dcGroupCount: frame.dcGroupCount, groupCount, passCount: frame.passCount },
      lfGlobal,
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
    const componentWidths = [
      fullBlockWidth,
      fullBlockWidth >> (shifts[0]?.[0] ?? 0),
      fullBlockWidth >> (shifts[2]?.[0] ?? 0),
    ]
    const componentHeights = [
      fullBlockHeight,
      fullBlockHeight >> (shifts[0]?.[1] ?? 0),
      fullBlockHeight >> (shifts[2]?.[1] ?? 0),
    ]
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
      const section = sections[2 + frame.dcGroupCount + group]
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
        },
        lfGlobal,
        hfPass,
        dcGroup,
      )
      mergeAcGroup(coefficients, componentWidths, decoded, globalBlockX, globalBlockY, shifts)
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
    )
    const exifBox = structure.metadataBoxes.find(({ type }) => type === 'Exif')
    const xmpBox = structure.metadataBoxes.find(({ type }) => type === 'xml ')
    const metadata = {
      ...(exifBox ? { exif: await payloadForBox(source, exifBox, options) } : {}),
      ...(xmpBox ? { xmp: await payloadForBox(source, xmpBox, options) } : {}),
    }
    const output = reconstructJpegFromCoefficientImage(
      reconstruction,
      blobs,
      image,
      metadata,
      jpegXlLimits.maxReconstructedJpegBytes,
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
