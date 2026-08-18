import type { AbortOptions } from '../../../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../../../errors.ts'
import type { RasterSampleType } from '../../../raster.ts'
import { rasterSampleBytes } from '../../../raster.ts'
import type { ImageSource } from '../../../source.ts'
import { dicomTag } from './constants.ts'
import {
  type DicomDataset,
  type DicomElement,
  type DicomFragmentLocator,
  decodeDicomIntegerString,
  decodeDicomText,
  decodeDicomUInt16Values,
  requireUniqueDicomElement,
} from './elements.ts'
import {
  dicomEncapsulatedFragmentPolicy,
  indexDicomEncapsulatedFrames,
} from './encapsulated-pixel.ts'
import type { DicomLimits } from './limits.ts'
import type { DicomPixelDataLocator } from './parser.ts'
import type { DicomTransferSyntax } from './transfer-syntax.ts'

export type DicomPhotometricInterpretation = 'MONOCHROME1' | 'MONOCHROME2'
export type DicomPixelRepresentation = 'unsigned' | 'signed'
export type DicomPixelEncoding =
  | 'native'
  | 'encapsulated-uncompressed'
  | 'rle'
  | 'jpeg-baseline'
  | 'jpeg-lossless-sv1'
  | 'jpeg2000-lossless'
  | 'jpeg2000'

export interface DicomEncapsulatedFrame {
  readonly fragments: readonly DicomFragmentLocator[]
  readonly encodedBytes: number
  readonly physicalEncodedBytes: number
}

export interface DicomPixelDescription {
  readonly rows: number
  readonly columns: number
  readonly numberOfFrames: number
  readonly samplesPerPixel: 1
  readonly photometricInterpretation: DicomPhotometricInterpretation
  readonly bitsAllocated: 8 | 16
  readonly bitsStored: number
  readonly highBit: number
  readonly pixelRepresentation: DicomPixelRepresentation
  readonly sampleType: RasterSampleType
  readonly bytesPerSample: 1 | 2
  readonly frameBytes: number
  readonly totalPixelBytes: number
  readonly pixelDataOffset: number
  readonly pixelDataLength: number
  readonly encoding: DicomPixelEncoding
  readonly encapsulatedFrames?: readonly DicomEncapsulatedFrame[]
}

const requiredElement = (
  elements: readonly DicomElement[],
  tag: number,
  label: string,
): DicomElement => requireUniqueDicomElement(elements, tag, label)

const requiredValue = (
  elements: readonly DicomElement[],
  tag: number,
  label: string,
): Uint8Array => {
  const value = requiredElement(elements, tag, label).value
  if (value === undefined) throw invalidInput(`DICOM ${label} value was not materialized`)
  return value
}

const optionalValue = (
  elements: readonly DicomElement[],
  tag: number,
  label: string,
): Uint8Array | undefined => {
  const matches = elements.filter((element) => element.tag === tag)
  if (matches.length > 1) throw invalidInput(`DICOM ${label} is duplicated`)
  return matches[0]?.value
}

const requiredUInt16 = (elements: readonly DicomElement[], tag: number, label: string): number => {
  const values = decodeDicomUInt16Values(requiredValue(elements, tag, label))
  if (values.length !== 1) throw invalidInput(`DICOM ${label} must contain one value`)
  const value = values[0]
  if (value === undefined) throw invalidInput(`DICOM ${label} is missing`)
  return value
}

const checkedProduct = (values: readonly number[], label: string): number => {
  let result = 1
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 1) throw invalidInput(`${label} must be positive`)
    result *= value
    if (!Number.isSafeInteger(result)) throw limitExceeded(`${label} exceeds safe integers`)
  }
  return result
}

const pixelEncoding = (transferSyntax: DicomTransferSyntax): DicomPixelEncoding => {
  if (transferSyntax.kind === 'rle-lossless') return 'rle'
  if (transferSyntax.kind === 'encapsulated-uncompressed-explicit-vr-little-endian') {
    return 'encapsulated-uncompressed'
  }
  if (transferSyntax.kind === 'jpeg-baseline-8bit') return 'jpeg-baseline'
  if (transferSyntax.kind === 'jpeg-lossless-sv1') return 'jpeg-lossless-sv1'
  if (transferSyntax.kind === 'jpeg2000-lossless') return 'jpeg2000-lossless'
  if (transferSyntax.kind === 'jpeg2000') return 'jpeg2000'
  return 'native'
}

export const describeDicomPixels = async (
  source: ImageSource,
  dataset: DicomDataset,
  pixelData: DicomPixelDataLocator | undefined,
  transferSyntax: DicomTransferSyntax,
  limits: Readonly<DicomLimits>,
  options: Readonly<AbortOptions> = {},
): Promise<DicomPixelDescription> => {
  if (pixelData === undefined) throw invalidInput('DICOM Pixel Data is missing')
  requireUniqueDicomElement(dataset.elements, dicomTag.pixelData, 'Pixel Data')
  const encoding = pixelEncoding(transferSyntax)
  if (encoding === 'native') {
    if (pixelData.encapsulated || pixelData.valueLength === undefined) {
      throw invalidInput('DICOM native transfer syntax cannot use encapsulated Pixel Data')
    }
  } else {
    if (!pixelData.encapsulated || pixelData.valueLength !== undefined) {
      throw invalidInput('DICOM encapsulated Pixel Data must have undefined length')
    }
    if (pixelData.vr !== undefined && pixelData.vr !== 'OB') {
      throw invalidInput('DICOM encapsulated Pixel Data must use VR OB')
    }
    if (pixelData.fragments === undefined) {
      throw invalidInput('DICOM encapsulated transfer syntax requires encapsulated Pixel Data')
    }
  }
  const samplesPerPixel = requiredUInt16(
    dataset.elements,
    dicomTag.samplesPerPixel,
    'Samples per Pixel',
  )
  if (samplesPerPixel !== 1) {
    throw unsupportedOperation(`DICOM Samples per Pixel ${samplesPerPixel} is unsupported`)
  }
  const photometric = decodeDicomText(
    requiredValue(
      dataset.elements,
      dicomTag.photometricInterpretation,
      'Photometric Interpretation',
    ),
  )
  if (photometric !== 'MONOCHROME1' && photometric !== 'MONOCHROME2') {
    throw unsupportedOperation(`DICOM Photometric Interpretation ${photometric} is unsupported`)
  }
  const rows = requiredUInt16(dataset.elements, dicomTag.rows, 'Rows')
  const columns = requiredUInt16(dataset.elements, dicomTag.columns, 'Columns')
  if (rows > limits.maxRows) {
    throw limitExceeded(`DICOM Rows ${rows} exceeds maxRows ${limits.maxRows}`)
  }
  if (columns > limits.maxColumns) {
    throw limitExceeded(`DICOM Columns ${columns} exceeds maxColumns ${limits.maxColumns}`)
  }
  const bitsAllocated = requiredUInt16(dataset.elements, dicomTag.bitsAllocated, 'Bits Allocated')
  if (bitsAllocated !== 8 && bitsAllocated !== 16) {
    throw unsupportedOperation(`DICOM Bits Allocated ${bitsAllocated} is unsupported`)
  }
  const bitsStored = requiredUInt16(dataset.elements, dicomTag.bitsStored, 'Bits Stored')
  if (bitsStored < 1 || bitsStored > bitsAllocated) {
    throw invalidInput(
      `DICOM Bits Stored ${bitsStored} is invalid for Bits Allocated ${bitsAllocated}`,
    )
  }
  const highBit = requiredUInt16(dataset.elements, dicomTag.highBit, 'High Bit')
  if (highBit !== bitsStored - 1) {
    throw unsupportedOperation(
      `DICOM High Bit ${highBit} is unsupported; High Bit must equal Bits Stored - 1`,
    )
  }
  const representationCode = requiredUInt16(
    dataset.elements,
    dicomTag.pixelRepresentation,
    'Pixel Representation',
  )
  if (representationCode !== 0 && representationCode !== 1) {
    throw invalidInput(`DICOM Pixel Representation ${representationCode} is invalid`)
  }
  if (encoding === 'jpeg-baseline') {
    if (bitsAllocated !== 8 || bitsStored !== 8) {
      throw unsupportedOperation('DICOM JPEG Baseline requires 8-bit stored samples')
    }
    if (representationCode !== 0) {
      throw unsupportedOperation('DICOM JPEG Baseline signed samples are unsupported')
    }
  }
  const frameBytesField = optionalValue(
    dataset.elements,
    dicomTag.numberOfFrames,
    'Number of Frames',
  )
  const numberOfFrames =
    frameBytesField === undefined
      ? 1
      : decodeDicomIntegerString(frameBytesField, 'Number of Frames')
  if (!Number.isSafeInteger(numberOfFrames) || numberOfFrames < 1) {
    throw invalidInput('DICOM Number of Frames is invalid')
  }
  if (numberOfFrames > limits.maxFrames) {
    throw limitExceeded(
      `DICOM Number of Frames ${numberOfFrames} exceeds maxFrames ${limits.maxFrames}`,
    )
  }
  const planar = optionalValue(
    dataset.elements,
    dicomTag.planarConfiguration,
    'Planar Configuration',
  )
  if (planar !== undefined) {
    throw unsupportedOperation(
      'DICOM Planar Configuration is unsupported for this grayscale subset',
    )
  }
  const signed = representationCode === 1
  const sampleType: RasterSampleType =
    bitsAllocated === 8 ? (signed ? 'int8' : 'uint8') : signed ? 'int16' : 'uint16'
  const bytesPerSample: 1 | 2 = bitsAllocated === 8 ? 1 : 2
  if (rasterSampleBytes(sampleType) !== bytesPerSample) {
    throw invalidInput('DICOM sample type does not match Bits Allocated')
  }
  const frameBytes = checkedProduct(
    [rows, columns, samplesPerPixel, bytesPerSample],
    'DICOM frame bytes',
  )
  const totalPixelBytes = checkedProduct([frameBytes, numberOfFrames], 'DICOM pixel bytes')
  if (totalPixelBytes > limits.maxDecodedFrameBytes * numberOfFrames) {
    throw limitExceeded('DICOM decoded frame limit exceeded')
  }
  if (frameBytes > limits.maxDecodedFrameBytes) {
    throw limitExceeded(
      `DICOM frame is ${frameBytes} bytes; maxDecodedFrameBytes is ${limits.maxDecodedFrameBytes}`,
    )
  }
  if (encoding === 'native') {
    const available = pixelData.valueLength
    if (available === undefined) throw invalidInput('DICOM native Pixel Data length is missing')
    if (available < totalPixelBytes) {
      throw invalidInput(
        `DICOM Pixel Data is ${available} bytes; ${totalPixelBytes} bytes are required`,
      )
    }
    if (available > totalPixelBytes) {
      if (!(available === totalPixelBytes + 1 && (totalPixelBytes & 1) === 1)) {
        throw invalidInput(
          `DICOM Pixel Data has ${available - totalPixelBytes} trailing bytes inside the native frame calculation`,
        )
      }
    }
    return Object.freeze({
      rows,
      columns,
      numberOfFrames,
      samplesPerPixel: 1 as const,
      photometricInterpretation: photometric,
      bitsAllocated,
      bitsStored,
      highBit,
      pixelRepresentation: signed ? ('signed' as const) : ('unsigned' as const),
      sampleType,
      bytesPerSample,
      frameBytes,
      totalPixelBytes,
      pixelDataOffset: pixelData.valueOffset,
      pixelDataLength: available,
      encoding,
    })
  }
  const encapsulatedFrames = await indexDicomEncapsulatedFrames(
    source,
    dataset,
    pixelData,
    numberOfFrames,
    limits,
    dicomEncapsulatedFragmentPolicy(encoding),
    options.signal,
  )
  return Object.freeze({
    rows,
    columns,
    numberOfFrames,
    samplesPerPixel: 1 as const,
    photometricInterpretation: photometric,
    bitsAllocated,
    bitsStored,
    highBit,
    pixelRepresentation: signed ? ('signed' as const) : ('unsigned' as const),
    sampleType,
    bytesPerSample,
    frameBytes,
    totalPixelBytes,
    pixelDataOffset: pixelData.valueOffset,
    pixelDataLength: 0,
    encoding,
    encapsulatedFrames,
  })
}
