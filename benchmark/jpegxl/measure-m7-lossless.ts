import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createJpegXlModularEncoder } from '../../src/codecs/jpegxl-modular-encode.ts'
import { Uint8ArraySink } from '../../src/sink.ts'

// One isolated process per sample. Input normalization and native oracles run separately.
const inputPath = process.argv[2]
const outputPath = process.argv[3]
const effort = Number(process.argv[4] ?? 7)
if (!inputPath || !outputPath || ![1, 3, 5, 7].includes(effort))
  throw new Error('Usage: node --expose-gc measure-m7-lossless.ts input.ppm output.jxl effort')
if (!globalThis.gc) throw new Error('Run with --expose-gc for an explicit pre-encode baseline')
const opened = performance.now()
const source = await readFile(inputPath)
const header = /^P6\n(\d+) (\d+)\n(255|65535)\n/u.exec(source.subarray(0, 100).toString('ascii'))
if (!header) throw new Error('Expected normalized RGB PPM with a canonical header')
const width = Number(header[1]),
  height = Number(header[2]),
  high = header[3] === '65535'
const format = high ? 'rgb16' : 'rgb8'
const rowBytes = width * (high ? 6 : 3)
const pixels = source.subarray(header[0].length)
if (!Number.isSafeInteger(rowBytes * height) || pixels.length !== rowBytes * height)
  throw new Error('Input extent does not match samples')
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const inputSha256 = hash(pixels)
const openMilliseconds = performance.now() - opened
globalThis.gc()
const baselineMemory = process.memoryUsage()
const start = performance.now()
const sink = new Uint8ArraySink()
const encoder = await createJpegXlModularEncoder(sink, {
  width,
  height,
  pixelFormat: format,
  colorSemantics: {
    family: 'rgb',
    primaries: 'srgb',
    transfer: { kind: 'srgb' },
    matrix: 'identity',
    range: 'full',
    alpha: 'none',
    provenance: 'assumed-default',
    renderingIntent: 'relative',
  },
  options: { effort },
})
await encoder.write({ x: 0, y: 0, width, height, stride: rowBytes, format, data: pixels })
const coreStart = performance.now()
await encoder.finish()
const coreMilliseconds = performance.now() - coreStart
const encoded = sink.toUint8Array()
const encodeOutputMilliseconds = performance.now() - start
const peakRssBytes = process.resourceUsage().maxRSS * 1024
const finalMemory = process.memoryUsage()
await writeFile(outputPath, encoded)
console.log(
  JSON.stringify({
    runtime: process.version,
    width,
    height,
    format,
    effort,
    inputSha256,
    outputSha256: hash(encoded),
    bytes: encoded.length,
    openMilliseconds,
    coreMilliseconds,
    encodeOutputMilliseconds,
    openEncodeOutputMilliseconds: openMilliseconds + encodeOutputMilliseconds,
    moduleReadySeconds: opened / 1000,
    peakRssBytes,
    baselineMemory,
    finalMemory,
    managedPeakBytes: 'managedPeakBytes' in encoder ? encoder.managedPeakBytes : null,
    managedLiveBytes: 'managedLiveBytes' in encoder ? encoder.managedLiveBytes : null,
    groupSearchEvidence: 'groupSearchEvidence' in encoder ? encoder.groupSearchEvidence : null,
    correctness: 'independent verification required after measurement',
  }),
)
