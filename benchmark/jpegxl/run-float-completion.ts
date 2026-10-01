/** Isolated cold/warm decode, crop, HDR and float-preserving encode resource checks. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createImageLibrary } from '../../src/browser.ts'
import type { DecoderOptions } from '../../src/codec.ts'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'
import composed from '../../tests/fixtures/jpegxl/composed-native/manifest.json' with {
  type: 'json',
}
import manifest from '../../tests/fixtures/jpegxl/float-completion/manifest.json' with {
  type: 'json',
}
import { compareJpegXlCompletionSamples } from '../../tests/helpers/jpegxl-float-completion.ts'
import { collectJpegXlProfileRows } from '../../tests/helpers/jpegxl-profile-pipeline.ts'

const fixtures = [
  ...manifest.fixtures.map((fixture) => ({ ...fixture, directory: 'float-completion' })),
  ...composed.fixtures.map((fixture) => ({ ...fixture, directory: 'composed-native' })),
]
const selected = new Set([
  'rgb32-icc-associated-grouped',
  'rgb16-icc-mab',
  'pq32-rec2020',
  'hlg16-p3-alpha',
  'linear32-rec2020-headroom',
  'float32-multiply-grouped-0',
  'cmyk16-associated-grouped-0',
  'float32-icc-blend-animation-2',
  'pq32-associated-animation-2',
  'hlg32-blend-animation-2',
])
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
if (process.argv[2] === '--worker') {
  const fixture = fixtures.find((fixture) => fixture.id === process.argv[3])
  if (!fixture || !globalThis.gc) throw new Error('Unknown resource fixture or missing --expose-gc')
  const warm = process.argv[4] === 'warm',
    cropped = process.argv[5] === 'crop',
    mode = process.argv[6]
  if (mode !== 'decode' && mode !== 'linear' && mode !== 'encode')
    throw new Error('Unknown resource mode')
  const root = resolve(`tests/fixtures/jpegxl/${fixture.directory}`)
  const input = new Uint8Array(await readFile(`${root}/${fixture.file}`))
  const reference = gunzipSync(
    await readFile(`${root}/${fixture.id}${mode === 'linear' ? '.linear' : ''}.bin.gz`),
  )
  if (hash(input) !== fixture.sha256) throw new Error('Resource fixture hash differs')
  const options: DecoderOptions = {
    ...('animation' in fixture && fixture.animation ? { frame: fixture.frame } : {}),
    ...(fixture.category === 'icc' ? { colorOutput: 'srgb' } : {}),
    ...(fixture.category === 'hdr'
      ? { hdrOutput: mode === 'linear' ? 'linear-float' : 'tone-map-srgb' }
      : {}),
  }
  const channels = fixture.format.startsWith('gray') ? 1 : fixture.format.startsWith('rgba') ? 4 : 3
  const format = mode === 'linear' ? (channels === 4 ? 'rgbaf32' : 'rgbf32') : fixture.format
  const sampleBytes = format.endsWith('f32') ? 4 : format.endsWith('16') ? 2 : 1
  const region = cropped
    ? { x: 1018, y: 0, width: 7, height: fixture.height }
    : { x: 0, y: 0, width: fixture.width, height: fixture.height }
  const expected = new Uint8Array(region.width * region.height * channels * sampleBytes)
  for (let y = 0; y < region.height; y++) {
    const start = (y * fixture.width + region.x) * channels * sampleBytes
    expected.set(
      reference.subarray(start, start + region.width * channels * sampleBytes),
      y * region.width * channels * sampleBytes,
    )
  }
  const Image = createImageLibrary({ codecs: [jpegxlCodec] })
  const run = async () => {
    const baseline = process.memoryUsage(),
      started = performance.now()
    let decoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(input),
      defaultImageLimits,
      options,
    )
    if (!decoder || decoder.pixelFormat !== format)
      throw new Error('Resource native format differs')
    const execution = decoder.execution
    let output: Uint8Array,
      encodedBytes = 0
    if (mode === 'encode') {
      const image = await Image.open(input, options)
      const encoded = await (cropped ? image.crop(region) : image).jpegxl().toUint8Array()
      encodedBytes = encoded.byteLength
      decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
      if (!decoder || decoder.pixelFormat !== format)
        throw new Error('Resource encoding loses precision')
      output = await collectJpegXlProfileRows(decoder)
    } else output = await collectJpegXlProfileRows(decoder, region)
    const elapsed = performance.now() - started
    const result = compareJpegXlCompletionSamples(output, expected, format)
    const colorTolerance = mode === 'linear' ? fixture.linearTolerance : fixture.colorTolerance
    const alphaTolerance = format.endsWith('f32') ? 0.000002 : fixture.category === 'cmyk' ? 1 : 0
    if (result.maximumColor > colorTolerance || result.maximumAlpha > alphaTolerance)
      throw new Error('Resource output differs from independent reference')
    return {
      id: fixture.id,
      category: fixture.category,
      mode,
      temperature: warm ? 'warm' : 'cold',
      region: cropped ? 'crop' : 'full',
      milliseconds: elapsed,
      outputMegapixelsPerSecond: (region.width * region.height) / elapsed / 1000,
      absoluteProcessPeakRss: process.resourceUsage().maxRSS * 1024,
      baseline,
      after: process.memoryUsage(),
      inputBytes: input.byteLength,
      encodedBytes,
      estimatedWorkingBytes: execution?.estimatedWorkingBytes,
      fullFrameFallbackReasons: execution?.fullFrameFallbackReasons,
      ...result,
      outputSha256: hash(output),
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
  const output = resolve(process.argv[2] ?? '.tmp/jpegxl-float-completion-resource.json'),
    rows: unknown[] = []
  for (const fixture of fixtures)
    if (selected.has(fixture.id))
      for (const temperature of ['cold', 'warm'])
        for (const region of fixture.width > 1024 ? ['full', 'crop'] : ['full'])
          for (const mode of fixture.category === 'hdr'
            ? ['decode', 'linear', 'encode']
            : ['decode', 'encode']) {
            const row: unknown = JSON.parse(
              execFileSync(
                process.execPath,
                [
                  '--expose-gc',
                  import.meta.filename,
                  '--worker',
                  fixture.id,
                  temperature,
                  region,
                  mode,
                ],
                { encoding: 'utf8', timeout: 60_000 },
              ),
            )
            if (typeof row !== 'object' || row === null) throw new Error('Invalid resource row')
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
          'One isolated process per row. Warm runs follow two complete workflows and two GC calls before measurement. Absolute peak RSS includes warmup, while baseline and after include external and ArrayBuffer memory. Validate all output against pinned libjxl, LittleCMS or FFmpeg references before reporting timing. Grouped crops cross x=1024. Composition retains canvas/reference planes; encoder stages planar Float32 bits and native compressed output.',
        rows,
      },
      null,
      2,
    )}\n`,
  )
  process.stdout.write(`Verified ${rows.length} isolated completion resource cases: ${output}\n`)
}
