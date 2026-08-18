import type { AbortOptions } from '../../../abort.ts'
import { throwIfAborted } from '../../../abort.ts'
import { invalidInput, limitExceeded } from '../../../errors.ts'
import type { RasterBlock } from '../../../raster.ts'
import { type ImageSource, readExactly } from '../../../source.ts'
import type { DicomPixelDescription } from './pixel-description.ts'

export interface DicomNativePlaneRead extends AbortOptions {
  readonly frame: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly rowsPerBlock: number
  readonly maxRegionBytes: number
}

const normalizeStoredSample = (allocated: number, bitsStored: number, signed: boolean): number => {
  const mask = bitsStored === 16 ? 0xffff : (1 << bitsStored) - 1
  const masked = allocated & mask
  if (!signed) return masked
  const signBit = 1 << (bitsStored - 1)
  return (masked & signBit) === 0 ? masked : masked | ~mask
}

const writeInt16BE = (output: Uint8Array, offset: number, value: number): void => {
  output[offset] = (value >> 8) & 0xff
  output[offset + 1] = value & 0xff
}

export const convertDicomNativeRow = (
  input: Uint8Array,
  output: Uint8Array,
  description: DicomPixelDescription,
): void => {
  if (description.bytesPerSample === 1) {
    if (description.bitsStored === 8) {
      output.set(input)
      return
    }
    for (let index = 0; index < input.byteLength; index += 1) {
      output[index] =
        normalizeStoredSample(
          input[index] ?? 0,
          description.bitsStored,
          description.pixelRepresentation === 'signed',
        ) & 0xff
    }
    return
  }
  const signed = description.pixelRepresentation === 'signed'
  const identity = description.bitsStored === 16
  for (let index = 0; index < input.byteLength; index += 2) {
    const allocated = (input[index] ?? 0) | ((input[index + 1] ?? 0) << 8)
    const sample = identity
      ? signed
        ? (allocated << 16) >> 16
        : allocated
      : normalizeStoredSample(allocated, description.bitsStored, signed)
    writeInt16BE(output, index, sample)
  }
}

export async function* readDicomNativePlane(
  source: ImageSource,
  description: DicomPixelDescription,
  request: Readonly<DicomNativePlaneRead>,
): AsyncIterable<RasterBlock> {
  throwIfAborted(request.signal)
  if (
    !Number.isSafeInteger(request.frame) ||
    request.frame < 0 ||
    request.frame >= description.numberOfFrames
  ) {
    throw invalidInput('DICOM frame index is outside the instance')
  }
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
  const frameOffset = description.pixelDataOffset + request.frame * description.frameBytes
  const readOptions = request.signal === undefined ? {} : { signal: request.signal }
  for (let localY = 0; localY < request.height; localY += blockRows) {
    throwIfAborted(request.signal)
    const height = Math.min(blockRows, request.height - localY)
    const output = new Uint8Array(selectedRowBytes * height)
    for (let row = 0; row < height; row += 1) {
      const sourceRow = request.y + localY + row
      const rowOffset = frameOffset + sourceRow * rowBytes + request.x * description.bytesPerSample
      const packed = await readExactly(source, rowOffset, selectedRowBytes, readOptions)
      convertDicomNativeRow(
        packed,
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
