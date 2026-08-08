import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { downloadPinnedFile } from '../../lib/pinned-download.ts'
import {
  compatibilityCorpusDirectory,
  compatibilityFixturePath,
  fixtureSha256,
  isSourceFixture,
  readCompatibilityManifest,
} from './corpus.ts'
import { generateCompatibilityFixtures } from './generated-fixtures.ts'

const allowedHosts: ReadonlySet<string> = new Set(['heic.digital', 'raw.githubusercontent.com'])
const manifest = await readCompatibilityManifest()
await mkdir(compatibilityCorpusDirectory, { recursive: true })

for (const fixture of manifest.fixtures) {
  if (!isSourceFixture(fixture)) continue
  const destination = compatibilityFixturePath(fixture)
  let alreadyPrepared = false
  try {
    alreadyPrepared = fixtureSha256(await readFile(destination)) === fixture.sha256
  } catch {
    // The pinned downloader will create a missing fixture.
  }
  if (alreadyPrepared) {
    console.log(`${fixture.id}: checksum already verified`)
    continue
  }
  await rm(destination, { force: true })
  await downloadPinnedFile({
    allowedDirectory: compatibilityCorpusDirectory,
    allowedHosts,
    destination,
    expectedSha256: fixture.sha256,
    maximumBytes: 16 * 1024 * 1024,
    url: fixture.url,
  })
  console.log(`${fixture.id}: downloaded and checksum verified`)
}

const benchmarkFilesDirectory = dirname(compatibilityCorpusDirectory)
for (const [compatibilityFile, benchmarkFile] of [
  ['iphone12-greyhounds.heic', 'iphone12-greyhounds-4032x3024.heic'],
  ['iphone12-classic-car.heic', 'iphone12-classic-car-4032x3024.heic'],
  ['iphone12-old-safe.heic', 'iphone12-old-safe-wall-4032x3024.heic'],
] as const) {
  await copyFile(
    join(compatibilityCorpusDirectory, compatibilityFile),
    join(benchmarkFilesDirectory, benchmarkFile),
  )
}

await generateCompatibilityFixtures(compatibilityCorpusDirectory)
for (const fixture of manifest.fixtures) {
  if (isSourceFixture(fixture)) continue
  const actual = fixtureSha256(await readFile(compatibilityFixturePath(fixture)))
  if (actual !== fixture.sha256) {
    throw new Error(`${fixture.id}: generated SHA-256 ${actual} does not match ${fixture.sha256}`)
  }
  console.log(`${fixture.id}: generated and checksum verified`)
}
