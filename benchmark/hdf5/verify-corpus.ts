import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { ImageError } from '../../src/errors.ts'
import { FileSource } from '../../src/node-source.ts'
import { readHdf5DatasetMetadata } from '../../src/scientific/formats/hdf5-dataset.ts'
import { openHdf5ObjectGraph } from '../../src/scientific/formats/hdf5-graph.ts'
import { openHdf5FileLayer } from '../../src/scientific/formats/hdf5.ts'
import { hdf5CorpusPath, readHdf5CorpusManifest } from './corpus.ts'

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
      if (metadata.layout.kind === 'chunked' && expected.chunkDimensions !== undefined) {
        requireNumberArrayEqual(
          metadata.layout.chunkDimensions,
          expected.chunkDimensions,
          `${fixture.file} ${expected.path} chunk dimensions`,
        )
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
