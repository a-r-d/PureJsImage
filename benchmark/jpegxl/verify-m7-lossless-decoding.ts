import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'
import { writeM7QualityReport } from './m7-quality-cache.ts'
import selection from './production-program/m7-corpus-selection.json' with { type: 'json' }

const [runId, caseId] = process.argv.slice(2)
if (!runId || !/^[a-z0-9-]+$/u.test(runId)) throw new Error('Specify a unique run identifier')
const directory = `.tmp/jpegxl-m7/lossless-decoding-${runId}`
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const record = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error('Expected record')
  return value
}
if (caseId === undefined) {
  await mkdir(directory)
  const source: { path: string; sha256: string }[] = []
  for (const path of (await readdir('src', { recursive: true })).sort())
    if (path.endsWith('.ts')) source.push({ path, sha256: hash(await readFile(`src/${path}`)) })
  await writeM7QualityReport(`${directory}/protocol.json`, {
    source,
    harnessSha256: hash(await readFile(import.meta.filename)),
    policy:
      'All 240 frozen SDR lossless outputs. Reuse unchanged multi-group RGB8 artifacts and final single-group replacements. Verify encoded hashes against the independently exact reports, then hash complete ordered repository RGB8 rows against the original normalized sample hash. No re-encoding or reference bitmap required. One fresh child per source; original splits retained.',
  })
  const results: unknown[] = []
  let failures = 0
  for (const entry of selection.cases) {
    const child = spawnSync(process.execPath, [import.meta.filename, runId, entry.id], {
      stdio: 'inherit',
      timeout: 600_000,
    })
    if (child.status !== 0) failures++
    try {
      results.push(JSON.parse(await readFile(`${directory}/${entry.id}.json`, 'utf8')))
    } catch (error) {
      if (child.status === 0) failures++
      results.push({ id: entry.id, status: 'failed', error: String(error), code: child.status })
    }
    await writeM7QualityReport(`${directory}/report.json`, {
      expected: selection.cases.length,
      completed: results.length,
      failures,
      results,
    })
    console.log(
      `${results.length}/${selection.cases.length} lossless repository decodes; ${failures} failures`,
    )
  }
  process.exitCode = failures ? 1 : 0
} else {
  const entry = selection.cases.find((entry) => entry.id === caseId)
  if (!entry) throw new Error('Source is outside the frozen corpus')
  try {
    const single = entry.width <= 1024 && entry.height <= 1024
    const reportPath = single
      ? `.tmp/jpegxl-m7/lossless-${entry.split}-integrated054-single-group-final/${entry.id}.json`
      : `benchmark/jpegxl/production-program/m7-lossless-${entry.split}-typed-palette.json`
    const reportBytes = await readFile(reportPath)
    const report = record(JSON.parse(reportBytes.toString('utf8')))
    const point = single
      ? report
      : (() => {
          if (!Array.isArray(report.results))
            throw new Error('Missing independently verified cases')
          const matches = report.results.map(record).filter((value) => value.id === entry.id)
          if (matches.length !== 1) throw new Error('Missing or duplicate lossless identity')
          return record(matches[0])
        })()
    if (
      point.id !== entry.id ||
      point.sourceSha256 !== entry.sourceSha256 ||
      point.width !== entry.width ||
      point.height !== entry.height ||
      point.status !== 'verified' ||
      typeof point.pureBytes !== 'number' ||
      !Number.isSafeInteger(point.pureBytes) ||
      point.pureBytes <= 0 ||
      typeof point.encodedSha256 !== 'string' ||
      typeof point.normalizedHash !== 'string' ||
      !Array.isArray(point.oracles)
    )
      throw new Error('Invalid independent lossless record')
    const oracles = point.oracles.map(record)
    if (
      oracles.length !== 2 ||
      !['libjxl', 'jxl-rs'].every((name) =>
        oracles.some(
          (oracle) =>
            oracle.oracle === name &&
            oracle.exact === true &&
            oracle.decodedHash === point.normalizedHash,
        ),
      )
    )
      throw new Error('Missing independent exactness proof')
    const candidates = single
      ? [`lossless-${entry.split}-integrated054-single-group-final`]
      : [
          `lossless-${entry.split}-typed-palette-034-snapshot`,
          `lossless-${entry.split}-single-cache-031-snapshot`,
        ]
    let encoded: Uint8Array | undefined, encodedPath: string | undefined
    for (const candidate of candidates) {
      const path = `.tmp/jpegxl-m7/${candidate}/${entry.id}-pure-e7.jxl`
      try {
        if ((await stat(path)).size !== point.pureBytes) continue
        const bytes = await readFile(path)
        if (hash(bytes) !== point.encodedSha256) continue
        encoded = bytes
        encodedPath = path
        break
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      }
    }
    if (!encoded || !encodedPath)
      throw new Error('No stored artifact matches the independent record')
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
    if (!decoder) throw new Error('Missing repository decoder')
    const digest = createHash('sha256')
    let nextRow = 0,
      samples = 0
    for await (const block of decoder.decode()) {
      try {
        if (
          block.format !== 'rgb8' ||
          block.x !== 0 ||
          block.y !== nextRow ||
          block.width !== entry.width ||
          block.height < 1 ||
          nextRow + block.height > entry.height ||
          block.stride < entry.width * 3
        )
          throw new Error('Invalid lossless row coverage')
        for (let y = 0; y < block.height; y++) {
          const row = block.data.subarray(y * block.stride, y * block.stride + entry.width * 3)
          digest.update(row)
          samples += row.length
        }
        nextRow += block.height
      } finally {
        block.release?.()
      }
    }
    const decodedSha256 = digest.digest('hex')
    if (
      nextRow !== entry.height ||
      samples !== entry.width * entry.height * 3 ||
      decodedSha256 !== point.normalizedHash
    )
      throw new Error('Repository lossless samples differ from the independent reference')
    await writeM7QualityReport(`${directory}/${entry.id}.json`, {
      id: entry.id,
      split: entry.split,
      status: 'passed',
      ownExact: true,
      samples,
      encodedPath,
      encodedSha256: point.encodedSha256,
      decodedSha256,
      independentReport: reportPath,
      independentReportSha256: hash(reportBytes),
      artifactProvenance: single ? 'final single-group replay' : 'unchanged multi-group RGB8 path',
    })
  } catch (error) {
    await writeM7QualityReport(`${directory}/${entry.id}.json`, {
      id: entry.id,
      split: entry.split,
      status: 'failed',
      error: String(error),
    })
    process.exitCode = 1
  }
}
