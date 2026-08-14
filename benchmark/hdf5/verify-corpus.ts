import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { ImageError } from '../../src/errors.ts'
import { FileSource } from '../../src/node-source.ts'
import { readHdf5DenseGroup } from '../../src/scientific/formats/hdf5-dense-group.ts'
import { readHdf5LegacyGroup } from '../../src/scientific/formats/hdf5-legacy-group.ts'
import { readHdf5ObjectHeader } from '../../src/scientific/formats/hdf5-object.ts'
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

const manifest = await readHdf5CorpusManifest()
for (const fixture of manifest.fixtures) {
  const path = hdf5CorpusPath(fixture.file)
  const bytes = await readFile(path)
  requireEqual(bytes.byteLength, fixture.bytes, `${fixture.file} byte length`)
  requireEqual(sha256(bytes), fixture.sha256, `${fixture.file} checksum`)

  const file = await openHdf5FileLayer(await FileSource.open(path))
  requireEqual(file.superblock.version, fixture.superblockVersion, `${fixture.file} superblock`)
  const root = await readHdf5ObjectHeader(file, file.superblock.rootObjectAddress)
  requireEqual(root.version, fixture.objectHeaderVersion, `${fixture.file} root object header`)
  if (fixture.storage === 'legacy') {
    if (root.linkStorage?.kind !== 'legacy') {
      throw new Error(`${fixture.file} root object does not use legacy link storage`)
    }
    const group = await readHdf5LegacyGroup(file, root.linkStorage)
    requireStringArrayEqual(
      group.links.map(({ name }) => name),
      fixture.rootLinks,
      `${fixture.file} root links`,
    )
    console.log(
      `ok ${fixture.file} superblock-v${file.superblock.version} object-v${root.version} ${group.links.length} legacy root links`,
    )
    continue
  }
  if (root.linkStorage?.kind !== 'dense') {
    throw new Error(`${fixture.file} root object does not use dense link storage`)
  }
  try {
    await readHdf5DenseGroup(file, root.linkStorage)
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
    `ok ${fixture.file} superblock-v${file.superblock.version} object-v${root.version} dense index rejects external link ${JSON.stringify(fixture.unsupportedLink)}`,
  )
}
