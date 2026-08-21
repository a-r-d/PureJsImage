import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded, unsupportedFormat } from '../../errors.ts'
import { normalizeScientificMetadataObject } from '../../scientific/dataset.ts'
import type {
  ScientificCompanionResolver,
  ScientificOpenContext,
  ScientificReader,
  ScientificReaderDescriptor,
  ScientificResource,
} from '../../scientific/reader.ts'
import {
  createScientificDatasetIdentity,
  identifyScientificDataset,
  normalizeScientificRelativeName,
} from '../../scientific/reader.ts'
import { jpegReader } from '../../scientific/readers/jpeg.ts'
import { pngReader } from '../../scientific/readers/png.ts'
import { createTiffReader } from '../../scientific/readers/tiff.ts'
import { readExactly } from '../../source.ts'
import { HttpRangeSource, type HttpRangeSourceOptions } from '../../sources/http-range.ts'
import type {
  GeoAffineTransform,
  GeoCrsEvidence,
  GeoMetadataObject,
  GeoRasterDataset,
  GeoSpatialReference,
} from '../contracts.ts'
import { geoRasterSchemaVersion, normalizeGeoSpatialReference } from '../contracts.ts'
import { geoCoordinateSystemTypeFromWkt } from '../crs.ts'
import type { GeoRasterDocument, GeoRasterReader } from './index.ts'
import { createGeoDatasetFromScientific } from './shared.ts'

const defaultSidecarBytes = 65_536

export interface WorldFileReaderOptions {
  readonly maxWorldFileBytes?: number
  readonly maxPrjBytes?: number
}

export interface OpenWorldFileHttpOptions extends WorldFileReaderOptions, AbortOptions {
  readonly http?: Omit<HttpRangeSourceOptions, 'allowNotFound' | 'openSignal'>
}

export interface WorldFileReader extends GeoRasterReader {
  open(context: Readonly<ScientificOpenContext>): Promise<GeoRasterDocument>
}

export const worldFileReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/geo/world-file',
  version: '1.0.0',
  format: 'World-file georeferenced image',
  extensions: Object.freeze(['tif', 'tiff', 'jpg', 'jpeg', 'jpe', 'png']),
  mediaTypes: Object.freeze(['image/tiff', 'image/jpeg', 'image/png']),
  capabilities: Object.freeze({
    resources: 'image-world-file-optional-prj',
    datasets: 'image-datasets',
    regionReads: 'source-codec-dependent',
    companionDiscovery: 'explicit-bounded-siblings',
  }),
})

interface ParsedWorldFile {
  readonly values: readonly [number, number, number, number, number, number]
  readonly pixelToWorld: GeoAffineTransform
}

interface ResolvedSidecars {
  readonly world: ScientificResource
  readonly prj?: ScientificResource
}

const positiveLimit = (value: number | undefined, fallback: number, label: string): number => {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return result
}

const leafParts = (name: string): { readonly stem: string; readonly extension: string } => {
  const normalized = normalizeScientificRelativeName(name)
  const slash = normalized.lastIndexOf('/')
  const directory = slash < 0 ? '' : normalized.slice(0, slash + 1)
  const leaf = slash < 0 ? normalized : normalized.slice(slash + 1)
  const dot = leaf.lastIndexOf('.')
  if (dot < 1 || dot === leaf.length - 1) {
    throw invalidInput('World-file image resource needs an unambiguous extension')
  }
  return Object.freeze({
    stem: `${directory}${leaf.slice(0, dot)}`,
    extension: leaf.slice(dot + 1).toLowerCase(),
  })
}

const worldFileNames = (name: string): readonly string[] => {
  const { stem, extension } = leafParts(name)
  const conventional =
    extension === 'tif' || extension === 'tiff'
      ? `${stem}.tfw`
      : extension === 'jpg' || extension === 'jpeg' || extension === 'jpe'
        ? `${stem}.jgw`
        : extension === 'png'
          ? `${stem}.pgw`
          : undefined
  if (conventional === undefined) return Object.freeze([])
  return Object.freeze([...new Set([conventional, `${stem}.${extension}w`, `${stem}.wld`])])
}

const sidecarText = async (
  resource: ScientificResource,
  maximum: number,
  label: string,
  signal: AbortSignal | undefined,
): Promise<string> => {
  if (resource.source.size > maximum) throw limitExceeded(`${label} exceeds ${maximum} bytes`)
  const bytes = await readExactly(resource.source, 0, resource.source.size, {
    ...(signal === undefined ? {} : { signal }),
  })
  if (bytes.includes(0)) throw invalidInput(`${label} contains a NUL byte`)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim()
  } catch {
    throw invalidInput(`${label} is not valid UTF-8`)
  }
}

const parseWorldFile = (text: string): ParsedWorldFile => {
  const lines = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
  if (lines.length !== 6) throw invalidInput('World file must contain exactly six lines')
  const values = lines.map((line, index) => {
    const trimmed = line.trim()
    if (trimmed.length === 0 || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u.test(trimmed)) {
      throw invalidInput(`World-file line ${index + 1} is not a finite number`)
    }
    const value = Number(trimmed)
    if (!Number.isFinite(value)) {
      throw invalidInput(`World-file line ${index + 1} is not a finite number`)
    }
    return value
  })
  const [a, d, b, e, centerX, centerY] = values
  if (
    a === undefined ||
    d === undefined ||
    b === undefined ||
    e === undefined ||
    centerX === undefined ||
    centerY === undefined
  ) {
    throw invalidInput('World file is incomplete')
  }
  const pixelToWorld: GeoAffineTransform = Object.freeze([
    a,
    b,
    centerX - (a + b) / 2,
    d,
    e,
    centerY - (d + e) / 2,
  ])
  return Object.freeze({
    values: Object.freeze([a, d, b, e, centerX, centerY] as const),
    pixelToWorld,
  })
}

const resolveSidecars = async (
  context: Readonly<ScientificOpenContext>,
): Promise<ResolvedSidecars> => {
  const name = context.primary.name
  if (name === undefined) throw invalidInput('World-file opening requires a primary resource name')
  if (context.companions === undefined) {
    throw invalidInput('World-file opening requires an explicit companion resolver')
  }
  const names = worldFileNames(name)
  if (names.length === 0)
    throw unsupportedFormat('Primary image has no supported world-file suffix')
  const matches: ScientificResource[] = []
  for (const candidate of names) {
    throwIfAborted(context.signal)
    const resource = await context.companions.resolve(
      { kind: 'relative-name', name: candidate },
      { ...(context.signal === undefined ? {} : { signal: context.signal }) },
    )
    if (resource !== undefined) matches.push(resource)
  }
  if (matches.length === 0) throw invalidInput('World-file companion is missing')
  if (matches.length > 1) throw invalidInput('World-file companion is ambiguous')
  const { stem } = leafParts(name)
  const prj = await context.companions.resolve(
    { kind: 'relative-name', name: `${stem}.prj` },
    { ...(context.signal === undefined ? {} : { signal: context.signal }) },
  )
  const world = matches[0]
  if (world === undefined) throw invalidInput('World-file companion is missing')
  return Object.freeze({ world, ...(prj === undefined ? {} : { prj }) })
}

const wktAuthority = (wkt: string): readonly [string, string] | undefined => {
  const matches = [
    ...wkt.matchAll(/(?:ID|AUTHORITY)\s*\[\s*["']([^"']+)["']\s*,\s*["']?(\d+)["']?/giu),
  ]
  const match = matches.at(-1)
  return match?.[1] === undefined || match[2] === undefined
    ? undefined
    : Object.freeze([match[1], match[2]])
}

const wktName = (wkt: string): string | undefined =>
  wkt.match(/^\s*[A-Za-z_]+\s*\[\s*["']([^"']+)["']/u)?.[1]

const isWkt2 = (wkt: string): boolean =>
  /^\s*(?:PROJCRS|GEOGCRS|GEODCRS|COMPOUNDCRS|VERTCRS)\s*\[/iu.test(wkt)

const spatialReference = (
  world: ScientificResource,
  prj: ScientificResource | undefined,
  wkt: string | undefined,
): GeoSpatialReference => {
  const evidence: GeoCrsEvidence[] = [
    Object.freeze({
      kind: 'sidecar',
      sourceId: world.id,
      locator: world.name ?? world.id,
      citation: 'World file affine',
    }),
  ]
  if (prj !== undefined && wkt !== undefined) {
    evidence.push(
      Object.freeze({
        kind: 'sidecar',
        sourceId: prj.id,
        locator: prj.name ?? prj.id,
        citation: wktName(wkt) ?? 'PRJ coordinate reference system',
        metadata: normalizeScientificMetadataObject({ originalWkt: wkt }),
      }),
    )
  }
  const authority = wkt === undefined ? undefined : wktAuthority(wkt)
  const type = geoCoordinateSystemTypeFromWkt(wkt)
  const name = wkt === undefined ? undefined : wktName(wkt)
  const diagnostics =
    wkt === undefined
      ? [
          {
            severity: 'warning' as const,
            code: 'unknown-crs' as const,
            message:
              'The world file defines a grid but no PRJ coordinate reference system was supplied.',
            path: 'spatialReference',
          },
        ]
      : []
  return normalizeGeoSpatialReference({
    schemaVersion: geoRasterSchemaVersion,
    coordinateSystemType: type,
    ...(authority?.[0] === undefined ? {} : { authority: authority[0] }),
    ...(authority?.[1] === undefined ? {} : { code: authority[1] }),
    ...(name === undefined ? {} : { name }),
    ...(wkt !== undefined && isWkt2(wkt) ? { wkt2: wkt } : {}),
    formalAxes: [],
    applicationAxes: { x: { name: 'X' }, y: { name: 'Y' } },
    evidence,
    state: wkt === undefined ? 'unknown' : 'incomplete',
    confidence: wkt === undefined ? 0.3 : 0.75,
    diagnostics,
  })
}

const imageReaders = (): readonly ScientificReader[] =>
  Object.freeze([createTiffReader(), jpegReader, pngReader])

const selectImageReader = async (
  context: Readonly<ScientificOpenContext>,
): Promise<ScientificReader> => {
  const matches: { readonly reader: ScientificReader; readonly confidence: number }[] = []
  for (const reader of imageReaders()) {
    const probe = await reader.probe(context)
    if (probe.confidence > 0) matches.push({ reader, confidence: probe.confidence })
  }
  matches.sort((left, right) => right.confidence - left.confidence)
  const selected = matches[0]?.reader
  if (selected === undefined)
    throw unsupportedFormat('World-file primary is not TIFF, JPEG, or PNG')
  return selected
}

const createDocument = async (
  context: Readonly<ScientificOpenContext>,
  options: Readonly<WorldFileReaderOptions>,
): Promise<GeoRasterDocument> => {
  const sidecars = await resolveSidecars(context)
  const worldText = await sidecarText(
    sidecars.world,
    positiveLimit(options.maxWorldFileBytes, defaultSidecarBytes, 'maxWorldFileBytes'),
    'World file',
    context.signal,
  )
  const parsed = parseWorldFile(worldText)
  const wkt =
    sidecars.prj === undefined
      ? undefined
      : await sidecarText(
          sidecars.prj,
          positiveLimit(options.maxPrjBytes, defaultSidecarBytes, 'maxPrjBytes'),
          'PRJ sidecar',
          context.signal,
        )
  if (wkt !== undefined && wkt.length === 0) throw invalidInput('PRJ sidecar is empty')
  const imageReader = await selectImageReader(context)
  const scientificDocument = await imageReader.open(context)
  const reference = spatialReference(sidecars.world, sidecars.prj, wkt)
  const entries: {
    readonly id: string
    readonly name?: string
    readonly dataset: GeoRasterDataset
  }[] = []
  for (const summary of scientificDocument.datasets) {
    const source = await scientificDocument.openDataset(summary.id, {
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    })
    const resources = [
      context.primary,
      sidecars.world,
      ...(sidecars.prj === undefined ? [] : [sidecars.prj]),
    ]
    identifyScientificDataset(
      source,
      await createScientificDatasetIdentity({
        reader: worldFileReaderDescriptor,
        datasetId: summary.id,
        resources,
      }),
    )
    const evidence: GeoMetadataObject = normalizeScientificMetadataObject({
      imageFormat: scientificDocument.format,
      worldFile: {
        lineOrder: [
          'pixelSizeX',
          'rowRotation',
          'columnRotation',
          'pixelSizeY',
          'centerX',
          'centerY',
        ],
        values: parsed.values,
        centerToCornerApplied: true,
      },
      ...(wkt === undefined ? {} : { prj: { originalWkt: wkt } }),
    })
    const dataset = createGeoDatasetFromScientific(source, {
      id: summary.id,
      ...(summary.name === undefined ? {} : { title: summary.name }),
      pixelToWorld: parsed.pixelToWorld,
      pixelRegistration: 'pixel-is-area',
      spatialReference: reference,
      sourceFormat: {
        id: 'world-file-image',
        name: `${scientificDocument.format} with world file`,
      },
      formatEvidence: evidence,
      storage: { organization: 'unknown', metadata: { imageFormat: scientificDocument.format } },
    })
    entries.push(
      Object.freeze({
        id: summary.id,
        ...(summary.name === undefined ? {} : { name: summary.name }),
        dataset,
      }),
    )
  }
  return Object.freeze({
    reader: Object.freeze({
      id: worldFileReaderDescriptor.id,
      version: worldFileReaderDescriptor.version,
    }),
    format: worldFileReaderDescriptor.format,
    metadata: normalizeScientificMetadataObject({
      imageFormat: scientificDocument.format,
      worldFile: sidecars.world.name ?? sidecars.world.id,
      prj: sidecars.prj?.name ?? null,
    }),
    datasets: Object.freeze(
      entries.map(({ id, name, dataset }) =>
        Object.freeze({
          id,
          ...(name === undefined ? {} : { name }),
          descriptor: dataset.descriptor,
          diagnostics: dataset.descriptor.diagnostics,
        }),
      ),
    ),
    async openDataset(id: string, openOptions?: Readonly<AbortOptions>) {
      throwIfAborted(openOptions?.signal ?? context.signal)
      const selected = entries.find((entry) => entry.id === id)
      if (selected === undefined) throw invalidInput(`Unknown world-file dataset ${id}`)
      return selected.dataset
    },
    ...(scientificDocument.close === undefined
      ? {}
      : { close: () => scientificDocument.close?.() }),
  })
}

export const createWorldFileReader = (
  options: Readonly<WorldFileReaderOptions> = {},
): WorldFileReader =>
  Object.freeze({
    descriptor: worldFileReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      throwIfAborted(context.signal)
      try {
        const image = await selectImageReader(context)
        const imageProbe = await image.probe(context)
        await resolveSidecars(context)
        return Object.freeze({
          confidence: Math.max(0.95, imageProbe.confidence),
          reason: 'Image and world-file sidecar match',
        })
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          /missing|requires|no supported|not TIFF|ambiguous/u.test(error.message)
        ) {
          return Object.freeze({ confidence: 0, reason: error.message })
        }
        throw error
      }
    },
    open: (context: Readonly<ScientificOpenContext>) => createDocument(context, options),
  })

export const worldFileReader: WorldFileReader = createWorldFileReader()

const urlLeaf = (url: URL): string => {
  const leaf = url.pathname.slice(url.pathname.lastIndexOf('/') + 1)
  if (leaf.length === 0) throw invalidInput('World-file HTTP URL must name an image object')
  return normalizeScientificRelativeName(decodeURIComponent(leaf))
}

/** Open one HTTP image and only its documented sibling world-file and PRJ names. */
export const openWorldFileHttp = async (
  input: string | URL,
  options: Readonly<OpenWorldFileHttpOptions> = {},
): Promise<GeoRasterDocument> => {
  const url = new URL(String(input))
  const name = urlLeaf(url)
  const allowed = new Set([...worldFileNames(name), `${leafParts(name).stem}.prj`])
  const http = options.http ?? {}
  const primarySource = await HttpRangeSource.open(url, {
    ...http,
    ...(options.signal === undefined ? {} : { openSignal: options.signal }),
  })
  const companions: ScientificCompanionResolver = Object.freeze({
    async resolve(
      request: Parameters<ScientificCompanionResolver['resolve']>[0],
      abort: Readonly<AbortOptions> = {},
    ) {
      const relative = request.kind === 'relative-name' ? request.name : request.relativeName
      if (relative === undefined) return undefined
      const normalized = normalizeScientificRelativeName(relative)
      if (!allowed.has(normalized)) return undefined
      const sibling = new URL(url)
      sibling.pathname = `${url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1)}${normalized}`
      const source = await HttpRangeSource.open(sibling, {
        ...http,
        allowNotFound: true,
        ...(abort.signal === undefined ? {} : { openSignal: abort.signal }),
      })
      return source === undefined
        ? undefined
        : Object.freeze({ id: sibling.href, name: normalized, source })
    },
  })
  return createWorldFileReader(options).open(
    Object.freeze({
      primary: Object.freeze({ id: url.href, name, source: primarySource }),
      companions,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }),
  )
}
