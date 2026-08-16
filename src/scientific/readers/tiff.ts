import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { openTiffDocument, TiffEncodedCacheSource } from '../../codecs/tiff.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import {
  type RasterBlock,
  type RasterDecoder,
  type RasterFormat,
  rasterSampleBytes,
} from '../../raster.ts'
import {
  bindImageSourceSignal,
  type ImageSource,
  sourceSessionEnd,
  sourceSessionStart,
} from '../../source.ts'
import {
  defaultTiffCalibrationProfiles,
  type TiffAxisCalibration,
  type TiffCalibrationProfileValue,
  type TiffDirectoryCalibration,
  type TiffPageAxisCalibration,
} from '../../tiff/calibration-profiles.ts'
import { createTiffProfileRegistry, type TiffProfile } from '../../tiff/profiles.ts'
import type {
  TiffDirectory,
  TiffDocument,
  TiffDocumentOptions,
  TiffTagInfo,
  TiffTagValue,
} from '../../tiff/types.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificAxisDescriptor,
  ScientificComponentDescriptor,
  ScientificDataset,
  ScientificMetadataObject,
  ScientificPlaneReadRequest,
  ScientificResolutionLevel,
} from '../dataset.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificMetadataObject,
  normalizeScientificPlaneReadRequest,
} from '../dataset.ts'
import type {
  ScientificDocument,
  ScientificOpenContext,
  ScientificReader,
  ScientificReaderDescriptor,
} from '../reader.ts'
import { createScientificDatasetIdentity, identifyScientificDataset } from '../reader.ts'
import { resourceHasHint } from './shared.ts'

const defaultMaximumMetadataBytes = 64 * 1024
const defaultMaximumMetadataTagBytes = 16 * 1024

interface SessionManagedSource extends ImageSource {
  [sourceSessionStart](): void
  [sourceSessionEnd](): Promise<void>
}

interface TiffLevelDescription {
  readonly level: number
  readonly directory: TiffDirectory
  readonly width: number
  readonly height: number
  readonly format: RasterFormat
}

interface TiffPageDescription {
  readonly page: number
  readonly directory: TiffDirectory
  readonly levels: readonly TiffLevelDescription[]
  readonly components: readonly ScientificComponentDescriptor[]
  readonly compatibilityKey: string
  readonly metadata: ScientificMetadataObject
  readonly calibration?: TiffDirectoryCalibration
}

interface TiffSeriesDescription {
  readonly id: string
  readonly pages: readonly TiffPageDescription[]
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly metadata: ScientificMetadataObject
  readonly pageAxisId?: string
}

interface ResolvedTiffCalibration {
  readonly value?: TiffCalibrationProfileValue
  readonly detectionFailures: readonly ScientificMetadataObject[]
  readonly warning?: string
}

interface SelectedTag {
  readonly tag: number
  readonly name: string
  readonly private: boolean
  readonly payload: 'bounded' | 'info-only'
}

const selectedStandardTags: readonly SelectedTag[] = Object.freeze([
  { tag: 254, name: 'NewSubfileType', private: false, payload: 'bounded' },
  { tag: 269, name: 'DocumentName', private: false, payload: 'bounded' },
  { tag: 270, name: 'ImageDescription', private: false, payload: 'bounded' },
  { tag: 271, name: 'Make', private: false, payload: 'bounded' },
  { tag: 272, name: 'Model', private: false, payload: 'bounded' },
  { tag: 274, name: 'Orientation', private: false, payload: 'bounded' },
  { tag: 282, name: 'XResolution', private: false, payload: 'bounded' },
  { tag: 283, name: 'YResolution', private: false, payload: 'bounded' },
  { tag: 285, name: 'PageName', private: false, payload: 'bounded' },
  { tag: 286, name: 'XPosition', private: false, payload: 'bounded' },
  { tag: 287, name: 'YPosition', private: false, payload: 'bounded' },
  { tag: 296, name: 'ResolutionUnit', private: false, payload: 'bounded' },
  { tag: 305, name: 'Software', private: false, payload: 'bounded' },
  { tag: 306, name: 'DateTime', private: false, payload: 'bounded' },
  { tag: 315, name: 'Artist', private: false, payload: 'bounded' },
  { tag: 316, name: 'HostComputer', private: false, payload: 'bounded' },
  { tag: 338, name: 'ExtraSamples', private: false, payload: 'bounded' },
  { tag: 339, name: 'SampleFormat', private: false, payload: 'bounded' },
  { tag: 33_432, name: 'Copyright', private: false, payload: 'bounded' },
  { tag: 34_675, name: 'ICCProfile', private: false, payload: 'info-only' },
])

const selectedPrivateTags: readonly SelectedTag[] = Object.freeze([
  { tag: 34_118, name: 'CZ_SEM', private: true, payload: 'bounded' },
  { tag: 34_680, name: 'FEI_SFEG', private: true, payload: 'bounded' },
  { tag: 34_682, name: 'FEI_HELIOS', private: true, payload: 'bounded' },
  ...Array.from({ length: 23 }, (_, index) => ({
    tag: 65_003 + index,
    name: `DigitalMicrograph_${65_003 + index}`,
    private: true,
    payload: 'bounded' as const,
  })),
])

const selectedTags = Object.freeze([...selectedStandardTags, ...selectedPrivateTags])

export interface TiffReaderOptions {
  /** Ordinary TIFF document limits. Reader cancellation always comes from the open request. */
  readonly limits?: Omit<TiffDocumentOptions, 'signal'>
  /** Aggregate admitted payload size for normalized optional tags. Defaults to 64 KiB. */
  readonly maxMetadataBytes?: number
  /** Largest admitted optional tag payload. Defaults to 16 KiB. */
  readonly maxMetadataTagBytes?: number
  /** Calibration profiles selected through the deterministic TIFF profile registry. */
  readonly calibrationProfiles?: readonly TiffProfile<TiffCalibrationProfileValue>[]
}

export const tiffReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/tiff',
  version: '1.0.0',
  format: 'TIFF',
  extensions: Object.freeze(['tif', 'tiff']),
  mediaTypes: Object.freeze(['image/tiff', 'image/x-tiff']),
  capabilities: Object.freeze({
    resources: 'single',
    datasets: 'image-series',
    axes: 'xy-page',
    nativePrecision: true,
    rangeReads: true,
  }),
})

const isTiffHeader = (bytes: Uint8Array): boolean =>
  bytes.byteLength === 4 &&
  ((bytes[0] === 0x49 &&
    bytes[1] === 0x49 &&
    ((bytes[2] === 0x2a && bytes[3] === 0) || (bytes[2] === 0x2b && bytes[3] === 0))) ||
    (bytes[0] === 0x4d &&
      bytes[1] === 0x4d &&
      ((bytes[2] === 0 && bytes[3] === 0x2a) || (bytes[2] === 0 && bytes[3] === 0x2b))))

const positiveInteger = (value: number | undefined, fallback: number, label: string): number => {
  const normalized = value ?? fallback
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return normalized
}

const isSessionManagedSource = (source: ImageSource): source is SessionManagedSource =>
  sourceSessionStart in source &&
  typeof source[sourceSessionStart] === 'function' &&
  sourceSessionEnd in source &&
  typeof source[sourceSessionEnd] === 'function'

const sameRasterFormat = (left: RasterFormat, right: RasterFormat): boolean =>
  left.sampleType === right.sampleType &&
  left.channels === right.channels &&
  left.planar === right.planar

const errorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : 'Unknown profile error'

const resolveTiffCalibration = async (
  document: TiffDocument,
  profiles: readonly TiffProfile<TiffCalibrationProfileValue>[],
): Promise<ResolvedTiffCalibration> => {
  const registry = createTiffProfileRegistry(profiles)
  const detection = await registry.detect(document)
  const failures = Object.freeze(
    detection.failures.map(({ id, error }) =>
      normalizeScientificMetadataObject({ profileId: id, error: errorMessage(error) }),
    ),
  )
  const selected = detection.matches[0]
  if (selected === undefined) return Object.freeze({ detectionFailures: failures })
  const conflicts = detection.matches.filter(({ priority }) => priority === selected.priority)
  if (conflicts.length > 1) {
    return Object.freeze({
      detectionFailures: failures,
      warning: `TIFF calibration profile detection is ambiguous at priority ${selected.priority}: ${conflicts
        .map(({ id }) => id)
        .join(', ')}`,
    })
  }
  const profile = profiles.find(({ id }) => id === selected.id)
  if (profile === undefined) {
    return Object.freeze({
      detectionFailures: failures,
      warning: `TIFF calibration profile ${selected.id} is unavailable after detection`,
    })
  }
  try {
    return Object.freeze({
      value: await registry.openWith(document, profile),
      detectionFailures: failures,
    })
  } catch (error: unknown) {
    return Object.freeze({
      detectionFailures: failures,
      warning: `TIFF calibration profile ${profile.id} was ignored: ${errorMessage(error)}`,
    })
  }
}

const alphaExtraSamples = async (directory: TiffDirectory): Promise<ReadonlySet<number>> => {
  const alpha = new Set<number>()
  const info = directory.getTagInfo?.(338)
  if (info === undefined || info.byteLength > 256) return alpha
  try {
    const value = await directory.getTag(338, { maxBytes: 256 })
    if (value?.kind !== 'numbers') return alpha
    for (let index = 0; index < value.values.length; index += 1) {
      const extraSample = value.values[index]
      if (extraSample === 1 || extraSample === 2) alpha.add(index)
    }
  } catch {
    // Optional sample semantics must not make native raster opening fail.
  }
  return alpha
}

const component = (
  id: string,
  name: string,
  kind: ScientificComponentDescriptor['kind'],
): ScientificComponentDescriptor => Object.freeze({ id, name, kind })

const componentsFor = async (
  directory: TiffDirectory,
  format: RasterFormat,
): Promise<readonly ScientificComponentDescriptor[]> => {
  const output: ScientificComponentDescriptor[] = []
  const baseSamples = directory.photometric === 2 ? 3 : directory.photometric === 5 ? 4 : 1
  const alpha = await alphaExtraSamples(directory)
  for (let index = 0; index < format.channels; index += 1) {
    if (directory.photometric === 2 && index < 3) {
      output.push(
        index === 0
          ? component('red', 'Red', 'red')
          : index === 1
            ? component('green', 'Green', 'green')
            : component('blue', 'Blue', 'blue'),
      )
      continue
    }
    if (directory.photometric === 5 && index < 4) {
      const names = ['Cyan', 'Magenta', 'Yellow', 'Black'] as const
      output.push(
        component(
          names[index]?.toLowerCase() ?? `component-${index + 1}`,
          names[index] ?? `Component ${index + 1}`,
          'other',
        ),
      )
      continue
    }
    if ((directory.photometric === 0 || directory.photometric === 1) && index === 0) {
      output.push(component('intensity', 'Intensity', 'intensity'))
      continue
    }
    if (index >= baseSamples && alpha.has(index - baseSamples)) {
      const suffix = output.some(({ kind }) => kind === 'alpha') ? `-${index + 1}` : ''
      output.push(component(`alpha${suffix}`, `Alpha ${index + 1}`, 'alpha'))
      continue
    }
    output.push(component(`component-${index + 1}`, `Component ${index + 1}`, 'scalar'))
  }
  return Object.freeze(output)
}

const tagInfoMetadata = (tag: SelectedTag, info: TiffTagInfo): ScientificMetadataObject => ({
  tag: tag.tag,
  name: tag.name,
  private: tag.private,
  fieldType: info.fieldType,
  count: info.count,
  byteLength: info.byteLength,
})

const finiteMetadataNumber = (value: number): number | string => {
  if (Number.isFinite(value)) return value
  if (Number.isNaN(value)) return 'NaN'
  return value > 0 ? 'Infinity' : '-Infinity'
}

const hexBytes = (value: Uint8Array): string => {
  let output = ''
  for (const byte of value) output += byte.toString(16).padStart(2, '0')
  return output
}

const tagValueMetadata = (value: TiffTagValue): ScientificMetadataObject => {
  if (value.kind === 'ascii') return { kind: value.kind, value: value.value }
  if (value.kind === 'numbers') {
    return { kind: value.kind, values: value.values.map(finiteMetadataNumber) }
  }
  if (value.kind === 'bigints') {
    return { kind: value.kind, values: value.values.map((entry) => entry.toString(10)) }
  }
  return { kind: value.kind, encoding: 'hex', value: hexBytes(value.value) }
}

interface MetadataBudget {
  remaining: number
  readonly maximumTagBytes: number
}

const estimatedMetadataBytes = (info: TiffTagInfo): number => {
  const estimate = BigInt(info.byteLength) * 2n + BigInt(info.count) * 8n + 128n
  return estimate > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(estimate)
}

const directoryMetadata = async (
  directory: TiffDirectory,
  budget: MetadataBudget,
): Promise<ScientificMetadataObject> => {
  const tags: ScientificMetadataObject[] = []
  for (const selected of selectedTags) {
    const info = directory.getTagInfo?.(selected.tag)
    if (info === undefined) continue
    const base = tagInfoMetadata(selected, info)
    const estimate = estimatedMetadataBytes(info)
    if (
      selected.payload === 'info-only' ||
      info.byteLength > budget.maximumTagBytes ||
      estimate > budget.remaining
    ) {
      tags.push({
        ...base,
        omitted: selected.payload === 'info-only' ? 'binary-payload' : 'metadata-limit',
      })
      continue
    }
    try {
      const value = await directory.getTag(selected.tag, { maxBytes: budget.maximumTagBytes })
      if (value === undefined) continue
      budget.remaining -= estimate
      tags.push({ ...base, value: tagValueMetadata(value) })
    } catch {
      tags.push({ ...base, omitted: 'unreadable' })
    }
  }
  return normalizeScientificMetadataObject({
    index: directory.index,
    offset: directory.offset,
    width: directory.width,
    height: directory.height,
    compression: directory.compression,
    photometric: directory.photometric,
    samplesPerPixel: directory.samplesPerPixel,
    bitsPerSample: directory.bitsPerSample,
    sampleFormats: directory.sampleFormats,
    layout: directory.planar ? 'planar' : 'interleaved',
    storage: directory.tiled ? 'tiled' : 'stripped',
    ...(directory.tileWidth === undefined ? {} : { tileWidth: directory.tileWidth }),
    ...(directory.tileHeight === undefined ? {} : { tileHeight: directory.tileHeight }),
    tags,
  })
}

const inspectLevel = async (
  directory: TiffDirectory,
  level: number,
  signal: AbortSignal | undefined,
): Promise<TiffLevelDescription> => {
  const decoder = await directory.createRasterDecoder({
    ...(signal === undefined ? {} : { signal }),
  })
  throwIfAborted(signal)
  if (decoder.width !== directory.width || decoder.height !== directory.height) {
    throw invalidInput(
      `TIFF directory ${directory.index} raster dimensions changed during inspection`,
    )
  }
  return Object.freeze({
    level,
    directory,
    width: decoder.width,
    height: decoder.height,
    format: decoder.format,
  })
}

const pageCompatibilityKey = (
  levels: readonly TiffLevelDescription[],
  components: readonly ScientificComponentDescriptor[],
  calibration: TiffDirectoryCalibration | undefined,
): string =>
  JSON.stringify({
    levels: levels.map((level) => ({
      width: level.width,
      height: level.height,
      format: level.format,
      photometric: level.directory.photometric,
      bitsPerSample: level.directory.bitsPerSample,
      sampleFormats: level.directory.sampleFormats,
    })),
    components: components.map(({ id, kind }) => ({ id, kind })),
    calibration:
      calibration === undefined
        ? undefined
        : {
            axes: calibration.axes
              .filter(({ axisId }) => axisId === 'x' || axisId === 'y')
              .map(({ axisId, origin, step, unit }) => ({ axisId, origin, step, unit })),
            intensity:
              calibration.intensity === undefined
                ? undefined
                : {
                    origin: calibration.intensity.origin,
                    step: calibration.intensity.step,
                    unit: calibration.intensity.unit,
                  },
          },
  })

const describePage = async (
  directory: TiffDirectory,
  page: number,
  metadata: ScientificMetadataObject,
  calibration: TiffDirectoryCalibration | undefined,
  signal: AbortSignal | undefined,
): Promise<TiffPageDescription> => {
  const directories = [directory, ...directory.subIfds]
  const levels: TiffLevelDescription[] = []
  for (let level = 0; level < directories.length; level += 1) {
    const selected = directories[level]
    if (selected === undefined) continue
    levels.push(await inspectLevel(selected, level, signal))
  }
  const base = levels[0]
  if (base === undefined) throw invalidInput(`TIFF page ${page} exposes no raster level`)
  for (const level of levels.slice(1)) {
    if (!sameRasterFormat(base.format, level.format)) {
      throw unsupportedOperation(
        `TIFF page ${page} changes native raster format between SubIFD levels`,
      )
    }
  }
  const components = await componentsFor(directory, base.format)
  return Object.freeze({
    page,
    directory,
    levels: Object.freeze(levels),
    components,
    compatibilityKey: pageCompatibilityKey(levels, components, calibration),
    metadata,
    ...(calibration === undefined ? {} : { calibration }),
  })
}

const groupPages = (
  pages: readonly TiffPageDescription[],
): readonly (readonly TiffPageDescription[])[] => {
  const series: TiffPageDescription[][] = []
  for (const page of pages) {
    const current = series.at(-1)
    if (current === undefined || current[0]?.compatibilityKey !== page.compatibilityKey) {
      series.push([page])
    } else {
      current.push(page)
    }
  }
  return Object.freeze(series.map((entry) => Object.freeze(entry)))
}

const scientificLevels = (
  pages: readonly TiffPageDescription[],
  pageAxisId: string | undefined,
): readonly ScientificResolutionLevel[] => {
  const first = pages[0]
  if (first === undefined) throw invalidInput('TIFF series has no pages')
  return Object.freeze(
    first.levels.map((level) =>
      Object.freeze({
        level: level.level,
        axisLengths: Object.freeze([
          Object.freeze({ axisId: 'x', length: level.width }),
          Object.freeze({ axisId: 'y', length: level.height }),
          ...(pageAxisId === undefined
            ? []
            : [Object.freeze({ axisId: pageAxisId, length: pages.length })]),
        ]),
      }),
    ),
  )
}

const scientificAxis = (
  axisId: 'x' | 'y',
  length: number,
  calibration: TiffAxisCalibration | undefined,
  resourceId: string,
): ScientificAxisDescriptor =>
  calibration === undefined
    ? Object.freeze({
        id: axisId,
        name: axisId.toUpperCase(),
        kind: 'space',
        length,
        coordinates: Object.freeze({ type: 'index' }),
      })
    : Object.freeze({
        id: axisId,
        name: axisId.toUpperCase(),
        kind: 'space',
        length,
        unit: calibration.unit,
        coordinates: Object.freeze({
          type: 'linear',
          origin: calibration.origin,
          step: calibration.step,
        }),
        calibration: Object.freeze({
          kind: calibration.evidence.kind ?? 'embedded',
          resourceId,
          locator: calibration.evidence.locator,
          ...(calibration.evidence.formula === undefined
            ? {}
            : { formula: calibration.evidence.formula }),
          ...(calibration.evidence.note === undefined ? {} : { note: calibration.evidence.note }),
        }),
      })

const calibratedPageAxis = (
  calibration: TiffPageAxisCalibration,
  resourceId: string,
): ScientificAxisDescriptor =>
  Object.freeze({
    id: 'z',
    name: 'Z',
    kind: 'space',
    length: calibration.length,
    unit: calibration.unit,
    coordinates: Object.freeze({
      type: 'linear',
      origin: calibration.origin,
      step: calibration.step,
    }),
    calibration: Object.freeze({
      kind: calibration.evidence.kind ?? 'embedded',
      resourceId,
      locator: calibration.evidence.locator,
      ...(calibration.evidence.formula === undefined
        ? {}
        : { formula: calibration.evidence.formula }),
      ...(calibration.evidence.note === undefined ? {} : { note: calibration.evidence.note }),
    }),
  })

const calibratedComponents = (
  components: readonly ScientificComponentDescriptor[],
  calibration: TiffDirectoryCalibration | undefined,
): readonly ScientificComponentDescriptor[] => {
  const unit = calibration?.intensity?.unit
  if (unit === undefined) return components
  return Object.freeze(
    components.map((component) =>
      component.kind === 'intensity' ? Object.freeze({ ...component, unit }) : component,
    ),
  )
}

const describeSeries = (
  pages: readonly TiffPageDescription[],
  index: number,
  calibration: TiffCalibrationProfileValue | undefined,
  resourceId: string,
): TiffSeriesDescription => {
  const first = pages[0]
  const base = first?.levels[0]
  if (first === undefined || base === undefined) throw invalidInput('TIFF series has no base image')
  const pageAxisCalibration =
    calibration?.pageAxis !== undefined &&
    calibration.pageAxis.length === pages.length &&
    pages.every(({ page }, pageIndex) => page === pageIndex)
      ? calibration.pageAxis
      : undefined
  const pageAxisId = pageAxisCalibration?.axisId ?? (pages.length === 1 ? undefined : 'page')
  const firstCalibration = first.calibration
  const intensity = firstCalibration?.intensity
  const metadata = normalizeScientificMetadataObject({
    firstPage: first.page,
    pageCount: pages.length,
    pages: pages.map(({ metadata: pageMetadata }) => pageMetadata),
    ...(calibration === undefined
      ? {}
      : {
          calibrationProfile: calibration.profileId,
          calibrationWarnings: calibration.warnings,
          ...(calibration.acquisition === undefined
            ? {}
            : { acquisition: calibration.acquisition }),
          [calibration.rawMetadata.namespace]: calibration.rawMetadata.value,
        }),
    ...(intensity === undefined
      ? {}
      : {
          intensityCalibration: {
            origin: intensity.origin,
            step: intensity.step,
            ...(intensity.unit === undefined ? {} : { unit: intensity.unit }),
            evidence: intensity.evidence,
          },
        }),
  })
  const xCalibration = firstCalibration?.axes.find(({ axisId }) => axisId === 'x')
  const yCalibration = firstCalibration?.axes.find(({ axisId }) => axisId === 'y')
  const descriptor = normalizeScientificDatasetDescriptor({
    schemaVersion: 1,
    axes: [
      scientificAxis('x', base.width, xCalibration, resourceId),
      scientificAxis('y', base.height, yCalibration, resourceId),
      ...(pageAxisCalibration !== undefined
        ? [calibratedPageAxis(pageAxisCalibration, resourceId)]
        : pages.length === 1
          ? []
          : [
              {
                id: 'page',
                name: 'Page',
                kind: 'index' as const,
                length: pages.length,
                coordinates: {
                  type: 'labels' as const,
                  values: pages.map(({ page }) => `Page ${page}`),
                },
                entries: pages.map(({ page, directory }) => ({
                  id: `ifd-${directory.index}`,
                  name: `Page ${page}`,
                })),
              },
            ]),
    ],
    sampleType: base.format.sampleType,
    components: calibratedComponents(first.components, firstCalibration),
    levels: scientificLevels(pages, pageAxisId),
    metadata: { 'purejsimage:tiff': metadata },
    capabilities: {
      regionReads: true,
      resolutionLevels: first.levels.length > 1,
      planeReads: { kind: 'ordered-axis-pairs', pairs: [['x', 'y']] },
    },
  })
  return Object.freeze({
    id: `series-${index}`,
    pages,
    descriptor,
    metadata,
    ...(pageAxisId === undefined ? {} : { pageAxisId }),
  })
}

const validateRasterBlock = (
  block: RasterBlock,
  decoder: RasterDecoder,
  request: ReturnType<typeof normalizeScientificPlaneReadRequest>,
): void => {
  if (!sameRasterFormat(block.format, decoder.format)) {
    throw invalidInput('TIFF raster decoder changed native format during plane read')
  }
  const bytesPerSample = rasterSampleBytes(block.format.sampleType)
  if (
    !Number.isSafeInteger(block.x) ||
    !Number.isSafeInteger(block.y) ||
    !Number.isSafeInteger(block.width) ||
    !Number.isSafeInteger(block.height) ||
    block.width < 1 ||
    block.height < 1 ||
    block.x < 0 ||
    block.y < 0 ||
    block.x + block.width > request.width ||
    block.y + block.height > request.height
  ) {
    throw invalidInput('TIFF raster decoder returned a block outside the requested region')
  }
  const rowBytes = block.width * bytesPerSample * (block.format.planar ? 1 : block.format.channels)
  const occupiedPlaneBytes = block.stride * (block.height - 1) + rowBytes
  const planeStride = block.format.planar ? block.planeStride : occupiedPlaneBytes
  const requiredBytes =
    planeStride === undefined
      ? Number.NaN
      : planeStride * (block.format.planar ? block.format.channels - 1 : 0) + occupiedPlaneBytes
  if (
    !Number.isSafeInteger(rowBytes) ||
    !Number.isSafeInteger(block.stride) ||
    block.stride < rowBytes ||
    !Number.isSafeInteger(occupiedPlaneBytes) ||
    planeStride === undefined ||
    !Number.isSafeInteger(planeStride) ||
    planeStride < occupiedPlaneBytes ||
    !Number.isSafeInteger(requiredBytes) ||
    block.data.byteLength < requiredBytes
  ) {
    throw invalidInput('TIFF raster decoder returned invalid block storage')
  }
}

class TiffScientificDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #pages: readonly TiffPageDescription[]
  readonly #pageAxisId: string | undefined
  readonly #source: ImageSource

  constructor(series: TiffSeriesDescription, source: ImageSource) {
    this.descriptor = series.descriptor
    this.#pages = series.pages
    this.#pageAxisId = series.pageAxisId
    this.#source = source
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<RasterBlock> {
    const normalized = normalizeScientificPlaneReadRequest(this.descriptor, request)
    throwIfAborted(normalized.signal)
    const pageIndex =
      this.#pageAxisId === undefined
        ? 0
        : (normalized.fixedIndices.find(({ axisId }) => axisId === this.#pageAxisId)?.index ?? 0)
    const page = this.#pages[pageIndex]
    const level = page?.levels[normalized.resolutionLevel]
    if (page === undefined || level === undefined) {
      throw invalidInput('TIFF page or resolution-level selection is unavailable')
    }
    const source = bindImageSourceSignal(this.#source, normalized.signal)
    const managed = isSessionManagedSource(source)
    let sessionEnded = !managed
    const endSession = async (suppressError: boolean): Promise<void> => {
      if (sessionEnded || !managed) return
      sessionEnded = true
      if (!suppressError) {
        await source[sourceSessionEnd]()
        return
      }
      try {
        await source[sourceSessionEnd]()
      } catch {
        // Preserve the read error or iterator-return outcome.
      }
    }
    if (managed) source[sourceSessionStart]()
    try {
      const decoder = await level.directory.createRasterDecoder({
        ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
      })
      if (
        decoder.width !== level.width ||
        decoder.height !== level.height ||
        !sameRasterFormat(decoder.format, level.format)
      ) {
        throw invalidInput('TIFF raster selection changed after document opening')
      }
      for await (const block of decoder.decode({
        x: normalized.x,
        y: normalized.y,
        width: normalized.width,
        height: normalized.height,
        ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
      })) {
        let transferred = false
        try {
          throwIfAborted(normalized.signal)
          validateRasterBlock(block, decoder, normalized)
          const rebased = Object.freeze({
            ...block,
            x: normalized.x + block.x,
            y: normalized.y + block.y,
          })
          transferred = true
          yield rebased
        } finally {
          if (!transferred) block.release?.()
        }
      }
      throwIfAborted(normalized.signal)
      await endSession(false)
    } catch (error: unknown) {
      await endSession(true)
      throw error
    } finally {
      await endSession(true)
    }
  }
}

const createDocument = async (
  context: Readonly<ScientificOpenContext>,
  options: Readonly<TiffReaderOptions>,
): Promise<ScientificDocument> => {
  const maximumMetadataBytes = positiveInteger(
    options.maxMetadataBytes,
    defaultMaximumMetadataBytes,
    'TIFF reader maxMetadataBytes',
  )
  const maximumMetadataTagBytes = positiveInteger(
    options.maxMetadataTagBytes,
    defaultMaximumMetadataTagBytes,
    'TIFF reader maxMetadataTagBytes',
  )
  if (maximumMetadataTagBytes > maximumMetadataBytes) {
    throw limitExceeded('TIFF reader maxMetadataTagBytes must not exceed maxMetadataBytes')
  }
  const source =
    context.primary.source instanceof TiffEncodedCacheSource
      ? context.primary.source
      : new TiffEncodedCacheSource(context.primary.source)
  const document = await openTiffDocument(source, {
    ...(options.limits ?? {}),
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  })
  const calibration = await resolveTiffCalibration(
    document,
    options.calibrationProfiles ?? defaultTiffCalibrationProfiles,
  )
  const budget: MetadataBudget = {
    remaining: maximumMetadataBytes,
    maximumTagBytes: maximumMetadataTagBytes,
  }
  const pages: TiffPageDescription[] = []
  for (let page = 0; page < document.topLevelDirectories.length; page += 1) {
    throwIfAborted(context.signal)
    const directory = document.topLevelDirectories[page]
    if (directory === undefined) continue
    const directoryCalibration = calibration.value?.directories.find(
      ({ directoryIndex }) => directoryIndex === directory.index,
    )
    pages.push(
      await describePage(
        directory,
        page,
        await directoryMetadata(directory, budget),
        directoryCalibration,
        context.signal,
      ),
    )
  }
  if (pages.length === 0)
    throw invalidInput('TIFF document contains no top-level image directories')
  const series = groupPages(pages).map((entry, index) =>
    describeSeries(entry, index, calibration.value, context.primary.id),
  )
  const entries = await Promise.all(
    series.map(async (entry) => {
      const identity = await createScientificDatasetIdentity({
        reader: tiffReaderDescriptor,
        datasetId: entry.id,
        resources: [context.primary],
      })
      const dataset = identifyScientificDataset(new TiffScientificDataset(entry, source), identity)
      return Object.freeze({ entry, identity, dataset })
    }),
  )
  type CalibrationStatus = 'calibrated' | 'partial' | 'uncalibrated' | 'invalid'
  const calibrationStatusFor = (
    matches: (directory: TiffDirectoryCalibration) => boolean,
  ): CalibrationStatus => {
    if (calibration.warning !== undefined) return 'invalid'
    const directories = calibration.value?.directories ?? []
    const calibrated = directories.filter(matches).length
    if (calibrated === 0) return 'uncalibrated'
    return calibrated === document.topLevelDirectories.length ? 'calibrated' : 'partial'
  }
  const metadata = normalizeScientificMetadataObject({
    littleEndian: document.littleEndian,
    bigTiff: document.bigTiff,
    topLevelDirectoryCount: document.topLevelDirectories.length,
    directoryCount: document.directories.length,
    seriesCount: series.length,
    optionalMetadataBytesAdmitted: maximumMetadataBytes - budget.remaining,
    optionalMetadataBytesLimit: maximumMetadataBytes,
    calibrationStatus: {
      spatial: {
        x: calibrationStatusFor(({ axes }) => axes.some(({ axisId }) => axisId === 'x')),
        y: calibrationStatusFor(({ axes }) => axes.some(({ axisId }) => axisId === 'y')),
      },
      intensity: calibrationStatusFor(({ intensity }) => intensity !== undefined),
    },
    ...(calibration.value === undefined ? {} : { calibrationProfile: calibration.value.profileId }),
    ...(calibration.warning === undefined ? {} : { calibrationWarning: calibration.warning }),
    ...(calibration.detectionFailures.length === 0
      ? {}
      : { calibrationDetectionFailures: calibration.detectionFailures }),
  })
  return Object.freeze({
    reader: Object.freeze({ id: tiffReaderDescriptor.id, version: tiffReaderDescriptor.version }),
    format: tiffReaderDescriptor.format,
    metadata,
    datasets: Object.freeze(
      entries.map(({ entry, identity }, index) =>
        Object.freeze({
          id: entry.id,
          name: `TIFF image series ${index + 1}`,
          descriptor: entry.descriptor,
          identity,
          metadata: entry.metadata,
        }),
      ),
    ),
    async openDataset(id: string, openOptions?: Readonly<AbortOptions>) {
      throwIfAborted(openOptions?.signal ?? context.signal)
      const selected = entries.find(({ entry }) => entry.id === id)
      if (selected === undefined) throw invalidInput(`Unknown TIFF dataset ${id}`)
      return selected.dataset
    },
  })
}

export const createTiffReader = (options: Readonly<TiffReaderOptions> = {}): ScientificReader =>
  Object.freeze({
    descriptor: tiffReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      throwIfAborted(context.signal)
      if (context.primary.source.size < 4) {
        return Object.freeze({ confidence: 0, reason: 'TIFF signature is absent' })
      }
      const header = await context.primary.source.read(0, 4, {
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      })
      if (!isTiffHeader(header)) {
        return Object.freeze({ confidence: 0, reason: 'TIFF signature is absent' })
      }
      const hinted = resourceHasHint(
        context.primary,
        tiffReaderDescriptor.extensions,
        tiffReaderDescriptor.mediaTypes,
      )
      return Object.freeze({
        confidence: hinted ? 0.65 : 0.6,
        reason: hinted ? 'TIFF signature and resource hint match' : 'TIFF signature matches',
      })
    },
    open(context: Readonly<ScientificOpenContext>) {
      throwIfAborted(context.signal)
      return createDocument(context, options)
    },
  })

export const tiffReader: ScientificReader = createTiffReader()
