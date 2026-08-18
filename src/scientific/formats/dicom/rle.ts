import { invalidInput, limitExceeded } from '../../../errors.ts'
import { addDicomSafe } from './limits.ts'
import type { DicomPixelDescription } from './pixel-description.ts'

const rleHeaderBytes = 64
const rleHeaderEntries = 16

const readUint32Le = (bytes: Uint8Array, offset: number): number => {
  const b0 = bytes[offset]
  const b1 = bytes[offset + 1]
  const b2 = bytes[offset + 2]
  const b3 = bytes[offset + 3]
  if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) {
    throw invalidInput('DICOM RLE header is truncated')
  }
  return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0
}

const decodeRleSegment = (input: Uint8Array, rows: number, columns: number): Uint8Array => {
  const expected = rows * columns
  const output = new Uint8Array(expected)
  let inputOffset = 0
  for (let row = 0; row < rows; row += 1) {
    const rowStart = row * columns
    const rowEnd = rowStart + columns
    let outputOffset = rowStart
    while (outputOffset < rowEnd) {
      if (inputOffset >= input.byteLength) throw invalidInput('DICOM RLE segment is truncated')
      const code = input[inputOffset]
      if (code === undefined) throw invalidInput('DICOM RLE segment is truncated')
      inputOffset += 1
      if (code === 128) continue
      const remaining = rowEnd - outputOffset
      if (code < 128) {
        const count = code + 1
        if (count > remaining) {
          throw invalidInput('DICOM RLE literal run crosses a row boundary')
        }
        const next = addDicomSafe(inputOffset, count, 'RLE literal end')
        if (next > input.byteLength) throw invalidInput('DICOM RLE literal run is truncated')
        output.set(input.subarray(inputOffset, next), outputOffset)
        inputOffset = next
        outputOffset += count
        continue
      }
      const count = 257 - code
      if (count > remaining) {
        throw invalidInput('DICOM RLE repeat run crosses a row boundary')
      }
      if (inputOffset >= input.byteLength) throw invalidInput('DICOM RLE repeat run is truncated')
      const value = input[inputOffset]
      if (value === undefined) throw invalidInput('DICOM RLE repeat run is truncated')
      inputOffset += 1
      output.fill(value, outputOffset, outputOffset + count)
      outputOffset += count
    }
  }
  const unused = input.byteLength - inputOffset
  if (unused === 0) return output
  if (unused === 1 && (inputOffset & 1) === 1 && input[inputOffset] === 0) return output
  if (unused === 1 && input[inputOffset] !== 0) {
    throw invalidInput('DICOM RLE segment padding byte must be zero')
  }
  throw invalidInput('DICOM RLE segment has trailing bytes after the decoded rows')
}

export const decodeDicomRleFrame = (
  encoded: Uint8Array,
  description: Pick<
    DicomPixelDescription,
    'rows' | 'columns' | 'samplesPerPixel' | 'bitsAllocated' | 'frameBytes'
  >,
): Uint8Array => {
  if (encoded.byteLength < rleHeaderBytes)
    throw invalidInput('DICOM RLE frame is shorter than its header')
  const segmentCount = readUint32Le(encoded, 0)
  const expectedSegments = description.samplesPerPixel * (description.bitsAllocated / 8)
  if (segmentCount !== expectedSegments) {
    throw invalidInput(
      `DICOM RLE segment count ${segmentCount} does not match ${expectedSegments} byte planes`,
    )
  }
  const offsets: number[] = []
  for (let index = 1; index <= segmentCount; index += 1) {
    offsets.push(readUint32Le(encoded, index * 4))
  }
  for (let index = segmentCount + 1; index < rleHeaderEntries; index += 1) {
    if (readUint32Le(encoded, index * 4) !== 0) {
      throw invalidInput('DICOM RLE header has a non-zero unused segment offset')
    }
  }
  const firstOffset = offsets[0]
  if (firstOffset !== rleHeaderBytes) {
    throw invalidInput('DICOM RLE first segment offset must equal 64')
  }
  for (let index = 1; index < offsets.length; index += 1) {
    const previous = offsets[index - 1]
    const current = offsets[index]
    if (previous === undefined || current === undefined || current <= previous) {
      throw invalidInput('DICOM RLE segment offsets are not strictly increasing')
    }
  }
  const lastOffset = offsets[offsets.length - 1]
  if (lastOffset === undefined || lastOffset >= encoded.byteLength) {
    throw invalidInput('DICOM RLE segment offset is outside the frame')
  }
  const planeBytes = description.rows * description.columns
  const planes: Uint8Array[] = []
  for (let index = 0; index < offsets.length; index += 1) {
    const start = offsets[index]
    const end = offsets[index + 1] ?? encoded.byteLength
    if (start === undefined || end === undefined || end < start) {
      throw invalidInput('DICOM RLE segment bounds are invalid')
    }
    planes.push(
      decodeRleSegment(encoded.subarray(start, end), description.rows, description.columns),
    )
  }
  if (description.bitsAllocated === 8) {
    const plane = planes[0]
    if (plane === undefined || plane.byteLength !== description.frameBytes) {
      throw invalidInput('DICOM RLE 8-bit frame size is invalid')
    }
    return plane
  }
  const high = planes[0]
  const low = planes[1]
  if (high === undefined || low === undefined) {
    throw invalidInput('DICOM RLE 16-bit frame is missing a byte plane')
  }
  const native = new Uint8Array(description.frameBytes)
  if (native.byteLength !== planeBytes * 2) {
    throw limitExceeded('DICOM RLE reconstructed frame size is invalid')
  }
  for (let index = 0; index < planeBytes; index += 1) {
    native[index * 2] = low[index] ?? 0
    native[index * 2 + 1] = high[index] ?? 0
  }
  return native
}
