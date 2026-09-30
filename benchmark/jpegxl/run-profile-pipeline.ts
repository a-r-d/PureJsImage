/** Isolated resource measurements with pinned LittleCMS color and exact alpha. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'
import manifest from '../../tests/fixtures/jpegxl/profile-pipeline/manifest.json' with {
  type: 'json',
}

const root = new URL('../../tests/fixtures/jpegxl/profile-pipeline/', import.meta.url)
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
if (process.argv[2] === '--worker') {
  const fixture = manifest.fixtures.find((item) => item.id === process.argv[3])
  if (!fixture) throw new Error('Unknown profile fixture')
  const warm = process.argv[4] === 'warm'
  const cropped = process.argv[5] === 'crop'
  if (!globalThis.gc) throw new Error('Run resource workers with --expose-gc')
  const input = new Uint8Array(await readFile(new URL(`${fixture.id}.jxl`, root)))
  const reference = gunzipSync(await readFile(new URL(`${fixture.id}.bin.gz`, root)))
  if (digest(input) !== fixture.sha256 || digest(reference) !== fixture.referenceSha256)
    throw new Error('Pinned resource input differs')
  const oracle = new DataView(reference.buffer, reference.byteOffset, reference.byteLength)
  const channels = fixture.format.startsWith('gray') ? 1 : fixture.format.startsWith('rgba') ? 4 : 3
  const sampleBytes = fixture.format.endsWith('16') ? 2 : 1
  const region = cropped
    ? { x: 1018, y: 0, width: 7, height: fixture.height }
    : { x: 0, y: 0, width: fixture.width, height: fixture.height }
  const run = async () => {
    const baseline = process.memoryUsage()
    const started = performance.now()
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(input), defaultImageLimits, {
      colorOutput: 'srgb',
    })
    if (!decoder || decoder.pixelFormat !== fixture.format)
      throw new Error('Resource output format differs')
    const hash = createHash('sha256')
    let rows = 0,
      maximumColor = 0,
      maximumAlpha = 0
    for await (const block of decoder.decode(region)) {
      try {
        if (block.x !== 0 || block.y !== rows || block.width !== region.width)
          throw new Error('Resource output geometry differs')
        const actual = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
        for (let y = 0; y < block.height; y++) {
          const rowStart = y * block.stride
          hash.update(
            block.data.subarray(rowStart, rowStart + block.width * channels * sampleBytes),
          )
          for (let x = 0; x < block.width; x++)
            for (let c = 0; c < channels; c++) {
              const offset = rowStart + (x * channels + c) * sampleBytes
              const expectedOffset =
                (((rows + y) * fixture.width + region.x + x) * channels + c) * sampleBytes
              const error = Math.abs(
                sampleBytes === 2
                  ? actual.getUint16(offset, false) - oracle.getUint16(expectedOffset, false)
                  : actual.getUint8(offset) - oracle.getUint8(expectedOffset),
              )
              if (channels === 4 && c === 3) maximumAlpha = Math.max(maximumAlpha, error)
              else maximumColor = Math.max(maximumColor, error)
            }
        }
        rows += block.height
      } finally {
        block.release?.()
      }
    }
    const milliseconds = performance.now() - started
    if (rows !== region.height || maximumColor > fixture.colorTolerance || maximumAlpha !== 0)
      throw new Error('Resource output differs from pinned profile reference')
    const outputPixels = region.width * rows
    return {
      id: fixture.id,
      temperature: warm ? 'warm' : 'cold',
      region: cropped ? 'crop' : 'full',
      milliseconds,
      outputPixels,
      outputMegapixelsPerSecond: outputPixels / milliseconds / 1000,
      inputBytes: input.byteLength,
      estimatedWorkingBytes: decoder.execution?.estimatedWorkingBytes,
      fullFrameFallbackReasons: decoder.execution?.fullFrameFallbackReasons,
      absoluteProcessPeakRss: process.resourceUsage().maxRSS * 1024,
      baseline,
      after: process.memoryUsage(),
      maximumColor,
      maximumAlpha,
      outputSha256: hash.digest('hex'),
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
  const output = resolve(process.argv[2] ?? '.tmp/jpegxl-profile-pipeline-resource.json')
  const rows: unknown[] = []
  for (const fixture of manifest.fixtures)
    for (const temperature of ['cold', 'warm'])
      for (const region of fixture.width > 1024 ? ['full', 'crop'] : ['full']) {
        const row: unknown = JSON.parse(
          execFileSync(
            process.execPath,
            ['--expose-gc', import.meta.filename, '--worker', fixture.id, temperature, region],
            { encoding: 'utf8', timeout: 60_000 },
          ),
        )
        if (typeof row !== 'object' || row === null) throw new Error('Invalid resource report')
        rows.push(row)
      }
  await mkdir(dirname(output), { recursive: true })
  await writeFile(
    output,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        node: process.version,
        methodology:
          'Each row runs in an isolated process. Warm measurements follow two completed decodes and two GC calls before the measured run. Absolute peak RSS includes warmup; baseline/after record external and ArrayBuffer storage. All samples match pinned LittleCMS references within the fixture color tolerance, with exact alpha. Crops cross the 1024-pixel Modular group boundary. Converter tables are added to existing native decoder working storage; this does not change its full-frame fallbacks.',
        rows,
      },
      null,
      2,
    )}\n`,
  )
  process.stdout.write(`Verified ${rows.length} isolated profile resource cases: ${output}\n`)
}
