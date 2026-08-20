import { invalidInput } from '../errors.ts'
import { BlobSource } from '../source.ts'
import type {
  ScientificCompanionRequest,
  ScientificCompanionResolver,
  ScientificOpenContext,
  ScientificProbeLimitOptions,
  ScientificResource,
} from './reader.ts'
import { normalizeScientificRelativeName } from './reader.ts'

export type {
  NormalizedOmeZarrStoreUrl,
  OmeZarrHttpContext,
  OmeZarrHttpStoreOptions,
  OmeZarrHttpStoreIdentitySummary,
  OmeZarrNetworkStats,
} from './ome-zarr-http.ts'
export {
  createOmeZarrHttpContext,
  normalizeOmeZarrStoreUrl,
  OmeZarrHttpStore,
  resolveOmeZarrObjectUrl,
} from './ome-zarr-http.ts'

const fileRelativeName = (file: File): string => {
  const relativePath = file.webkitRelativePath
  return normalizeScientificRelativeName(
    typeof relativePath === 'string' && relativePath.length > 0 ? relativePath : file.name,
  )
}

const fileResource = (file: File): ScientificResource => {
  const name = fileRelativeName(file)
  return Object.freeze({
    id: name,
    name,
    ...(file.type.length === 0 ? {} : { mediaType: file.type }),
    source: new BlobSource(file),
  })
}

/** Create a deterministic in-memory File resolver; duplicate relative names are rejected. */
export const createScientificFileCompanionResolver = (
  files: Iterable<File>,
): ScientificCompanionResolver => {
  const resources = new Map<string, ScientificResource>()
  for (const file of files) {
    const resource = fileResource(file)
    if (resource.name === undefined) throw invalidInput('Browser scientific file name is missing')
    if (resources.has(resource.name)) {
      throw invalidInput(`Browser scientific companion name is ambiguous: ${resource.name}`)
    }
    resources.set(resource.name, resource)
  }
  return Object.freeze({
    async resolve(request: Readonly<ScientificCompanionRequest>) {
      const name = request.kind === 'relative-name' ? request.name : request.relativeName
      if (name === undefined) {
        if (request.kind !== 'role')
          throw invalidInput('Browser scientific companion name is missing')
        throw invalidInput(`Browser scientific companion role ${request.role} requires a name`)
      }
      return resources.get(normalizeScientificRelativeName(name))
    },
  })
}

export interface ScientificFileContextOptions {
  readonly id?: string
  readonly companions?: Iterable<File>
  readonly readerId?: string
  readonly readerVersion?: string
  readonly probeLimits?: ScientificProbeLimitOptions
  readonly signal?: AbortSignal
}

/** Build a browser scientific context from a primary File and an explicit companion set. */
export const createScientificFileContext = (
  primary: File,
  options: Readonly<ScientificFileContextOptions> = {},
): ScientificOpenContext => {
  const resource = fileResource(primary)
  const primaryResource: ScientificResource = Object.freeze({
    ...resource,
    ...(options.id === undefined ? {} : { id: options.id }),
  })
  const companions =
    options.companions === undefined
      ? undefined
      : createScientificFileCompanionResolver(options.companions)
  return Object.freeze({
    primary: primaryResource,
    ...(companions === undefined ? {} : { companions }),
    ...(options.readerId === undefined ? {} : { readerId: options.readerId }),
    ...(options.readerVersion === undefined ? {} : { readerVersion: options.readerVersion }),
    ...(options.probeLimits === undefined ? {} : { probeLimits: options.probeLimits }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
}
