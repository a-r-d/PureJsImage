import { invalidInput } from '../errors.ts'

export interface JpegXlLimits {
  readonly maxBoxes: number
  readonly maxCodestreamBytes: number
  readonly maxHeaderBytes: number
  readonly maxMetadataBytes: number
  readonly maxSegments: number
}

export type JpegXlLimitOptions = Partial<JpegXlLimits>

export const defaultJpegXlLimits: Readonly<JpegXlLimits> = Object.freeze({
  maxBoxes: 4_096,
  maxCodestreamBytes: 134_217_728,
  maxHeaderBytes: 4_194_304,
  maxMetadataBytes: 16_777_216,
  maxSegments: 65_536,
})

const positiveSafeInteger = (name: keyof JpegXlLimits, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
  return value
}

export const resolveJpegXlLimits = (
  options: Readonly<JpegXlLimitOptions> = {},
): Readonly<JpegXlLimits> =>
  Object.freeze({
    maxBoxes: positiveSafeInteger('maxBoxes', options.maxBoxes ?? defaultJpegXlLimits.maxBoxes),
    maxCodestreamBytes: positiveSafeInteger(
      'maxCodestreamBytes',
      options.maxCodestreamBytes ?? defaultJpegXlLimits.maxCodestreamBytes,
    ),
    maxHeaderBytes: positiveSafeInteger(
      'maxHeaderBytes',
      options.maxHeaderBytes ?? defaultJpegXlLimits.maxHeaderBytes,
    ),
    maxMetadataBytes: positiveSafeInteger(
      'maxMetadataBytes',
      options.maxMetadataBytes ?? defaultJpegXlLimits.maxMetadataBytes,
    ),
    maxSegments: positiveSafeInteger(
      'maxSegments',
      options.maxSegments ?? defaultJpegXlLimits.maxSegments,
    ),
  })
