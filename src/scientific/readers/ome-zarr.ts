import { invalidInput } from '../../errors.ts'
import { type OmeZarrLimits, openOmeZarr, probeOmeZarr } from '../formats/ome-zarr.ts'
import type {
  ScientificDocument,
  ScientificOpenContext,
  ScientificReader,
  ScientificReaderDescriptor,
} from '../reader.ts'
import { resourceHasHint } from './shared.ts'

export interface OmeZarrReaderOptions {
  readonly limits?: Partial<OmeZarrLimits>
}

const defaults: Readonly<OmeZarrLimits> = Object.freeze({
  maxMetadataBytes: 1_048_576,
  maxDimensions: 8,
  maxChunkBytes: 67_108_864,
  maxDecodedChunkBytes: 67_108_864,
  maxOpenSources: 4_096,
  maxCachedChunkBytes: 16_777_216,
  maxStoreResolutions: 8_192,
  maxMultiscales: 16,
  maxDatasets: 256,
  maxLevels: 32,
  maxRegionBytes: 67_108_864,
  rowsPerBlock: 32,
})

const positive = (value: number | undefined, fallback: number, label: string): number => {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return resolved
}

const resolveLimits = (input: Partial<OmeZarrLimits> = {}): Readonly<OmeZarrLimits> =>
  Object.freeze({
    maxMetadataBytes: positive(
      input.maxMetadataBytes,
      defaults.maxMetadataBytes,
      'OME-Zarr maxMetadataBytes',
    ),
    maxDimensions: positive(input.maxDimensions, defaults.maxDimensions, 'OME-Zarr maxDimensions'),
    maxChunkBytes: positive(input.maxChunkBytes, defaults.maxChunkBytes, 'OME-Zarr maxChunkBytes'),
    maxDecodedChunkBytes: positive(
      input.maxDecodedChunkBytes,
      defaults.maxDecodedChunkBytes,
      'OME-Zarr maxDecodedChunkBytes',
    ),
    maxOpenSources: positive(
      input.maxOpenSources,
      defaults.maxOpenSources,
      'OME-Zarr maxOpenSources',
    ),
    maxCachedChunkBytes: positive(
      input.maxCachedChunkBytes,
      defaults.maxCachedChunkBytes,
      'OME-Zarr maxCachedChunkBytes',
    ),
    maxStoreResolutions: positive(
      input.maxStoreResolutions,
      defaults.maxStoreResolutions,
      'OME-Zarr maxStoreResolutions',
    ),
    maxMultiscales: positive(
      input.maxMultiscales,
      defaults.maxMultiscales,
      'OME-Zarr maxMultiscales',
    ),
    maxDatasets: positive(input.maxDatasets, defaults.maxDatasets, 'OME-Zarr maxDatasets'),
    maxLevels: positive(input.maxLevels, defaults.maxLevels, 'OME-Zarr maxLevels'),
    maxRegionBytes: positive(
      input.maxRegionBytes,
      defaults.maxRegionBytes,
      'OME-Zarr maxRegionBytes',
    ),
    rowsPerBlock: positive(input.rowsPerBlock, defaults.rowsPerBlock, 'OME-Zarr rowsPerBlock'),
    ...(input.zip === undefined ? {} : { zip: input.zip }),
  })

export const omeZarrReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/ome-zarr',
  version: '1.0.0',
  format: 'OME-Zarr',
  extensions: Object.freeze(['zarr', 'ozx']),
  mediaTypes: Object.freeze(['application/vnd.ome.zarr', 'application/x-zarr']),
  capabilities: Object.freeze({
    resources: 'directory-like',
    datasets: 'multiple',
    axes: 'labeled',
    zarr: '2-3',
    omeNgff: '0.4-0.5',
    zipStore: 'root-metadata',
  }),
})

export const createOmeZarrReader = (
  options: Readonly<OmeZarrReaderOptions> = {},
): ScientificReader => {
  const limits = resolveLimits(options.limits)
  return Object.freeze({
    descriptor: omeZarrReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      const hinted = resourceHasHint(
        context.primary,
        omeZarrReaderDescriptor.extensions,
        omeZarrReaderDescriptor.mediaTypes,
      )
      const name = context.primary.name?.toLowerCase() ?? ''
      const looksLikeRoot =
        name === 'zarr.json' ||
        name.endsWith('/zarr.json') ||
        name.endsWith('.zgroup') ||
        name.endsWith('.ozx')
      const probed = await probeOmeZarr(
        context,
        Math.min(limits.maxMetadataBytes, 16_384),
        limits.zip ?? {},
      )
      if (probed.confidence === 0 && probed.reason === undefined && (hinted || looksLikeRoot)) {
        return { confidence: 0.2, reason: 'OME-Zarr name hint without confirming metadata' }
      }
      return probed
    },
    open(context: Readonly<ScientificOpenContext>): Promise<ScientificDocument> {
      return openOmeZarr({ context, descriptor: omeZarrReaderDescriptor, limits })
    },
  })
}

export const omeZarrReader = createOmeZarrReader()
