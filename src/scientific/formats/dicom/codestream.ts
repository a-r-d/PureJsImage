import { jpegCodec } from '../../../codecs/jpeg.ts'
import { decodeJpegLosslessFrame } from '../../../codecs/jpeg-lossless.ts'
import { decodeJpeg2000NativeGrayFrame } from '../../../codecs/jpeg2000.ts'
import { invalidInput, unsupportedOperation } from '../../../errors.ts'
import { resolveLimits } from '../../../limits.ts'
import { MemorySource } from '../../../source.ts'
import type { DicomLimits } from './limits.ts'
import type { DicomPixelDescription } from './pixel-description.ts'

const jpegLimits = (limits: Readonly<DicomLimits>) =>
  resolveLimits({
    maxWidth: limits.maxColumns,
    maxHeight: limits.maxRows,
    maxInputBytes: limits.maxEncodedFrameBytes,
    maxDecodedBytes: limits.maxDecodedFrameBytes,
    maxFrames: 1,
  })

const ensureJpegEoi = (encoded: Uint8Array): Uint8Array => {
  if (
    encoded.byteLength >= 2 &&
    encoded[encoded.byteLength - 2] === 0xff &&
    encoded[encoded.byteLength - 1] === 0xd9
  ) {
    return encoded
  }
  const padded = new Uint8Array(encoded.byteLength + 2)
  padded.set(encoded)
  padded[encoded.byteLength] = 0xff
  padded[encoded.byteLength + 1] = 0xd9
  return padded
}

export const decodeDicomJpegBaselineFrame = async (
  encoded: Uint8Array,
  description: DicomPixelDescription,
  limits: Readonly<DicomLimits>,
): Promise<Uint8Array> => {
  if (encoded.byteLength < 2 || encoded[0] !== 0xff || encoded[1] !== 0xd8) {
    throw invalidInput('DICOM JPEG Baseline frame is missing SOI')
  }
  const createDecoder = jpegCodec.createDecoder
  if (createDecoder === undefined) throw unsupportedOperation('JPEG decoder is unavailable')
  const decoder = await createDecoder(
    new MemorySource(ensureJpegEoi(encoded)),
    jpegLimits(limits),
    {
      preserveIcc: true,
    },
  )
  if (decoder.width !== description.columns || decoder.height !== description.rows) {
    throw invalidInput(
      `DICOM JPEG Baseline ${decoder.width}x${decoder.height} does not match ${description.columns}x${description.rows}`,
    )
  }
  if (decoder.pixelFormat !== 'rgb8') {
    throw unsupportedOperation(
      `DICOM JPEG Baseline pixel format ${decoder.pixelFormat} is unsupported`,
    )
  }
  const native = new Uint8Array(description.frameBytes)
  for await (const block of decoder.decode({
    x: 0,
    y: 0,
    width: description.columns,
    height: description.rows,
  })) {
    if (block.format !== 'rgb8') throw invalidInput('DICOM JPEG Baseline changed pixel format')
    for (let row = 0; row < block.height; row += 1) {
      const outputRow = (block.y + row) * description.columns + block.x
      const sourceRow = row * block.stride
      for (let column = 0; column < block.width; column += 1) {
        native[outputRow + column] = block.data[sourceRow + column * 3] ?? 0
      }
    }
  }
  return native
}

export const decodeDicomJpegLosslessFrame = (
  encoded: Uint8Array,
  description: DicomPixelDescription,
): Uint8Array => {
  const decoded = decodeJpegLosslessFrame(encoded, { requiredSelection: 1 })
  if (decoded.width !== description.columns || decoded.height !== description.rows) {
    throw invalidInput(
      `DICOM JPEG Lossless ${decoded.width}x${decoded.height} does not match ${description.columns}x${description.rows}`,
    )
  }
  if (decoded.precision !== description.bitsStored) {
    throw invalidInput(
      `DICOM JPEG Lossless precision ${decoded.precision} does not match Bits Stored ${description.bitsStored}`,
    )
  }
  if (decoded.samplesLittleEndian.byteLength !== description.frameBytes) {
    throw invalidInput(
      `DICOM JPEG Lossless frame is ${decoded.samplesLittleEndian.byteLength} bytes; ${description.frameBytes} bytes are required`,
    )
  }
  return decoded.samplesLittleEndian
}

const trimJpeg2000Codestream = (encoded: Uint8Array): Uint8Array => {
  for (let index = encoded.byteLength - 2; index >= 0; index -= 1) {
    if (encoded[index] === 0xff && encoded[index + 1] === 0xd9) {
      return encoded.subarray(0, index + 2)
    }
  }
  return encoded
}

export const decodeDicomJpeg2000Frame = (
  encoded: Uint8Array,
  description: DicomPixelDescription,
  limits: Readonly<DicomLimits>,
): Uint8Array => {
  const decoded = decodeJpeg2000NativeGrayFrame(trimJpeg2000Codestream(encoded), jpegLimits(limits))
  if (decoded.width !== description.columns || decoded.height !== description.rows) {
    throw invalidInput(
      `DICOM JPEG 2000 ${decoded.width}x${decoded.height} does not match ${description.columns}x${description.rows}`,
    )
  }
  if (decoded.signed !== (description.pixelRepresentation === 'signed')) {
    throw invalidInput('DICOM JPEG 2000 signedness does not match Pixel Representation')
  }
  if (decoded.precision !== description.bitsStored) {
    throw invalidInput(
      `DICOM JPEG 2000 precision ${decoded.precision} does not match Bits Stored ${description.bitsStored}`,
    )
  }
  if (description.encoding === 'jpeg2000-lossless' && !decoded.reversible) {
    throw invalidInput(
      'DICOM JPEG 2000 Lossless transfer syntax contains an irreversible codestream',
    )
  }
  const expectedBytes = description.frameBytes
  if (decoded.samplesLittleEndian.byteLength !== expectedBytes) {
    throw invalidInput(
      `DICOM JPEG 2000 frame is ${decoded.samplesLittleEndian.byteLength} bytes; ${expectedBytes} bytes are required`,
    )
  }
  return decoded.samplesLittleEndian
}
