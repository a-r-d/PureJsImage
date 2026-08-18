import { jpegCodec, inspectJpegCodestream } from '../../../codecs/jpeg.ts'
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

const requireDicomJpegCodestream = (
  encoded: Uint8Array,
  options: {
    readonly sofMarker: number
    readonly label: string
    readonly columns: number
    readonly rows: number
    readonly precision?: number
    readonly componentCount?: number
  },
): {
  readonly inspection: ReturnType<typeof inspectJpegCodestream>
  readonly codestream: Uint8Array
} => {
  const inspection = inspectJpegCodestream(encoded)
  if (inspection.sofMarker !== options.sofMarker) {
    throw invalidInput(
      options.sofMarker === 0xc0
        ? `${options.label} requires SOF0`
        : `${options.label} requires SOF3`,
    )
  }
  if (inspection.componentCount !== (options.componentCount ?? 1)) {
    throw invalidInput(`${options.label} requires exactly one component`)
  }
  if (inspection.width !== options.columns || inspection.height !== options.rows) {
    throw invalidInput(
      `${options.label} ${inspection.width}x${inspection.height} does not match ${options.columns}x${options.rows}`,
    )
  }
  if (options.precision !== undefined && inspection.precision !== options.precision) {
    throw invalidInput(
      `${options.label} precision ${inspection.precision} does not match Bits Stored ${options.precision}`,
    )
  }
  const eoiEnd = inspection.eoiOffset + 2
  if (inspection.trailingByteCount === 0) {
    return {
      inspection,
      codestream: encoded.byteLength === eoiEnd ? encoded : encoded.subarray(0, eoiEnd),
    }
  }
  if (inspection.trailingByteCount === 1 && encoded[eoiEnd] === 0) {
    return { inspection, codestream: encoded.subarray(0, eoiEnd) }
  }
  throw invalidInput(`${options.label} contains invalid bytes after EOI`)
}

const requireDicomJpeg2000Padding = (encoded: Uint8Array, consumedBytes: number): void => {
  if (consumedBytes === encoded.byteLength) return
  if (
    consumedBytes === encoded.byteLength - 1 &&
    (consumedBytes & 1) === 1 &&
    encoded[consumedBytes] === 0
  ) {
    return
  }
  throw invalidInput('DICOM JPEG 2000 contains invalid bytes after EOC')
}

const storedBitMask = (bitsStored: number, bitsAllocated: 8 | 16): number => {
  if (bitsStored === bitsAllocated) return bitsAllocated === 8 ? 0xff : 0xffff
  return (1 << bitsStored) - 1
}

export const packDicomCodecSamples = (
  samplesLittleEndian: Uint8Array,
  precision: number,
  description: DicomPixelDescription,
): Uint8Array => {
  if (precision !== description.bitsStored) {
    throw invalidInput(
      `DICOM compressed precision ${precision} does not match Bits Stored ${description.bitsStored}`,
    )
  }
  const sourceBytes = precision <= 8 ? 1 : 2
  const sampleCount = description.rows * description.columns
  if (samplesLittleEndian.byteLength !== sampleCount * sourceBytes) {
    throw invalidInput('DICOM compressed frame sample count does not match Rows and Columns')
  }
  const mask = storedBitMask(description.bitsStored, description.bitsAllocated)
  if (description.bytesPerSample === 1) {
    if (sourceBytes !== 1) {
      throw invalidInput('DICOM compressed precision exceeds Bits Allocated')
    }
    if (mask === 0xff) return samplesLittleEndian
    const output = new Uint8Array(sampleCount)
    for (let index = 0; index < sampleCount; index += 1) {
      output[index] = (samplesLittleEndian[index] ?? 0) & mask
    }
    return output
  }
  const output = new Uint8Array(description.frameBytes)
  if (sourceBytes === 1) {
    for (let index = 0; index < sampleCount; index += 1) {
      const code = (samplesLittleEndian[index] ?? 0) & mask
      output[index * 2] = code & 0xff
      output[index * 2 + 1] = (code >> 8) & 0xff
    }
    return output
  }
  for (let index = 0; index < sampleCount; index += 1) {
    const code =
      ((samplesLittleEndian[index * 2] ?? 0) | ((samplesLittleEndian[index * 2 + 1] ?? 0) << 8)) &
      mask
    output[index * 2] = code & 0xff
    output[index * 2 + 1] = (code >> 8) & 0xff
  }
  return output
}

export const decodeDicomJpegBaselineFrame = async (
  encoded: Uint8Array,
  description: DicomPixelDescription,
  limits: Readonly<DicomLimits>,
): Promise<Uint8Array> => {
  const { codestream: trimmed } = requireDicomJpegCodestream(encoded, {
    sofMarker: 0xc0,
    label: 'DICOM JPEG Baseline',
    columns: description.columns,
    rows: description.rows,
    precision: 8,
  })
  if (description.bitsAllocated !== 8 || description.bitsStored !== 8) {
    throw unsupportedOperation('DICOM JPEG Baseline requires 8-bit stored samples')
  }
  if (description.pixelRepresentation !== 'unsigned') {
    throw unsupportedOperation('DICOM JPEG Baseline signed samples are unsupported')
  }
  const createDecoder = jpegCodec.createDecoder
  if (createDecoder === undefined) throw unsupportedOperation('JPEG decoder is unavailable')
  const decoder = await createDecoder(new MemorySource(trimmed), jpegLimits(limits), {
    preserveIcc: true,
  })
  if (decoder.width !== description.columns || decoder.height !== description.rows) {
    throw invalidInput(
      `DICOM JPEG Baseline ${decoder.width}x${decoder.height} does not match ${description.columns}x${description.rows}`,
    )
  }
  if (decoder.pixelFormat !== 'rgb8' && decoder.pixelFormat !== 'gray8') {
    throw unsupportedOperation(
      `DICOM JPEG Baseline pixel format ${decoder.pixelFormat} is unsupported`,
    )
  }
  const native = new Uint8Array(description.frameBytes)
  const channels = decoder.pixelFormat === 'gray8' ? 1 : 3
  for await (const block of decoder.decode({
    x: 0,
    y: 0,
    width: description.columns,
    height: description.rows,
  })) {
    if (block.format !== decoder.pixelFormat) {
      throw invalidInput('DICOM JPEG Baseline changed pixel format')
    }
    for (let row = 0; row < block.height; row += 1) {
      const outputRow = (block.y + row) * description.columns + block.x
      const sourceRow = row * block.stride
      for (let column = 0; column < block.width; column += 1) {
        native[outputRow + column] = block.data[sourceRow + column * channels] ?? 0
      }
    }
  }
  return native
}

export const decodeDicomJpegLosslessFrame = (
  encoded: Uint8Array,
  description: DicomPixelDescription,
  limits: Readonly<DicomLimits>,
): Uint8Array => {
  const { codestream } = requireDicomJpegCodestream(encoded, {
    sofMarker: 0xc3,
    label: 'DICOM JPEG Lossless',
    columns: description.columns,
    rows: description.rows,
    precision: description.bitsStored,
  })
  const decoded = decodeJpegLosslessFrame(codestream, {
    requiredSelection: 1,
    requiredPointTransform: 0,
    limits: {
      expectedWidth: description.columns,
      expectedHeight: description.rows,
      maxWidth: limits.maxColumns,
      maxHeight: limits.maxRows,
      maxEncodedBytes: limits.maxEncodedFrameBytes,
      maxDecodedBytes: limits.maxDecodedFrameBytes,
    },
  })
  if (decoded.width !== description.columns || decoded.height !== description.rows) {
    throw invalidInput(
      `DICOM JPEG Lossless ${decoded.width}x${decoded.height} does not match ${description.columns}x${description.rows}`,
    )
  }
  return packDicomCodecSamples(decoded.samplesLittleEndian, decoded.precision, description)
}

export const decodeDicomJpeg2000Frame = (
  encoded: Uint8Array,
  description: DicomPixelDescription,
  limits: Readonly<DicomLimits>,
): Uint8Array => {
  const decoded = decodeJpeg2000NativeGrayFrame(encoded, {
    ...jpegLimits(limits),
    allowTrailingBytes: true,
  })
  requireDicomJpeg2000Padding(encoded, decoded.consumedBytes)
  if (decoded.width !== description.columns || decoded.height !== description.rows) {
    throw invalidInput(
      `DICOM JPEG 2000 ${decoded.width}x${decoded.height} does not match ${description.columns}x${description.rows}`,
    )
  }
  if (decoded.signed !== (description.pixelRepresentation === 'signed')) {
    throw invalidInput('DICOM JPEG 2000 signedness does not match Pixel Representation')
  }
  if (description.encoding === 'jpeg2000-lossless') {
    if (!decoded.reversibleTransform) {
      throw invalidInput(
        'DICOM JPEG 2000 Lossless transfer syntax contains an irreversible component transform',
      )
    }
    if (!decoded.unquantized) {
      throw invalidInput('DICOM JPEG 2000 Lossless transfer syntax contains a quantized codestream')
    }
    if (!decoded.bitPreserving) {
      throw invalidInput(
        'DICOM JPEG 2000 Lossless transfer syntax contains a rate-truncated codestream',
      )
    }
  }
  return packDicomCodecSamples(decoded.samplesLittleEndian, decoded.precision, description)
}
