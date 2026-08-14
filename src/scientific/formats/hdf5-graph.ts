import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded } from '../../errors.ts'
import { readHdf5DenseGroup, type Hdf5DenseGroupLimits } from './hdf5-dense-group.ts'
import { readHdf5LegacyGroup, type Hdf5LegacyGroupLimits } from './hdf5-legacy-group.ts'
import {
  readHdf5ObjectHeader,
  type Hdf5Link,
  type Hdf5ObjectHeader,
  type Hdf5ObjectHeaderLimits,
} from './hdf5-object.ts'
import type { Hdf5FileLayer } from './hdf5.ts'

export interface Hdf5ObjectGraphLimits {
  readonly maxObjects?: number
  readonly maxLinks?: number
  readonly maxLinkDepth?: number
  readonly maxSoftLinkTraversals?: number
  readonly maxPathBytes?: number
  readonly maxMetadataBytes?: number
}

export interface Hdf5ObjectGraphOptions extends AbortOptions, Hdf5ObjectGraphLimits {
  readonly objectHeaderLimits?: Readonly<Hdf5ObjectHeaderLimits>
  readonly legacyGroupLimits?: Readonly<Hdf5LegacyGroupLimits>
  readonly denseGroupLimits?: Readonly<Hdf5DenseGroupLimits>
}

export interface Hdf5ObjectGraphReadOptions extends AbortOptions {}

export interface Hdf5GraphObject {
  readonly path: string
  readonly address: bigint
  readonly header: Hdf5ObjectHeader
}

export interface Hdf5ObjectGraphStats {
  readonly objects: number
  readonly groups: number
  readonly links: number
  readonly metadataBytes: number
}

export interface Hdf5ObjectGraph {
  readonly rootAddress: bigint
  get(
    path: string,
    options?: Readonly<Hdf5ObjectGraphReadOptions>,
  ): Promise<Hdf5GraphObject | undefined>
  list(
    path: string,
    options?: Readonly<Hdf5ObjectGraphReadOptions>,
  ): Promise<readonly Hdf5Link[] | undefined>
  stats(): Hdf5ObjectGraphStats
}

interface ResolvedGraphLimits {
  readonly maxObjects: number
  readonly maxLinks: number
  readonly maxLinkDepth: number
  readonly maxSoftLinkTraversals: number
  readonly maxPathBytes: number
  readonly maxMetadataBytes: number
}

interface ParsedPath {
  readonly absolute: boolean
  readonly components: readonly string[]
}

const defaultLimits: ResolvedGraphLimits = Object.freeze({
  maxObjects: 65_536,
  maxLinks: 262_144,
  maxLinkDepth: 64,
  maxSoftLinkTraversals: 16,
  maxPathBytes: 65_536,
  maxMetadataBytes: 67_108_864,
})

const positiveSafeInteger = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
  return value
}

const resolveLimits = (options: Readonly<Hdf5ObjectGraphLimits>): ResolvedGraphLimits =>
  Object.freeze({
    maxObjects: positiveSafeInteger(
      'HDF5 graph maxObjects',
      options.maxObjects ?? defaultLimits.maxObjects,
    ),
    maxLinks: positiveSafeInteger(
      'HDF5 graph maxLinks',
      options.maxLinks ?? defaultLimits.maxLinks,
    ),
    maxLinkDepth: positiveSafeInteger(
      'HDF5 graph maxLinkDepth',
      options.maxLinkDepth ?? defaultLimits.maxLinkDepth,
    ),
    maxSoftLinkTraversals: positiveSafeInteger(
      'HDF5 graph maxSoftLinkTraversals',
      options.maxSoftLinkTraversals ?? defaultLimits.maxSoftLinkTraversals,
    ),
    maxPathBytes: positiveSafeInteger(
      'HDF5 graph maxPathBytes',
      options.maxPathBytes ?? defaultLimits.maxPathBytes,
    ),
    maxMetadataBytes: positiveSafeInteger(
      'HDF5 graph maxMetadataBytes',
      options.maxMetadataBytes ?? defaultLimits.maxMetadataBytes,
    ),
  })

const pathBytes = (value: string): number => new TextEncoder().encode(value).byteLength

const parsePath = (value: string, maximumBytes: number, requireAbsolute: boolean): ParsedPath => {
  if (value.includes('\0')) throw invalidInput('HDF5 object path contains a NUL byte')
  const bytes = pathBytes(value)
  if (bytes > maximumBytes) {
    throw limitExceeded(`HDF5 object path requires ${bytes} bytes; limit is ${maximumBytes}`)
  }
  const absolute = value.startsWith('/')
  if (requireAbsolute && !absolute) throw invalidInput('HDF5 object path must be absolute')
  const components: string[] = []
  for (const component of value.split('/')) {
    if (component.length === 0 || component === '.') continue
    if (component === '..') {
      throw invalidInput("HDF5 object paths do not support '..' parent traversal")
    }
    components.push(component)
  }
  return Object.freeze({ absolute, components: Object.freeze(components) })
}

const absolutePath = (components: readonly string[]): string =>
  components.length === 0 ? '/' : `/${components.join('/')}`

class Hdf5ObjectGraphImplementation implements Hdf5ObjectGraph {
  readonly rootAddress: bigint
  readonly #file: Hdf5FileLayer
  readonly #limits: ResolvedGraphLimits
  readonly #objectHeaderLimits: Readonly<Hdf5ObjectHeaderLimits>
  readonly #legacyGroupLimits: Readonly<Hdf5LegacyGroupLimits>
  readonly #denseGroupLimits: Readonly<Hdf5DenseGroupLimits>
  readonly #headers = new Map<bigint, Hdf5ObjectHeader>()
  readonly #groupLinks = new Map<bigint, readonly Hdf5Link[]>()
  #metadataBytes = 0
  #links = 0

  constructor(file: Hdf5FileLayer, options: Readonly<Hdf5ObjectGraphOptions>) {
    this.#file = file
    this.rootAddress = file.superblock.rootObjectAddress
    this.#limits = resolveLimits(options)
    this.#objectHeaderLimits = Object.freeze({ ...(options.objectHeaderLimits ?? {}) })
    this.#legacyGroupLimits = Object.freeze({ ...(options.legacyGroupLimits ?? {}) })
    this.#denseGroupLimits = Object.freeze({ ...(options.denseGroupLimits ?? {}) })
    file.resolveAddress(this.rootAddress, 4n, 'HDF5 root object')
  }

  async get(
    path: string,
    options: Readonly<Hdf5ObjectGraphReadOptions> = {},
  ): Promise<Hdf5GraphObject | undefined> {
    throwIfAborted(options.signal)
    const parsed = parsePath(path, this.#limits.maxPathBytes, true)
    const requestedPath = absolutePath(parsed.components)
    let address = this.rootAddress
    let groupComponents: readonly string[] = Object.freeze([])
    let pending = parsed.components.slice()
    let traversedLinks = 0
    let softLinkTraversals = 0
    const visitedSoftStates = new Set<string>()

    while (pending.length > 0) {
      throwIfAborted(options.signal)
      const name = pending.shift()
      if (name === undefined) break
      traversedLinks += 1
      if (traversedLinks > this.#limits.maxLinkDepth) {
        throw limitExceeded(
          `HDF5 path ${JSON.stringify(requestedPath)} exceeds link depth ${this.#limits.maxLinkDepth}`,
        )
      }
      const links = await this.#linksFor(address, absolutePath(groupComponents), options.signal)
      const link = links.find((candidate) => candidate.name === name)
      if (link === undefined) return undefined
      if (link.kind === 'hard') {
        address = link.objectAddress
        groupComponents = Object.freeze([...groupComponents, name])
        continue
      }

      softLinkTraversals += 1
      if (softLinkTraversals > this.#limits.maxSoftLinkTraversals) {
        throw limitExceeded(
          `HDF5 path ${JSON.stringify(requestedPath)} exceeds ${this.#limits.maxSoftLinkTraversals} soft-link traversals`,
        )
      }
      if (link.target.length === 0) {
        throw invalidInput(
          `HDF5 soft link ${JSON.stringify(absolutePath([...groupComponents, name]))} has an empty target`,
        )
      }
      const target = parsePath(link.target, this.#limits.maxPathBytes, false)
      const targetComponents = target.absolute
        ? target.components
        : [...groupComponents, ...target.components]
      pending = [...targetComponents, ...pending]
      const expandedPath = absolutePath(pending)
      const expandedBytes = pathBytes(expandedPath)
      if (expandedBytes > this.#limits.maxPathBytes) {
        throw limitExceeded(
          `HDF5 soft-link expansion requires ${expandedBytes} path bytes; limit is ${this.#limits.maxPathBytes}`,
        )
      }
      const state = `${address}:${name}\0${expandedPath}`
      if (visitedSoftStates.has(state)) {
        throw invalidInput(`HDF5 path ${JSON.stringify(requestedPath)} contains a cyclic soft link`)
      }
      visitedSoftStates.add(state)
      address = this.rootAddress
      groupComponents = Object.freeze([])
    }

    const header = await this.#header(address, requestedPath, options.signal)
    return Object.freeze({ path: requestedPath, address, header })
  }

  async list(
    path: string,
    options: Readonly<Hdf5ObjectGraphReadOptions> = {},
  ): Promise<readonly Hdf5Link[] | undefined> {
    const object = await this.get(path, options)
    if (object === undefined) return undefined
    return this.#linksFor(object.address, object.path, options.signal)
  }

  stats(): Hdf5ObjectGraphStats {
    return Object.freeze({
      objects: this.#headers.size,
      groups: this.#groupLinks.size,
      links: this.#links,
      metadataBytes: this.#metadataBytes,
    })
  }

  async #header(
    address: bigint,
    path: string,
    signal: AbortSignal | undefined,
  ): Promise<Hdf5ObjectHeader> {
    const cached = this.#headers.get(address)
    if (cached !== undefined) return cached
    if (this.#headers.size >= this.#limits.maxObjects) {
      throw limitExceeded(`HDF5 object graph exceeds ${this.#limits.maxObjects} objects`)
    }
    const header = await readHdf5ObjectHeader(this.#file, address, {
      ...this.#objectHeaderLimits,
      objectPath: path,
      ...(signal === undefined ? {} : { signal }),
    })
    this.#admitMetadata(header.metadataBytes)
    this.#headers.set(address, header)
    return header
  }

  async #linksFor(
    address: bigint,
    path: string,
    signal: AbortSignal | undefined,
  ): Promise<readonly Hdf5Link[]> {
    const cached = this.#groupLinks.get(address)
    if (cached !== undefined) return cached
    const header = await this.#header(address, path, signal)
    let links: readonly Hdf5Link[]
    let metadataBytes = 0
    if (header.linkStorage?.kind === 'legacy') {
      if (header.links.length !== 0) {
        throw invalidInput(`HDF5 object ${JSON.stringify(path)} mixes compact and legacy links`)
      }
      const group = await readHdf5LegacyGroup(this.#file, header.linkStorage, {
        ...this.#legacyGroupLimits,
        objectPath: path,
        ...(signal === undefined ? {} : { signal }),
      })
      links = group.links
      metadataBytes = group.metadataBytes
    } else if (header.linkStorage?.kind === 'dense') {
      if (header.links.length !== 0) {
        throw invalidInput(`HDF5 object ${JSON.stringify(path)} mixes compact and dense links`)
      }
      const group = await readHdf5DenseGroup(this.#file, header.linkStorage, {
        ...this.#denseGroupLimits,
        objectPath: path,
        ...(signal === undefined ? {} : { signal }),
      })
      links = group.links
      metadataBytes = group.metadataBytes
    } else {
      links = header.links
    }
    if (metadataBytes > this.#limits.maxMetadataBytes - this.#metadataBytes) {
      throw limitExceeded(
        `HDF5 object graph exceeds ${this.#limits.maxMetadataBytes} metadata bytes`,
      )
    }
    if (links.length > this.#limits.maxLinks - this.#links) {
      throw limitExceeded(`HDF5 object graph exceeds ${this.#limits.maxLinks} links`)
    }
    this.#metadataBytes += metadataBytes
    this.#links += links.length
    this.#groupLinks.set(address, links)
    return links
  }

  #admitMetadata(bytes: number): void {
    if (bytes > this.#limits.maxMetadataBytes - this.#metadataBytes) {
      throw limitExceeded(
        `HDF5 object graph exceeds ${this.#limits.maxMetadataBytes} metadata bytes`,
      )
    }
    this.#metadataBytes += bytes
  }
}

export const openHdf5ObjectGraph = async (
  file: Hdf5FileLayer,
  options: Readonly<Hdf5ObjectGraphOptions> = {},
): Promise<Hdf5ObjectGraph> => {
  throwIfAborted(options.signal)
  const graph = new Hdf5ObjectGraphImplementation(file, options)
  await graph.get('/', options)
  return graph
}
