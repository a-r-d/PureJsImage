import type { AbortOptions } from '../../../abort.ts'
import { throwIfAborted } from '../../../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../../../errors.ts'
import type { RasterBlock } from '../../../raster.ts'
import { type ImageSource, readExactly } from '../../../source.ts'
import {
  decodeDicomJpeg2000Frame,
  decodeDicomJpegBaselineFrame,
  decodeDicomJpegLosslessFrame,
} from './codestream.ts'
import { dicomTag } from './constants.ts'
import {
  type DicomDataset,
  type DicomFragmentLocator,
  decodeDicomUInt32Values,
  decodeDicomUInt64Values,
  findDicomElement,
} from './elements.ts'
import { addDicomSafe, type DicomLimits, requireDicomSafeInteger } from './limits.ts'
import { convertDicomNativeRow } from './native-pixel.ts'
import type { DicomPixelDataLocator } from './parser.ts'
import type { DicomEncapsulatedFrame, DicomPixelDescription } from './pixel-description.ts'
import { decodeDicomRleFrame } from './rle.ts'

export interface DicomEncapsulatedPlaneRead extends AbortOptions {
  readonly frame: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly rowsPerBlock: number
  readonly maxRegionBytes: number
  readonly maxEncodedFrameBytes: number
  readonly limits: Readonly<DicomLimits>
}

const frameFromFragments = (
  fragments: readonly DicomFragmentLocator[],
  limits: Readonly<DicomLimits>,
): DicomEncapsulatedFrame => {
  if (fragments.length === 0) throw invalidInput('DICOM encapsulated frame has no fragments')
  let encodedBytes = 0
  for (const fragment of fragments) {
    encodedBytes = addDicomSafe(encodedBytes, fragment.valueLength, 'encoded frame bytes')
  }
  if (encodedBytes > limits.maxEncodedFrameBytes) {
    throw limitExceeded(
      `DICOM encapsulated frame is ${encodedBytes} bytes; maxEncodedFrameBytes is ${limits.maxEncodedFrameBytes}`,
    )
  }
  return Object.freeze({
    fragments: Object.freeze([...fragments]),
    encodedBytes,
  })
}

const requireOffsetMatch = (
  pixelFragments: readonly DicomFragmentLocator[],
  origin: number,
  offset: number,
  label: string,
): number => {
  const absolute = addDicomSafe(origin, requireDicomSafeInteger(offset, label), label)
  for (let index = 0; index < pixelFragments.length; index += 1) {
    if (pixelFragments[index]?.headerOffset === absolute) return index
  }
  throw invalidInput(`DICOM ${label} does not point to a fragment Item Tag`)
}

const framesFromOffsets = (
  pixelFragments: readonly DicomFragmentLocator[],
  offsets: readonly number[],
  lengths: readonly number[] | undefined,
  numberOfFrames: number,
  limits: Readonly<DicomLimits>,
): readonly DicomEncapsulatedFrame[] => {
  if (offsets.length !== numberOfFrames) {
    throw invalidInput(
      `DICOM offset table has ${offsets.length} entries; Number of Frames is ${numberOfFrames}`,
    )
  }
  if (lengths !== undefined && lengths.length !== numberOfFrames) {
    throw invalidInput('DICOM Extended Offset Table Lengths count does not match Number of Frames')
  }
  const first = pixelFragments[0]
  if (first === undefined)
    throw invalidInput('DICOM encapsulated Pixel Data has no pixel fragments')
  const origin = first.headerOffset
  if (offsets[0] !== 0) throw invalidInput('DICOM offset table must start at 0')
  const starts: number[] = []
  for (let index = 0; index < offsets.length; index += 1) {
    const offset = offsets[index]
    if (offset === undefined) throw invalidInput('DICOM offset table is missing an entry')
    if (index > 0) {
      const previous = offsets[index - 1]
      if (previous === undefined || offset <= previous) {
        throw invalidInput('DICOM offset table is not strictly increasing')
      }
    }
    starts.push(requireOffsetMatch(pixelFragments, origin, offset, 'offset table'))
  }
  const frames: DicomEncapsulatedFrame[] = []
  for (let index = 0; index < starts.length; index += 1) {
    const begin = starts[index]
    const end = starts[index + 1] ?? pixelFragments.length
    if (begin === undefined || end === undefined || end <= begin) {
      throw invalidInput('DICOM offset table frame bounds are invalid')
    }
    const frame = frameFromFragments(pixelFragments.slice(begin, end), limits)
    const declared = lengths?.[index]
    if (declared !== undefined && declared !== frame.encodedBytes) {
      throw invalidInput('DICOM Extended Offset Table Lengths do not match fragment payloads')
    }
    frames.push(frame)
  }
  return Object.freeze(frames)
}

export const indexDicomEncapsulatedFrames = async (
  source: ImageSource,
  dataset: DicomDataset,
  pixelData: DicomPixelDataLocator,
  numberOfFrames: number,
  limits: Readonly<DicomLimits>,
  signal?: AbortSignal,
): Promise<readonly DicomEncapsulatedFrame[]> => {
  throwIfAborted(signal)
  const fragments = pixelData.fragments
  if (fragments === undefined || fragments.length === 0) {
    throw invalidInput('DICOM encapsulated Pixel Data has no fragments')
  }
  const bot = fragments[0]
  if (bot === undefined) throw invalidInput('DICOM Basic Offset Table is missing')
  const pixelFragments = fragments.slice(1)
  if (pixelFragments.length === 0) {
    throw invalidInput('DICOM encapsulated Pixel Data has no pixel fragments')
  }
  const extended = findDicomElement(dataset.elements, dicomTag.extendedOffsetTable)
  const extendedLengths = findDicomElement(dataset.elements, dicomTag.extendedOffsetTableLengths)
  if (extended !== undefined) {
    if (extended.value === undefined) {
      throw limitExceeded('DICOM Extended Offset Table was not materialized')
    }
    if (bot.valueLength > 0) {
      throw invalidInput('DICOM Extended Offset Table requires an empty Basic Offset Table')
    }
    const lengths =
      extendedLengths === undefined
        ? undefined
        : extendedLengths.value === undefined
          ? (() => {
              throw limitExceeded('DICOM Extended Offset Table Lengths were not materialized')
            })()
          : decodeDicomUInt64Values(extendedLengths.value, 'Extended Offset Table Lengths')
    return framesFromOffsets(
      pixelFragments,
      decodeDicomUInt64Values(extended.value, 'Extended Offset Table'),
      lengths,
      numberOfFrames,
      limits,
    )
  }
  if (extendedLengths !== undefined) {
    throw invalidInput('DICOM Extended Offset Table Lengths require an Extended Offset Table')
  }
  if (bot.valueLength > 0) {
    if (bot.valueLength > limits.maxOffsetTableBytes) {
      throw limitExceeded(
        `DICOM Basic Offset Table is ${bot.valueLength} bytes; maxOffsetTableBytes is ${limits.maxOffsetTableBytes}`,
      )
    }
    const bytes = await readExactly(
      source,
      bot.valueOffset,
      bot.valueLength,
      signal === undefined ? {} : { signal },
    )
    return framesFromOffsets(
      pixelFragments,
      decodeDicomUInt32Values(bytes),
      undefined,
      numberOfFrames,
      limits,
    )
  }
  if (numberOfFrames === 1) return Object.freeze([frameFromFragments(pixelFragments, limits)])
  if (pixelFragments.length === numberOfFrames) {
    return Object.freeze(pixelFragments.map((fragment) => frameFromFragments([fragment], limits)))
  }
  throw unsupportedOperation(
    'DICOM encapsulated multi-frame Pixel Data has an empty offset table and ambiguous fragment boundaries',
  )
}

export const readDicomEncapsulatedFrameBytes = async (
  source: ImageSource,
  frame: DicomEncapsulatedFrame,
  maxEncodedFrameBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> => {
  throwIfAborted(signal)
  if (frame.encodedBytes > maxEncodedFrameBytes) {
    throw limitExceeded(
      `DICOM encapsulated frame is ${frame.encodedBytes} bytes; maxEncodedFrameBytes is ${maxEncodedFrameBytes}`,
    )
  }
  const output = new Uint8Array(frame.encodedBytes)
  let offset = 0
  const readOptions = signal === undefined ? {} : { signal }
  for (const fragment of frame.fragments) {
    throwIfAborted(signal)
    const payload = await readExactly(
      source,
      fragment.valueOffset,
      fragment.valueLength,
      readOptions,
    )
    output.set(payload, offset)
    offset += fragment.valueLength
  }
  return output
}

const nativeFrameBytes = async (
  encoded: Uint8Array,
  description: DicomPixelDescription,
  limits: Readonly<DicomLimits>,
): Promise<Uint8Array> => {
  if (description.encoding === 'rle') return decodeDicomRleFrame(encoded, description)
  if (description.encoding === 'jpeg-baseline') {
    return decodeDicomJpegBaselineFrame(encoded, description, limits)
  }
  if (description.encoding === 'jpeg-lossless-sv1') {
    return decodeDicomJpegLosslessFrame(encoded, description)
  }
  if (description.encoding === 'jpeg2000-lossless' || description.encoding === 'jpeg2000') {
    return decodeDicomJpeg2000Frame(encoded, description, limits)
  }
  if (encoded.byteLength === description.frameBytes) return encoded
  if (encoded.byteLength === description.frameBytes + 1 && (description.frameBytes & 1) === 1) {
    return encoded.subarray(0, description.frameBytes)
  }
  throw invalidInput(
    `DICOM encapsulated uncompressed frame is ${encoded.byteLength} bytes; ${description.frameBytes} bytes are required`,
  )
}

export async function* readDicomEncapsulatedPlane(
  source: ImageSource,
  description: DicomPixelDescription,
  request: Readonly<DicomEncapsulatedPlaneRead>,
): AsyncIterable<RasterBlock> {
  throwIfAborted(request.signal)
  if (
    !Number.isSafeInteger(request.frame) ||
    request.frame < 0 ||
    request.frame >= description.numberOfFrames
  ) {
    throw invalidInput('DICOM frame index is outside the instance')
  }
  const frames = description.encapsulatedFrames
  const selectedFrame = frames?.[request.frame]
  if (frames === undefined || selectedFrame === undefined) {
    throw invalidInput('DICOM encapsulated frame index is missing')
  }
  const encoded = await readDicomEncapsulatedFrameBytes(
    source,
    selectedFrame,
    request.maxEncodedFrameBytes,
    request.signal,
  )
  const native = await nativeFrameBytes(encoded, description, request.limits)
  const rowBytes = description.columns * description.bytesPerSample
  const selectedRowBytes = request.width * description.bytesPerSample
  if (selectedRowBytes > request.maxRegionBytes) {
    throw limitExceeded('DICOM selected row exceeds maxDecodedFrameBytes')
  }
  const blockRows = Math.max(
    1,
    Math.min(request.rowsPerBlock, Math.floor(request.maxRegionBytes / selectedRowBytes)),
  )
  const format = Object.freeze({
    sampleType: description.sampleType,
    channels: 1,
    planar: false,
  })
  for (let localY = 0; localY < request.height; localY += blockRows) {
    throwIfAborted(request.signal)
    const height = Math.min(blockRows, request.height - localY)
    const output = new Uint8Array(selectedRowBytes * height)
    for (let row = 0; row < height; row += 1) {
      const sourceRow = request.y + localY + row
      const rowOffset = sourceRow * rowBytes + request.x * description.bytesPerSample
      convertDicomNativeRow(
        native.subarray(rowOffset, rowOffset + selectedRowBytes),
        output.subarray(row * selectedRowBytes, (row + 1) * selectedRowBytes),
        description,
      )
    }
    yield Object.freeze({
      x: request.x,
      y: request.y + localY,
      width: request.width,
      height,
      stride: selectedRowBytes,
      format,
      data: output,
    })
  }
}
