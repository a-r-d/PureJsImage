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
  collectDicomElements,
} from './elements.ts'
import { addDicomSafe, type DicomLimits, requireDicomSafeInteger } from './limits.ts'
import { convertDicomNativeRow } from './native-pixel.ts'
import type { DicomPixelDataLocator } from './parser.ts'
import type {
  DicomEncapsulatedFrame,
  DicomPixelDescription,
  DicomPixelEncoding,
} from './pixel-description.ts'
import { decodeDicomRleFrame } from './rle.ts'

export type DicomEncapsulatedFragmentPolicy = 'single-fragment-per-frame' | 'offset-table-frames'

export const dicomEncapsulatedFragmentPolicy = (
  encoding: DicomPixelEncoding,
): DicomEncapsulatedFragmentPolicy => {
  if (encoding === 'encapsulated-uncompressed' || encoding === 'rle') {
    return 'single-fragment-per-frame'
  }
  return 'offset-table-frames'
}

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
  logicalEncodedBytes?: number,
): DicomEncapsulatedFrame => {
  if (fragments.length === 0) throw invalidInput('DICOM encapsulated frame has no fragments')
  let physicalBytes = 0
  for (const fragment of fragments) {
    physicalBytes = addDicomSafe(physicalBytes, fragment.valueLength, 'encoded frame bytes')
  }
  const encodedBytes = logicalEncodedBytes ?? physicalBytes
  if (encodedBytes > limits.maxEncodedFrameBytes) {
    throw limitExceeded(
      `DICOM encapsulated frame is ${encodedBytes} bytes; maxEncodedFrameBytes is ${limits.maxEncodedFrameBytes}`,
    )
  }
  return Object.freeze({
    fragments: Object.freeze([...fragments]),
    encodedBytes,
    physicalEncodedBytes: physicalBytes,
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

const requireStrictlyIncreasingOffsets = (offsets: readonly number[], label: string): void => {
  for (let index = 1; index < offsets.length; index += 1) {
    const previous = offsets[index - 1]
    const offset = offsets[index]
    if (previous === undefined || offset === undefined || offset <= previous) {
      throw invalidInput(`DICOM ${label} is not strictly increasing`)
    }
  }
}

const framesFromBasicOffsets = (
  pixelFragments: readonly DicomFragmentLocator[],
  offsets: readonly number[],
  numberOfFrames: number,
  limits: Readonly<DicomLimits>,
  policy: DicomEncapsulatedFragmentPolicy,
): readonly DicomEncapsulatedFrame[] => {
  if (offsets.length !== numberOfFrames) {
    throw invalidInput(
      `DICOM offset table has ${offsets.length} entries; Number of Frames is ${numberOfFrames}`,
    )
  }
  const first = pixelFragments[0]
  if (first === undefined)
    throw invalidInput('DICOM encapsulated Pixel Data has no pixel fragments')
  const origin = first.headerOffset
  if (offsets[0] !== 0) throw invalidInput('DICOM offset table must start at 0')
  requireStrictlyIncreasingOffsets(offsets, 'offset table')
  const starts: number[] = []
  for (const offset of offsets) {
    starts.push(requireOffsetMatch(pixelFragments, origin, offset, 'offset table'))
  }
  const frames: DicomEncapsulatedFrame[] = []
  for (let index = 0; index < starts.length; index += 1) {
    const begin = starts[index]
    const end = starts[index + 1] ?? pixelFragments.length
    if (begin === undefined || end === undefined || end <= begin) {
      throw invalidInput('DICOM offset table frame bounds are invalid')
    }
    const fragments = pixelFragments.slice(begin, end)
    if (policy === 'single-fragment-per-frame' && fragments.length !== 1) {
      throw invalidInput('DICOM transfer syntax requires exactly one fragment per frame')
    }
    frames.push(frameFromFragments(fragments, limits))
  }
  return Object.freeze(frames)
}

const framesFromExtendedOffsets = (
  pixelFragments: readonly DicomFragmentLocator[],
  offsets: readonly number[],
  lengths: readonly number[],
  numberOfFrames: number,
  limits: Readonly<DicomLimits>,
): readonly DicomEncapsulatedFrame[] => {
  if (offsets.length === 0 || lengths.length === 0) {
    throw invalidInput('DICOM Extended Offset Table and Lengths must be non-empty')
  }
  if (offsets.length !== numberOfFrames || lengths.length !== numberOfFrames) {
    throw invalidInput(
      'DICOM Extended Offset Table and Lengths must contain exactly Number of Frames entries',
    )
  }
  const first = pixelFragments[0]
  if (first === undefined)
    throw invalidInput('DICOM encapsulated Pixel Data has no pixel fragments')
  const origin = first.headerOffset
  if (offsets[0] !== 0) throw invalidInput('DICOM Extended Offset Table must start at 0')
  requireStrictlyIncreasingOffsets(offsets, 'Extended Offset Table')
  const starts: number[] = []
  for (const offset of offsets) {
    starts.push(requireOffsetMatch(pixelFragments, origin, offset, 'Extended Offset Table'))
  }
  const frames: DicomEncapsulatedFrame[] = []
  for (let index = 0; index < starts.length; index += 1) {
    const begin = starts[index]
    const next = starts[index + 1]
    const end = next ?? pixelFragments.length
    if (begin === undefined || end !== begin + 1) {
      throw invalidInput('DICOM Extended Offset Table frame must occupy exactly one fragment')
    }
    const fragment = pixelFragments[begin]
    const logicalLength = lengths[index]
    if (fragment === undefined || logicalLength === undefined) {
      throw invalidInput('DICOM Extended Offset Table frame bounds are invalid')
    }
    if (!Number.isSafeInteger(logicalLength) || logicalLength < 1) {
      throw invalidInput('DICOM Extended Offset Table Length must be a positive integer')
    }
    if ((logicalLength & 1) === 0) {
      if (fragment.valueLength !== logicalLength) {
        throw invalidInput(
          'DICOM Extended Offset Table Length must equal the even fragment Item Value Length',
        )
      }
    } else if (fragment.valueLength !== logicalLength + 1) {
      throw invalidInput(
        'DICOM Extended Offset Table Length plus one padding byte must equal the odd-frame fragment Item Value Length',
      )
    }
    frames.push(frameFromFragments([fragment], limits, logicalLength))
  }
  return Object.freeze(frames)
}

export const indexDicomEncapsulatedFrames = async (
  source: ImageSource,
  dataset: DicomDataset,
  pixelData: DicomPixelDataLocator,
  numberOfFrames: number,
  limits: Readonly<DicomLimits>,
  policy: DicomEncapsulatedFragmentPolicy,
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
  const extendedMatches = collectDicomElements(dataset.elements, dicomTag.extendedOffsetTable)
  const extendedLengthMatches = collectDicomElements(
    dataset.elements,
    dicomTag.extendedOffsetTableLengths,
  )
  if (extendedMatches.length > 1) {
    throw invalidInput('DICOM Extended Offset Table is duplicated')
  }
  if (extendedLengthMatches.length > 1) {
    throw invalidInput('DICOM Extended Offset Table Lengths is duplicated')
  }
  const extended = extendedMatches[0]
  const extendedLengths = extendedLengthMatches[0]
  if (extended !== undefined && extendedLengths === undefined) {
    throw invalidInput('DICOM Extended Offset Table requires Extended Offset Table Lengths')
  }
  if (extended === undefined && extendedLengths !== undefined) {
    throw invalidInput('DICOM Extended Offset Table Lengths require an Extended Offset Table')
  }
  if (extended !== undefined && extendedLengths !== undefined) {
    if (extended.vr !== 'OV') {
      throw invalidInput('DICOM Extended Offset Table must use VR OV')
    }
    if (extendedLengths.vr !== 'OV') {
      throw invalidInput('DICOM Extended Offset Table Lengths must use VR OV')
    }
    if (extended.value === undefined) {
      throw limitExceeded('DICOM Extended Offset Table was not materialized')
    }
    if (extendedLengths.value === undefined) {
      throw limitExceeded('DICOM Extended Offset Table Lengths were not materialized')
    }
    if (bot.valueLength > 0) {
      throw invalidInput('DICOM Extended Offset Table requires an empty Basic Offset Table')
    }
    return framesFromExtendedOffsets(
      pixelFragments,
      decodeDicomUInt64Values(extended.value, 'Extended Offset Table'),
      decodeDicomUInt64Values(extendedLengths.value, 'Extended Offset Table Lengths'),
      numberOfFrames,
      limits,
    )
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
    return framesFromBasicOffsets(
      pixelFragments,
      decodeDicomUInt32Values(bytes),
      numberOfFrames,
      limits,
      policy,
    )
  }
  if (numberOfFrames === 1) {
    if (policy === 'single-fragment-per-frame' && pixelFragments.length !== 1) {
      throw invalidInput('DICOM transfer syntax requires exactly one fragment per frame')
    }
    return Object.freeze([frameFromFragments(pixelFragments, limits)])
  }
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
  for (let index = 0; index < frame.fragments.length; index += 1) {
    throwIfAborted(signal)
    const fragment = frame.fragments[index]
    if (fragment === undefined) throw invalidInput('DICOM encapsulated fragment is missing')
    const payload = await readExactly(
      source,
      fragment.valueOffset,
      fragment.valueLength,
      readOptions,
    )
    const remaining = frame.encodedBytes - offset
    const last = index === frame.fragments.length - 1
    if (!last) {
      if (payload.byteLength > remaining) {
        throw invalidInput('DICOM encapsulated fragment payload exceeds the logical frame length')
      }
      output.set(payload, offset)
      offset += payload.byteLength
      continue
    }
    if (payload.byteLength === remaining) {
      output.set(payload, offset)
      offset += payload.byteLength
      continue
    }
    if (payload.byteLength === remaining + 1 && (remaining & 1) === 1 && payload[remaining] === 0) {
      output.set(payload.subarray(0, remaining), offset)
      offset += remaining
      continue
    }
    if (payload.byteLength === remaining + 1 && (remaining & 1) === 1) {
      throw invalidInput('DICOM encapsulated fragment padding byte must be zero')
    }
    throw invalidInput(
      'DICOM encapsulated fragment payload does not match the logical frame length',
    )
  }
  if (offset !== frame.encodedBytes) {
    throw invalidInput('DICOM encapsulated frame logical length is incomplete')
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
    return decodeDicomJpegLosslessFrame(encoded, description, limits)
  }
  if (description.encoding === 'jpeg2000-lossless' || description.encoding === 'jpeg2000') {
    return decodeDicomJpeg2000Frame(encoded, description, limits)
  }
  if (encoded.byteLength === description.frameBytes) return encoded
  if (
    encoded.byteLength === description.frameBytes + 1 &&
    (description.frameBytes & 1) === 1 &&
    encoded[description.frameBytes] === 0
  ) {
    return encoded.subarray(0, description.frameBytes)
  }
  if (encoded.byteLength === description.frameBytes + 1 && (description.frameBytes & 1) === 1) {
    throw invalidInput('DICOM encapsulated uncompressed padding byte must be zero')
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
