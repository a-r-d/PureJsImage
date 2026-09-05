import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import manifest from '../../tests/fixtures/jpegxl/remediation/manifest.json' with { type: 'json' }
import { reportArgument, reportRevision } from './report-provenance.ts'

const directory = await mkdtemp(join(tmpdir(), 'jpegxl-remediation-oracle-'))
const tools = reportArgument(
  '--tools',
  '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools',
)
const results = []
try {
  for (const entry of manifest.cases) {
    const inputPath = `tests/fixtures/jpegxl/remediation/${entry.id}.jxl`,
      outputPath = join(directory, `${entry.id}.npy`)
    const input = await readFile(inputPath),
      expected = await readFile(`tests/fixtures/jpegxl/remediation/${entry.id}.bin`)
    const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
    if (digest(input) !== entry.sha256 || digest(expected) !== entry.pixelsSha256)
      throw new Error(`${entry.id}: pinned bytes changed`)
    const decoded = spawnSync(join(tools, 'djxl'), [inputPath, outputPath, '--num_threads=1'], {
      encoding: 'utf8',
    })
    if (decoded.status !== 0) throw new Error(decoded.stderr || String(decoded.error))
    const actual = await readFile(outputPath)
    if (actual.subarray(0, 6).toString('latin1') !== '\x93NUMPY' || actual[6] !== 1)
      throw new Error('Unexpected NumPy version')
    const offset = 10 + actual.readUInt16LE(8)
    if (actual.length - offset !== expected.length) throw new Error('Oracle sample count changed')
    let maximumError = 0
    for (let i = 0; i < expected.length; i += 4) {
      const error = Math.abs(actual.readFloatLE(offset + i) - expected.readFloatBE(i))
      if (!Number.isFinite(error)) throw new Error('Nonfinite oracle sample')
      maximumError = Math.max(maximumError, error)
    }
    if (maximumError > 1e-7)
      throw new Error(`${entry.id}: independent samples changed by ${maximumError}`)
    results.push({
      id: entry.id,
      inputSha256: entry.sha256,
      pixelsSha256: entry.pixelsSha256,
      maximumError,
      passed: true,
    })
  }
  const report = {
    schemaVersion: 1,
    revision: reportRevision(),
    oracleRevision: manifest.libjxlRevision,
    passed: true,
    results,
  }
  await writeFile(
    reportArgument('--output', '.tmp/pr35-remediation/evidence/remediation-fixtures.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.log(`Verified ${results.length} independent HDR/alpha fixture references`)
} finally {
  await rm(directory, { recursive: true, force: true })
}
