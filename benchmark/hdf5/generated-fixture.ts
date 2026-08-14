import {
  type Hdf5IntegerWidth,
  type Hdf5SuperblockVersion,
  hdf5MetadataChecksum,
} from '../../src/scientific/formats/hdf5.ts'

export interface GeneratedHdf5FixtureOptions {
  readonly version: Hdf5SuperblockVersion
  readonly userBlockBytes?: number
  readonly offsetSize?: Hdf5IntegerWidth
  readonly lengthSize?: Hdf5IntegerWidth
  readonly storedBaseAddress?: bigint
  readonly storedEndOfFileAddress?: bigint
  readonly rootObjectAddress?: bigint
  readonly freeSpaceAddress?: bigint
  readonly driverIdentifier?: string
  readonly superblockExtensionAddress?: bigint
  readonly fileConsistencyFlags?: number
}

export interface GeneratedHdf5Fixture {
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly superblockBytes: number
  readonly rootObjectAddress: bigint
  readonly rootObjectOffset: number | undefined
}

const signature = Uint8Array.of(0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a)

const writeUnsigned = (output: Uint8Array, offset: number, width: number, value: bigint): void => {
  if (value < 0n || value >= 1n << BigInt(width * 8)) {
    throw new Error(`Fixture value ${value} does not fit ${width} bytes`)
  }
  let remaining = value
  for (let index = 0; index < width; index += 1) {
    output[offset + index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
}

const writeUint16 = (output: Uint8Array, offset: number, value: number): void => {
  new DataView(output.buffer).setUint16(offset, value, true)
}

const writeUint32 = (output: Uint8Array, offset: number, value: number): void => {
  new DataView(output.buffer).setUint32(offset, value, true)
}

const undefinedAddress = (width: number): bigint => (1n << BigInt(width * 8)) - 1n

const assertUserBlock = (value: number): void => {
  if (value === 0) return
  if (!Number.isSafeInteger(value) || value < 512 || (value & (value - 1)) !== 0) {
    throw new Error('Generated HDF5 user block must be zero or a power of two at least 512')
  }
}

export const createGeneratedHdf5Fixture = (
  options: Readonly<GeneratedHdf5FixtureOptions>,
): GeneratedHdf5Fixture => {
  const userBlockBytes = options.userBlockBytes ?? 0
  assertUserBlock(userBlockBytes)
  const offsetSize = options.offsetSize ?? 8
  const lengthSize = options.lengthSize ?? 8
  const legacy = options.version === 0 || options.version === 1
  const prefixBytes = options.version === 0 ? 24 : options.version === 1 ? 28 : 12
  const superblockBytes = legacy
    ? prefixBytes + offsetSize * 5 + lengthSize + 24
    : 12 + offsetSize * 4 + 4
  const driverBlockBytes = options.driverIdentifier === undefined ? 0 : 16
  const defaultRootAddress = BigInt(superblockBytes + driverBlockBytes + 16)
  const rootObjectAddress = options.rootObjectAddress ?? defaultRootAddress
  const minimumFileBytes = userBlockBytes + superblockBytes + driverBlockBytes + 64
  const rootObjectOffsetBig = BigInt(userBlockBytes) + rootObjectAddress
  const rootObjectOffset =
    rootObjectOffsetBig <= BigInt(Number.MAX_SAFE_INTEGER) &&
    rootObjectOffsetBig < BigInt(minimumFileBytes)
      ? Number(rootObjectOffsetBig)
      : undefined
  const storedBaseAddress = options.storedBaseAddress ?? BigInt(userBlockBytes)
  const storedEndOfFileAddress = options.storedEndOfFileAddress ?? BigInt(minimumFileBytes)
  const bytes = new Uint8Array(minimumFileBytes)
  const start = userBlockBytes
  bytes.set(signature, start)
  bytes[start + 8] = options.version

  if (legacy) {
    bytes[start + 9] = 0
    bytes[start + 10] = 0
    bytes[start + 11] = 0
    bytes[start + 12] = 0
    bytes[start + 13] = offsetSize
    bytes[start + 14] = lengthSize
    bytes[start + 15] = 0
    writeUint16(bytes, start + 16, 4)
    writeUint16(bytes, start + 18, 16)
    writeUint32(bytes, start + 20, options.fileConsistencyFlags ?? 0)
    if (options.version === 1) {
      writeUint16(bytes, start + 24, 32)
      writeUint16(bytes, start + 26, 0)
    }
    const addressStart = start + prefixBytes
    writeUnsigned(bytes, addressStart, offsetSize, storedBaseAddress)
    writeUnsigned(
      bytes,
      addressStart + offsetSize,
      offsetSize,
      options.freeSpaceAddress ?? undefinedAddress(offsetSize),
    )
    writeUnsigned(bytes, addressStart + offsetSize * 2, offsetSize, storedEndOfFileAddress)
    writeUnsigned(
      bytes,
      addressStart + offsetSize * 3,
      offsetSize,
      options.driverIdentifier === undefined
        ? undefinedAddress(offsetSize)
        : BigInt(superblockBytes),
    )
    const rootEntry = addressStart + offsetSize * 4
    writeUnsigned(bytes, rootEntry, lengthSize, 0n)
    writeUnsigned(bytes, rootEntry + lengthSize, offsetSize, rootObjectAddress)
    writeUint32(bytes, rootEntry + lengthSize + offsetSize, 1)

    if (options.driverIdentifier !== undefined) {
      if (options.driverIdentifier.length !== 8) {
        throw new Error('Generated HDF5 driver identifier must contain exactly eight ASCII bytes')
      }
      const driverOffset = start + superblockBytes
      bytes[driverOffset] = 0
      writeUint32(bytes, driverOffset + 4, 0)
      for (let index = 0; index < 8; index += 1) {
        const code = options.driverIdentifier.charCodeAt(index)
        if (code > 0x7f) throw new Error('Generated HDF5 driver identifier must be ASCII')
        bytes[driverOffset + 8 + index] = code
      }
    }
  } else {
    bytes[start + 9] = offsetSize
    bytes[start + 10] = lengthSize
    bytes[start + 11] = options.fileConsistencyFlags ?? 0
    writeUnsigned(bytes, start + 12, offsetSize, storedBaseAddress)
    writeUnsigned(
      bytes,
      start + 12 + offsetSize,
      offsetSize,
      options.superblockExtensionAddress ?? undefinedAddress(offsetSize),
    )
    writeUnsigned(bytes, start + 12 + offsetSize * 2, offsetSize, storedEndOfFileAddress)
    writeUnsigned(bytes, start + 12 + offsetSize * 3, offsetSize, rootObjectAddress)
    const checksumOffset = start + superblockBytes - 4
    writeUint32(bytes, checksumOffset, hdf5MetadataChecksum(bytes.subarray(start, checksumOffset)))
  }

  if (rootObjectOffset !== undefined) bytes[rootObjectOffset] = 1
  return Object.freeze({ bytes, superblockBytes, rootObjectAddress, rootObjectOffset })
}

export const prependGeneratedHdf5Fixture = (
  fixture: GeneratedHdf5Fixture,
  prefixBytes: number,
): Uint8Array<ArrayBuffer> => {
  assertUserBlock(prefixBytes)
  if (prefixBytes === 0) return fixture.bytes.slice()
  const output = new Uint8Array(prefixBytes + fixture.bytes.byteLength)
  output.set(fixture.bytes, prefixBytes)
  return output
}
