import { invalidInput } from '../errors.ts'
import { FileSource } from '../node-source.ts'
import type { EnviDataset, EnviOpenOptions } from './formats/envi.ts'
import { openEnvi } from './formats/envi.ts'
import type {
  ScientificCompanionResolver,
  ScientificCompanionRequest,
  ScientificOpenContext,
  ScientificProbeLimitOptions,
  ScientificResource,
} from './reader.ts'
import { normalizeScientificRelativeName } from './reader.ts'
export type {
  FitsDataset,
  FitsDocument,
  FitsHdu,
  FitsHeaderCard,
  FitsHeaderValue,
  FitsOpenOptions,
} from './formats/fits.ts'
export { openFits } from './formats/fits.ts'

export interface EnviPathOpenOptions extends Omit<EnviOpenOptions, 'header' | 'data'> {
  readonly dataPath?: string
}

const existingFile = async (path: string): Promise<boolean> => {
  const { stat } = await import('node:fs/promises')
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

const associatedDataPath = async (headerPath: string): Promise<string> => {
  const { extname } = await import('node:path')
  const extension = extname(headerPath)
  const stem =
    extension.toLowerCase() === '.hdr' ? headerPath.slice(0, -extension.length) : headerPath
  const candidates = [stem, `${stem}.img`, `${stem}.dat`, `${stem}.raw`]
  for (const candidate of candidates) {
    if (candidate !== headerPath && (await existingFile(candidate))) return candidate
  }
  throw invalidInput(
    `Could not resolve the ENVI binary file associated with ${headerPath}; pass dataPath explicitly`,
  )
}

export const openEnviPath = async (
  headerPath: string,
  options: Readonly<EnviPathOpenOptions> = {},
): Promise<EnviDataset> => {
  const dataPath = options.dataPath ?? (await associatedDataPath(headerPath))
  const [header, data] = await Promise.all([FileSource.open(headerPath), FileSource.open(dataPath)])
  const { dataPath: _dataPath, ...portableOptions } = options
  return openEnvi({ ...portableOptions, header, data })
}

export type { EnviDataset, EnviOpenOptions } from './formats/envi.ts'
export { openEnvi } from './formats/envi.ts'

const nodeResource = async (
  path: string,
  id: string,
  name: string,
): Promise<ScientificResource> => {
  const source = await FileSource.open(path)
  return Object.freeze({
    id,
    name,
    source,
  })
}

const existingPaths = async (paths: readonly string[]): Promise<readonly string[]> => {
  const matches: string[] = []
  for (const path of paths) if (await existingFile(path)) matches.push(path)
  return Object.freeze(matches)
}

const createNodeCompanionResolver = async (
  primaryPath: string,
): Promise<ScientificCompanionResolver> => {
  const { basename, dirname, join } = await import('node:path')
  const directory = dirname(primaryPath)
  return Object.freeze({
    async resolve(request: Readonly<ScientificCompanionRequest>) {
      const requested = request.kind === 'relative-name' ? request.name : request.relativeName
      if (requested === undefined) {
        if (request.kind !== 'role') throw invalidInput('Node scientific companion name is missing')
        throw invalidInput(`Node scientific companion role ${request.role} requires a name`)
      }
      const relativeName = normalizeScientificRelativeName(requested)
      const exact = join(directory, relativeName)
      const candidates =
        request.kind === 'role' && request.role === 'data'
          ? [exact, `${exact}.img`, `${exact}.dat`, `${exact}.raw`, `${exact}.bin`]
          : [exact]
      const matches = await existingPaths(candidates)
      if (matches.length > 1) {
        throw invalidInput(`Scientific companion ${relativeName} is ambiguous`)
      }
      const match = matches[0]
      return match === undefined
        ? undefined
        : nodeResource(match, match, normalizeScientificRelativeName(basename(match)))
    },
  })
}

export interface ScientificPathContextOptions {
  readonly id?: string
  readonly readerId?: string
  readonly readerVersion?: string
  readonly probeLimits?: ScientificProbeLimitOptions
  readonly signal?: AbortSignal
}

/** Build a Node scientific context without importing filesystem code into the portable entry. */
export const createScientificPathContext = async (
  path: string,
  options: Readonly<ScientificPathContextOptions> = {},
): Promise<ScientificOpenContext> => {
  const { basename } = await import('node:path')
  const name = normalizeScientificRelativeName(basename(path))
  const [primary, companions] = await Promise.all([
    nodeResource(path, options.id ?? path, name),
    createNodeCompanionResolver(path),
  ])
  return Object.freeze({
    primary,
    companions,
    ...(options.readerId === undefined ? {} : { readerId: options.readerId }),
    ...(options.readerVersion === undefined ? {} : { readerVersion: options.readerVersion }),
    ...(options.probeLimits === undefined ? {} : { probeLimits: options.probeLimits }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}
