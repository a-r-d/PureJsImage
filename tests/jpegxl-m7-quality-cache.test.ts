import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  loadM7QualityCache,
  reuseM7QualityPoint,
  revalidateM7EncodedPoint,
  validateM7CachedPoint,
  writeM7QualityReport,
} from '../benchmark/jpegxl/m7-quality-cache.ts'

const directories: string[] = []
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true })
})
const bytes = Uint8Array.of(255, 10, 0, 42)
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
const identity = {
  id: 'sample',
  sourceSha256: 'a'.repeat(64),
  normalizedSha256: 'b'.repeat(64),
  width: 4,
  height: 3,
}
const protocol = {
  sourceFingerprint: 'encoder-v1',
  split: 'development',
  runtime: 'pinned-node',
  sharp: { vips: 'pinned' },
  tools: [{ sha256: 'c'.repeat(64) }],
  preprocessing: 'RGB8 stored raster',
  evaluation: 'frozen coordinates',
  matching: 'log-byte interpolation',
}
const point = {
  engine: 'purejsimage',
  setting: 1,
  status: 'measured',
  bytes: bytes.length,
  encodedSha256: hash(bytes),
  decodedSha256: 'd'.repeat(64),
  ssimulacra2: 90,
  butteraugli: 1,
  rmse: 0.5,
  maximumError: 2,
  maximumIndependentDifference: 1,
  rawMetrics: { ssimulacra2Text: '90\n', butteraugliText: '1\n3-norm: 0.3\n' },
}
async function fixture(points: readonly unknown[] = [point]) {
  const directory = await mkdtemp(join(tmpdir(), 'm7-quality-cache-'))
  directories.push(directory)
  await mkdir(`${directory}/sample`)
  await mkdir(`${directory}/output`)
  await writeFile(`${directory}/protocol.json`, JSON.stringify(protocol))
  await writeFile(
    `${directory}/sample/report.json`,
    JSON.stringify({ ...identity, sourceFingerprint: protocol.sourceFingerprint, points }),
  )
  await writeFile(`${directory}/sample/purejsimage-1.jxl`, bytes)
  return directory
}
it('reuses a verified coordinate and preserves its encoded artifact and provenance', async () => {
  const directory = await fixture()
  const cache = await loadM7QualityCache(directory, identity, protocol, 'encoder-v1')
  const reused = await reuseM7QualityPoint(cache, 'sample', 'purejsimage', 1, `${directory}/output`)
  expect(reused).toMatchObject({ ...point, reusedFrom: { directory } })
  expect(new Uint8Array(await readFile(`${directory}/output/purejsimage-1.jxl`))).toEqual(bytes)
  expect(
    await reuseM7QualityPoint(cache, 'sample', 'purejsimage', 2, `${directory}/output`),
  ).toBeUndefined()
})
it('reuses an unchanged small original under the two MP profile only with identical normalized pixels', async () => {
  const directory = await fixture()
  const capped = { ...protocol, resolution: '2mp', preprocessing: 'Capped RGB8 raster' }
  expect(await loadM7QualityCache(directory, identity, capped)).toBeDefined()
  expect(await loadM7QualityCache(directory, { ...identity, width: 2 }, capped)).toBeUndefined()
  expect(
    await loadM7QualityCache(directory, { ...identity, normalizedSha256: 'e'.repeat(64) }, capped),
  ).toBeUndefined()
  await expect(
    loadM7QualityCache(directory, { ...identity, sourceSha256: 'e'.repeat(64) }, capped),
  ).rejects.toThrow('source mismatch')
  await expect(loadM7QualityCache(directory, identity, { ...capped, tools: [] })).rejects.toThrow(
    'tools',
  )
})
it('revalidates scores across implementations only after fresh encoding produces identical bytes', async () => {
  const directory = await fixture()
  const cache = await loadM7QualityCache(directory, identity, {
    ...protocol,
    sourceFingerprint: 'encoder-v2',
  })
  const reused = await revalidateM7EncodedPoint(
    cache,
    'sample',
    1,
    bytes,
    'encoder-v2',
    `${directory}/output`,
  )
  expect(reused).toMatchObject({
    ...point,
    byteRevalidation: {
      previousFingerprint: 'encoder-v1',
      currentFingerprint: 'encoder-v2',
      encodedSha256: hash(bytes),
    },
  })
  expect(
    await revalidateM7EncodedPoint(
      cache,
      'sample',
      1,
      Uint8Array.of(255, 10, 0, 43),
      'encoder-v2',
      `${directory}/output`,
    ),
  ).toBeUndefined()
  expect(
    await revalidateM7EncodedPoint(
      cache,
      'sample',
      1,
      bytes.subarray(1),
      'encoder-v2',
      `${directory}/output`,
    ),
  ).toBeUndefined()
  expect(
    await revalidateM7EncodedPoint(cache, 'sample', 2, bytes, 'encoder-v2', `${directory}/output`),
  ).toBeUndefined()
})
it('does not bypass artifact, status or coordinate integrity during fresh-byte revalidation', async () => {
  const directory = await fixture()
  const cache = await loadM7QualityCache(directory, identity, protocol)
  await writeFile(`${directory}/sample/purejsimage-1.jxl`, Uint8Array.of(0))
  await expect(
    revalidateM7EncodedPoint(cache, 'sample', 1, bytes, 'encoder-v2', `${directory}/output`),
  ).rejects.toThrow('artifact changed')
  for (const points of [[{ ...point, status: 'failed' }], [point, point]]) {
    const other = await fixture(points)
    const invalid = await loadM7QualityCache(other, identity, protocol)
    await expect(
      revalidateM7EncodedPoint(invalid, 'sample', 1, bytes, 'encoder-v2', `${other}/output`),
    ).rejects.toThrow()
  }
})
it('rejects changed source samples, dimensions, implementations and comparator tools', async () => {
  const directory = await fixture()
  await expect(
    loadM7QualityCache(directory, { ...identity, normalizedSha256: 'e'.repeat(64) }, protocol),
  ).rejects.toThrow('source mismatch')
  await expect(loadM7QualityCache(directory, { ...identity, width: 5 }, protocol)).rejects.toThrow(
    'source mismatch',
  )
  await expect(loadM7QualityCache(directory, identity, protocol, 'encoder-v2')).rejects.toThrow(
    'implementation mismatch',
  )
  await expect(loadM7QualityCache(directory, identity, { ...protocol, tools: [] })).rejects.toThrow(
    'protocol mismatch',
  )
  await expect(
    loadM7QualityCache(directory, identity, { ...protocol, split: 'holdout' }),
  ).rejects.toThrow('split mismatch')
})
it('rejects a tampered encoded artifact', async () => {
  const directory = await fixture()
  const cache = await loadM7QualityCache(directory, identity, protocol)
  await writeFile(`${directory}/sample/purejsimage-1.jxl`, Uint8Array.of(0, 10, 0, 42))
  await expect(
    reuseM7QualityPoint(cache, 'sample', 'purejsimage', 1, `${directory}/output`),
  ).rejects.toThrow('artifact changed')
})
it('never treats failed or duplicate coordinates as reusable measurements', async () => {
  for (const points of [[{ ...point, status: 'failed' }], [point, point]]) {
    const directory = await fixture(points)
    const cache = await loadM7QualityCache(directory, identity, protocol)
    await expect(
      reuseM7QualityPoint(cache, 'sample', 'purejsimage', 1, `${directory}/output`),
    ).rejects.toThrow()
  }
})
it('requires raw scores and independent pixel agreement to support a cached measurement', () => {
  expect(() => validateM7CachedPoint({ ...point, ssimulacra2: 91 }, 'purejsimage', 1)).toThrow(
    'raw metrics',
  )
  expect(() =>
    validateM7CachedPoint({ ...point, maximumIndependentDifference: 3 }, 'purejsimage', 1),
  ).toThrow('decoder agreement')
  expect(() => validateM7CachedPoint({ ...point, bytes: 0 }, 'purejsimage', 1)).toThrow(
    'byte count',
  )
})

it('keeps a valid checkpoint beside an interrupted write and replaces it on recovery', async () => {
  const directory = await fixture()
  const path = `${directory}/sample/report.json`
  await writeFile(`${path}.pending`, '{"points":[')
  const previous = await loadM7QualityCache(directory, identity, protocol, 'encoder-v1')
  expect(previous?.points).toEqual([point])
  await writeM7QualityReport(path, {
    ...identity,
    sourceFingerprint: protocol.sourceFingerprint,
    points: [point, { ...point, setting: 2 }],
  })
  const recovered = await loadM7QualityCache(directory, identity, protocol, 'encoder-v1')
  expect(recovered?.points).toHaveLength(2)
  await expect(readFile(`${path}.pending`)).rejects.toMatchObject({ code: 'ENOENT' })
})
