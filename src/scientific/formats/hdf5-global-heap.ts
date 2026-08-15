import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import type { ImageSourceReadOptions } from '../../source.ts'
import type { Hdf5FileLayer } from './hdf5.ts'

export interface Hdf5GlobalHeapLimits {
  readonly maxGlobalHeapCollectionBytes?: number
  readonly maxGlobalHeapObjects?: number
  readonly maxGlobalHeapObjectBytes?: number
}

export interface Hdf5GlobalHeapReadOptions extends AbortOptions, Hdf5GlobalHeapLimits {}

export interface Hdf5GlobalHeapCollection {
  readonly address: bigint
  readonly byteLength: number
  readonly objects: ReadonlyMap<number, Uint8Array<ArrayBuffer>>
}

interface ResolvedLimits {
  readonly maxCollectionBytes: number
  readonly maxObjects: number
  readonly maxObjectBytes: number
}

const defaultLimits: ResolvedLimits = Object.freeze({
  maxCollectionBytes: 1_048_576,
  maxObjects: 4_096,
  maxObjectBytes: 1_048_576,
})

const positiveSafeInteger = (label: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return value
}

const resolveLimits = (options: Readonly<Hdf5GlobalHeapLimits>): ResolvedLimits =>
  Object.freeze({
    maxCollectionBytes: positiveSafeInteger(
      'HDF5 global heap maxGlobalHeapCollectionBytes',
      options.maxGlobalHeapCollectionBytes ?? defaultLimits.maxCollectionBytes,
    ),
    maxObjects: positiveSafeInteger(
      'HDF5 global heap maxGlobalHeapObjects',
      options.maxGlobalHeapObjects ?? defaultLimits.maxObjects,
    ),
    maxObjectBytes: positiveSafeInteger(
      'HDF5 global heap maxGlobalHeapObjectBytes',
      options.maxGlobalHeapObjectBytes ?? defaultLimits.maxObjectBytes,
    ),
  })

const littleEndianUnsigned = (bytes: Uint8Array, offset: number, width: number): bigint => {
  let value = 0n
  for (let index = width - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[offset + index] ?? 0)
  }
  return value
}

const littleEndianUint16 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)

const littleEndianUint32 = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)) >>>
  0

const paddedToEight = (value: number): number => Math.ceil(value / 8) * 8

const hasSignature = (bytes: Uint8Array): boolean =>
  bytes[0] === 0x47 && bytes[1] === 0x43 && bytes[2] === 0x4f && bytes[3] === 0x4c

export const readHdf5GlobalHeapCollection = async (
  file: Hdf5FileLayer,
  address: bigint,
  options: Readonly<Hdf5GlobalHeapReadOptions> = {},
): Promise<Hdf5GlobalHeapCollection> => {
  throwIfAborted(options.signal)
  const limits = resolveLimits(options)
  const headerBytes = 8 + file.superblock.lengthSize
  file.resolveAddress(address, BigInt(headerBytes), 'HDF5 global heap collection')
  const readOptions: Readonly<ImageSourceReadOptions> =
    options.signal === undefined ? {} : { signal: options.signal }
  const prefix = await file.readMetadata(address, headerBytes, readOptions)
  throwIfAborted(options.signal)
  if (!hasSignature(prefix)) throw invalidInput('HDF5 global heap signature is invalid')
  if (prefix[4] !== 1) {
    throw unsupportedOperation(`HDF5 global heap version ${prefix[4]} is not supported`)
  }
  if (prefix[5] !== 0 || prefix[6] !== 0 || prefix[7] !== 0) {
    throw invalidInput('HDF5 global heap header has non-zero reserved bytes')
  }
  const collectionSize = littleEndianUnsigned(prefix, 8, file.superblock.lengthSize)
  if (collectionSize < BigInt(headerBytes)) {
    throw invalidInput('HDF5 global heap collection is smaller than its header')
  }
  if (collectionSize > BigInt(limits.maxCollectionBytes)) {
    throw limitExceeded(`HDF5 global heap collection exceeds ${limits.maxCollectionBytes} bytes`)
  }
  const byteLength = Number(collectionSize)
  if ((byteLength & 7) !== 0) {
    throw invalidInput('HDF5 global heap collection size is not eight-byte aligned')
  }
  file.resolveAddress(address, collectionSize, 'HDF5 global heap collection')
  const bytes = await file.readMetadata(address, byteLength, readOptions)
  throwIfAborted(options.signal)
  const objectHeaderBytes = 8 + file.superblock.lengthSize
  const objects = new Map<number, Uint8Array<ArrayBuffer>>()
  let position = headerBytes
  while (position < byteLength) {
    if (position > byteLength - objectHeaderBytes) {
      throw invalidInput('HDF5 global heap object header is truncated')
    }
    const index = littleEndianUint16(bytes, position)
    const referenceCount = littleEndianUint16(bytes, position + 2)
    const reserved = littleEndianUint32(bytes, position + 4)
    const objectSize = littleEndianUnsigned(bytes, position + 8, file.superblock.lengthSize)
    if (reserved !== 0) throw invalidInput('HDF5 global heap object has reserved bits set')
    if (index === 0) {
      if (referenceCount !== 0) {
        throw invalidInput('HDF5 global heap free-space object has references')
      }
      if (objectSize !== BigInt(byteLength - position)) {
        throw invalidInput('HDF5 global heap free-space extent is invalid')
      }
      position = byteLength
      break
    }
    if (objects.has(index)) throw invalidInput(`HDF5 global heap repeats object index ${index}`)
    if (objects.size >= limits.maxObjects) {
      throw limitExceeded(`HDF5 global heap exceeds ${limits.maxObjects} objects`)
    }
    if (objectSize > BigInt(limits.maxObjectBytes)) {
      throw limitExceeded(`HDF5 global heap object exceeds ${limits.maxObjectBytes} bytes`)
    }
    const objectBytes = Number(objectSize)
    const dataOffset = position + objectHeaderBytes
    const paddedBytes = paddedToEight(objectBytes)
    if (dataOffset > byteLength - paddedBytes) {
      throw invalidInput(`HDF5 global heap object ${index} exceeds its collection`)
    }
    objects.set(index, bytes.slice(dataOffset, dataOffset + objectBytes))
    position = dataOffset + paddedBytes
  }
  if (position !== byteLength) throw invalidInput('HDF5 global heap collection is incomplete')
  return Object.freeze({ address, byteLength, objects })
}
