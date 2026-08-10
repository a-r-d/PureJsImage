import { createServer } from 'node:http'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'
import { build } from 'esbuild'
import { GifWriter } from 'omggif'
import { PNG } from 'pngjs'
import { createImageLibrary } from '../src/index.ts'
import { jpegCodec } from '../src/codec-entries/jpeg.ts'
import { pngCodec } from '../src/codec-entries/png.ts'
import { main10PqFixture } from '../benchmark/heif/compatibility/generated-fixtures.ts'

const outputDirectory = resolve('benchmark/.tmp/browser-tests')
const fixtureDirectory = resolve(outputDirectory, 'fixtures')
const port = Number(process.env.PUREJSIMAGE_BROWSER_PORT ?? '4173')

const benchmarkEntries = {
  compatibility: 'browser-tests/compatibility-harness.ts',
  benchmark: 'browser-tests/benchmark-harness.ts',
  'purejsimage-jpeg': 'browser-tests/benchmark/purejsimage-jpeg.ts',
  'purejsimage-png': 'browser-tests/benchmark/purejsimage-png.ts',
  'native-jpeg': 'browser-tests/benchmark/native-jpeg.ts',
  'native-png': 'browser-tests/benchmark/native-png.ts',
  'jsquash-jpeg-decode': 'browser-tests/benchmark/jsquash-jpeg-decode.ts',
  'jsquash-jpeg-encode': 'browser-tests/benchmark/jsquash-jpeg-encode.ts',
  'jsquash-png-decode': 'browser-tests/benchmark/jsquash-png-decode.ts',
  'jsquash-png-encode': 'browser-tests/benchmark/jsquash-png-encode.ts',
  'jsquash-webp-decode': 'browser-tests/benchmark/jsquash-webp-decode.ts',
  'jsquash-webp-encode': 'browser-tests/benchmark/jsquash-webp-encode.ts',
} as const

const alphaFixture = (): Uint8Array => {
  const image = new PNG({ width: 4, height: 3 })
  const alpha = [0, 64, 128, 255] as const
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4
      image.data.set([x * 60, y * 90, (x + y) * 40, alpha[x] ?? 255], offset)
    }
  }
  return PNG.sync.write(image)
}

const webpGraphicFixture = (): Uint8Array => {
  const image = new PNG({ width: 192, height: 128 })
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4
      const panel = x >= 20 && x < 172 && y >= 16 && y < 112
      const stripe = panel && ((x + y) & 15) < 3
      const detail = (x * 13 + y * 7) & 3
      image.data.set(
        stripe
          ? [240 - detail, 96 + detail, 48, 255]
          : panel
            ? [36 + detail, 48 + detail, 72 + detail, 255]
            : [248 - detail, 248 - detail, 248 - detail, 255],
        offset,
      )
    }
  }
  return PNG.sync.write(image)
}

const animatedGifFixture = (): Uint8Array => {
  const output = new Uint8Array(1_024)
  const writer = new GifWriter(output, 2, 2, { loop: 0 })
  const palette = [0x151b17, 0xb7ed55]
  writer.addFrame(0, 0, 2, 2, [0, 1, 1, 0], { delay: 5, palette })
  writer.addFrame(0, 0, 2, 2, [1, 0, 0, 1], { delay: 5, palette })
  return output.slice(0, writer.end())
}

const benchmarkPng = (width = 640, height = 480): Uint8Array => {
  const image = new PNG({ width, height })
  let state = 0x4b1d_5eed
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      state = (Math.imul(state ^ (state >>> 15), 2_246_822_519) + 3_266_489_917) >>> 0
      const offset = (y * image.width + x) * 4
      image.data.set(
        [
          (x + (state & 31)) & 0xff,
          (y + ((state >>> 8) & 31)) & 0xff,
          (x + y + ((state >>> 16) & 31)) & 0xff,
          255,
        ],
        offset,
      )
    }
  }
  return PNG.sync.write(image)
}

const writeSignature = (output: Uint8Array, offset: number, value: string): void => {
  for (let index = 0; index < value.length; index += 1) {
    output[offset + index] = value.charCodeAt(index)
  }
}

const mpfSegment = (
  primaryBytes: number,
  secondaryBytes: number,
  secondaryOffset: number,
): Uint8Array => {
  const payload = new Uint8Array(86)
  const view = new DataView(payload.buffer)
  writeSignature(payload, 0, 'MPF\0')
  writeSignature(payload, 4, 'MM')
  view.setUint16(6, 42, false)
  view.setUint32(8, 8, false)
  view.setUint16(12, 3, false)
  let entry = 14
  view.setUint16(entry, 0xb000, false)
  view.setUint16(entry + 2, 7, false)
  view.setUint32(entry + 4, 4, false)
  writeSignature(payload, entry + 8, '0100')
  entry += 12
  view.setUint16(entry, 0xb001, false)
  view.setUint16(entry + 2, 4, false)
  view.setUint32(entry + 4, 1, false)
  view.setUint32(entry + 8, 2, false)
  entry += 12
  view.setUint16(entry, 0xb002, false)
  view.setUint16(entry + 2, 7, false)
  view.setUint32(entry + 4, 32, false)
  view.setUint32(entry + 8, 50, false)
  view.setUint32(50, 0, false)
  view.setUint32(54, 0x2003_0000, false)
  view.setUint32(58, primaryBytes, false)
  view.setUint32(62, 0, false)
  view.setUint32(70, 0, false)
  view.setUint32(74, secondaryBytes, false)
  view.setUint32(78, secondaryOffset, false)

  const segment = new Uint8Array(payload.byteLength + 4)
  segment.set([0xff, 0xe2, 0, payload.byteLength + 2])
  segment.set(payload, 4)
  return segment
}

const mpfJpeg = (primary: Uint8Array, secondary: Uint8Array): Uint8Array => {
  const provisionalMpf = mpfSegment(0, secondary.byteLength, 0)
  const primaryBytes = primary.byteLength + provisionalMpf.byteLength
  const tiffOffset = 2 + 4 + 4 // SOI, APP2 marker/length, and MPF signature.
  const mpf = mpfSegment(primaryBytes, secondary.byteLength, primaryBytes - tiffOffset)
  const output = new Uint8Array(primaryBytes + secondary.byteLength)
  output.set(primary.subarray(0, 2))
  output.set(mpf, 2)
  output.set(primary.subarray(2), 2 + mpf.byteLength)
  output.set(secondary, primaryBytes)
  return output
}

const withOrientation = (input: Uint8Array, orientation: number): Uint8Array => {
  const payload = Uint8Array.of(
    0x45,
    0x78,
    0x69,
    0x66,
    0,
    0,
    0x49,
    0x49,
    0x2a,
    0,
    8,
    0,
    0,
    0,
    1,
    0,
    0x12,
    0x01,
    3,
    0,
    1,
    0,
    0,
    0,
    orientation,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  )
  const segment = new Uint8Array(payload.byteLength + 4)
  segment.set([0xff, 0xe1, 0, payload.byteLength + 2])
  segment.set(payload, 4)
  const output = new Uint8Array(input.byteLength + segment.byteLength)
  output.set(input.subarray(0, 2))
  output.set(segment, 2)
  output.set(input.subarray(2), segment.byteLength + 2)
  return output
}

await rm(outputDirectory, { force: true, recursive: true })
await mkdir(fixtureDirectory, { recursive: true })
await build({
  absWorkingDir: process.cwd(),
  bundle: true,
  entryPoints: benchmarkEntries,
  format: 'esm',
  legalComments: 'none',
  logLevel: 'silent',
  minify: true,
  outdir: outputDirectory,
  platform: 'browser',
  sourcemap: false,
  target: ['es2022'],
})

await mkdir(resolve(outputDirectory, 'assets'), { recursive: true })
await build({
  absWorkingDir: process.cwd(),
  banner: {
    js: '/* Generated from docs/demo.ts for browser validation. */',
  },
  bundle: true,
  charset: 'utf8',
  entryPoints: ['docs/demo.ts'],
  format: 'esm',
  legalComments: 'none',
  logLevel: 'silent',
  minify: true,
  outfile: resolve(outputDirectory, 'assets/demo-app.js'),
  platform: 'browser',
  sourcemap: false,
  target: ['es2022'],
})
const docsDemoFiles = [
  ['docs/demo.html', 'demo.html'],
  ['docs/favicon.svg', 'favicon.svg'],
  ['docs/site.js', 'site.js'],
  ['docs/styles.css', 'styles.css'],
] as const
for (const [source, destination] of docsDemoFiles) {
  await copyFile(source, resolve(outputDirectory, destination))
}
await copyFile(
  'src/accelerator-entries/jpeg-decoder.wasm',
  resolve(outputDirectory, 'assets/jpeg-decoder.wasm'),
)
await copyFile(
  'src/accelerator-entries/jpeg-decoder-simd.wasm',
  resolve(outputDirectory, 'assets/jpeg-decoder-simd.wasm'),
)
await copyFile(
  'src/accelerator-entries/jpeg-encoder.wasm',
  resolve(outputDirectory, 'assets/jpeg-encoder.wasm'),
)
await copyFile(
  'src/accelerator-entries/jpeg-encoder-simd.wasm',
  resolve(outputDirectory, 'assets/jpeg-encoder-simd.wasm'),
)

const wasmFiles: readonly (readonly [string, string])[] = [
  ['src/accelerator-entries/jpeg-decoder.wasm', 'jpeg-decoder.wasm'],
  ['src/accelerator-entries/jpeg-decoder-simd.wasm', 'jpeg-decoder-simd.wasm'],
  ['src/accelerator-entries/jpeg-encoder.wasm', 'jpeg-encoder.wasm'],
  ['src/accelerator-entries/jpeg-encoder-simd.wasm', 'jpeg-encoder-simd.wasm'],
  ['src/accelerator-entries/png-codec.wasm', 'png-codec.wasm'],
  ['src/accelerator-entries/png-codec-simd.wasm', 'png-codec-simd.wasm'],
  ['node_modules/@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm', 'mozjpeg_dec.wasm'],
  ['node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm', 'mozjpeg_enc.wasm'],
  ['node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm', 'squoosh_png_bg.wasm'],
  ['node_modules/@jsquash/webp/codec/dec/webp_dec.wasm', 'webp_dec.wasm'],
  ['node_modules/@jsquash/webp/codec/enc/webp_enc.wasm', 'webp_enc.wasm'],
  ['node_modules/@jsquash/webp/codec/enc/webp_enc_simd.wasm', 'webp_enc_simd.wasm'],
]
for (const [source, name] of wasmFiles) await copyFile(source, resolve(outputDirectory, name))

const png = benchmarkPng()
const image = createImageLibrary([pngCodec, jpegCodec])
const jpeg = await (await image.open(png)).jpeg({ quality: 85 }).toUint8Array()
const wasmJpeg = await (await image.open(benchmarkPng(1_024, 1_024)))
  .jpeg({ quality: 85 })
  .toUint8Array()
await writeFile(resolve(fixtureDirectory, 'benchmark-input.png'), png)
await writeFile(resolve(fixtureDirectory, 'benchmark-input.jpg'), jpeg)
await writeFile(resolve(fixtureDirectory, 'wasm-input.jpg'), wasmJpeg)
await writeFile(resolve(fixtureDirectory, 'mpf-primary.jpg'), mpfJpeg(jpeg, jpeg))
await writeFile(resolve(fixtureDirectory, 'oriented-6.jpg'), withOrientation(jpeg, 6))
await writeFile(resolve(fixtureDirectory, 'alpha.png'), alphaFixture())
await writeFile(resolve(fixtureDirectory, 'webp-graphic.png'), webpGraphicFixture())
await writeFile(resolve(fixtureDirectory, 'animated.gif'), animatedGifFixture())
await writeFile(resolve(fixtureDirectory, 'main10-pq.heic'), main10PqFixture())
await copyFile(
  'benchmark/corpus/files/webp-lossless-tux-386x395.webp',
  resolve(fixtureDirectory, 'benchmark-input.webp'),
)
await copyFile(
  'tests/fixtures/bluemarble_256_256_3_byte.lerc2',
  resolve(fixtureDirectory, 'bluemarble_256_256_3_byte.lerc2'),
)
await copyFile(
  'benchmark/corpus/files/avif/sharp-qmatrix-q30-256x192.avif',
  resolve(fixtureDirectory, 'sharp-qmatrix-q30-256x192.avif'),
)
await writeFile(
  resolve(outputDirectory, 'index.html'),
  '<!doctype html><meta charset="utf-8"><title>PureJsImage browser validation</title><script type="module" src="/compatibility.js"></script><script type="module" src="/benchmark.js"></script>',
)

const contentTypes: Readonly<Record<string, string>> = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.heic': 'image/heic',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
}

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? '/', `http://127.0.0.1:${port}`).pathname
    const requested = pathname === '/' ? '/index.html' : pathname
    const path = resolve(outputDirectory, `.${decodeURIComponent(requested)}`)
    const escaped = relative(outputDirectory, path)
    if (escaped.startsWith('..') || escaped.includes('/../')) {
      response.writeHead(403).end('Forbidden')
      return
    }
    const data = await readFile(path)
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-length': data.byteLength,
      'content-type': contentTypes[extname(path)] ?? 'application/octet-stream',
    })
    response.end(data)
  } catch {
    response.writeHead(404).end('Not found')
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`PureJsImage browser test server listening on http://127.0.0.1:${port}`)
})
