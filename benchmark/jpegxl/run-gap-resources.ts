/** Isolated native crop and structured forward-writer measurements, after pixel verification. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { encodeJpegXlNative, openJpegXlSequence } from '../../src/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'
import { gapDecoder, gapSemantics } from '../../tests/helpers/jpegxl-gap-completion.ts'
import { collectJpegXlProfileRows } from '../../tests/helpers/jpegxl-profile-pipeline.ts'

const fixture = '.tmp/jpegxl-gap-resource.jxl'
const width = 4100,
  height = 1025
const region = { x: 1022, y: 1022, width: 5, height: 3 }
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const value = (x: number, y: number): number => (((x + y * 3) % 16) - 4) / 8
const record = (input: unknown): input is Record<string, unknown> =>
  typeof input === 'object' && input !== null

if (process.argv[2] === '--worker') {
  if (!globalThis.gc) throw new Error('Use --expose-gc')
  const mode = process.argv[3]
  if (
    mode !== 'crop-bands' &&
    mode !== 'crop-full' &&
    mode !== 'hlg' &&
    mode !== 'pq' &&
    mode !== 'linear-blend'
  )
    throw new Error('Unknown measurement')
  const input = new Uint8Array(
    await readFile(
      mode === 'linear-blend'
        ? 'tests/fixtures/jpegxl/gap-alpha/vardct-linear-blend-straight.jxl'
        : fixture,
    ),
  )
  const blendReference =
    mode === 'linear-blend'
      ? new Uint8Array(
          gunzipSync(
            await readFile('tests/fixtures/jpegxl/gap-alpha/vardct-linear-blend-straight.bin.gz'),
          ),
        )
      : undefined
  const data = new Uint8Array(256 * 256 * 3)
  for (let i = 0; i < data.length; i++) data[i] = (i * 7 + Math.floor(i / 768) * 11) % 256
  const run = async (): Promise<{ outputSha256: string; encodedBytes: number }> => {
    let output: Uint8Array
    if (mode === 'linear-blend') {
      if (!blendReference) throw new Error('Missing blend reference')
      output = await collectJpegXlProfileRows(await gapDecoder(input))
      if (output.length !== blendReference.length) throw new Error('Blend sample count differs')
      const actual = new DataView(output.buffer, output.byteOffset, output.byteLength),
        expected = new DataView(
          blendReference.buffer,
          blendReference.byteOffset,
          blendReference.byteLength,
        )
      for (let offset = 0; offset < output.length; offset += 4) {
        const difference = Math.abs(
          actual.getFloat32(offset, false) - expected.getFloat32(offset, false),
        )
        if (!Number.isFinite(difference) || difference > (offset % 16 === 12 ? 1.2e-7 : 1 / 255))
          throw new Error('Independent linear blend differs')
      }
    } else if (mode === 'crop-bands') {
      const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
      if (!decoder) throw new Error('Missing native decoder')
      output = await collectJpegXlProfileRows(decoder, region)
    } else if (mode === 'crop-full') {
      const sequence = await openJpegXlSequence(input)
      output = new Uint8Array(region.width * region.height * 4)
      try {
        for await (const layer of sequence.layers()) {
          const plane = layer.planes[0]
          if (!(plane instanceof Int32Array)) throw new Error('Expected native float bits')
          const view = new DataView(output.buffer)
          for (let y = 0; y < region.height; y++)
            for (let x = 0; x < region.width; x++)
              view.setUint32(
                (y * region.width + x) * 4,
                (plane[(region.y + y) * width + region.x + x] ?? 0) >>> 0,
                false,
              )
          break
        }
      } finally {
        await sequence.close()
      }
    } else {
      const sink = new Uint8ArraySink()
      const encoder = await jpegxlCodec.createEncoder?.(sink, {
        width: 256,
        height: 256,
        pixelFormat: 'rgb8',
        colorSemantics: { ...gapSemantics, transfer: { kind: mode } },
        options: {
          mode: 'lossy',
          distance: 1,
          effort: 1,
          toneMapping: {
            intensityTarget: 1500,
            minNits: 0,
            relativeToMaxDisplay: false,
            linearBelow: 0,
          },
        },
      })
      if (!encoder) throw new Error('Missing forward writer')
      await encoder.write({
        x: 0,
        y: 0,
        width: 256,
        height: 256,
        format: 'rgb8',
        stride: 768,
        data,
      })
      await encoder.finish()
      output = sink.toUint8Array()
    }
    if (mode.startsWith('crop-')) {
      const view = new DataView(output.buffer)
      for (let y = 0; y < region.height; y++)
        for (let x = 0; x < region.width; x++)
          if (
            view.getFloat32((y * region.width + x) * 4, false) !== value(region.x + x, region.y + y)
          )
            throw new Error('Crop output differs')
    }
    return {
      outputSha256: hash(output),
      encodedBytes: mode.startsWith('crop-')
        ? 0
        : mode === 'linear-blend'
          ? input.length
          : output.length,
    }
  }
  if (process.argv[4] === 'warm') {
    await run()
    await run()
    globalThis.gc()
    globalThis.gc()
  }
  const baseline = process.memoryUsage(),
    started = performance.now()
  const result = await run()
  const milliseconds = performance.now() - started
  console.log(
    JSON.stringify({
      mode,
      temperature: process.argv[4],
      milliseconds,
      inputMegapixelsPerSecond:
        (mode.startsWith('crop-')
          ? width * height
          : mode === 'linear-blend'
            ? 16 * 16
            : 256 * 256) /
        milliseconds /
        1000,
      absoluteProcessPeakRss: process.resourceUsage().maxRSS * 1024,
      baseline,
      after: process.memoryUsage(),
      ...result,
    }),
  )
} else {
  await mkdir('.tmp', { recursive: true })
  const values = Float32Array.from({ length: width * height }, (_, i) =>
    value(i % width, Math.floor(i / width)),
  )
  const input = await encodeJpegXlNative({
    width,
    height,
    color: [{ data: new Uint32Array(values.buffer), bitDepth: 32, sampleFormat: 'binary32' }],
  })
  await writeFile(fixture, input)
  const oracleDirectory = '.tmp/jpegxl-gap-resource-oracle'
  execFileSync(
    'bun',
    [
      'benchmark/jpegxl/flush-progressive-oracle.ts',
      fixture,
      oracleDirectory,
      'native-planes-float32',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const metadata: unknown = JSON.parse(await readFile(`${oracleDirectory}/manifest.json`, 'utf8'))
  if (!record(metadata) || !Array.isArray(metadata.stages)) throw new Error('Invalid oracle stages')
  const last: unknown = metadata.stages.at(-1)
  if (!record(last) || typeof last.file !== 'string') throw new Error('Invalid oracle frame')
  const reference = new Uint8Array(await readFile(`${oracleDirectory}/${last.file}`))
  if (reference.length !== values.length * 4) throw new Error('Oracle sample count differs')
  const view = new DataView(reference.buffer)
  for (let i = 0; i < values.length; i++)
    if (view.getFloat32(i * 4, false) !== values[i])
      throw new Error('Independent native samples differ')
  const rows: unknown[] = []
  for (const mode of ['crop-full', 'crop-bands', 'hlg', 'pq', 'linear-blend'])
    for (const temperature of ['cold', 'warm']) {
      const row: unknown = JSON.parse(
        execFileSync(
          process.execPath,
          ['--expose-gc', 'benchmark/jpegxl/run-gap-resources.ts', '--worker', mode, temperature],
          { encoding: 'utf8' },
        ),
      )
      if (!record(row) || typeof row.outputSha256 !== 'string')
        throw new Error('Invalid measurement')
      rows.push(row)
    }
  await writeFile(
    'benchmark/jpegxl/gap-completion/native-resources.json',
    `${JSON.stringify({ schemaVersion: 1, node: process.version, methodology: 'Isolated processes. Full-plane native extraction and cropped group bands use the identical independently verified input and output crop. Warm runs follow two workflows and two GC calls; absolute peak RSS includes warmup. Forward HLG/PQ rows measure new writer paths; separate color checks qualify decoder compatibility, with no speed comparison claimed. Linear blend rows check color within 1/255 and alpha within 0.00000012 against a pinned libjxl reference. Input throughput for crop rows counts the source image and does not describe actual decoded work.', inputSha256: hash(input), oracleSha256: hash(reference), width, height, region, rows }, null, 2)}\n`,
  )
  console.log(`Verified ${rows.length} native crop and forward HDR resource cases`)
}
