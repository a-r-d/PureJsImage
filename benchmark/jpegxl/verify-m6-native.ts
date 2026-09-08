/** Correctness and dependency evidence. Run separately from isolated performance measurements. */
import { reportRevision } from './report-provenance.ts'
import { createEvidenceSession } from '../../src/evidence.ts'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { openJpegXlSession, type JpegXlProgressiveRequest } from '../../src/jpegxl.ts'
import sources from './production-program/m6-native-sources.json' with { type: 'json' }

const encodedDirectory = process.argv[2] ?? '.tmp/jpegxl-m6-native/encoded'
const oracleDirectory = process.argv[3] ?? '.tmp/jpegxl-m6-native/oracle'
const output = process.argv[4] ?? '.tmp/jpegxl-m6-m10/m6-native-correctness.json'
const selectedMode = process.argv[5]
const revision = reportRevision()
const results: object[] = []
let failures = 0
for (const entry of sources.entries) {
  const input = new Uint8Array(await readFile(`${encodedDirectory}/${entry.id}.jxl`))
  const inputSha256 = createHash('sha256').update(input).digest('hex')
  const oracleText: unknown = JSON.parse(
    await readFile(`${oracleDirectory}/${entry.id}/manifest.json`, 'utf8'),
  )
  if (
    typeof oracleText !== 'object' ||
    oracleText === null ||
    !('inputSha256' in oracleText) ||
    oracleText.inputSha256 !== inputSha256
  )
    throw new Error('Native reference belongs to another input')
  for (const mode of ['dc', 'pass1', 'pass2', 'viewport', 'final']) {
    if (selectedMode && selectedMode !== mode) continue
    const evidence = createEvidenceSession({ mode: 'summary' })
    let lfDecodes = 0
    evidence.subscribe((event) => {
      if (event.type === 'allocation' && event.category === 'jpegxl-vardct-lf-metadata') lfDecodes++
    })
    const session = await openJpegXlSession(input, {
      evidence: evidence.context,
      maxCachedBytes: 134_217_728,
      limits: { maxDecodedBytes: 2_147_483_648, maxPixels: 100_000_000 },
    })
    const region =
      mode === 'viewport'
        ? {
            x: Math.floor(entry.width / 3),
            y: Math.floor(entry.height / 3),
            width: Math.floor(entry.width / 4),
            height: Math.floor(entry.height / 4),
          }
        : { x: 0, y: 0, width: entry.width, height: entry.height }
    const scale = mode === 'dc' ? 8 : mode === 'pass1' ? 4 : mode === 'pass2' ? 2 : 1
    const stage = mode === 'dc' ? 0 : mode === 'pass1' ? 1 : mode === 'pass2' ? 2 : 3
    const expected = new Uint8Array(
      await readFile(`${oracleDirectory}/${entry.id}/stage-${stage}.bin`),
    )
    if (expected.length !== entry.width * entry.height * 3)
      throw new Error('Invalid native oracle geometry')
    const request: JpegXlProgressiveRequest = {
      region,
      scaleDenominator: scale,
      until: stage === 0 ? 'dc' : stage === 3 ? 'final' : stage,
    }
    let maximum = 0,
      squared = 0,
      samples = 0,
      completed = 0
    const record: Record<string, unknown> = {
      id: entry.id,
      mode,
      inputSha256,
      oracleSha256: createHash('sha256').update(expected).digest('hex'),
      width: entry.width,
      height: entry.height,
      region,
      scale,
    }
    try {
      for await (const event of session.decode(request)) {
        if (event.type === 'stage-complete') {
          completed++
          record.plan = event.stage.plan
        }
        if (event.type !== 'block') continue
        const block = event.block
        if (block.format !== 'rgb8') throw new Error('Unexpected native-photo pixel format')
        for (let row = 0; row < block.height; row++)
          for (let x = 0; x < block.width; x++) {
            const sourceY =
              region.y +
              Math.min(region.height - 1, (block.y + row) * scale + Math.floor(scale / 2))
            const sourceX = region.x + Math.min(region.width - 1, x * scale + Math.floor(scale / 2))
            for (let channel = 0; channel < 3; channel++) {
              const error = Math.abs(
                (expected[(sourceY * entry.width + sourceX) * 3 + channel] ?? 0) -
                  (block.data[row * block.stride + x * 3 + channel] ?? 0),
              )
              maximum = Math.max(maximum, error)
              squared += error * error
              samples++
            }
          }
        block.release?.()
      }
      const expectedSamples = Math.ceil(region.width / scale) * Math.ceil(region.height / scale) * 3
      record.maximum = maximum
      record.rmse = Math.sqrt(squared / samples)
      record.samples = samples
      record.sourceSectionBytes = session.sourceSectionBytes
      record.compressedSectionRatio = session.sourceSectionBytes / input.length
      record.managedPeakBytes = session.managedPeakBytes
      if (
        completed !== 1 ||
        samples !== expectedSamples ||
        maximum > 1 ||
        Math.sqrt(squared / samples) > 0.55
      )
        throw new Error('Independent native stage tolerance failed')
      if (mode === 'dc') {
        const before = session.sourceSectionBytes
        for await (const event of session.decode({ until: 'dc', scaleDenominator: 8 }))
          if (event.type === 'block') event.block.release?.()
        record.lfDecodes = lfDecodes
        if (lfDecodes !== 1) throw new Error('Cached LF state was decoded again')
        record.repeatDcSectionBytes = session.sourceSectionBytes - before
        if (session.sourceSectionBytes !== before)
          throw new Error('Cached LF request transferred additional sections')
      }
      record.status = 'pass'
    } catch (error) {
      record.status = 'fail'
      record.error = String(error)
      failures++
    } finally {
      await session.close()
    }
    results.push(record)
    console.log(entry.id, mode, record.status, record.maximum, record.rmse)
    await writeFile(
      output,
      JSON.stringify(
        {
          schemaVersion: 1,
          revision,
          sourceSelectionFrozenAt: sources.frozenAt,
          tolerance: { maximum: 1, rmse: 0.55 },
          results,
        },
        null,
        2,
      ) + '\n',
    )
  }
}
if (failures) process.exitCode = 1
