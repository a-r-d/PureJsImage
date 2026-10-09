import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { jpegxlCodec } from '../../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../../src/limits.ts'
import { Uint8ArraySink } from '../../../src/sink.ts'
import { initialize } from '../comparison/adapters.ts'
import { hash, metrics, oracle, work } from '../comparison/io.ts'
import { number, object } from '../comparison/model.ts'
import { parseButteraugliOutput, parseSsimulacra2Output } from './metrics.ts'
import { type CurvePoint, parsePoint } from './model.ts'

const [engine, reference, directory, settingsArgument] = process.argv.slice(2)
if (
  (engine !== 'purejsimage' && engine !== 'jsquash' && engine !== 'vips') ||
  !reference ||
  !directory ||
  !settingsArgument
)
  throw new Error('Usage: worker.ts engine reference.png output-directory comma-separated-settings')
const settings = settingsArgument.split(',').map(Number)
if (!settings.length || settings.some((setting) => !Number.isFinite(setting) || setting <= 0))
  throw new Error('Invalid settings ladder')
const image = PNG.sync.read(await readFile(reference))
const pixels = {
  width: image.width,
  height: image.height,
  channels: 4,
  data: new Uint8Array(image.data),
  interpretation: 'srgb',
}
const originalHash = hash(pixels.data)
for (let offset = 3; offset < pixels.data.length; offset += 4)
  if (pixels.data[offset] !== 255) throw new Error('Photo lab requires opaque RGBA8')
await mkdir(directory, { recursive: true })
if (!('ImageData' in globalThis))
  Object.defineProperty(globalThis, 'ImageData', {
    value: class {
      readonly data: Uint8ClampedArray
      readonly width: number
      readonly height: number
      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data
        this.width = width
        this.height = height
      }
    },
  })
const adapter =
  engine === 'purejsimage'
    ? null
    : await initialize(
        engine,
        async (name) => Uint8Array.from(await readFile(`${work}/assets/${name}`)).buffer,
      )
const run = (tool: string, args: string[]): string =>
  execFileSync(tool, args, {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 4 * 1024 ** 2,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
const points: CurvePoint[] = []
const failures: { setting: number; error: string }[] = []
if (process.argv.includes('--append')) {
  const saved = object(JSON.parse(await readFile(join(directory, 'result.json'), 'utf8')))
  if (
    saved.fixtureSha256 !== hash(await readFile(reference)) ||
    saved.engine !== engine ||
    !Array.isArray(saved.points)
  )
    throw new Error('Cached peer fixture changed')
  points.push(...saved.points.map(parsePoint))
}
try {
  for (const setting of settings) {
    try {
      const started = performance.now()
      let bytes: Uint8Array
      let managedPeakBytes: number | null = null
      if (engine === 'purejsimage') {
        const sink = new Uint8ArraySink()
        const encoder = await jpegxlCodec.createEncoder?.(sink, {
          width: pixels.width,
          height: pixels.height,
          pixelFormat: 'rgba8',
          limits: defaultImageLimits,
          options: { mode: 'lossy', effort: 7, distance: setting },
          colorSemantics: {
            family: 'rgb',
            primaries: 'srgb',
            transfer: { kind: 'srgb' },
            matrix: 'identity',
            range: 'full',
            alpha: 'straight',
            provenance: 'container-signaled',
            renderingIntent: 'relative',
          },
        })
        if (!encoder) throw new Error('Public encoder missing')
        await encoder.write({
          x: 0,
          y: 0,
          width: pixels.width,
          height: pixels.height,
          stride: pixels.width * 4,
          format: 'rgba8',
          data: pixels.data,
        })
        await encoder.finish()
        bytes = sink.toUint8Array()
        if (!('managedPeakBytes' in encoder)) throw new Error('Managed peak missing')
        managedPeakBytes = number(encoder.managedPeakBytes)
        if (
          !('managedLiveBytes' in encoder) ||
          encoder.managedLiveBytes !== 0 ||
          !('managedLiveAllocations' in encoder) ||
          encoder.managedLiveAllocations !== 0
        )
          throw new Error('Encoder scratch retained')
      } else {
        if (!adapter?.encode) throw new Error('Public peer encoder missing')
        const encoded = await adapter.encode(pixels, { effort: 7, lossless: false, value: setting })
        if (encoded.kind !== 'jxl') throw new Error('Encoder did not return JPEG XL')
        bytes = encoded.bytes
      }
      const encodeMs = performance.now() - started
      if (hash(pixels.data) !== originalHash) throw new Error('Encoder changed input pixels')
      const artifact = join(directory, `${setting}.jxl`)
      const decoded = join(directory, `${setting}.png`)
      await writeFile(artifact, bytes)
      run(`${oracle}/djxl`, [artifact, decoded, '--num_threads=1', '--bits_per_sample=8'])
      const decodedImage = PNG.sync.read(await readFile(decoded))
      if (decodedImage.width !== image.width || decodedImage.height !== image.height)
        throw new Error('Decoded dimensions changed')
      for (let offset = 3; offset < decodedImage.data.length; offset += 4)
        if (decodedImage.data[offset] !== 255) throw new Error('Decoded alpha changed')
      const ba = parseButteraugliOutput(run(`${metrics}/butteraugli_main`, [reference, decoded]))
      const point: CurvePoint = {
        setting,
        bytes: bytes.length,
        encodeMs,
        managedPeakBytes,
        processPeakRssBytes: process.resourceUsage().maxRSS * 1024,
        ssimulacra2: parseSsimulacra2Output(run(`${metrics}/ssimulacra2`, [reference, decoded])),
        butteraugliMax: ba.max,
        butteraugliNorm3: ba.norm3,
      }
      points.push(point)
      console.log(JSON.stringify({ engine, ...point }))
    } catch (error) {
      failures.push({ setting, error: error instanceof Error ? error.message : String(error) })
    }
    await writeFile(
      join(directory, 'result.json'),
      `${JSON.stringify({ engine, reference, fixtureSha256: hash(await readFile(reference)), width: image.width, height: image.height, effort: 7, points, failures }, null, 2)}\n`,
    )
  }
} finally {
  adapter?.close()
}
if (failures.length) process.exitCode = 1
