/** Verify repository decoding of every generated point in a completed frozen quality run. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { validateM7CachedPoint } from './m7-quality-cache.ts'
import { verifyM7QualityPixels } from './m7-quality-decoding.ts'
import selection from './production-program/m7-corpus-selection.json' with { type: 'json' }

const [runId, qualityDirectory, caseId] = process.argv.slice(2)
if (!runId || !/^[a-z0-9-]+$/u.test(runId) || !qualityDirectory)
  throw new Error('Usage: verify-m7-quality-decoding.ts unique-run-id quality-directory')
const directory = `.tmp/jpegxl-m7/quality-decoding-${runId}`
const native = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/djxl'
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const record = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error('Expected quality report object')
  return value
}
const protocol = record(JSON.parse(await readFile(`${qualityDirectory}/protocol.json`, 'utf8')))
const split = protocol.split
if (split !== 'development' && split !== 'holdout') throw new Error('Missing frozen split')
const cases = selection.cases.filter((entry) => entry.split === split)
const tools = protocol.tools
if (!Array.isArray(tools)) throw new Error('Missing quality oracle fingerprint')
const nativeTool = tools.map(record).find((entry) => entry.path === native)
if (nativeTool?.sha256 !== hash(await readFile(native))) throw new Error('Native oracle changed')

if (caseId === undefined) {
  await mkdir(directory, { recursive: false })
  const source: { name: string; sha256: string }[] = []
  for (const name of (
    await readdir(new URL('../../src/', import.meta.url), { recursive: true })
  ).sort())
    if (name.endsWith('.ts'))
      source.push({
        name,
        sha256: hash(await readFile(new URL(`../../src/${name}`, import.meta.url))),
      })
  await writeFile(
    `${directory}/protocol.json`,
    `${JSON.stringify(
      {
        qualityDirectory,
        split,
        expectedSources: cases.length,
        expectedPoints: cases.length * 6,
        source,
        harnessSha256: hash(await readFile(import.meta.filename)),
        pixelVerifierSha256: hash(
          await readFile(new URL('./m7-quality-decoding.ts', import.meta.url)),
        ),
        qualityProtocolSha256: hash(await readFile(`${qualityDirectory}/protocol.json`)),
        startedAt: new Date().toISOString(),
        policy:
          'All six PureJsImage points for every frozen source. Verify encoded hashes, regenerate the pinned native oracle and require its pixel hash to match the scored raster. Repository RGB8 output must have identical dimensions and differ by at most 2 per sample. Missing, failed or changed artifacts fail verification. Each source runs serially in a fresh process; only one native reference bitmap is retained at a time.',
      },
      null,
      2,
    )}\n`,
  )
  let failures = 0
  const results: unknown[] = []
  for (const entry of cases) {
    const child = spawnSync(
      process.execPath,
      [import.meta.filename, runId, qualityDirectory, entry.id],
      {
        stdio: 'inherit',
        timeout: 1_200_000,
      },
    )
    if (child.status !== 0) failures++
    try {
      results.push(JSON.parse(await readFile(`${directory}/${entry.id}/report.json`, 'utf8')))
    } catch (error) {
      if (child.status === 0) failures++
      results.push({
        id: entry.id,
        status: 'failed',
        error: String(error),
        processStatus: child.status,
      })
    }
    await writeFile(
      `${directory}/report.json`,
      `${JSON.stringify({ failures, completedSources: results.length, expectedSources: cases.length, results }, null, 2)}\n`,
    )
    console.log(
      `${results.length}/${cases.length} repository decoder sources; ${failures} failures`,
    )
  }
  process.exitCode = failures === 0 ? 0 : 1
} else {
  const entry = cases.find((entry) => entry.id === caseId)
  if (!entry) throw new Error('Source is outside the frozen split')
  const path = `${directory}/${entry.id}`
  await mkdir(path, { recursive: false })
  const results: object[] = []
  try {
    const report = record(
      JSON.parse(await readFile(`${qualityDirectory}/${entry.id}/report.json`, 'utf8')),
    )
    if (
      report.sourceSha256 !== entry.sourceSha256 ||
      report.sourceFingerprint !== protocol.sourceFingerprint ||
      report.width !== entry.width ||
      report.height !== entry.height ||
      !Array.isArray(report.points)
    )
      throw new Error('Quality source identity mismatch')
    for (const setting of [0.25, 0.5, 1, 2, 3, 5]) {
      const points = report.points
        .map(record)
        .filter((point) => point.engine === 'purejsimage' && point.setting === setting)
      if (points.length !== 1) throw new Error('Missing or duplicate quality coordinate')
      const point = validateM7CachedPoint(points[0], 'purejsimage', setting)
      const encodedPath = `${qualityDirectory}/${entry.id}/purejsimage-${setting}.jxl`
      const encoded = await readFile(encodedPath)
      if (encoded.length !== point.bytes || hash(encoded) !== point.encodedSha256)
        throw new Error('Encoded quality artifact changed')
      const oraclePath = `${path}/reference.ppm`
      const child = spawnSync(
        native,
        [encodedPath, oraclePath, '--num_threads=1', '--bits_per_sample=8'],
        {
          encoding: 'utf8',
          timeout: 600_000,
          maxBuffer: 4_194_304,
        },
      )
      if (child.status !== 0) throw new Error(`Native decode failed: ${child.stderr}`)
      const bytes = await readFile(oraclePath)
      const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/u.exec(bytes.subarray(0, 100).toString('ascii'))
      if (
        !header ||
        Number(header[1]) !== entry.width ||
        Number(header[2]) !== entry.height ||
        bytes.length !== header[0].length + entry.width * entry.height * 3
      )
        throw new Error('Native oracle extent changed')
      const expected = bytes.subarray(header[0].length)
      if (hash(expected) !== point.decodedSha256) throw new Error('Scored native pixels changed')
      const comparison = await verifyM7QualityPixels(encoded, expected, entry.width, entry.height)
      results.push({
        setting,
        ...comparison,
        encodedSha256: point.encodedSha256,
        decodedSha256: point.decodedSha256,
      })
      await unlink(oraclePath)
    }
    await writeFile(
      `${path}/report.json`,
      `${JSON.stringify({ id: entry.id, status: 'passed', results }, null, 2)}\n`,
    )
  } catch (error) {
    await writeFile(
      `${path}/report.json`,
      `${JSON.stringify({ id: entry.id, status: 'failed', error: String(error), results }, null, 2)}\n`,
    )
    process.exitCode = 1
  }
}
