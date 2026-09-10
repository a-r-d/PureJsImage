import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import type { PixelColorSemantics } from '../../src/color.ts'
import { inspectJpegXl } from '../../src/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

const distance = Number(process.argv[2] ?? 1)
const effort = process.argv.includes('--effort7') ? 7 : 3
const directory = `.tmp/jpegxl-m7/forward-color-d${distance}-e${effort}-oracle`
await mkdir(directory, { recursive: true })
const results: object[] = []
let failures = 0
const colors: readonly Readonly<{
  id: string
  primaries: PixelColorSemantics['primaries']
  transfer: PixelColorSemantics['transfer']
}>[] = [
  { id: 'linear', primaries: 'srgb', transfer: { kind: 'linear' } },
  { id: 'p3', primaries: 'display-p3', transfer: { kind: 'srgb' } },
  { id: 'rec2020', primaries: 'rec2020', transfer: { kind: 'linear' } },
  { id: 'pq', primaries: 'rec2020', transfer: { kind: 'pq' } },
]
async function npy(path: string, count: number) {
  const bytes = await readFile(path)
  if (bytes[0] !== 147 || bytes.subarray(1, 6).toString('ascii') !== 'NUMPY' || bytes[6] !== 1)
    throw new Error('Unsupported oracle array header')
  const start = 10 + bytes.readUInt16LE(8)
  const header = bytes.subarray(10, start).toString('ascii')
  if (!header.includes("'<f4'") || bytes.length !== start + count * 4)
    throw new Error(`Unexpected oracle array: ${header}`)
  return Float32Array.from({ length: count }, (_, index) => bytes.readFloatLE(start + index * 4))
}
for (const color of colors)
  for (const depth of [10, 12, 16])
    for (const progressive of [false, true]) {
      const id = `${color.id}-${depth}-${progressive ? 'progressive' : 'single'}`
      try {
        const width = 17,
          height = 13,
          maximum = 2 ** depth - 1
        const pixels = new Uint8Array(width * height * 6),
          view = new DataView(pixels.buffer)
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            view.setUint16((y * width + x) * 6, Math.round((x / (width - 1)) * maximum), false)
            view.setUint16((y * width + x) * 6 + 2, Math.round((y / (height - 1)) * maximum), false)
            view.setUint16((y * width + x) * 6 + 4, Math.round(maximum * 0.3), false)
          }
        const sink = new Uint8ArraySink()
        const encoder = await jpegxlCodec.createEncoder?.(sink, {
          width,
          height,
          pixelFormat: 'rgb16',
          colorSemantics: {
            family: 'rgb',
            primaries: color.primaries,
            transfer: color.transfer,
            matrix: 'identity',
            range: 'full',
            alpha: 'none',
            provenance: 'container-signaled',
            renderingIntent: 'relative',
          },
          options: { mode: 'lossy', distance, effort, sampleBitDepth: depth, progressive },
          limits: defaultImageLimits,
        })
        if (!encoder) throw new Error('Missing encoder')
        await encoder.write({
          x: 0,
          y: 0,
          width,
          height,
          stride: width * 6,
          format: 'rgb16',
          data: pixels,
        })
        await encoder.finish()
        const bytes = sink.toUint8Array(),
          path = `${directory}/${id}.jxl`
        await writeFile(path, bytes)
        const metadata = await inspectJpegXl(bytes)
        const references: Float32Array[] = []
        for (const oracle of ['libjxl', 'jxl-rs']) {
          const output = `${directory}/${id}-${oracle}.npy`
          const decoded = spawnSync(
            oracle === 'libjxl'
              ? '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/djxl'
              : '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli',
            oracle === 'libjxl'
              ? [path, output, '--num_threads=1', '--color_space=RGB_D65_SRG_Rel_Lin']
              : [path, output, '--num-threads', '1', '--data-type', 'f32'],
            { encoding: 'utf8', timeout: 120000 },
          )
          if (decoded.status !== 0) throw new Error(`${oracle}: ${decoded.stderr}`)
          references.push(await npy(output, width * height * 3))
        }
        // jxl-rs emits the original structured profile; compare it in that same domain.
        const originalOutput = `${directory}/${id}-libjxl-original.npy`
        const description =
          color.id === 'p3'
            ? 'DisplayP3'
            : color.id === 'pq'
              ? 'RGB_D65_202_Rel_PeQ'
              : color.id === 'rec2020'
                ? 'RGB_D65_202_Rel_Lin'
                : 'RGB_D65_SRG_Rel_Lin'
        const originalDecoded = spawnSync(
          '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/djxl',
          [path, originalOutput, '--num_threads=1', `--color_space=${description}`],
          { encoding: 'utf8', timeout: 120000 },
        )
        if (originalDecoded.status !== 0) throw new Error(originalDecoded.stderr)
        const original = await npy(originalOutput, width * height * 3)
        const native = references[0],
          rust = references[1]
        if (!native || !rust) throw new Error('Missing oracle')
        let maximumIndependent = 0,
          maximumOwn = 0,
          samples = 0
        const decoder = await jpegxlCodec.createDecoder?.(
          new MemorySource(bytes),
          defaultImageLimits,
        )
        if (!decoder || decoder.pixelFormat !== 'rgbf32')
          throw new Error('Missing linear float output')
        const scale = color.id === 'pq' ? metadata.toneMapping.intensityTarget / 203 : 1
        for await (const block of decoder.decode()) {
          const blockView = new DataView(
            block.data.buffer,
            block.data.byteOffset,
            block.data.byteLength,
          )
          for (let y = 0; y < block.height; y++)
            for (let x = 0; x < width * 3; x++) {
              const offset = (block.y + y) * width * 3 + x
              const expected = native[offset] ?? 0
              maximumIndependent = Math.max(
                maximumIndependent,
                Math.abs((original[offset] ?? 0) - (rust[offset] ?? 0)),
              )
              maximumOwn = Math.max(
                maximumOwn,
                Math.abs(expected - blockView.getFloat32(y * block.stride + x * 4, false) / scale),
              )
              samples++
            }
          block.release?.()
        }
        if (maximumIndependent > 1 / 255 || maximumOwn > 1 / 255)
          throw new Error(`Linear difference independent=${maximumIndependent}, own=${maximumOwn}`)
        results.push({
          id,
          status: 'verified',
          bytes: bytes.length,
          samples,
          maximumIndependent,
          maximumOwn,
          metadata,
        })
        console.log(`${id}: verified`)
      } catch (error) {
        failures++
        results.push({
          id,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        })
        console.log(`${id}: failed`)
      }
    }
await writeFile(`${directory}/report.json`, `${JSON.stringify({ failures, results }, null, 2)}\n`)
if (failures) process.exitCode = 1
