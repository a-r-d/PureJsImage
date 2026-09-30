import { readFile, writeFile } from 'node:fs/promises'
import { execute, type Job } from './execute.ts'
import { hash, json, raw, work } from './io.ts'
import { number, object, parseFixture, string, subjects } from './model.ts'

const config: unknown = JSON.parse(await readFile(process.argv[2] ?? '', 'utf8')),
  v = object(config),
  subject = subjects.find((s) => s === v.subject),
  operation = v.operation
if (
  !subject ||
  (operation !== 'decode-lossless' &&
    operation !== 'decode-lossy' &&
    operation !== 'encode' &&
    operation !== 'roundtrip')
)
  throw new Error('Invalid job')
const settings = object(v.settings)
if (typeof settings.lossless !== 'boolean') throw new Error('Invalid lossless setting')
const job: Job = {
  subject,
  operation,
  fixture: parseFixture(v.fixture),
  settings: {
    lossless: settings.lossless,
    effort: number(settings.effort),
    value: number(settings.value),
  },
  repeats: number(v.repeats),
}
// jSquash documents this ImageData shim for Node; no image work happens here.
if (!('ImageData' in globalThis))
  Object.defineProperty(globalThis, 'ImageData', {
    value: class {
      data: Uint8ClampedArray
      width: number
      height: number
      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data
        this.width = width
        this.height = height
      }
    },
    configurable: true,
  })
const input = await readFile(
    job.operation === 'decode-lossy'
      ? (job.fixture.lossy ?? job.fixture.lossless)
      : job.fixture.lossless,
  ),
  pixels = await raw(job.fixture)
const baseline = process.memoryUsage(),
  result = await execute(
    job,
    input,
    pixels,
    async (name) => new Uint8Array(await readFile(`${work}/assets/${name}`)).buffer,
  )
const { output, ...measurement } = result
const prefix = string(v.output)
let descriptor: unknown = null
if (output) {
  const bytes =
    output.kind === 'pixels'
      ? new Uint8Array(
          output.pixels.data.buffer,
          output.pixels.data.byteOffset,
          output.pixels.data.byteLength,
        )
      : output.bytes
  await writeFile(`${prefix}.bin`, bytes)
  descriptor =
    output.kind === 'pixels'
      ? {
          ...output.pixels,
          data: undefined,
          sampleType:
            output.pixels.data instanceof Uint16Array
              ? 'uint16'
              : output.pixels.data instanceof Float32Array
                ? 'float32'
                : 'uint8',
          kind: output.kind,
          sha256: hash(bytes),
          bytes: bytes.length,
        }
      : { kind: output.kind, sha256: hash(bytes), bytes: bytes.length }
}
await json(`${prefix}.json`, {
  ...measurement,
  output: descriptor,
  memory: {
    baseline,
    after: process.memoryUsage(),
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
    scope:
      'isolated Node process including wrapper, WASM, adapters and input; no metric subprocess',
    wasmLinearMemoryBytes: null,
  },
})
