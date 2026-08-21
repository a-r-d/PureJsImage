import type { AbortOptions } from '../abort.ts'
import { invalidInput, limitExceeded } from '../errors.ts'
import { openZipArchive, type ZipArchive, type ZipLimits } from '../archive/zip.ts'
import { MemorySource, type ImageSource } from '../source.ts'
import {
  createZarrStore,
  parseZarrNodeJson,
  readZarrJsonBytes,
  type ZarrObject,
  type ZarrObjectStore,
  type ZarrStore,
  type ZarrStoreLimits,
} from './core.ts'

export const isZipBytes = (bytes: Uint8Array): boolean =>
  bytes.byteLength >= 4 &&
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
    (bytes[2] === 0x05 && bytes[3] === 0x06) ||
    (bytes[2] === 0x06 && bytes[3] === 0x06))

const entryDirectory = (path: string): string => {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

const ignoredPrefix = (prefix: string): boolean => {
  const lower = prefix.toLowerCase()
  return lower === '__macosx' || lower.startsWith('__macosx/')
}

const preferredMetadataObject = (archive: ZipArchive, prefix: string): string | undefined => {
  const lead = prefix.length === 0 ? '' : `${prefix}/`
  if (archive.get(`${lead}zarr.json`) !== undefined) return `${lead}zarr.json`
  if (archive.get(`${lead}.zgroup`) !== undefined) return `${lead}.zgroup`
  if (archive.get(`${lead}.zarray`) !== undefined) return `${lead}.zarray`
  return undefined
}

const rootMetadataObject = (archive: ZipArchive): string | undefined => {
  const top = preferredMetadataObject(archive, '')
  if (top !== undefined) return top
  const prefixes = new Set<string>()
  for (const entry of archive.entries) {
    const slash = entry.path.lastIndexOf('/')
    const name = slash < 0 ? entry.path : entry.path.slice(slash + 1)
    if (name === 'zarr.json' || name === '.zgroup' || name === '.zarray') {
      const directory = entryDirectory(entry.path)
      if (!ignoredPrefix(directory)) prefixes.add(directory)
    }
  }
  const outermost = [...prefixes].filter(
    (prefix) => ![...prefixes].some((other) => other !== prefix && prefix.startsWith(`${other}/`)),
  )
  if (outermost.length !== 1) return undefined
  const prefix = outermost[0]
  return prefix === undefined ? undefined : preferredMetadataObject(archive, prefix)
}

const metadataMember = (name: string): boolean =>
  /(?:^|\/)(?:zarr\.json|\.zgroup|\.zattrs|\.zarray)$/u.test(name)

const createZipObjectStore = (
  archive: ZipArchive,
  limits: Readonly<ZarrStoreLimits>,
): ZarrObjectStore =>
  Object.freeze({
    async resolve(name: string, signal?: AbortSignal): Promise<ZarrObject | undefined> {
      const entry = archive.get(name)
      if (entry === undefined) return undefined
      const metadata = metadataMember(name)
      const limit = metadata ? limits.maxMetadataBytes : limits.maxChunkBytes
      const label = metadata ? 'maxMetadataBytes' : 'maxChunkBytes'
      if (entry.uncompressedBytes > limit) {
        throw limitExceeded(`Zarr ZIP member ${name} exceeds ${label}`)
      }
      const options: Readonly<AbortOptions> = signal === undefined ? {} : { signal }
      const source =
        entry.compression === 'stored'
          ? await archive.openStored(name, options)
          : new MemorySource(await archive.read(name, options))
      return Object.freeze({ id: name, source })
    },
  })

export interface OpenZarrZipOptions {
  readonly limits: Readonly<ZarrStoreLimits>
  readonly zip?: Readonly<ZipLimits>
  readonly identityResource?: ZarrObject
  readonly signal?: AbortSignal
}

export interface OpenedZarrZipStore {
  readonly metadataObject: string
  readonly json: unknown
  readonly store: ZarrStore
}

/** Open one root Zarr hierarchy from a bounded ZIP or ZIP64 source. */
export const openZarrZipStore = async (
  source: ImageSource,
  options: Readonly<OpenZarrZipOptions>,
): Promise<OpenedZarrZipStore> => {
  const archive = await openZipArchive(source, options.zip ?? {}, options.signal)
  const metadataObject = rootMetadataObject(archive)
  if (metadataObject === undefined) {
    throw invalidInput('Zarr ZIP archive is missing a unique root zarr.json, .zgroup, or .zarray')
  }
  const entry = archive.get(metadataObject)
  if (entry !== undefined && entry.uncompressedBytes > options.limits.maxMetadataBytes) {
    throw limitExceeded(`Zarr root metadata exceeds ${options.limits.maxMetadataBytes} bytes`)
  }
  const json = readZarrJsonBytes(
    await archive.read(
      metadataObject,
      options.signal === undefined ? {} : { signal: options.signal },
    ),
  )
  if (json === undefined) throw invalidInput('Zarr ZIP root metadata is not valid JSON')
  const node = parseZarrNodeJson(json)
  if (node === undefined)
    throw invalidInput('Zarr ZIP root metadata does not describe a v2 or v3 node')
  return Object.freeze({
    metadataObject,
    json,
    store: createZarrStore(
      createZipObjectStore(archive, options.limits),
      metadataObject,
      options.limits,
      node.format,
      {
        identityKind: 'archive',
        ...(options.identityResource === undefined
          ? {}
          : { archiveResource: options.identityResource }),
      },
    ),
  })
}
