import { throwIfAborted } from '../abort.ts'
import type { AbortOptions } from '../abort.ts'
import { crc32 } from '../codecs/crc32.ts'
import { invalidInput, limitExceeded, truncatedInput, unsupportedOperation } from '../errors.ts'
import type { ImageSource, ImageSourceReadOptions } from '../source.ts'
import { readExactly } from '../source.ts'

const eocdSignature = 0x06054b50
const zip64EocdSignature = 0x06064b50
const zip64LocatorSignature = 0x07064b50
const centralSignature = 0x02014b50
const localSignature = 0x04034b50

export interface ZipLimits {
  readonly maxEntries?: number
  readonly maxCentralDirectoryBytes?: number
  readonly maxMemberBytes?: number
  readonly maxTotalDecodedBytes?: number
  readonly maxDecompressionRatio?: number
}

interface ResolvedZipLimits {
  readonly maxEntries: number
  readonly maxCentralDirectoryBytes: number
  readonly maxMemberBytes: number
  readonly maxTotalDecodedBytes: number
  readonly maxDecompressionRatio: number
}

export interface ZipEntry {
  readonly path: string
  readonly compressedBytes: number
  readonly uncompressedBytes: number
  readonly compression: 'stored' | 'deflate'
  readonly crc32: number
}

interface IndexedZipEntry extends ZipEntry {
  readonly localHeaderOffset: number
}

export interface ZipArchive {
  readonly entries: readonly ZipEntry[]
  get(path: string): ZipEntry | undefined
  openStored(path: string, options?: Readonly<AbortOptions>): Promise<ImageSource>
  read(path: string, options?: Readonly<AbortOptions>): Promise<Uint8Array<ArrayBuffer>>
}

const positiveInteger = (label: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) throw invalidInput(`${label} must be positive`)
  return value
}

const resolveLimits = (limits: Readonly<ZipLimits>): ResolvedZipLimits =>
  Object.freeze({
    maxEntries: positiveInteger('ZIP maxEntries', limits.maxEntries ?? 16_384),
    maxCentralDirectoryBytes: positiveInteger(
      'ZIP maxCentralDirectoryBytes',
      limits.maxCentralDirectoryBytes ?? 16_777_216,
    ),
    maxMemberBytes: positiveInteger('ZIP maxMemberBytes', limits.maxMemberBytes ?? 536_870_912),
    maxTotalDecodedBytes: positiveInteger(
      'ZIP maxTotalDecodedBytes',
      limits.maxTotalDecodedBytes ?? 1_073_741_824,
    ),
    maxDecompressionRatio: positiveInteger(
      'ZIP maxDecompressionRatio',
      limits.maxDecompressionRatio ?? 1_000,
    ),
  })

const uint16 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)

const uint32 = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)) >>>
  0

const uint64 = (bytes: Uint8Array, offset: number, label: string): number => {
  let value = 0n
  for (let index = 7; index >= 0; index -= 1)
    value = (value << 8n) | BigInt(bytes[offset + index] ?? 0)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw limitExceeded(`${label} exceeds safe integers`)
  return Number(value)
}

const safeRange = (offset: number, length: number, size: number, label: string): void => {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
    throw invalidInput(`${label} range is invalid`)
  }
  if (offset > size || length > size - offset) throw truncatedInput(`${label} is truncated`)
}

const decodeName = (bytes: Uint8Array, utf8: boolean): string => {
  if (!utf8 && bytes.some((byte) => byte > 0x7f)) {
    throw unsupportedOperation('ZIP legacy non-ASCII member names are unsupported')
  }
  try {
    return new TextDecoder(utf8 ? 'utf-8' : 'ascii', { fatal: true }).decode(bytes)
  } catch {
    throw invalidInput('ZIP member name is not valid text')
  }
}

export const normalizeZipPath = (path: string): string => {
  if (path.includes('\0') || path.includes('\\')) throw invalidInput('ZIP member path is unsafe')
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path))
    throw invalidInput('ZIP member path is absolute')
  const directory = path.endsWith('/')
  const parts = path
    .split('/')
    .filter((_part, index, all) => !(directory && index === all.length - 1))
  if (
    parts.length === 0 ||
    parts.some((part) => part.length === 0 || part === '.' || part === '..')
  ) {
    throw invalidInput('ZIP member path is not normalized')
  }
  return `${parts.join('/')}${directory ? '/' : ''}`
}

const findExtra = (extra: Uint8Array, id: number): Uint8Array | undefined => {
  let offset = 0
  while (offset < extra.byteLength) {
    if (offset + 4 > extra.byteLength) throw invalidInput('ZIP extra field is truncated')
    const fieldId = uint16(extra, offset)
    const length = uint16(extra, offset + 2)
    offset += 4
    if (offset + length > extra.byteLength)
      throw invalidInput('ZIP extra field payload is truncated')
    if (fieldId === id) return extra.subarray(offset, offset + length)
    offset += length
  }
  return undefined
}

interface DirectoryLocation {
  readonly entries: number
  readonly offset: number
  readonly size: number
}

const locateDirectory = async (
  source: ImageSource,
  signal?: AbortSignal,
): Promise<DirectoryLocation> => {
  const options = signal === undefined ? {} : { signal }
  const tailLength = Math.min(source.size, 65_557)
  const tailOffset = source.size - tailLength
  const tail = await readExactly(source, tailOffset, tailLength, options)
  let relative = -1
  for (let index = tail.byteLength - 22; index >= 0; index -= 1) {
    if (uint32(tail, index) !== eocdSignature) continue
    const commentLength = uint16(tail, index + 20)
    if (index + 22 + commentLength === tail.byteLength) {
      relative = index
      break
    }
  }
  if (relative < 0) throw invalidInput('ZIP end-of-central-directory record is missing')
  if (uint16(tail, relative + 4) !== 0 || uint16(tail, relative + 6) !== 0) {
    throw unsupportedOperation('Multi-disk ZIP archives are unsupported')
  }
  const entries = uint16(tail, relative + 10)
  const size = uint32(tail, relative + 12)
  const offset = uint32(tail, relative + 16)
  if (entries !== 0xffff && size !== 0xffffffff && offset !== 0xffffffff) {
    return { entries, size, offset }
  }
  const eocdOffset = tailOffset + relative
  if (eocdOffset < 20) throw truncatedInput('ZIP64 locator is missing')
  const locator = await readExactly(source, eocdOffset - 20, 20, options)
  if (uint32(locator, 0) !== zip64LocatorSignature) throw invalidInput('ZIP64 locator is missing')
  if (uint32(locator, 4) !== 0 || uint32(locator, 16) !== 1) {
    throw unsupportedOperation('Multi-disk ZIP64 archives are unsupported')
  }
  const recordOffset = uint64(locator, 8, 'ZIP64 record offset')
  const record = await readExactly(source, recordOffset, 56, options)
  if (uint32(record, 0) !== zip64EocdSignature) throw invalidInput('ZIP64 record is missing')
  if (uint32(record, 16) !== 0 || uint32(record, 20) !== 0) {
    throw unsupportedOperation('Multi-disk ZIP64 archives are unsupported')
  }
  return {
    entries: uint64(record, 32, 'ZIP64 entry count'),
    size: uint64(record, 40, 'ZIP64 central-directory size'),
    offset: uint64(record, 48, 'ZIP64 central-directory offset'),
  }
}

const zip64Values = (
  extra: Uint8Array,
  compressed: number,
  uncompressed: number,
  localOffset: number,
): { readonly compressed: number; readonly uncompressed: number; readonly localOffset: number } => {
  if (compressed !== 0xffffffff && uncompressed !== 0xffffffff && localOffset !== 0xffffffff) {
    return { compressed, uncompressed, localOffset }
  }
  const field = findExtra(extra, 0x0001)
  if (field === undefined) throw invalidInput('ZIP64 member is missing its ZIP64 extra field')
  let offset = 0
  const take = (needed: boolean, label: string, fallback: number): number => {
    if (!needed) return fallback
    if (offset + 8 > field.byteLength) throw invalidInput(`ZIP64 ${label} is truncated`)
    const value = uint64(field, offset, `ZIP64 ${label}`)
    offset += 8
    return value
  }
  return {
    uncompressed: take(uncompressed === 0xffffffff, 'uncompressed size', uncompressed),
    compressed: take(compressed === 0xffffffff, 'compressed size', compressed),
    localOffset: take(localOffset === 0xffffffff, 'local-header offset', localOffset),
  }
}

const inflateRaw = async (
  input: Uint8Array,
  maximum: number,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> => {
  throwIfAborted(signal)
  if (typeof DecompressionStream !== 'function') {
    throw unsupportedOperation('Deflate ZIP members require DecompressionStream')
  }
  const stream = new Blob([Uint8Array.from(input)])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    if (signal?.aborted === true) {
      await reader.cancel(signal.reason)
      throwIfAborted(signal)
    }
    const result = await reader.read()
    if (result.done) break
    total += result.value.byteLength
    if (total > maximum) {
      await reader.cancel()
      throw limitExceeded(`ZIP decoded member exceeds ${maximum} bytes`)
    }
    chunks.push(result.value)
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

class StoredEntrySource implements ImageSource {
  readonly size: number
  readonly #source: ImageSource
  readonly #offset: number

  constructor(source: ImageSource, offset: number, size: number) {
    this.#source = source
    this.#offset = offset
    this.size = size
  }

  read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    throwIfAborted(options.signal)
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0
    ) {
      throw invalidInput('ZIP member source range is invalid')
    }
    const available = offset >= this.size ? 0 : Math.min(length, this.size - offset)
    return this.#source.read(this.#offset + offset, available, options)
  }
}

class ZipArchiveImplementation implements ZipArchive {
  readonly entries: readonly ZipEntry[]
  readonly #source: ImageSource
  readonly #byPath: ReadonlyMap<string, IndexedZipEntry>
  readonly #limits: ResolvedZipLimits
  readonly #directoryOffset: number

  constructor(
    source: ImageSource,
    entries: readonly IndexedZipEntry[],
    limits: ResolvedZipLimits,
    directoryOffset: number,
  ) {
    this.#source = source
    this.#limits = limits
    this.#directoryOffset = directoryOffset
    this.#byPath = new Map(entries.map((entry) => [entry.path, entry]))
    this.entries = Object.freeze(
      entries.map(({ localHeaderOffset: _ignored, ...entry }) => Object.freeze(entry)),
    )
  }

  get(path: string): ZipEntry | undefined {
    const entry = this.#byPath.get(path)
    if (entry === undefined) return undefined
    const { localHeaderOffset: _ignored, ...published } = entry
    return Object.freeze(published)
  }

  async #dataOffset(entry: IndexedZipEntry, options: Readonly<AbortOptions>): Promise<number> {
    throwIfAborted(options.signal)
    safeRange(entry.localHeaderOffset, 30, this.#directoryOffset, `ZIP local header ${entry.path}`)
    const readOptions = options.signal === undefined ? {} : { signal: options.signal }
    const header = await readExactly(this.#source, entry.localHeaderOffset, 30, readOptions)
    if (uint32(header, 0) !== localSignature)
      throw invalidInput(`ZIP local header for ${entry.path} is missing`)
    const flags = uint16(header, 6)
    if ((flags & 1) !== 0) throw unsupportedOperation('Encrypted ZIP members are unsupported')
    const method = uint16(header, 8)
    if (method !== (entry.compression === 'stored' ? 0 : 8)) {
      throw invalidInput(`ZIP local and central compression methods disagree for ${entry.path}`)
    }
    const nameLength = uint16(header, 26)
    const extraLength = uint16(header, 28)
    const nameBytes = await readExactly(
      this.#source,
      entry.localHeaderOffset + 30,
      nameLength,
      readOptions,
    )
    const localPath = normalizeZipPath(decodeName(nameBytes, (flags & 0x0800) !== 0))
    if (localPath !== entry.path)
      throw invalidInput(`ZIP local and central names disagree for ${entry.path}`)
    const offset = entry.localHeaderOffset + 30 + nameLength + extraLength
    safeRange(offset, entry.compressedBytes, this.#directoryOffset, `ZIP member ${entry.path}`)
    return offset
  }

  async openStored(path: string, options: Readonly<AbortOptions> = {}): Promise<ImageSource> {
    const entry = this.#byPath.get(path)
    if (entry === undefined) throw invalidInput(`ZIP member ${path} does not exist`)
    if (entry.compression !== 'stored')
      throw unsupportedOperation(`ZIP member ${path} is compressed`)
    return new StoredEntrySource(
      this.#source,
      await this.#dataOffset(entry, options),
      entry.uncompressedBytes,
    )
  }

  async read(path: string, options: Readonly<AbortOptions> = {}): Promise<Uint8Array<ArrayBuffer>> {
    const entry = this.#byPath.get(path)
    if (entry === undefined) throw invalidInput(`ZIP member ${path} does not exist`)
    const offset = await this.#dataOffset(entry, options)
    const compressed = await readExactly(
      this.#source,
      offset,
      entry.compressedBytes,
      options.signal === undefined ? {} : { signal: options.signal },
    )
    const decoded =
      entry.compression === 'stored'
        ? Uint8Array.from(compressed)
        : await inflateRaw(
            compressed,
            Math.min(entry.uncompressedBytes, this.#limits.maxMemberBytes),
            options.signal,
          )
    if (decoded.byteLength !== entry.uncompressedBytes)
      throw invalidInput(`ZIP member ${path} decoded to an unexpected size`)
    if (crc32(decoded) !== entry.crc32)
      throw invalidInput(`ZIP member ${path} failed CRC-32 verification`)
    return decoded
  }
}

/** Open a bounded, range-aware ZIP or ZIP64 archive without eagerly reading members. */
export const openZipArchive = async (
  source: ImageSource,
  options: Readonly<ZipLimits> = {},
  signal?: AbortSignal,
): Promise<ZipArchive> => {
  throwIfAborted(signal)
  const limits = resolveLimits(options)
  const directory = await locateDirectory(source, signal)
  if (directory.entries > limits.maxEntries)
    throw limitExceeded(`ZIP contains more than ${limits.maxEntries} entries`)
  if (directory.size > limits.maxCentralDirectoryBytes) {
    throw limitExceeded(`ZIP central directory exceeds ${limits.maxCentralDirectoryBytes} bytes`)
  }
  safeRange(directory.offset, directory.size, source.size, 'ZIP central directory')
  const bytes = await readExactly(
    source,
    directory.offset,
    directory.size,
    signal === undefined ? {} : { signal },
  )
  const entries: IndexedZipEntry[] = []
  const paths = new Set<string>()
  let totalDecoded = 0n
  let cursor = 0
  for (let index = 0; index < directory.entries; index += 1) {
    if (cursor + 46 > bytes.byteLength || uint32(bytes, cursor) !== centralSignature) {
      throw invalidInput('ZIP central-directory entry is missing or truncated')
    }
    const flags = uint16(bytes, cursor + 8)
    if ((flags & 1) !== 0) throw unsupportedOperation('Encrypted ZIP members are unsupported')
    const method = uint16(bytes, cursor + 10)
    if (method !== 0 && method !== 8)
      throw unsupportedOperation(`ZIP compression method ${method} is unsupported`)
    const nameLength = uint16(bytes, cursor + 28)
    const extraLength = uint16(bytes, cursor + 30)
    const commentLength = uint16(bytes, cursor + 32)
    const end = cursor + 46 + nameLength + extraLength + commentLength
    if (end > bytes.byteLength) throw truncatedInput('ZIP central-directory entry is truncated')
    const path = normalizeZipPath(
      decodeName(bytes.subarray(cursor + 46, cursor + 46 + nameLength), (flags & 0x0800) !== 0),
    )
    if (paths.has(path)) throw invalidInput(`ZIP contains duplicate member ${path}`)
    paths.add(path)
    const sizes = zip64Values(
      bytes.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength),
      uint32(bytes, cursor + 20),
      uint32(bytes, cursor + 24),
      uint32(bytes, cursor + 42),
    )
    if (method === 0 && sizes.compressed !== sizes.uncompressed) {
      throw invalidInput(`Stored ZIP member ${path} has inconsistent sizes`)
    }
    if (sizes.uncompressed > limits.maxMemberBytes)
      throw limitExceeded(`ZIP member ${path} exceeds maxMemberBytes`)
    if (
      sizes.compressed === 0
        ? sizes.uncompressed > 0
        : BigInt(sizes.uncompressed) >
          BigInt(sizes.compressed) * BigInt(limits.maxDecompressionRatio)
    ) {
      throw limitExceeded(`ZIP member ${path} exceeds maxDecompressionRatio`)
    }
    totalDecoded += BigInt(sizes.uncompressed)
    if (totalDecoded > BigInt(limits.maxTotalDecodedBytes))
      throw limitExceeded('ZIP total decoded size exceeds maxTotalDecodedBytes')
    entries.push(
      Object.freeze({
        path,
        compressedBytes: sizes.compressed,
        uncompressedBytes: sizes.uncompressed,
        compression: method === 0 ? 'stored' : 'deflate',
        crc32: uint32(bytes, cursor + 16),
        localHeaderOffset: sizes.localOffset,
      }),
    )
    cursor = end
  }
  if (cursor !== bytes.byteLength) throw invalidInput('ZIP central directory has trailing data')
  return new ZipArchiveImplementation(source, Object.freeze(entries), limits, directory.offset)
}
