import { invalidInput } from '../errors.ts'
import type { TiffProfile, TiffProfileContext } from './profiles.ts'
import type { TiffDirectory, TiffDocument, TiffTagValue } from './types.ts'

const tagImageDescription = 270
const tagMake = 271
const tagModel = 272
const tagXResolution = 282
const tagYResolution = 283
const tagXPosition = 286
const tagYPosition = 287
const tagResolutionUnit = 296
const tagSoftware = 305
const tagDateTime = 306
const maximumDescriptionBytes = 64 * 1024
const maximumTextTagBytes = 4 * 1024

const digitalMicrographTags = Object.freeze({
  xUnit: 65_003,
  yUnit: 65_004,
  zUnit: 65_005,
  xOrigin: 65_006,
  yOrigin: 65_007,
  zOrigin: 65_008,
  xStep: 65_009,
  yStep: 65_010,
  zStep: 65_011,
  xUnitName: 65_012,
  yUnitName: 65_013,
  zUnitName: 65_014,
  intensityUnit: 65_022,
  intensityUnitName: 65_023,
  intensityOrigin: 65_024,
  intensityStep: 65_025,
})

export type TiffCalibratedAxisId = 'x' | 'y' | 'z'

export type TiffCalibrationMetadataValue =
  | null
  | boolean
  | number
  | string
  | readonly TiffCalibrationMetadataValue[]
  | TiffCalibrationMetadataObject

export interface TiffCalibrationMetadataObject {
  readonly [key: string]: TiffCalibrationMetadataValue
}

export interface TiffCalibrationEvidence {
  readonly locator: string
  readonly formula?: string
  readonly note?: string
}

export interface TiffAxisCalibration {
  readonly axisId: TiffCalibratedAxisId
  readonly origin: number
  readonly step: number
  readonly unit: string
  readonly evidence: TiffCalibrationEvidence
}

export interface TiffIntensityCalibration {
  readonly origin: number
  readonly step: number
  readonly unit?: string
  readonly evidence: TiffCalibrationEvidence
}

export interface TiffDirectoryCalibration {
  readonly directoryIndex: number
  readonly axes: readonly TiffAxisCalibration[]
  readonly intensity?: TiffIntensityCalibration
  readonly warnings: readonly string[]
}

export interface TiffPageAxisCalibration extends TiffAxisCalibration {
  readonly axisId: 'z'
  readonly length: number
}

export interface TiffAcquisitionMetadata {
  readonly manufacturer?: string
  readonly model?: string
  readonly software?: string
  readonly acquisitionDate?: string
}

export interface TiffCalibrationProfileValue {
  readonly profileId: string
  readonly directories: readonly TiffDirectoryCalibration[]
  readonly pageAxis?: TiffPageAxisCalibration
  readonly acquisition?: TiffAcquisitionMetadata
  readonly rawMetadata: {
    readonly namespace: string
    readonly value: TiffCalibrationMetadataObject
  }
  readonly warnings: readonly string[]
}

const firstDirectory = (document: TiffDocument): TiffDirectory => {
  const directory = document.topLevelDirectories[0]
  if (directory === undefined)
    throw invalidInput('TIFF calibration profile found no top-level image')
  return directory
}

const tagLocator = (directory: TiffDirectory, tags: readonly number[]): string =>
  `tiff:ifd:${directory.index}/tags:${tags.join(',')}`

const readTag = async (
  directory: TiffDirectory,
  tag: number,
  maximumBytes: number,
): Promise<TiffTagValue | undefined> => {
  const info = directory.getTagInfo?.(tag)
  if (info === undefined || info.byteLength > maximumBytes) return undefined
  try {
    return await directory.getTag(tag, { maxBytes: maximumBytes })
  } catch {
    return undefined
  }
}

const readAscii = async (
  directory: TiffDirectory,
  tag: number,
  maximumBytes = maximumTextTagBytes,
): Promise<string | undefined> => {
  const value = await readTag(directory, tag, maximumBytes)
  if (value?.kind !== 'ascii') return undefined
  const normalized = value.value.trim()
  return normalized.length === 0 ? undefined : normalized
}

const readNumber = async (directory: TiffDirectory, tag: number): Promise<number | undefined> => {
  const value = await readTag(directory, tag, 64)
  if (value?.kind !== 'numbers' || value.values.length !== 1) return undefined
  const number = value.values[0]
  return number !== undefined && Number.isFinite(number) ? number : undefined
}

const normalizedUnit = (value: string): string => {
  const normalized = value.trim()
  const lowercase = normalized.toLowerCase().replaceAll('μ', 'µ')
  if (
    lowercase === 'um' ||
    lowercase === 'µm' ||
    lowercase === 'micron' ||
    lowercase === 'microns' ||
    lowercase === 'micrometer' ||
    lowercase === 'micrometers'
  ) {
    return 'µm'
  }
  if (lowercase === 'nanometer' || lowercase === 'nanometers') return 'nm'
  if (lowercase === 'millimeter' || lowercase === 'millimeters') return 'mm'
  if (lowercase === 'centimeter' || lowercase === 'centimeters') return 'cm'
  if (lowercase === 'meter' || lowercase === 'meters') return 'm'
  if (lowercase === 'pixel' || lowercase === 'pixels' || lowercase === 'px') return 'px'
  return normalized
}

const acquisitionMetadata = async (
  directory: TiffDirectory,
): Promise<TiffAcquisitionMetadata | undefined> => {
  const [manufacturer, model, software, acquisitionDate] = await Promise.all([
    readAscii(directory, tagMake),
    readAscii(directory, tagModel),
    readAscii(directory, tagSoftware),
    readAscii(directory, tagDateTime),
  ])
  if (
    manufacturer === undefined &&
    model === undefined &&
    software === undefined &&
    acquisitionDate === undefined
  ) {
    return undefined
  }
  return Object.freeze({
    ...(manufacturer === undefined ? {} : { manufacturer }),
    ...(model === undefined ? {} : { model }),
    ...(software === undefined ? {} : { software }),
    ...(acquisitionDate === undefined ? {} : { acquisitionDate }),
  })
}

const standardResolutionUnit = async (
  directory: TiffDirectory,
): Promise<{ readonly micrometers: number; readonly defaulted: boolean } | undefined> => {
  const info = directory.getTagInfo?.(tagResolutionUnit)
  if (info === undefined) {
    return Object.freeze({ micrometers: 25_400, defaulted: true })
  }
  const value = await readNumber(directory, tagResolutionUnit)
  if (value === 1) return undefined
  if (value === 3) return Object.freeze({ micrometers: 10_000, defaulted: false })
  if (value === 2) return Object.freeze({ micrometers: 25_400, defaulted: false })
  return undefined
}

const standardDirectoryCalibration = async (
  directory: TiffDirectory,
): Promise<TiffDirectoryCalibration> => {
  const warnings: string[] = []
  const [xResolution, yResolution, xPosition, yPosition, resolutionUnit] = await Promise.all([
    readNumber(directory, tagXResolution),
    readNumber(directory, tagYResolution),
    readNumber(directory, tagXPosition),
    readNumber(directory, tagYPosition),
    standardResolutionUnit(directory),
  ])
  const axes: TiffAxisCalibration[] = []
  if (resolutionUnit === undefined) {
    warnings.push('TIFF ResolutionUnit does not declare an absolute physical unit')
  } else {
    if (resolutionUnit.defaulted) {
      warnings.push('TIFF ResolutionUnit is absent; TIFF 6.0 default inch policy was applied')
    }
    if (xResolution !== undefined && xResolution > 0) {
      axes.push(
        Object.freeze({
          axisId: 'x',
          origin: (xPosition ?? 0) * resolutionUnit.micrometers,
          step: resolutionUnit.micrometers / xResolution,
          unit: 'µm',
          evidence: Object.freeze({
            locator: tagLocator(directory, [
              tagXResolution,
              ...(resolutionUnit.defaulted ? [] : [tagResolutionUnit]),
              ...(xPosition === undefined ? [] : [tagXPosition]),
            ]),
            formula: `step_um=${resolutionUnit.micrometers}/XResolution; origin_um=XPosition*${resolutionUnit.micrometers}`,
            ...(resolutionUnit.defaulted
              ? { note: 'ResolutionUnit omitted; TIFF 6.0 default is inch' }
              : {}),
          }),
        }),
      )
    } else if (directory.getTagInfo?.(tagXResolution) !== undefined) {
      warnings.push('TIFF XResolution is not a positive finite value')
    }
    if (yResolution !== undefined && yResolution > 0) {
      axes.push(
        Object.freeze({
          axisId: 'y',
          origin: (yPosition ?? 0) * resolutionUnit.micrometers,
          step: resolutionUnit.micrometers / yResolution,
          unit: 'µm',
          evidence: Object.freeze({
            locator: tagLocator(directory, [
              tagYResolution,
              ...(resolutionUnit.defaulted ? [] : [tagResolutionUnit]),
              ...(yPosition === undefined ? [] : [tagYPosition]),
            ]),
            formula: `step_um=${resolutionUnit.micrometers}/YResolution; origin_um=YPosition*${resolutionUnit.micrometers}`,
            ...(resolutionUnit.defaulted
              ? { note: 'ResolutionUnit omitted; TIFF 6.0 default is inch' }
              : {}),
          }),
        }),
      )
    } else if (directory.getTagInfo?.(tagYResolution) !== undefined) {
      warnings.push('TIFF YResolution is not a positive finite value')
    }
  }
  return Object.freeze({
    directoryIndex: directory.index,
    axes: Object.freeze(axes),
    warnings: Object.freeze(warnings),
  })
}

const micrometersPerUnit = (unit: string): number | undefined => {
  if (unit === 'nm') return 0.001
  if (unit === 'µm') return 1
  if (unit === 'mm') return 1_000
  if (unit === 'cm') return 10_000
  if (unit === 'm') return 1_000_000
  if (unit.toLowerCase() === 'inch' || unit.toLowerCase() === 'in') return 25_400
  return undefined
}

const approximatelyEqual = (left: number, right: number): boolean =>
  Math.abs(left - right) <= Math.max(1e-12, Math.abs(left), Math.abs(right)) * 1e-9

const appendStandardContradictions = async (
  directory: TiffDirectory,
  profileName: string,
  axes: readonly TiffAxisCalibration[],
  warnings: string[],
): Promise<void> => {
  if (
    directory.getTagInfo?.(tagXResolution) === undefined &&
    directory.getTagInfo?.(tagYResolution) === undefined
  ) {
    return
  }
  const standard = await standardDirectoryCalibration(directory)
  for (const axis of axes) {
    if (axis.axisId === 'z') continue
    const standardAxis = standard.axes.find(({ axisId }) => axisId === axis.axisId)
    const factor = micrometersPerUnit(axis.unit)
    if (standardAxis === undefined || factor === undefined) continue
    if (
      !approximatelyEqual(axis.step * factor, standardAxis.step) ||
      !approximatelyEqual(axis.origin * factor, standardAxis.origin)
    ) {
      warnings.push(
        `${profileName} ${axis.axisId.toUpperCase()} calibration contradicts standard TIFF resolution tags`,
      )
    }
  }
}

const openStandardTiffCalibration = async (
  document: TiffDocument,
): Promise<TiffCalibrationProfileValue> => {
  const directory = firstDirectory(document)
  const directories = await Promise.all(
    document.topLevelDirectories.map(standardDirectoryCalibration),
  )
  const warnings = directories.flatMap(({ warnings: directoryWarnings }) => directoryWarnings)
  const [xResolution, yResolution, resolutionUnit, xPosition, yPosition] = await Promise.all([
    readNumber(directory, tagXResolution),
    readNumber(directory, tagYResolution),
    readNumber(directory, tagResolutionUnit),
    readNumber(directory, tagXPosition),
    readNumber(directory, tagYPosition),
  ])
  return Object.freeze({
    profileId: 'standard-tiff-calibration',
    directories: Object.freeze(directories),
    ...(await acquisitionMetadata(directory).then((value) =>
      value === undefined ? {} : { acquisition: value },
    )),
    rawMetadata: Object.freeze({
      namespace: 'purejsimage:tiff-standard',
      value: Object.freeze({
        ...(xResolution === undefined ? {} : { xResolution }),
        ...(yResolution === undefined ? {} : { yResolution }),
        ...(resolutionUnit === undefined ? {} : { resolutionUnit }),
        ...(xPosition === undefined ? {} : { xPosition }),
        ...(yPosition === undefined ? {} : { yPosition }),
      }),
    }),
    warnings: Object.freeze(warnings),
  })
}

const parseImageJDescription = (description: string): ReadonlyMap<string, string> => {
  const entries = new Map<string, string>()
  for (const line of description.split(/\r?\n/u)) {
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim().toLowerCase()
    const value = line.slice(separator + 1).trim()
    if (key.length !== 0 && value.length !== 0 && !entries.has(key)) entries.set(key, value)
  }
  return entries
}

const parsedFinite = (values: ReadonlyMap<string, string>, key: string): number | undefined => {
  const raw = values.get(key)
  if (raw === undefined || raw.length > 128) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

const parsedPositiveInteger = (
  values: ReadonlyMap<string, string>,
  key: string,
  fallback: number,
): number => {
  const value = parsedFinite(values, key)
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback
}

const invalidFiniteEntry = (values: ReadonlyMap<string, string>, key: string): boolean =>
  values.has(key) && parsedFinite(values, key) === undefined

const invalidPositiveIntegerEntry = (values: ReadonlyMap<string, string>, key: string): boolean => {
  if (!values.has(key)) return false
  const value = parsedFinite(values, key)
  return value === undefined || !Number.isSafeInteger(value) || value < 1
}

const imageJDirectoryCalibration = async (
  directory: TiffDirectory,
  descriptionDirectory: TiffDirectory,
  values: ReadonlyMap<string, string>,
  unit: string,
): Promise<TiffDirectoryCalibration> => {
  const warnings: string[] = []
  const [xResolution, yResolution] = await Promise.all([
    readNumber(directory, tagXResolution),
    readNumber(directory, tagYResolution),
  ])
  const axes: TiffAxisCalibration[] = []
  if (unit === 'px') {
    warnings.push('ImageJ unit is pixel; physical X/Y calibration was not asserted')
  } else {
    const xOriginPixels = parsedFinite(values, 'xorigin') ?? 0
    const yOriginPixels = parsedFinite(values, 'yorigin') ?? 0
    if (xResolution !== undefined && xResolution > 0) {
      const step = 1 / xResolution
      axes.push(
        Object.freeze({
          axisId: 'x',
          origin: -xOriginPixels * step,
          step,
          unit,
          evidence: Object.freeze({
            locator: `tiff:ifd:${descriptionDirectory.index}/tag:${tagImageDescription};tiff:ifd:${directory.index}/tag:${tagXResolution}`,
            formula: 'step=1/XResolution; origin=-ImageJ.xorigin*step',
          }),
        }),
      )
    } else {
      warnings.push('ImageJ XResolution is absent or invalid')
    }
    if (yResolution !== undefined && yResolution > 0) {
      const step = 1 / yResolution
      axes.push(
        Object.freeze({
          axisId: 'y',
          origin: -yOriginPixels * step,
          step,
          unit,
          evidence: Object.freeze({
            locator: `tiff:ifd:${descriptionDirectory.index}/tag:${tagImageDescription};tiff:ifd:${directory.index}/tag:${tagYResolution}`,
            formula: 'step=1/YResolution; origin=-ImageJ.yorigin*step',
          }),
        }),
      )
    } else {
      warnings.push('ImageJ YResolution is absent or invalid')
    }
  }
  await appendStandardContradictions(directory, 'ImageJ', axes, warnings)
  return Object.freeze({
    directoryIndex: directory.index,
    axes: Object.freeze(axes),
    warnings: Object.freeze(warnings),
  })
}

const openImageJTiffCalibration = async (
  document: TiffDocument,
): Promise<TiffCalibrationProfileValue> => {
  const directory = firstDirectory(document)
  const description = await readAscii(directory, tagImageDescription, maximumDescriptionBytes)
  if (
    description === undefined ||
    (!description.startsWith('ImageJ=') && !description.startsWith('SCIFIO='))
  ) {
    throw invalidInput('TIFF ImageDescription does not contain ImageJ metadata')
  }
  const values = parseImageJDescription(description)
  const rawUnit = values.get('unit') ?? 'pixel'
  const unit = normalizedUnit(rawUnit)
  const directories = await Promise.all(
    document.topLevelDirectories.map((entry) =>
      imageJDirectoryCalibration(entry, directory, values, unit),
    ),
  )
  const warnings = directories.flatMap(({ warnings: directoryWarnings }) => directoryWarnings)
  for (const key of ['xorigin', 'yorigin', 'zorigin', 'spacing'] as const) {
    if (invalidFiniteEntry(values, key)) warnings.push(`ImageJ ${key} is not a finite number`)
  }
  for (const key of ['images', 'channels', 'slices', 'frames'] as const) {
    if (invalidPositiveIntegerEntry(values, key)) {
      warnings.push(`ImageJ ${key} is not a positive integer`)
    }
  }
  const images = parsedPositiveInteger(values, 'images', document.topLevelDirectories.length)
  const channels = parsedPositiveInteger(values, 'channels', 1)
  const slices = parsedPositiveInteger(values, 'slices', 1)
  const frames = parsedPositiveInteger(values, 'frames', 1)
  const spacing = parsedFinite(values, 'spacing')
  const zOriginPixels = parsedFinite(values, 'zorigin') ?? 0
  let pageAxis: TiffPageAxisCalibration | undefined
  if (images !== channels * slices * frames) {
    warnings.push('ImageJ images does not equal channels*slices*frames')
  }
  if (
    unit !== 'px' &&
    spacing !== undefined &&
    spacing > 0 &&
    slices === document.topLevelDirectories.length &&
    images === slices &&
    channels === 1 &&
    frames === 1
  ) {
    pageAxis = Object.freeze({
      axisId: 'z',
      length: slices,
      origin: -zOriginPixels * spacing,
      step: spacing,
      unit,
      evidence: Object.freeze({
        locator: tagLocator(directory, [tagImageDescription]),
        formula: 'step=ImageJ.spacing; origin=-ImageJ.zorigin*step',
      }),
    })
  } else if (spacing !== undefined || slices > 1) {
    warnings.push(
      'ImageJ Z calibration was not applied because the page count is not a simple single-channel Z stack',
    )
  }
  const raw: Record<string, TiffCalibrationMetadataValue> = {}
  for (const [key, value] of values) raw[key] = value
  return Object.freeze({
    profileId: 'imagej-tiff-calibration',
    directories: Object.freeze(directories),
    ...(pageAxis === undefined ? {} : { pageAxis }),
    ...(await acquisitionMetadata(directory).then((value) =>
      value === undefined ? {} : { acquisition: value },
    )),
    rawMetadata: Object.freeze({
      namespace: 'purejsimage:imagej',
      value: Object.freeze(raw),
    }),
    warnings: Object.freeze(warnings),
  })
}

const numericField = (directory: TiffDirectory, tag: number): boolean => {
  const fieldType = directory.getTagInfo?.(tag)?.fieldType
  return (
    fieldType === 1 ||
    fieldType === 3 ||
    fieldType === 4 ||
    fieldType === 6 ||
    fieldType === 8 ||
    fieldType === 9 ||
    fieldType === 11 ||
    fieldType === 12
  )
}

const coherentDigitalMicrographAxis = (
  directory: TiffDirectory,
  unitTag: number,
  originTag: number,
  stepTag: number,
): boolean =>
  directory.getTagInfo?.(unitTag)?.fieldType === 2 &&
  numericField(directory, originTag) &&
  numericField(directory, stepTag)

const digitalMicrographDetected = (document: TiffDocument): boolean => {
  const directory = document.topLevelDirectories[0]
  if (directory === undefined) return false
  return (
    coherentDigitalMicrographAxis(
      directory,
      digitalMicrographTags.xUnit,
      digitalMicrographTags.xOrigin,
      digitalMicrographTags.xStep,
    ) ||
    coherentDigitalMicrographAxis(
      directory,
      digitalMicrographTags.yUnit,
      digitalMicrographTags.yOrigin,
      digitalMicrographTags.yStep,
    ) ||
    coherentDigitalMicrographAxis(
      directory,
      digitalMicrographTags.zUnit,
      digitalMicrographTags.zOrigin,
      digitalMicrographTags.zStep,
    ) ||
    coherentDigitalMicrographAxis(
      directory,
      digitalMicrographTags.intensityUnit,
      digitalMicrographTags.intensityOrigin,
      digitalMicrographTags.intensityStep,
    )
  )
}

const readDigitalMicrographAxis = async (
  directory: TiffDirectory,
  axisId: TiffCalibratedAxisId,
  unitTag: number,
  originTag: number,
  stepTag: number,
  warnings: string[],
): Promise<TiffAxisCalibration | undefined> => {
  const [rawUnit, origin, step] = await Promise.all([
    readAscii(directory, unitTag),
    readNumber(directory, originTag),
    readNumber(directory, stepTag),
  ])
  if (rawUnit === undefined && origin === undefined && step === undefined) return undefined
  if (rawUnit === undefined || origin === undefined || step === undefined || step <= 0) {
    warnings.push(
      `DigitalMicrograph ${axisId.toUpperCase()} calibration tuple is incomplete or invalid`,
    )
    return undefined
  }
  const unit = normalizedUnit(rawUnit)
  if (unit === 'px') {
    warnings.push(
      `DigitalMicrograph ${axisId.toUpperCase()} unit is pixel; physical calibration was not asserted`,
    )
    return undefined
  }
  return Object.freeze({
    axisId,
    origin,
    step,
    unit,
    evidence: Object.freeze({
      locator: tagLocator(directory, [unitTag, originTag, stepTag]),
      formula: `origin=tag:${originTag}; step=tag:${stepTag}; unit=tag:${unitTag}`,
    }),
  })
}

const readDigitalMicrographIntensity = async (
  directory: TiffDirectory,
  warnings: string[],
): Promise<TiffIntensityCalibration | undefined> => {
  const [rawUnit, origin, step] = await Promise.all([
    readAscii(directory, digitalMicrographTags.intensityUnit),
    readNumber(directory, digitalMicrographTags.intensityOrigin),
    readNumber(directory, digitalMicrographTags.intensityStep),
  ])
  if (rawUnit === undefined && origin === undefined && step === undefined) return undefined
  if (origin === undefined || step === undefined || step === 0) {
    warnings.push('DigitalMicrograph intensity calibration tuple is incomplete or invalid')
    return undefined
  }
  return Object.freeze({
    origin,
    step,
    ...(rawUnit === undefined ? {} : { unit: normalizedUnit(rawUnit) }),
    evidence: Object.freeze({
      locator: tagLocator(directory, [
        digitalMicrographTags.intensityUnit,
        digitalMicrographTags.intensityOrigin,
        digitalMicrographTags.intensityStep,
      ]),
      formula: 'value=sample*tag:65025+tag:65024; unit=tag:65022',
    }),
  })
}

const digitalMicrographDirectoryCalibration = async (
  directory: TiffDirectory,
): Promise<TiffDirectoryCalibration> => {
  const warnings: string[] = []
  const axes = (
    await Promise.all([
      readDigitalMicrographAxis(
        directory,
        'x',
        digitalMicrographTags.xUnit,
        digitalMicrographTags.xOrigin,
        digitalMicrographTags.xStep,
        warnings,
      ),
      readDigitalMicrographAxis(
        directory,
        'y',
        digitalMicrographTags.yUnit,
        digitalMicrographTags.yOrigin,
        digitalMicrographTags.yStep,
        warnings,
      ),
      readDigitalMicrographAxis(
        directory,
        'z',
        digitalMicrographTags.zUnit,
        digitalMicrographTags.zOrigin,
        digitalMicrographTags.zStep,
        warnings,
      ),
    ])
  ).filter((value): value is TiffAxisCalibration => value !== undefined)
  const intensity = await readDigitalMicrographIntensity(directory, warnings)
  await appendStandardContradictions(directory, 'DigitalMicrograph', axes, warnings)
  return Object.freeze({
    directoryIndex: directory.index,
    axes: Object.freeze(axes),
    ...(intensity === undefined ? {} : { intensity }),
    warnings: Object.freeze(warnings),
  })
}

const digitalMicrographRawMetadata = async (
  directory: TiffDirectory,
): Promise<TiffCalibrationMetadataObject> => {
  const output: Record<string, TiffCalibrationMetadataValue> = {}
  for (let tag = 65_003; tag <= 65_025; tag += 1) {
    const value = await readTag(directory, tag, maximumTextTagBytes)
    if (value?.kind === 'ascii') output[String(tag)] = value.value
    else if (value?.kind === 'numbers') {
      output[String(tag)] = value.values.map((entry) =>
        Number.isFinite(entry)
          ? entry
          : Number.isNaN(entry)
            ? 'NaN'
            : entry > 0
              ? 'Infinity'
              : '-Infinity',
      )
    } else if (value?.kind === 'bigints') {
      output[String(tag)] = value.values.map((entry) => entry.toString(10))
    }
  }
  return Object.freeze(output)
}

const openDigitalMicrographTiffCalibration = async (
  document: TiffDocument,
): Promise<TiffCalibrationProfileValue> => {
  const directory = firstDirectory(document)
  const directories = await Promise.all(
    document.topLevelDirectories.map(digitalMicrographDirectoryCalibration),
  )
  const first = directories[0]
  const zAxis = first?.axes.find(({ axisId }) => axisId === 'z')
  const warnings = directories.flatMap(({ warnings: directoryWarnings }) => directoryWarnings)
  let pageAxis: TiffPageAxisCalibration | undefined
  const consistentZ =
    zAxis !== undefined &&
    directories.every(({ axes }) => {
      const candidate = axes.find(({ axisId }) => axisId === 'z')
      return (
        candidate !== undefined &&
        candidate.unit === zAxis.unit &&
        approximatelyEqual(candidate.origin, zAxis.origin) &&
        approximatelyEqual(candidate.step, zAxis.step)
      )
    })
  if (zAxis !== undefined && consistentZ) {
    pageAxis = Object.freeze({ ...zAxis, axisId: 'z', length: document.topLevelDirectories.length })
  } else if (zAxis !== undefined) {
    warnings.push('DigitalMicrograph Z calibration differs between TIFF directories')
  }
  return Object.freeze({
    profileId: 'digital-micrograph-tiff-calibration',
    directories: Object.freeze(directories),
    ...(pageAxis === undefined ? {} : { pageAxis }),
    ...(await acquisitionMetadata(directory).then((value) =>
      value === undefined ? {} : { acquisition: value },
    )),
    rawMetadata: Object.freeze({
      namespace: 'purejsimage:digital-micrograph',
      value: await digitalMicrographRawMetadata(directory),
    }),
    warnings: Object.freeze(warnings),
  })
}

export const standardTiffCalibrationProfile: TiffProfile<TiffCalibrationProfileValue> =
  Object.freeze({
    id: 'standard-tiff-calibration',
    priority: 10,
    detect: ({ document }: Readonly<TiffProfileContext>) =>
      document.topLevelDirectories.some(
        (directory) =>
          directory.getTagInfo?.(tagXResolution) !== undefined ||
          directory.getTagInfo?.(tagYResolution) !== undefined,
      ),
    open: ({ document }: Readonly<TiffProfileContext>) => openStandardTiffCalibration(document),
  })

export const imageJTiffCalibrationProfile: TiffProfile<TiffCalibrationProfileValue> = Object.freeze(
  {
    id: 'imagej-tiff-calibration',
    priority: 20,
    detect: async ({ document }: Readonly<TiffProfileContext>) => {
      const directory = document.topLevelDirectories[0]
      if (directory === undefined) return false
      const info = directory.getTagInfo?.(tagImageDescription)
      if (info === undefined || info.byteLength > maximumDescriptionBytes) return false
      const description = await directory.getTag(tagImageDescription, {
        maxBytes: maximumDescriptionBytes,
      })
      return (
        description?.kind === 'ascii' &&
        (description.value.startsWith('ImageJ=') || description.value.startsWith('SCIFIO='))
      )
    },
    open: ({ document }: Readonly<TiffProfileContext>) => openImageJTiffCalibration(document),
  },
)

export const digitalMicrographTiffCalibrationProfile: TiffProfile<TiffCalibrationProfileValue> =
  Object.freeze({
    id: 'digital-micrograph-tiff-calibration',
    priority: 30,
    detect: ({ document }: Readonly<TiffProfileContext>) => digitalMicrographDetected(document),
    open: ({ document }: Readonly<TiffProfileContext>) =>
      openDigitalMicrographTiffCalibration(document),
  })

export const defaultTiffCalibrationProfiles: readonly TiffProfile<TiffCalibrationProfileValue>[] =
  Object.freeze([
    standardTiffCalibrationProfile,
    imageJTiffCalibrationProfile,
    digitalMicrographTiffCalibrationProfile,
  ])
