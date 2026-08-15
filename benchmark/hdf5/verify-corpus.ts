import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { ImageError } from '../../src/errors.ts'
import { FileSource } from '../../src/node-source.ts'
import {
  type Hdf5Datatype,
  readHdf5DatasetElementRange,
  readHdf5DatasetMetadata,
} from '../../src/scientific/formats/hdf5-dataset.ts'
import { locateHdf5Chunk } from '../../src/scientific/formats/hdf5-chunks.ts'
import { readHdf5DecodedChunkBlocks } from '../../src/scientific/formats/hdf5-filters.ts'
import { openHdf5ObjectGraph } from '../../src/scientific/formats/hdf5-graph.ts'
import { openHdf5FileLayer } from '../../src/scientific/formats/hdf5.ts'
import {
  type Hdf5DatatypeCorpusExpectation,
  hdf5CorpusPath,
  readHdf5CorpusManifest,
} from './corpus.ts'

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const requireEqual = (actual: unknown, expected: unknown, label: string): void => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`)
  }
}

const requireStringArrayEqual = (
  actual: readonly string[],
  expected: readonly string[],
  label: string,
): void => {
  const actualValue = [...actual].sort().join('\u0000')
  const expectedValue = [...expected].sort().join('\u0000')
  requireEqual(actualValue, expectedValue, label)
}

const requireNumberArrayEqual = (
  actual: readonly number[],
  expected: readonly number[],
  label: string,
): void => requireEqual(actual.join(','), expected.join(','), label)

const requireDatatype = (
  actual: Hdf5Datatype,
  expected: Hdf5DatatypeCorpusExpectation,
  label: string,
): void => {
  requireEqual(actual.kind, expected.kind, `${label} kind`)
  if (expected.kind === 'enum') {
    if (actual.kind !== 'enum') return
    requireEqual(actual.members.length, expected.members.length, `${label} member count`)
    for (let index = 0; index < expected.members.length; index += 1) {
      const actualMember = actual.members[index]
      const expectedMember = expected.members[index]
      if (actualMember === undefined || expectedMember === undefined) {
        throw new Error(`${label} lacks enum member ${index}`)
      }
      requireEqual(actualMember.name, expectedMember.name, `${label} member ${index} name`)
      requireEqual(
        actualMember.value.toString(),
        expectedMember.value,
        `${label} member ${index} value`,
      )
    }
    return
  }
  if (expected.kind !== 'compound' || actual.kind !== 'compound') return
  requireEqual(actual.members.length, expected.members.length, `${label} member count`)
  for (let index = 0; index < expected.members.length; index += 1) {
    const actualMember = actual.members[index]
    const expectedMember = expected.members[index]
    if (actualMember === undefined || expectedMember === undefined) {
      throw new Error(`${label} lacks compound member ${index}`)
    }
    requireEqual(actualMember.name, expectedMember.name, `${label} member ${index} name`)
    requireEqual(actualMember.offset, expectedMember.offset, `${label} member ${index} offset`)
    requireEqual(actualMember.datatype.kind, expectedMember.kind, `${label} member ${index} kind`)
    requireEqual(
      actualMember.datatype.byteLength,
      expectedMember.elementBytes,
      `${label} member ${index} bytes`,
    )
  }
}

const hex = (bytes: Uint8Array): string => {
  let value = ''
  for (const byte of bytes) value += byte.toString(16).padStart(2, '0')
  return value
}

const chunkIndexSamples: Readonly<
  Record<
    string,
    Readonly<{
      coordinates: readonly number[]
      indexKind: 'btree-v1' | 'fixed-array'
      encodedBytes: number
      rawPrefixHex: string
    }>
  >
> = Object.freeze({
  'h5repack_layout.h5:/dset_chunk': Object.freeze({
    coordinates: Object.freeze([1, 1]),
    indexKind: 'btree-v1',
    encodedBytes: 800,
    rawPrefixHex: '9a0100009b0100009c0100009d010000',
  }),
  'bounds_latest_latest.h5:/DS_chunked_layout_4': Object.freeze({
    coordinates: Object.freeze([1, 3]),
    indexKind: 'fixed-array',
    encodedBytes: 10_000,
    rawPrefixHex: '0000c8420000c8420000c8420000c842',
  }),
})

const filterChunkSamples: Readonly<
  Record<
    string,
    Readonly<{
      encodedBytes: number
      decodedPrefixHex?: string
      unsupportedFilter?: string
    }>
  >
> = Object.freeze({
  'h5repack_filters.h5:/dset_all': Object.freeze({
    encodedBytes: 203,
    decodedPrefixHex: '0000000001000000020000000300000004000000050000000600000007000000',
  }),
  'h5repack_filters.h5:/dset_deflate': Object.freeze({
    encodedBytes: 320,
    decodedPrefixHex: '0000000001000000020000000300000004000000050000000600000007000000',
  }),
  'h5repack_filters.h5:/dset_fletcher32': Object.freeze({
    encodedBytes: 804,
    decodedPrefixHex: '0000000001000000020000000300000004000000050000000600000007000000',
  }),
  'h5repack_filters.h5:/dset_nbit': Object.freeze({
    encodedBytes: 776,
    unsupportedFilter: 'N-bit',
  }),
  'h5repack_filters.h5:/dset_shuffle': Object.freeze({
    encodedBytes: 800,
    decodedPrefixHex: '0000000001000000020000000300000004000000050000000600000007000000',
  }),
})

const manifest = await readHdf5CorpusManifest()
for (const fixture of manifest.fixtures) {
  const path = hdf5CorpusPath(fixture.file)
  const bytes = await readFile(path)
  requireEqual(bytes.byteLength, fixture.bytes, `${fixture.file} byte length`)
  requireEqual(sha256(bytes), fixture.sha256, `${fixture.file} checksum`)

  const file = await openHdf5FileLayer(await FileSource.open(path))
  requireEqual(file.superblock.version, fixture.superblockVersion, `${fixture.file} superblock`)
  const graph = await openHdf5ObjectGraph(file)
  const root = await graph.get('/')
  if (root === undefined) throw new Error(`${fixture.file} root object is unavailable`)
  requireEqual(
    root.header.version,
    fixture.objectHeaderVersion,
    `${fixture.file} root object header`,
  )
  if (fixture.storage === 'legacy') {
    if (root.header.linkStorage?.kind !== 'legacy') {
      throw new Error(`${fixture.file} root object does not use legacy link storage`)
    }
    const links = await graph.list('/')
    if (links === undefined) throw new Error(`${fixture.file} root links are unavailable`)
    requireStringArrayEqual(
      links.map(({ name }) => name),
      fixture.rootLinks,
      `${fixture.file} root links`,
    )
    for (const name of fixture.rootLinks) {
      if ((await graph.get(`/${name}`)) === undefined) {
        throw new Error(`${fixture.file} root link ${JSON.stringify(name)} does not resolve`)
      }
    }
    console.log(
      `ok ${fixture.file} superblock-v${file.superblock.version} object-v${root.header.version} ${links.length} legacy graph links`,
    )
    continue
  }
  if (fixture.storage === 'datasets') {
    for (const expected of fixture.datasets) {
      const object = await graph.get(expected.path)
      if (object === undefined) throw new Error(`${fixture.file} lacks ${expected.path}`)
      requireEqual(
        object.header.version,
        fixture.objectHeaderVersion,
        `${fixture.file} ${expected.path} object header`,
      )
      const metadata = await readHdf5DatasetMetadata(file, object.header, {
        objectPath: expected.path,
      })
      requireNumberArrayEqual(
        metadata.dataspace.dimensions,
        expected.dimensions,
        `${fixture.file} ${expected.path} dimensions`,
      )
      requireEqual(
        metadata.datatype.byteLength,
        expected.elementBytes,
        `${fixture.file} ${expected.path} element bytes`,
      )
      requireDatatype(
        metadata.datatype,
        expected.datatype,
        `${fixture.file} ${expected.path} datatype`,
      )
      requireEqual(metadata.layout.kind, expected.layout, `${fixture.file} ${expected.path} layout`)
      const logicalBytes = metadata.dataspace.elementCount * metadata.datatype.byteLength
      requireEqual(
        logicalBytes,
        expected.logicalBytes,
        `${fixture.file} ${expected.path} logical bytes`,
      )
      if (metadata.layout.kind !== 'chunked') {
        requireEqual(
          metadata.layout.storageBytes,
          expected.logicalBytes,
          `${fixture.file} ${expected.path} allocated bytes`,
        )
      }
      requireEqual(
        metadata.fillValue.status,
        expected.fillStatus,
        `${fixture.file} ${expected.path} fill status`,
      )
      requireNumberArrayEqual(
        metadata.filterPipeline?.filters.map(({ id }) => id) ?? [],
        expected.filterIds ?? [],
        `${fixture.file} ${expected.path} filter IDs`,
      )
      if (metadata.layout.kind === 'chunked' && expected.chunkDimensions !== undefined) {
        requireNumberArrayEqual(
          metadata.layout.chunkDimensions,
          expected.chunkDimensions,
          `${fixture.file} ${expected.path} chunk dimensions`,
        )
        const chunkSample = chunkIndexSamples[`${fixture.file}:${expected.path}`]
        if (chunkSample !== undefined) {
          requireEqual(
            metadata.layout.index.kind,
            chunkSample.indexKind,
            `${fixture.file} ${expected.path} chunk index`,
          )
          const located = await locateHdf5Chunk(file, metadata, chunkSample.coordinates, {
            objectPath: expected.path,
          })
          requireEqual(
            located.encodedBytes,
            chunkSample.encodedBytes,
            `${fixture.file} ${expected.path} encoded chunk bytes`,
          )
          if (located.address === undefined) {
            throw new Error(`${fixture.file} ${expected.path} sample chunk is unallocated`)
          }
          const prefixBytes = chunkSample.rawPrefixHex.length / 2
          const prefix = await file.readRaw(located.address, prefixBytes)
          requireEqual(
            hex(prefix),
            chunkSample.rawPrefixHex,
            `${fixture.file} ${expected.path} chunk prefix`,
          )
        }
        const filterSample = filterChunkSamples[`${fixture.file}:${expected.path}`]
        if (filterSample !== undefined) {
          const coordinates = Object.freeze(metadata.dataspace.dimensions.map(() => 0))
          const located = await locateHdf5Chunk(file, metadata, coordinates, {
            objectPath: expected.path,
          })
          requireEqual(
            located.encodedBytes,
            filterSample.encodedBytes,
            `${fixture.file} ${expected.path} encoded chunk bytes`,
          )
          const selection = {
            start: coordinates,
            shape: Object.freeze(metadata.dataspace.dimensions.map(() => 1)),
          }
          const iterator = readHdf5DecodedChunkBlocks(file, metadata, selection, {
            objectPath: expected.path,
          })[Symbol.asyncIterator]()
          if (filterSample.unsupportedFilter !== undefined) {
            try {
              await iterator.next()
              throw new Error(`${fixture.file} ${expected.path} unexpectedly decoded`)
            } catch (error: unknown) {
              if (
                !(error instanceof ImageError) ||
                error.code !== 'UNSUPPORTED_OPERATION' ||
                !error.message.includes(expected.path) ||
                !error.message.includes(filterSample.unsupportedFilter)
              ) {
                throw error
              }
            }
          } else {
            const first = await iterator.next()
            if (first.done || first.value.decoded === undefined) {
              throw new Error(`${fixture.file} ${expected.path} decoded chunk is unavailable`)
            }
            const prefix = first.value.decoded.subarray(
              0,
              (filterSample.decodedPrefixHex?.length ?? 0) / 2,
            )
            requireEqual(
              hex(prefix),
              filterSample.decodedPrefixHex,
              `${fixture.file} ${expected.path} decoded chunk prefix`,
            )
          }
        }
      }
      if (expected.sample !== undefined) {
        const count = expected.sample.rawHex.length / 2 / metadata.datatype.byteLength
        const bytes = await readHdf5DatasetElementRange(
          file,
          metadata,
          { offset: expected.sample.elementOffset, count },
          { objectPath: expected.path },
        )
        requireEqual(hex(bytes), expected.sample.rawHex, `${fixture.file} ${expected.path} sample`)
      }
    }
    console.log(
      `ok ${fixture.file} superblock-v${file.superblock.version} ${fixture.datasets.length} dataset layouts`,
    )
    continue
  }
  if (root.header.linkStorage?.kind !== 'dense') {
    throw new Error(`${fixture.file} root object does not use dense link storage`)
  }
  try {
    await graph.list('/')
    throw new Error(`${fixture.file} unexpectedly accepted its external link`)
  } catch (error: unknown) {
    if (
      !(error instanceof ImageError) ||
      error.code !== 'UNSUPPORTED_OPERATION' ||
      !error.message.includes(`external link ${JSON.stringify(fixture.unsupportedLink)}`)
    ) {
      throw error
    }
  }
  console.log(
    `ok ${fixture.file} superblock-v${file.superblock.version} object-v${root.header.version} dense graph rejects external link ${JSON.stringify(fixture.unsupportedLink)}`,
  )
}
