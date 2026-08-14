import { describe, expect, it } from 'vitest'
import {
  createGeneratedHdf5Fixture,
  prependGeneratedHdf5Fixture,
} from '../benchmark/hdf5/generated-fixture.ts'
import {
  type Hdf5IntegerWidth,
  Hdf5MetadataPageCache,
  type Hdf5SuperblockVersion,
  hdf5MetadataChecksum,
  openHdf5FileLayer,
} from '../src/scientific/formats/hdf5.ts'
import type { ImageSource, ImageSourceReadOptions } from '../src/source.ts'
import { MemorySource } from '../src/source.ts'
import type { SourceIdentity } from '../src/source-identity.ts'
import { imageSourceIdentity } from '../src/source-identity.ts'
import { HostileSource } from './hostile-source.ts'

interface VersionCase {
  readonly version: Hdf5SuperblockVersion
  readonly userBlockBytes: number
  readonly offsetSize: Hdf5IntegerWidth
  readonly lengthSize: Hdf5IntegerWidth
}

const versionCases: readonly VersionCase[] = [
  { version: 0, userBlockBytes: 0, offsetSize: 2, lengthSize: 4 },
  { version: 1, userBlockBytes: 512, offsetSize: 4, lengthSize: 2 },
  { version: 2, userBlockBytes: 1_024, offsetSize: 8, lengthSize: 16 },
  { version: 3, userBlockBytes: 2_048, offsetSize: 16, lengthSize: 8 },
]

class CountingHostileSource implements ImageSource {
  readonly size: number
  readonly #source: HostileSource
  reads = 0

  constructor(bytes: Uint8Array) {
    this.#source = new HostileSource(bytes)
    this.size = bytes.byteLength
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    if (options.signal?.aborted === true) throw options.signal.reason
    this.reads += 1
    return this.#source.read(offset, length)
  }
}

class MutableIdentitySource implements ImageSource {
  readonly size: number
  readonly #bytes: Uint8Array
  identityId = 'before'

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes
    this.size = bytes.byteLength
  }

  [imageSourceIdentity](): SourceIdentity {
    return {
      kind: 'session',
      strength: 'session',
      stability: 'instance',
      id: this.identityId,
      size: this.size,
    }
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    return this.#bytes.subarray(offset, Math.min(this.size, offset + length))
  }
}

describe('HDF5 file and address layer', () => {
  it.each(versionCases)(
    'indexes superblock version $version with $offsetSize-byte addresses at user block $userBlockBytes',
    async ({ version, userBlockBytes, offsetSize, lengthSize }) => {
      const fixture = createGeneratedHdf5Fixture({
        version,
        userBlockBytes,
        offsetSize,
        lengthSize,
      })
      const file = await openHdf5FileLayer(new HostileSource(fixture.bytes), {
        pageBytes: 32,
        maxBytes: 128,
      })

      expect(file.superblock).toMatchObject({
        version,
        signatureOffset: BigInt(userBlockBytes),
        offsetSize,
        lengthSize,
        groupLeafNodeK: 4,
        groupInternalNodeK: 16,
        storedBaseAddress: BigInt(userBlockBytes),
        baseAddress: BigInt(userBlockBytes),
        addressAdjustment: 0n,
        storedEndOfFileAddress: BigInt(fixture.bytes.byteLength),
        endOfFileAddress: BigInt(fixture.bytes.byteLength),
        rootObjectAddress: fixture.rootObjectAddress,
        rootObjectOffset: BigInt(fixture.rootObjectOffset ?? -1),
      })
      expect(typeof file.superblock.rootObjectAddress).toBe('bigint')
      expect(await file.readMetadata(file.superblock.rootObjectAddress, 1)).toEqual(
        Uint8Array.of(1),
      )
      file.close()
      expect(file.metadataCache.residentBytes).toBe(0)
      expect(() => file.resolveAddress(0n)).toThrow(/closed/u)
    },
  )

  it('retains non-default legacy group B-tree K values for D2 traversal', async () => {
    const fixture = createGeneratedHdf5Fixture({
      version: 1,
      groupLeafNodeK: 7,
      groupInternalNodeK: 23,
    })
    const file = await openHdf5FileLayer(new MemorySource(fixture.bytes))

    expect(file.superblock).toMatchObject({ groupLeafNodeK: 7, groupInternalNodeK: 23 })
  })

  it('applies the specified relocation adjustment when a complete file is wrapped later', async () => {
    const fixture = createGeneratedHdf5Fixture({ version: 2 })
    const wrapped = prependGeneratedHdf5Fixture(fixture, 512)
    const file = await openHdf5FileLayer(new MemorySource(wrapped))

    expect(file.superblock).toMatchObject({
      signatureOffset: 512n,
      storedBaseAddress: 0n,
      baseAddress: 512n,
      addressAdjustment: 512n,
      storedEndOfFileAddress: BigInt(fixture.bytes.byteLength),
      endOfFileAddress: BigInt(wrapped.byteLength),
      rootObjectOffset: BigInt(512 + (fixture.rootObjectOffset ?? -1)),
    })
    expect(await file.readMetadata(file.superblock.rootObjectAddress, 1)).toEqual(Uint8Array.of(1))
  })

  it('does not accept a signature at a non-user-block offset', async () => {
    const fixture = createGeneratedHdf5Fixture({ version: 0 })
    const bytes = new Uint8Array(256 + fixture.bytes.byteLength)
    bytes.set(fixture.bytes, 256)
    await expect(openHdf5FileLayer(new MemorySource(bytes))).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
    })
  })

  it('matches the HDF5 lookup3 reference vector and rejects a corrupt modern superblock', async () => {
    expect(hdf5MetadataChecksum(new TextEncoder().encode('Four score and seven years ago'))).toBe(
      0x1777_0551,
    )
    const fixture = createGeneratedHdf5Fixture({ version: 3 })
    fixture.bytes[11] = (fixture.bytes[11] ?? 0) ^ 1
    await expect(openHdf5FileLayer(new MemorySource(fixture.bytes))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('checksum mismatch'),
    })
  })

  it('rejects hostile bigint addresses and declared files larger than the source before conversion', async () => {
    const hostileRoot = createGeneratedHdf5Fixture({
      version: 2,
      offsetSize: 16,
      rootObjectAddress: 1n << 80n,
    })
    await expect(openHdf5FileLayer(new MemorySource(hostileRoot.bytes))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('root object address'),
    })

    const oversized = createGeneratedHdf5Fixture({
      version: 0,
      storedEndOfFileAddress: 1_000_000n,
    })
    await expect(openHdf5FileLayer(new MemorySource(oversized.bytes))).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
      message: expect.stringContaining('source contains'),
    })
  })

  it.each(['NCSAfami', 'NCSAmult'])(
    'explicitly rejects the %s multi-file driver',
    async (driverIdentifier) => {
      const fixture = createGeneratedHdf5Fixture({ version: 1, driverIdentifier })
      await expect(openHdf5FileLayer(new MemorySource(fixture.bytes))).rejects.toMatchObject({
        code: 'UNSUPPORTED_OPERATION',
        message: expect.stringContaining(driverIdentifier),
      })
    },
  )

  it('rejects unknown legacy drivers and modern superblock extensions at the D1 boundary', async () => {
    const custom = createGeneratedHdf5Fixture({ version: 0, driverIdentifier: 'TESTdrv0' })
    await expect(openHdf5FileLayer(new MemorySource(custom.bytes))).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('TESTdrv0'),
    })

    const extension = createGeneratedHdf5Fixture({
      version: 2,
      superblockExtensionAddress: 96n,
    })
    await expect(openHdf5FileLayer(new MemorySource(extension.bytes))).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('superblock extensions'),
    })
  })

  it('keeps a true byte-bounded page cache and copies weakest-lifetime source buffers', async () => {
    const bytes = Uint8Array.from({ length: 64 }, (_, index) => index)
    const source = new CountingHostileSource(bytes)
    const cache = await Hdf5MetadataPageCache.create(source, {
      pageBytes: 16,
      maxBytes: 32,
      maxReadBytes: 48,
    })

    expect(await cache.read(0, 16)).toEqual(bytes.subarray(0, 16))
    expect(await cache.read(16, 16)).toEqual(bytes.subarray(16, 32))
    expect(await cache.read(0, 8)).toEqual(bytes.subarray(0, 8))
    expect(source.reads).toBe(2)
    expect(await cache.read(32, 16)).toEqual(bytes.subarray(32, 48))
    expect(cache.residentBytes).toBe(32)
    expect(cache.entryCount).toBe(2)
    expect(await cache.read(16, 16)).toEqual(bytes.subarray(16, 32))
    expect(source.reads).toBe(4)
    expect(cache.sourceReadCount).toBe(4)
    expect(cache.sourceBytesRead).toBe(64)

    const [left, right] = await Promise.all([cache.read(8, 32), cache.read(24, 24)])
    expect(left).toEqual(bytes.subarray(8, 40))
    expect(right).toEqual(bytes.subarray(24, 48))
    expect(cache.residentBytes).toBeLessThanOrEqual(32)
  })

  it('invalidates cached pages when the source identity changes', async () => {
    const source = new MutableIdentitySource(Uint8Array.of(1, 2, 3, 4))
    const cache = await Hdf5MetadataPageCache.create(source, {
      pageBytes: 2,
      maxBytes: 4,
    })
    expect(await cache.read(0, 2)).toEqual(Uint8Array.of(1, 2))
    source.identityId = 'after'
    await expect(cache.read(0, 2)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringContaining('identity changed'),
    })
    expect(cache.residentBytes).toBe(0)
  })

  it('enforces metadata read limits and cancellation', async () => {
    const source = new MemorySource(new Uint8Array(32))
    const cache = await Hdf5MetadataPageCache.create(source, {
      pageBytes: 8,
      maxBytes: 16,
      maxReadBytes: 8,
    })
    await expect(cache.read(0, 9)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })

    const controller = new AbortController()
    controller.abort(new Error('stop HDF5'))
    await expect(cache.read(0, 1, { signal: controller.signal })).rejects.toThrow('stop HDF5')
  })

  it('rejects unsupported versions and invalid address widths precisely', async () => {
    const version = createGeneratedHdf5Fixture({ version: 0 })
    version.bytes[8] = 4
    await expect(openHdf5FileLayer(new MemorySource(version.bytes))).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('version 4'),
    })

    const width = createGeneratedHdf5Fixture({ version: 0 })
    width.bytes[13] = 3
    await expect(openHdf5FileLayer(new MemorySource(width.bytes))).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('width 3'),
    })
  })
})
