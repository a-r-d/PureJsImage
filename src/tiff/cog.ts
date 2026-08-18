import { invalidInput, limitExceeded } from '../errors.ts'
import type { TiffDirectory, TiffDocument, TiffTagValue } from './types.ts'
import {
  tiffCompressionCapability,
  tiffCompressionName,
  type TiffCompressionTestStatus,
} from './compressions.ts'

export type CogInspectionSeverity = 'warning' | 'error'

export interface CogInspectionIssue {
  readonly code:
    | 'STRIPED_IMAGE'
    | 'MISSING_INTERNAL_OVERVIEWS'
    | 'MULTIPLE_TOP_LEVEL_IMAGES'
    | 'OVERVIEW_NOT_REDUCED'
    | 'IFD_AFTER_IMAGE_DATA'
    | 'MISSING_TILE_TABLE'
    | 'INVALID_TILE_TABLE'
    | 'NON_MONOTONIC_TILE_OFFSETS'
    | 'UNSUPPORTED_COMPRESSION'
  readonly severity: CogInspectionSeverity
  readonly message: string
  readonly directoryOffset?: number
}

export interface CogCompressionInspection {
  readonly id: number
  readonly name: string
  readonly status: TiffCompressionTestStatus | 'unknown'
}

export interface CogDirectoryInspection {
  readonly index: number
  readonly path: string
  readonly role: 'image' | 'overview'
  readonly offset: number
  readonly width: number
  readonly height: number
  readonly subIfdOffsets: readonly number[]
  readonly tiled: boolean
  readonly tileWidth?: number
  readonly tileHeight?: number
  readonly tileCount: number
  readonly firstTileOffset?: number
  readonly lastTileOffset?: number
  readonly compression: CogCompressionInspection
  readonly samplesPerPixel: number
  readonly bitsPerSample: readonly number[]
  readonly sampleFormats: readonly number[]
  readonly planar: boolean
}

export interface CogInspection {
  readonly container: 'TIFF' | 'BigTIFF'
  readonly byteOrder: 'little-endian' | 'big-endian'
  readonly topLevelDirectoryCount: number
  readonly directories: readonly CogDirectoryInspection[]
  readonly issues: readonly CogInspectionIssue[]
  readonly likelyCog: boolean
}

export interface CogInspectionOptions {
  /** Aggregate upper bound for tile offset and byte-count tag reads. Defaults to 8 MiB. */
  readonly maxTagBytes?: number
}

const safeTagNumbers = (value: TiffTagValue | undefined, label: string): readonly number[] => {
  if (value === undefined) return Object.freeze([])
  if (value.kind !== 'numbers' && value.kind !== 'bigints') {
    throw invalidInput(`COG ${label} must contain numeric values`)
  }
  const raw = value.values
  const numbers = raw.map((entry) => {
    const number = typeof entry === 'bigint' ? Number(entry) : entry
    if (!Number.isSafeInteger(number) || number < 0) {
      throw invalidInput(`COG ${label} contains an unsafe offset or length`)
    }
    return number
  })
  return Object.freeze(numbers)
}

const monotonic = (values: readonly number[]): boolean => {
  for (let index = 1; index < values.length; index += 1) {
    if ((values[index] ?? 0) < (values[index - 1] ?? 0)) return false
  }
  return true
}

const numberBounds = (
  values: readonly number[],
): Readonly<{ minimum: number; maximum: number }> | undefined => {
  const first = values[0]
  if (first === undefined) return undefined
  let minimum = first
  let maximum = first
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index]
    if (value === undefined) continue
    if (value < minimum) minimum = value
    if (value > maximum) maximum = value
  }
  return Object.freeze({ minimum, maximum })
}

interface DirectoryPath {
  readonly directory: TiffDirectory
  readonly path: string
  readonly role: 'image' | 'overview'
  readonly parent?: TiffDirectory
}

const directoryPaths = (document: TiffDocument): readonly DirectoryPath[] => {
  const paths: DirectoryPath[] = []
  const visit = (
    directory: TiffDirectory,
    path: string,
    role: 'image' | 'overview',
    parent?: TiffDirectory,
  ): void => {
    paths.push({ directory, path, role, ...(parent === undefined ? {} : { parent }) })
    for (let index = 0; index < directory.subIfds.length; index += 1) {
      const child = directory.subIfds[index]
      if (child !== undefined) visit(child, `${path}/subifd[${index}]`, 'overview', directory)
    }
  }
  for (let index = 0; index < document.topLevelDirectories.length; index += 1) {
    const directory = document.topLevelDirectories[index]
    if (directory !== undefined) visit(directory, `ifd[${index}]`, 'image')
  }
  return Object.freeze(paths)
}

export const inspectCog = async (
  document: TiffDocument,
  options: Readonly<CogInspectionOptions> = {},
): Promise<CogInspection> => {
  const maxTagBytes = options.maxTagBytes ?? 8_388_608
  if (!Number.isSafeInteger(maxTagBytes) || maxTagBytes < 1) {
    throw invalidInput('COG maxTagBytes must be a positive safe integer')
  }
  const paths = directoryPaths(document)
  const issues: CogInspectionIssue[] = []
  const directories: CogDirectoryInspection[] = []
  let tagBytes = 0
  let firstImageDataOffset = Number.POSITIVE_INFINITY

  if (document.topLevelDirectories.length > 1) {
    issues.push({
      code: 'MULTIPLE_TOP_LEVEL_IMAGES',
      severity: 'warning',
      message: 'COG interoperability is strongest with one top-level image and internal overviews.',
    })
  }

  for (const { directory, path, role, parent } of paths) {
    const offsetInfo = directory.getTagInfo?.(directory.tiled ? 324 : 273)
    const byteCountInfo = directory.getTagInfo?.(directory.tiled ? 325 : 279)
    tagBytes += (offsetInfo?.byteLength ?? 0) + (byteCountInfo?.byteLength ?? 0)
    if (tagBytes > maxTagBytes) {
      throw limitExceeded(`COG tile tables need ${tagBytes} bytes; maxTagBytes is ${maxTagBytes}`)
    }
    const offsets = safeTagNumbers(
      await directory.getTag(directory.tiled ? 324 : 273, { maxBytes: maxTagBytes }),
      'tile offset table',
    )
    const byteCounts = safeTagNumbers(
      await directory.getTag(directory.tiled ? 325 : 279, { maxBytes: maxTagBytes }),
      'tile byte-count table',
    )
    if (!directory.tiled) {
      issues.push({
        code: 'STRIPED_IMAGE',
        severity: 'error',
        message: `${path} uses strips; Cloud Optimized GeoTIFF imagery should be tiled.`,
        directoryOffset: directory.offset,
      })
    }
    if (offsets.length === 0 || byteCounts.length === 0) {
      issues.push({
        code: 'MISSING_TILE_TABLE',
        severity: 'error',
        message: `${path} has no readable ${directory.tiled ? 'tile' : 'strip'} table.`,
        directoryOffset: directory.offset,
      })
    } else if (offsets.length !== byteCounts.length) {
      issues.push({
        code: 'INVALID_TILE_TABLE',
        severity: 'error',
        message: `${path} has ${offsets.length} offsets but ${byteCounts.length} byte counts.`,
        directoryOffset: directory.offset,
      })
    }
    if (!monotonic(offsets)) {
      issues.push({
        code: 'NON_MONOTONIC_TILE_OFFSETS',
        severity: 'warning',
        message: `${path} tile offsets are not in ascending storage order.`,
        directoryOffset: directory.offset,
      })
    }
    const offsetBounds = numberBounds(offsets)
    const firstTileOffset = offsetBounds?.minimum
    const lastTileOffset = offsetBounds?.maximum
    if (firstTileOffset !== undefined)
      firstImageDataOffset = Math.min(firstImageDataOffset, firstTileOffset)
    if (
      parent !== undefined &&
      (directory.width >= parent.width || directory.height >= parent.height)
    ) {
      issues.push({
        code: 'OVERVIEW_NOT_REDUCED',
        severity: 'error',
        message: `${path} dimensions ${directory.width}x${directory.height} do not reduce ${parent.width}x${parent.height}.`,
        directoryOffset: directory.offset,
      })
    }
    const compression = tiffCompressionCapability(directory.compression)
    if (
      compression === undefined ||
      compression.status === 'recognized-but-unsupported' ||
      compression.status === 'not-implemented'
    ) {
      issues.push({
        code: 'UNSUPPORTED_COMPRESSION',
        severity: 'error',
        message: `${path} uses TIFF compression ${directory.compression} (${tiffCompressionName(directory.compression)}), which PureJsImage does not decode.`,
        directoryOffset: directory.offset,
      })
    }
    directories.push(
      Object.freeze({
        index: directory.index,
        path,
        role,
        offset: directory.offset,
        width: directory.width,
        height: directory.height,
        subIfdOffsets: Object.freeze(directory.subIfds.map(({ offset }) => offset)),
        tiled: directory.tiled,
        ...(directory.tileWidth === undefined ? {} : { tileWidth: directory.tileWidth }),
        ...(directory.tileHeight === undefined ? {} : { tileHeight: directory.tileHeight }),
        tileCount: offsets.length,
        ...(firstTileOffset === undefined ? {} : { firstTileOffset }),
        ...(lastTileOffset === undefined ? {} : { lastTileOffset }),
        compression: Object.freeze({
          id: directory.compression,
          name: tiffCompressionName(directory.compression),
          status: compression?.status ?? 'unknown',
        }),
        samplesPerPixel: directory.samplesPerPixel,
        bitsPerSample: Object.freeze([...directory.bitsPerSample]),
        sampleFormats: Object.freeze([...directory.sampleFormats]),
        planar: directory.planar,
      }),
    )
  }

  if (document.topLevelDirectories.every(({ subIfds }) => subIfds.length === 0)) {
    issues.push({
      code: 'MISSING_INTERNAL_OVERVIEWS',
      severity: 'warning',
      message: 'The TIFF has no internal SubIFD overviews.',
    })
  }
  if (Number.isFinite(firstImageDataOffset)) {
    for (const directory of directories) {
      if (directory.offset > firstImageDataOffset) {
        issues.push({
          code: 'IFD_AFTER_IMAGE_DATA',
          severity: 'warning',
          message: `${directory.path} is stored after the first image tile, increasing remote metadata reads.`,
          directoryOffset: directory.offset,
        })
      }
    }
  }

  return Object.freeze({
    container: document.bigTiff ? 'BigTIFF' : 'TIFF',
    byteOrder: document.littleEndian ? 'little-endian' : 'big-endian',
    topLevelDirectoryCount: document.topLevelDirectories.length,
    directories: Object.freeze(directories),
    issues: Object.freeze(issues),
    likelyCog: !issues.some(({ severity }) => severity === 'error'),
  })
}
