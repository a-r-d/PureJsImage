import { invalidInput, unsupportedFormat } from '../errors.ts'
import type { ScientificReader } from './reader.ts'
import {
  generatedScientificBrowserReaderCatalog,
  importGeneratedScientificReaderModule,
} from './browser-reader-catalog.generated.ts'

export type ScientificBrowserResourceModel =
  | 'single'
  | 'companion-pair'
  | 'companion-set'
  | 'directory-like'

export interface ScientificBrowserReaderCatalogEntry {
  readonly id: string
  readonly version: string
  readonly format: string
  readonly packageExport: string
  readonly extensions: readonly string[]
  readonly mediaTypes: readonly string[]
  readonly resourceModel: ScientificBrowserResourceModel
  readonly datasetKinds: readonly string[]
  readonly directRangeReads: boolean
  readonly boundary: string
}

export interface ScientificBrowserReaderHints {
  readonly name?: string
  readonly mediaType?: string
  readonly readerId?: string
}

export const scientificBrowserReaderCatalog = generatedScientificBrowserReaderCatalog

const extensionOf = (name: string | undefined): string | undefined => {
  if (name === undefined) return undefined
  const leaf = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
  const dot = leaf.lastIndexOf('.')
  return dot < 0 || dot === leaf.length - 1 ? undefined : leaf.slice(dot + 1).toLowerCase()
}

const normalizedMediaType = (mediaType: string | undefined): string | undefined => {
  if (mediaType === undefined) return undefined
  const value = mediaType.split(';', 1)[0]?.trim().toLowerCase()
  return value === undefined || value.length === 0 ? undefined : value
}

/**
 * Return a deterministic candidate set. Hints choose chunks to load but never select a reader.
 * Registered readers still inspect bytes under ScientificReaderRegistry probe limits.
 */
export const candidateScientificBrowserReaders = (
  hints: Readonly<ScientificBrowserReaderHints> = {},
): readonly ScientificBrowserReaderCatalogEntry[] => {
  if (hints.readerId !== undefined) {
    const explicit = scientificBrowserReaderCatalog.find(({ id }) => id === hints.readerId)
    if (explicit === undefined) {
      throw unsupportedFormat(`Scientific reader ${hints.readerId} is not in the browser catalog`)
    }
    return Object.freeze([explicit])
  }
  const extension = extensionOf(hints.name)
  const mediaType = normalizedMediaType(hints.mediaType)
  const candidates = scientificBrowserReaderCatalog.filter(
    (entry) =>
      (extension !== undefined && entry.extensions.includes(extension)) ||
      (mediaType !== undefined && entry.mediaTypes.includes(mediaType)),
  )
  return candidates.length === 0 ? scientificBrowserReaderCatalog : Object.freeze(candidates)
}

const isScientificReader = (value: unknown): value is ScientificReader =>
  value !== null &&
  typeof value === 'object' &&
  'descriptor' in value &&
  'probe' in value &&
  typeof value.probe === 'function' &&
  'open' in value &&
  typeof value.open === 'function'

const moduleValues = (value: unknown): readonly unknown[] =>
  value !== null && typeof value === 'object' ? Object.values(value) : []

/** Dynamically load one explicit scientific reader chunk and validate its descriptor identity. */
export const loadScientificBrowserReader = async (id: string): Promise<ScientificReader> => {
  const entry = scientificBrowserReaderCatalog.find((candidate) => candidate.id === id)
  if (entry === undefined) {
    throw unsupportedFormat(`Scientific reader ${id} is not in the browser catalog`)
  }
  const module = await importGeneratedScientificReaderModule(id)
  const readers = moduleValues(module).filter(isScientificReader)
  const matches = readers.filter(
    ({ descriptor }) => descriptor.id === entry.id && descriptor.version === entry.version,
  )
  if (matches.length !== 1) {
    throw invalidInput(
      `Scientific reader module ${entry.packageExport} did not expose exactly ${entry.id}@${entry.version}`,
    )
  }
  const reader = matches[0]
  if (reader === undefined) {
    throw invalidInput(`Scientific reader module ${entry.packageExport} is empty`)
  }
  return reader
}

/** Load only the reader chunks selected by safe filename, media-type, or explicit-ID hints. */
export const loadCandidateScientificBrowserReaders = async (
  hints: Readonly<ScientificBrowserReaderHints> = {},
): Promise<readonly ScientificReader[]> =>
  Object.freeze(
    await Promise.all(
      candidateScientificBrowserReaders(hints).map(({ id }) => loadScientificBrowserReader(id)),
    ),
  )
