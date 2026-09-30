/** Isolated cold/warm resource checks; all output alpha uses pinned libjxl samples. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { openJpegXlSession } from '../../src/jpegxl.ts'
import manifest from '../../tests/fixtures/jpegxl/grouped-alpha/manifest.json' with { type: 'json' }

const root = new URL('../../tests/fixtures/jpegxl/grouped-alpha/', import.meta.url)
if (process.argv[2] === '--worker') {
  const fixture = manifest.fixtures.find((item) => item.id === process.argv[3])
  if (!fixture) throw new Error('Unknown grouped alpha fixture')
  const warm = process.argv[4] === 'warm'
  const viewport = process.argv[5] === 'viewport-final'
  if (!globalThis.gc) throw new Error('Run the resource worker with --expose-gc')
  const input = new Uint8Array(await readFile(new URL(fixture.file, root)))
  const reference = gunzipSync(await readFile(new URL(`${fixture.id}.rgba.gz`, root)))
  const oracle = new DataView(reference.buffer, reference.byteOffset, reference.byteLength)
  const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
  if (digest(input) !== fixture.sha256 || digest(reference) !== fixture.referenceSha256)
    throw new Error('Pinned resource input differs')
  const region = viewport
    ? { x: 249, y: 249, width: 22, height: Math.min(10, fixture.height - 249) }
    : undefined
  const scale = viewport ? 1 : 8
  const readSample = (view: DataView, offset: number): number =>
    fixture.format === 'rgba8'
      ? view.getUint8(offset) / 255
      : fixture.format === 'rgba16'
        ? view.getUint16(offset, false) / 65_535
        : view.getFloat32(offset, false)
  let result: unknown
  for (let run = 0; run < (warm ? 3 : 1); run++) {
    globalThis.gc()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    globalThis.gc()
    const baseline = process.memoryUsage()
    const started = performance.now()
    const session = await openJpegXlSession(input, { maxCachedBytes: 0 })
    const hash = createHash('sha256')
    let outputPixels = 0,
      maximumAlpha = 0,
      maximumColor = 0
    let workingMemoryClass: string | undefined
    try {
      for await (const event of session.decode({
        until: viewport ? 'final' : 'dc',
        scaleDenominator: scale,
        ...(region ? { region } : {}),
      })) {
        if (event.type === 'stage-start') workingMemoryClass = event.stage.plan.workingMemoryClass
        if (event.type !== 'block') continue
        const block = event.block
        try {
          if (block.format !== fixture.format) throw new Error('Resource output format differs')
          hash.update(block.data)
          const actual = new DataView(
            block.data.buffer,
            block.data.byteOffset,
            block.data.byteLength,
          )
          const sampleBytes = fixture.format === 'rgba8' ? 1 : fixture.format === 'rgba16' ? 2 : 4
          for (let y = 0; y < block.height; y++)
            for (let x = 0; x < block.width; x++) {
              const sourceX =
                (region?.x ?? 0) +
                Math.min((region?.width ?? fixture.width) - 1, x * scale + Math.floor(scale / 2))
              const sourceY =
                (region?.y ?? 0) +
                Math.min(
                  (region?.height ?? fixture.height) - 1,
                  (block.y + y) * scale + Math.floor(scale / 2),
                )
              for (let c = 0; c < 4; c++) {
                const value = readSample(actual, y * block.stride + (x * 4 + c) * sampleBytes)
                const expected =
                  readSample(oracle, ((sourceY * fixture.width + sourceX) * 4 + c) * sampleBytes) *
                  (c === 3 ? 1 : fixture.referenceColorScale)
                if (!Number.isFinite(value))
                  throw new Error('Resource output contains non-finite samples')
                const error = Math.abs(value - expected)
                if (c === 3) maximumAlpha = Math.max(maximumAlpha, error)
                else if (viewport) maximumColor = Math.max(maximumColor, error)
              }
              outputPixels++
            }
        } finally {
          block.release?.()
        }
      }
    } finally {
      await session.close()
    }
    const milliseconds = performance.now() - started
    const alphaTolerance = fixture.format === 'rgbaf32' ? 0.000001 : 0
    const colorTolerance =
      fixture.format === 'rgba8'
        ? 1 / 255 + 1e-12
        : fixture.format === 'rgba16'
          ? 4 / 65_535
          : 0.00012
    if (
      !outputPixels ||
      maximumAlpha > alphaTolerance ||
      maximumColor > colorTolerance ||
      session.managedLiveBytes !== 0
    )
      throw new Error('Resource output failed correctness or release checks')
    result = {
      id: fixture.id,
      temperature: warm ? 'warm' : 'cold',
      stage: viewport ? 'viewport-final' : 'dc-1/8',
      milliseconds,
      outputPixels,
      outputMegapixelsPerSecond: outputPixels / milliseconds / 1000,
      inputBytes: input.byteLength,
      sourceSectionBytes: session.sourceSectionBytes,
      workingMemoryClass,
      managedPeakBytes: session.managedPeakBytes,
      absoluteProcessPeakRss: process.resourceUsage().maxRSS * 1024,
      baseline,
      after: process.memoryUsage(),
      maximumAlpha,
      maximumColor,
      outputSha256: hash.digest('hex'),
    }
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
} else {
  const output = resolve(process.argv[2] ?? '.tmp/jpegxl-grouped-alpha-resource.json')
  const rows: unknown[] = []
  for (const fixture of manifest.fixtures)
    for (const temperature of ['cold', 'warm'])
      for (const stage of ['dc-1/8', 'viewport-final']) {
        const report: unknown = JSON.parse(
          execFileSync(
            process.execPath,
            ['--expose-gc', import.meta.filename, '--worker', fixture.id, temperature, stage],
            { encoding: 'utf8', timeout: 60_000 },
          ),
        )
        if (typeof report !== 'object' || report === null) throw new Error('Invalid worker report')
        rows.push(report)
      }
  await mkdir(dirname(output), { recursive: true })
  await writeFile(
    output,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        node: process.version,
        methodology:
          'Each row runs in its own process. Warm rows follow two completed decodes and two GC calls before measurement. Absolute peak RSS includes warmup; baseline/after include external and ArrayBuffer storage. DC validates alpha; final viewports validate alpha and color against pinned libjxl output.',
        rows,
      },
      null,
      2,
    )}\n`,
  )
  process.stdout.write(`Verified ${rows.length} isolated grouped alpha resource cases: ${output}\n`)
}
