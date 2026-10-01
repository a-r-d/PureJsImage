/** Isolated ordinary binary32 decode, checked against the official libjxl PFM reference. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

const input = new Uint8Array(await readFile('tests/fixtures/jpegxl/m10-level10/lossless-pfm.jxl'))
const reference = new Uint8Array(
  await readFile('.tmp/jpegxl-conformance/testcases/lossless_pfm/ref.pfm'),
)
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
if (digest(input) !== '61ae52b5851ab2e156aec1d22502e8e1ec0cdf6bc0d6a3956ac6d7d6d2969d5e')
  throw new Error('Pinned float input differs')
if (digest(reference) !== '8203553df55ec1cd70b51f3c39457c92c90a87de18d903c91b4756697be6f8b5')
  throw new Error('Pinned official PFM reference differs')
const header = new TextDecoder().decode(reference.subarray(0, 16))
if (header !== 'PF\n500 500\n-1.0\n' || reference.length !== 16 + 500 * 500 * 12)
  throw new Error('Invalid pinned PFM layout')
if (process.argv[2] === '--worker') {
  if (!globalThis.gc) throw new Error('Run isolated workers with --expose-gc')
  const warm = process.argv[3] === 'warm',
    cropped = process.argv[4] === 'crop'
  const region = cropped
    ? { x: 249, y: 249, width: 7, height: 7 }
    : { x: 0, y: 0, width: 500, height: 500 }
  const oracle = new DataView(reference.buffer, reference.byteOffset + 16)
  const run = async () => {
    const baseline = process.memoryUsage(),
      started = performance.now()
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
    if (decoder?.pixelFormat !== 'rgbf32') throw new Error('Float decoder unavailable')
    let rows = 0
    for await (const block of decoder.decode(region)) {
      if (block.y !== rows || block.width !== region.width || block.height !== 1)
        throw new Error('Float geometry differs')
      const actual = new DataView(block.data.buffer, block.data.byteOffset)
      for (let x = 0; x < region.width; x++)
        for (let c = 0; c < 3; c++) {
          const offset = ((499 - (region.y + rows)) * 500 + region.x + x) * 12 + c * 4
          if (!Object.is(actual.getFloat32(x * 12 + c * 4, false), oracle.getFloat32(offset, true)))
            throw new Error('Float sample differs from official PFM')
        }
      rows++
      block.release?.()
    }
    if (rows !== region.height) throw new Error('Float rows missing')
    const milliseconds = performance.now() - started
    return {
      temperature: warm ? 'warm' : 'cold',
      region,
      milliseconds,
      outputMegapixelsPerSecond: (region.width * region.height) / milliseconds / 1000,
      absoluteProcessPeakRss: process.resourceUsage().maxRSS * 1024,
      estimatedWorkingBytes: decoder.execution?.estimatedWorkingBytes,
      fullFrameFallbackReasons: decoder.execution?.fullFrameFallbackReasons,
      baseline,
      after: process.memoryUsage(),
      inputSha256: digest(input),
      referenceSha256: digest(reference),
      exact: true,
    }
  }
  let result: unknown
  for (let iteration = 0; iteration < (warm ? 3 : 1); iteration++) {
    globalThis.gc()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    globalThis.gc()
    result = await run()
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
} else {
  const rows: unknown[] = []
  for (const temperature of ['cold', 'warm'])
    for (const region of ['full', 'crop']) {
      const row: unknown = JSON.parse(
        execFileSync(
          process.execPath,
          ['--expose-gc', import.meta.filename, '--worker', temperature, region],
          { encoding: 'utf8', timeout: 60000 },
        ),
      )
      rows.push(row)
    }
  const output = process.argv[2] ?? '.tmp/jpegxl-float-pipeline-resource.json'
  await writeFile(
    output,
    `${JSON.stringify(
      {
        node: process.version,
        methodology:
          'Isolated cold and warm processes; warm records follow two completed decodes and two GC calls. Every output sample is bit-exact to official libjxl PFM. Baselines include fixed oracle bytes; peak RSS includes warmup. Crops still decode full native channel planes and emitted pixels use rows.',
        rows,
      },
      null,
      2,
    )}\n`,
  )
  process.stdout.write(`Verified ${rows.length} isolated float resource cases: ${output}\n`)
}
