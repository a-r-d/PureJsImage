import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import {
  invalidInput,
  limitExceeded,
  truncatedInput,
  unsupportedFormat,
  unsupportedOperation,
} from '../../errors.ts'
import type { ImageSource, ImageSourceReadOptions } from '../../source.ts'
import type { SourceIdentity } from '../../source-identity.ts'
import { getImageSourceIdentity } from '../../source-identity.ts'

export type Hdf5SuperblockVersion = 0 | 1 | 2 | 3
export type Hdf5IntegerWidth = 2 | 4 | 8 | 16

interface Hdf5SuperblockBase {
  readonly version: Hdf5SuperblockVersion
  readonly signatureOffset: bigint
  readonly byteLength: number
  readonly offsetSize: Hdf5IntegerWidth
  readonly lengthSize: Hdf5IntegerWidth
  readonly fileConsistencyFlags: number
  readonly storedBaseAddress: bigint
  readonly baseAddress: bigint
  readonly addressAdjustment: bigint
  readonly storedEndOfFileAddress: bigint
  readonly endOfFileAddress: bigint
  readonly rootObjectAddress: bigint
  readonly rootObjectOffset: bigint
}

export interface Hdf5LegacySuperblock extends Hdf5SuperblockBase {
  readonly version: 0 | 1
  readonly freeSpaceAddress: bigint | undefined
  readonly driverInformationAddress: bigint | undefined
}

export interface Hdf5ModernSuperblock extends Hdf5SuperblockBase {
  readonly version: 2 | 3
  readonly superblockExtensionAddress: bigint | undefined
  readonly checksum: number
}

export type Hdf5Superblock = Hdf5LegacySuperblock | Hdf5ModernSuperblock

export interface Hdf5MetadataPageCacheOptions {
  readonly pageBytes?: number
  readonly maxBytes?: number
  readonly maxReadBytes?: number
}

interface ResolvedCacheOptions {
  readonly pageBytes: number
  readonly maxBytes: number
  readonly maxReadBytes: number
}

export interface Hdf5FileLayerOptions extends AbortOptions, Hdf5MetadataPageCacheOptions {}

const hdf5Signature = Uint8Array.of(0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a)
const defaultCacheOptions: ResolvedCacheOptions = Object.freeze({
  pageBytes: 4_096,
  maxBytes: 1_048_576,
  maxReadBytes: 1_048_576,
})
const validIntegerWidths: ReadonlySet<number> = new Set([2, 4, 8, 16])

const positiveSafeInteger = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
  return value
}

const resolveCacheOptions = (
  options: Readonly<Hdf5MetadataPageCacheOptions>,
): ResolvedCacheOptions => {
  const pageBytes = positiveSafeInteger(
    'HDF5 metadata pageBytes',
    options.pageBytes ?? defaultCacheOptions.pageBytes,
  )
  const maxBytes = positiveSafeInteger(
    'HDF5 metadata maxBytes',
    options.maxBytes ?? defaultCacheOptions.maxBytes,
  )
  const maxReadBytes = positiveSafeInteger(
    'HDF5 metadata maxReadBytes',
    options.maxReadBytes ?? defaultCacheOptions.maxReadBytes,
  )
  if (pageBytes > maxBytes) {
    throw invalidInput('HDF5 metadata pageBytes cannot exceed maxBytes')
  }
  return Object.freeze({ pageBytes, maxBytes, maxReadBytes })
}

const sourceIdentitiesEqual = (left: SourceIdentity, right: SourceIdentity): boolean => {
  if (left.kind !== right.kind || left.size !== right.size) return false
  if (left.kind === 'content' && right.kind === 'content') {
    return left.algorithm === right.algorithm && left.digest === right.digest
  }
  if (left.kind === 'remote' && right.kind === 'remote') {
    return (
      left.url === right.url &&
      left.strength === right.strength &&
      left.stability === right.stability &&
      left.validator?.kind === right.validator?.kind &&
      left.validator?.value === right.validator?.value
    )
  }
  if (left.kind === 'local-file' && right.kind === 'local-file') {
    return left.nameOrPath === right.nameOrPath && left.lastModified === right.lastModified
  }
  return left.kind === 'session' && right.kind === 'session' && left.id === right.id
}

interface MetadataPage {
  readonly start: number
  readonly data: Uint8Array<ArrayBuffer>
}

export class Hdf5MetadataPageCache {
  readonly sourceIdentity: SourceIdentity
  readonly pageBytes: number
  readonly maxBytes: number
  readonly maxReadBytes: number
  readonly #source: ImageSource
  readonly #pages = new Map<number, MetadataPage>()
  readonly #pendingPages = new Map<number, Promise<MetadataPage>>()
  #sourceReadTail: Promise<void> = Promise.resolve()
  #residentBytes = 0
  #sourceReadCount = 0
  #sourceBytesRead = 0

  private constructor(
    source: ImageSource,
    identity: SourceIdentity,
    options: ResolvedCacheOptions,
  ) {
    this.#source = source
    this.sourceIdentity = identity
    this.pageBytes = options.pageBytes
    this.maxBytes = options.maxBytes
    this.maxReadBytes = options.maxReadBytes
  }

  static async create(
    source: ImageSource,
    options: Readonly<Hdf5MetadataPageCacheOptions & AbortOptions> = {},
  ): Promise<Hdf5MetadataPageCache> {
    validateSourceSize(source)
    throwIfAborted(options.signal)
    const identity = await getImageSourceIdentity(source)
    throwIfAborted(options.signal)
    return new Hdf5MetadataPageCache(source, identity, resolveCacheOptions(options))
  }

  get residentBytes(): number {
    return this.#residentBytes
  }

  get entryCount(): number {
    return this.#pages.size
  }

  get sourceReadCount(): number {
    return this.#sourceReadCount
  }

  get sourceBytesRead(): number {
    return this.#sourceBytesRead
  }

  clear(): void {
    this.#pages.clear()
    this.#residentBytes = 0
  }

  async #assertSourceIdentity(options: Readonly<ImageSourceReadOptions>): Promise<void> {
    throwIfAborted(options.signal)
    const identity = await getImageSourceIdentity(this.#source)
    throwIfAborted(options.signal)
    if (!sourceIdentitiesEqual(identity, this.sourceIdentity)) {
      this.clear()
      throw invalidInput('HDF5 metadata source identity changed while the cache was active')
    }
  }

  #touch(page: MetadataPage): MetadataPage {
    this.#pages.delete(page.start)
    this.#pages.set(page.start, page)
    return page
  }

  #store(page: MetadataPage): MetadataPage {
    while (this.#residentBytes + page.data.byteLength > this.maxBytes) {
      const oldest = this.#pages.entries().next().value
      if (oldest === undefined) break
      const [start, entry] = oldest
      this.#pages.delete(start)
      this.#residentBytes -= entry.data.byteLength
    }
    this.#pages.set(page.start, page)
    this.#residentBytes += page.data.byteLength
    return page
  }

  async #readPageFromSource(
    start: number,
    length: number,
    options: Readonly<ImageSourceReadOptions>,
  ): Promise<MetadataPage> {
    let releaseRead: (() => void) | undefined
    const previousRead = this.#sourceReadTail
    this.#sourceReadTail = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    await previousRead
    try {
      throwIfAborted(options.signal)
      const sourceBytes = await this.#source.read(start, length, options)
      throwIfAborted(options.signal)
      if (sourceBytes.byteLength !== length) {
        throw truncatedInput(
          `Expected ${length} HDF5 metadata bytes at offset ${start}, received ${sourceBytes.byteLength}`,
        )
      }
      const data = Uint8Array.from(sourceBytes)
      this.#sourceReadCount += 1
      this.#sourceBytesRead += data.byteLength
      return { start, data }
    } finally {
      releaseRead?.()
    }
  }

  async #page(start: number, options: Readonly<ImageSourceReadOptions>): Promise<MetadataPage> {
    const cached = this.#pages.get(start)
    if (cached !== undefined) return this.#touch(cached)
    const pending = this.#pendingPages.get(start)
    if (pending !== undefined) return pending

    const length = Math.min(this.pageBytes, this.#source.size - start)
    const load = this.#readPageFromSource(start, length, options).then((page) => this.#store(page))
    this.#pendingPages.set(start, load)
    try {
      return await load
    } finally {
      this.#pendingPages.delete(start)
    }
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array<ArrayBuffer>> {
    throwIfAborted(options.signal)
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw invalidInput('HDF5 metadata read offset must be a non-negative safe integer')
    }
    if (!Number.isSafeInteger(length) || length < 0) {
      throw invalidInput('HDF5 metadata read length must be a non-negative safe integer')
    }
    if (length > this.maxReadBytes) {
      throw limitExceeded(
        `HDF5 metadata read of ${length} bytes exceeds maxReadBytes ${this.maxReadBytes}`,
      )
    }
    if (offset > this.#source.size || length > this.#source.size - offset) {
      throw truncatedInput(`HDF5 metadata read exceeds the input at offset ${offset}`)
    }
    if (length === 0) return new Uint8Array()

    await this.#assertSourceIdentity(options)
    const output = new Uint8Array(length)
    const end = offset + length
    let position = offset
    while (position < end) {
      throwIfAborted(options.signal)
      const pageStart = Math.floor(position / this.pageBytes) * this.pageBytes
      const page = await this.#page(pageStart, options)
      throwIfAborted(options.signal)
      const pageOffset = position - pageStart
      const amount = Math.min(end - position, page.data.byteLength - pageOffset)
      if (amount <= 0) throw truncatedInput(`HDF5 metadata page ended at offset ${position}`)
      output.set(page.data.subarray(pageOffset, pageOffset + amount), position - offset)
      position += amount
    }
    return output
  }
}

export interface Hdf5FileLayer {
  readonly sourceIdentity: SourceIdentity
  readonly superblock: Hdf5Superblock
  readonly metadataCache: Hdf5MetadataPageCache
  resolveAddress(address: bigint, length?: bigint, label?: string): number
  readMetadata(
    address: bigint,
    length: number,
    options?: Readonly<ImageSourceReadOptions>,
  ): Promise<Uint8Array<ArrayBuffer>>
  close(): void
}

class Hdf5FileLayerImplementation implements Hdf5FileLayer {
  readonly sourceIdentity: SourceIdentity
  readonly superblock: Hdf5Superblock
  readonly metadataCache: Hdf5MetadataPageCache
  readonly #sourceSize: number
  #closed = false

  constructor(sourceSize: number, cache: Hdf5MetadataPageCache, superblock: Hdf5Superblock) {
    this.#sourceSize = sourceSize
    this.metadataCache = cache
    this.sourceIdentity = cache.sourceIdentity
    this.superblock = superblock
  }

  resolveAddress(address: bigint, length = 0n, label = 'address'): number {
    this.#assertOpen()
    return resolveRelativeAddress(this.superblock, this.#sourceSize, address, length, label)
  }

  async readMetadata(
    address: bigint,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array<ArrayBuffer>> {
    this.#assertOpen()
    if (!Number.isSafeInteger(length) || length < 0) {
      throw invalidInput('HDF5 metadata read length must be a non-negative safe integer')
    }
    const offset = this.resolveAddress(address, BigInt(length), 'metadata address')
    return this.metadataCache.read(offset, length, options)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.metadataCache.clear()
  }

  #assertOpen(): void {
    if (this.#closed) throw invalidInput('HDF5 file layer is closed')
  }
}

const validateSourceSize = (source: ImageSource): void => {
  if (!Number.isSafeInteger(source.size) || source.size < 0) {
    throw invalidInput('HDF5 source size must be a non-negative safe integer')
  }
}

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

const locateSignature = async (
  cache: Hdf5MetadataPageCache,
  options: Readonly<ImageSourceReadOptions>,
): Promise<bigint> => {
  const sourceSize = BigInt(cache.sourceIdentity.size)
  let offset = 0n
  while (offset + BigInt(hdf5Signature.byteLength) <= sourceSize) {
    const bytes = await cache.read(Number(offset), hdf5Signature.byteLength, options)
    if (bytesEqual(bytes, hdf5Signature)) return offset
    offset = offset === 0n ? 512n : offset * 2n
  }
  throw unsupportedFormat('HDF5 signature was not found at a legal user-block offset')
}

const integerWidth = (value: number, field: string): Hdf5IntegerWidth => {
  if (!validIntegerWidths.has(value)) {
    throw unsupportedOperation(
      `HDF5 ${field} width ${value} is unsupported; expected 2, 4, 8, or 16 bytes`,
    )
  }
  if (value === 2 || value === 4 || value === 8 || value === 16) return value
  throw invalidInput(`HDF5 ${field} width is invalid`)
}

const littleEndianUnsigned = (bytes: Uint8Array, offset: number, width: number): bigint => {
  let value = 0n
  for (let index = width - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[offset + index] ?? 0)
  }
  return value
}

const optionalAddress = (bytes: Uint8Array, offset: number, width: number): bigint | undefined => {
  const value = littleEndianUnsigned(bytes, offset, width)
  const undefinedValue = (1n << BigInt(width * 8)) - 1n
  return value === undefinedValue ? undefined : value
}

const littleEndianUint16 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)

const littleEndianUint32 = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)) >>>
  0

const rotateLeft = (value: number, bits: number): number =>
  ((value << bits) | (value >>> (32 - bits))) >>> 0

const add32 = (left: number, right: number): number => (left + right) >>> 0
const subtract32 = (left: number, right: number): number => (left - right) >>> 0

const lookup3Mix = (
  initialA: number,
  initialB: number,
  initialC: number,
): readonly [number, number, number] => {
  let a = initialA
  let b = initialB
  let c = initialC
  a = subtract32(a, c)
  a = (a ^ rotateLeft(c, 4)) >>> 0
  c = add32(c, b)
  b = subtract32(b, a)
  b = (b ^ rotateLeft(a, 6)) >>> 0
  a = add32(a, c)
  c = subtract32(c, b)
  c = (c ^ rotateLeft(b, 8)) >>> 0
  b = add32(b, a)
  a = subtract32(a, c)
  a = (a ^ rotateLeft(c, 16)) >>> 0
  c = add32(c, b)
  b = subtract32(b, a)
  b = (b ^ rotateLeft(a, 19)) >>> 0
  a = add32(a, c)
  c = subtract32(c, b)
  c = (c ^ rotateLeft(b, 4)) >>> 0
  b = add32(b, a)
  return [a, b, c]
}

const lookup3Final = (
  initialA: number,
  initialB: number,
  initialC: number,
): readonly [number, number, number] => {
  let a = initialA
  let b = initialB
  let c = initialC
  c = (c ^ b) >>> 0
  c = subtract32(c, rotateLeft(b, 14))
  a = (a ^ c) >>> 0
  a = subtract32(a, rotateLeft(c, 11))
  b = (b ^ a) >>> 0
  b = subtract32(b, rotateLeft(a, 25))
  c = (c ^ b) >>> 0
  c = subtract32(c, rotateLeft(b, 16))
  a = (a ^ c) >>> 0
  a = subtract32(a, rotateLeft(c, 4))
  b = (b ^ a) >>> 0
  b = subtract32(b, rotateLeft(a, 14))
  c = (c ^ b) >>> 0
  c = subtract32(c, rotateLeft(b, 24))
  return [a, b, c]
}

export const hdf5MetadataChecksum = (bytes: Uint8Array, initValue = 0): number => {
  if (!Number.isSafeInteger(initValue) || initValue < 0 || initValue > 0xffff_ffff) {
    throw invalidInput('HDF5 checksum initial value must be a uint32')
  }
  let a = (0xdead_beef + bytes.byteLength + initValue) >>> 0
  let b = a
  let c = a
  let offset = 0
  let remaining = bytes.byteLength

  while (remaining > 12) {
    a = add32(a, littleEndianUint32(bytes, offset))
    b = add32(b, littleEndianUint32(bytes, offset + 4))
    c = add32(c, littleEndianUint32(bytes, offset + 8))
    ;[a, b, c] = lookup3Mix(a, b, c)
    offset += 12
    remaining -= 12
  }

  if (remaining === 0) return c
  if (remaining >= 12) c = add32(c, (bytes[offset + 11] ?? 0) << 24)
  if (remaining >= 11) c = add32(c, (bytes[offset + 10] ?? 0) << 16)
  if (remaining >= 10) c = add32(c, (bytes[offset + 9] ?? 0) << 8)
  if (remaining >= 9) c = add32(c, bytes[offset + 8] ?? 0)
  if (remaining >= 8) b = add32(b, (bytes[offset + 7] ?? 0) << 24)
  if (remaining >= 7) b = add32(b, (bytes[offset + 6] ?? 0) << 16)
  if (remaining >= 6) b = add32(b, (bytes[offset + 5] ?? 0) << 8)
  if (remaining >= 5) b = add32(b, bytes[offset + 4] ?? 0)
  if (remaining >= 4) a = add32(a, (bytes[offset + 3] ?? 0) << 24)
  if (remaining >= 3) a = add32(a, (bytes[offset + 2] ?? 0) << 16)
  if (remaining >= 2) a = add32(a, (bytes[offset + 1] ?? 0) << 8)
  a = add32(a, bytes[offset] ?? 0)
  ;[a, b, c] = lookup3Final(a, b, c)
  return c
}

interface AddressContext {
  readonly storedBaseAddress: bigint
  readonly baseAddress: bigint
  readonly addressAdjustment: bigint
  readonly storedEndOfFileAddress: bigint
  readonly endOfFileAddress: bigint
}

const resolveAddressContext = (
  signatureOffset: bigint,
  byteLength: number,
  storedBaseAddress: bigint | undefined,
  storedEndOfFileAddress: bigint | undefined,
  sourceSize: number,
): AddressContext => {
  if (storedBaseAddress === undefined) throw invalidInput('HDF5 base address is undefined')
  if (storedEndOfFileAddress === undefined) {
    throw invalidInput('HDF5 end-of-file address is undefined')
  }
  const addressAdjustment = signatureOffset - storedBaseAddress
  const endOfFileAddress = storedEndOfFileAddress + addressAdjustment
  const superblockEnd = signatureOffset + BigInt(byteLength)
  if (endOfFileAddress < superblockEnd) {
    throw invalidInput('HDF5 end-of-file address precedes the end of the superblock')
  }
  if (endOfFileAddress > BigInt(sourceSize)) {
    throw truncatedInput(
      `HDF5 declares ${endOfFileAddress} bytes, but the source contains ${sourceSize}`,
    )
  }
  return Object.freeze({
    storedBaseAddress,
    baseAddress: signatureOffset,
    addressAdjustment,
    storedEndOfFileAddress,
    endOfFileAddress,
  })
}

const resolveRelativeAddress = (
  superblock: Pick<Hdf5SuperblockBase, 'baseAddress' | 'endOfFileAddress'>,
  sourceSize: number,
  address: bigint,
  length: bigint,
  label: string,
): number => {
  if (address < 0n || length < 0n) throw invalidInput(`HDF5 ${label} is negative`)
  const absolute = superblock.baseAddress + address
  const end = absolute + length
  if (
    absolute > superblock.endOfFileAddress ||
    end > superblock.endOfFileAddress ||
    (length > 0n && absolute === superblock.endOfFileAddress)
  ) {
    throw invalidInput(`HDF5 ${label} exceeds the declared end-of-file address`)
  }
  if (end > BigInt(sourceSize)) {
    throw truncatedInput(`HDF5 ${label} exceeds the available source bytes`)
  }
  if (absolute > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw limitExceeded(`HDF5 ${label} exceeds the safe ImageSource address range`)
  }
  return Number(absolute)
}

const validateLegacyPrefix = (bytes: Uint8Array, version: 0 | 1): void => {
  if (bytes[9] !== 0)
    throw unsupportedOperation(`HDF5 free-space version ${bytes[9]} is unsupported`)
  if (bytes[10] !== 0) {
    throw unsupportedOperation(`HDF5 root symbol-table version ${bytes[10]} is unsupported`)
  }
  if (bytes[12] !== 0) {
    throw unsupportedOperation(`HDF5 shared-header version ${bytes[12]} is unsupported`)
  }
  if (
    bytes[11] !== 0 ||
    bytes[15] !== 0 ||
    (version === 1 && littleEndianUint16(bytes, 26) !== 0)
  ) {
    throw invalidInput('HDF5 legacy superblock reserved bytes are non-zero')
  }
  if (littleEndianUint16(bytes, 16) === 0 || littleEndianUint16(bytes, 18) === 0) {
    throw invalidInput('HDF5 legacy group B-tree K values must be non-zero')
  }
  if (version === 1 && littleEndianUint16(bytes, 24) === 0) {
    throw invalidInput('HDF5 indexed-storage B-tree K value must be non-zero')
  }
}

const parseLegacySuperblock = async (
  cache: Hdf5MetadataPageCache,
  signatureOffset: bigint,
  version: 0 | 1,
  options: Readonly<ImageSourceReadOptions>,
): Promise<Hdf5LegacySuperblock> => {
  const signatureNumber = Number(signatureOffset)
  const prefixLength = version === 0 ? 24 : 28
  const prefix = await cache.read(signatureNumber, prefixLength, options)
  validateLegacyPrefix(prefix, version)
  const offsetSize = integerWidth(prefix[13] ?? 0, 'offset')
  const lengthSize = integerWidth(prefix[14] ?? 0, 'length')
  const byteLength = prefixLength + offsetSize * 5 + lengthSize + 24
  const bytes = await cache.read(signatureNumber, byteLength, options)
  const addressesOffset = prefixLength
  const storedBaseAddress = optionalAddress(bytes, addressesOffset, offsetSize)
  const freeSpaceAddress = optionalAddress(bytes, addressesOffset + offsetSize, offsetSize)
  const storedEndOfFileAddress = optionalAddress(
    bytes,
    addressesOffset + offsetSize * 2,
    offsetSize,
  )
  const driverInformationAddress = optionalAddress(
    bytes,
    addressesOffset + offsetSize * 3,
    offsetSize,
  )
  const rootEntryOffset = addressesOffset + offsetSize * 4
  const rootObjectAddress = optionalAddress(bytes, rootEntryOffset + lengthSize, offsetSize)
  if (rootObjectAddress === undefined) throw invalidInput('HDF5 root object address is undefined')
  const context = resolveAddressContext(
    signatureOffset,
    byteLength,
    storedBaseAddress,
    storedEndOfFileAddress,
    cache.sourceIdentity.size,
  )
  const rootObjectOffset = BigInt(
    resolveRelativeAddress(
      context,
      cache.sourceIdentity.size,
      rootObjectAddress,
      1n,
      'root object address',
    ),
  )
  return Object.freeze({
    version,
    signatureOffset,
    byteLength,
    offsetSize,
    lengthSize,
    fileConsistencyFlags: littleEndianUint32(bytes, 20),
    ...context,
    rootObjectAddress,
    rootObjectOffset,
    freeSpaceAddress,
    driverInformationAddress,
  })
}

const parseModernSuperblock = async (
  cache: Hdf5MetadataPageCache,
  signatureOffset: bigint,
  version: 2 | 3,
  options: Readonly<ImageSourceReadOptions>,
): Promise<Hdf5ModernSuperblock> => {
  const signatureNumber = Number(signatureOffset)
  const prefix = await cache.read(signatureNumber, 12, options)
  const offsetSize = integerWidth(prefix[9] ?? 0, 'offset')
  const lengthSize = integerWidth(prefix[10] ?? 0, 'length')
  const fileConsistencyFlags = prefix[11] ?? 0
  if (version === 3 && (fileConsistencyFlags & ~0x05) !== 0) {
    throw invalidInput('HDF5 version 3 superblock has reserved consistency flags set')
  }
  const byteLength = 12 + offsetSize * 4 + 4
  const bytes = await cache.read(signatureNumber, byteLength, options)
  const checksumOffset = byteLength - 4
  const checksum = littleEndianUint32(bytes, checksumOffset)
  const computedChecksum = hdf5MetadataChecksum(bytes.subarray(0, checksumOffset))
  if (checksum !== computedChecksum) {
    throw invalidInput(
      `HDF5 superblock checksum mismatch: stored 0x${checksum.toString(16).padStart(8, '0')}, computed 0x${computedChecksum.toString(16).padStart(8, '0')}`,
    )
  }
  const storedBaseAddress = optionalAddress(bytes, 12, offsetSize)
  const superblockExtensionAddress = optionalAddress(bytes, 12 + offsetSize, offsetSize)
  const storedEndOfFileAddress = optionalAddress(bytes, 12 + offsetSize * 2, offsetSize)
  const rootObjectAddress = optionalAddress(bytes, 12 + offsetSize * 3, offsetSize)
  if (rootObjectAddress === undefined) throw invalidInput('HDF5 root object address is undefined')
  const context = resolveAddressContext(
    signatureOffset,
    byteLength,
    storedBaseAddress,
    storedEndOfFileAddress,
    cache.sourceIdentity.size,
  )
  const rootObjectOffset = BigInt(
    resolveRelativeAddress(
      context,
      cache.sourceIdentity.size,
      rootObjectAddress,
      1n,
      'root object address',
    ),
  )
  return Object.freeze({
    version,
    signatureOffset,
    byteLength,
    offsetSize,
    lengthSize,
    fileConsistencyFlags,
    ...context,
    rootObjectAddress,
    rootObjectOffset,
    superblockExtensionAddress,
    checksum,
  })
}

const decodeAscii = (bytes: Uint8Array): string => {
  let output = ''
  for (const byte of bytes) output += String.fromCharCode(byte)
  return output
}

const rejectUnsupportedDriver = async (
  cache: Hdf5MetadataPageCache,
  superblock: Hdf5Superblock,
  options: Readonly<ImageSourceReadOptions>,
): Promise<void> => {
  if ('superblockExtensionAddress' in superblock) {
    if (superblock.superblockExtensionAddress !== undefined) {
      throw unsupportedOperation(
        `HDF5 superblock extensions are not supported by the D1 file layer (address ${superblock.superblockExtensionAddress}); family and multi-file drivers remain unsupported`,
      )
    }
    return
  }
  const driverAddress = superblock.driverInformationAddress
  if (driverAddress === undefined) return
  const offset = resolveRelativeAddress(
    superblock,
    cache.sourceIdentity.size,
    driverAddress,
    16n,
    'driver information block',
  )
  const bytes = await cache.read(offset, 16, options)
  if (bytes[0] !== 0) {
    throw unsupportedOperation(`HDF5 driver information version ${bytes[0]} is unsupported`)
  }
  if (bytes[1] !== 0 || bytes[2] !== 0 || bytes[3] !== 0) {
    throw invalidInput('HDF5 driver information reserved bytes are non-zero')
  }
  const identifier = decodeAscii(bytes.subarray(8, 16))
  if (identifier === 'NCSAfami') {
    throw unsupportedOperation('HDF5 family multi-file driver NCSAfami is unsupported')
  }
  if (identifier === 'NCSAmult') {
    throw unsupportedOperation('HDF5 multi-file driver NCSAmult is unsupported')
  }
  const informationBytes = littleEndianUint32(bytes, 4)
  throw unsupportedOperation(
    `HDF5 file driver ${JSON.stringify(identifier)} with ${informationBytes} information bytes is unsupported`,
  )
}

export const openHdf5FileLayer = async (
  source: ImageSource,
  options: Readonly<Hdf5FileLayerOptions> = {},
): Promise<Hdf5FileLayer> => {
  validateSourceSize(source)
  throwIfAborted(options.signal)
  const cache = await Hdf5MetadataPageCache.create(source, options)
  const readOptions: Readonly<ImageSourceReadOptions> =
    options.signal === undefined ? {} : { signal: options.signal }
  try {
    const signatureOffset = await locateSignature(cache, readOptions)
    const versionBytes = await cache.read(
      Number(signatureOffset) + hdf5Signature.byteLength,
      1,
      readOptions,
    )
    const version = versionBytes[0]
    let superblock: Hdf5Superblock
    if (version === 0 || version === 1) {
      superblock = await parseLegacySuperblock(cache, signatureOffset, version, readOptions)
    } else if (version === 2 || version === 3) {
      superblock = await parseModernSuperblock(cache, signatureOffset, version, readOptions)
    } else {
      throw unsupportedOperation(`HDF5 superblock version ${version} is unsupported`)
    }
    await rejectUnsupportedDriver(cache, superblock, readOptions)
    throwIfAborted(options.signal)
    return new Hdf5FileLayerImplementation(source.size, cache, superblock)
  } catch (error) {
    cache.clear()
    throw error
  }
}
