import { createServer } from 'node:http'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'
import { build } from 'esbuild'
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
  const image = new PNG({ width: 32, height: 24 })
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4
      const panel = x >= 4 && x < 28 && y >= 3 && y < 21
      const stripe = panel && ((x + y) & 7) === 0
      image.data.set(
        stripe ? [240, 96, 48, 255] : panel ? [36, 48, 72, 255] : [248, 248, 248, 255],
        offset,
      )
    }
  }
  return PNG.sync.write(image)
}

const benchmarkPng = (): Uint8Array => {
  const image = new PNG({ width: 640, height: 480 })
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

const wasmFiles: readonly (readonly [string, string])[] = [
  ['src/accelerator-entries/jpeg-decoder.wasm', 'jpeg-decoder.wasm'],
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
await writeFile(resolve(fixtureDirectory, 'benchmark-input.png'), png)
await writeFile(resolve(fixtureDirectory, 'benchmark-input.jpg'), jpeg)
await writeFile(resolve(fixtureDirectory, 'oriented-6.jpg'), withOrientation(jpeg, 6))
await writeFile(resolve(fixtureDirectory, 'alpha.png'), alphaFixture())
await writeFile(resolve(fixtureDirectory, 'webp-graphic.png'), webpGraphicFixture())
await writeFile(resolve(fixtureDirectory, 'main10-pq.heic'), main10PqFixture())
await copyFile(
  'benchmark/corpus/files/webp-lossless-tux-386x395.webp',
  resolve(fixtureDirectory, 'benchmark-input.webp'),
)
await copyFile(
  'benchmark/corpus/files/avif/sharp-qmatrix-q50-256x192.avif',
  resolve(fixtureDirectory, 'sharp-qmatrix-q50-256x192.avif'),
)
await writeFile(
  resolve(outputDirectory, 'index.html'),
  '<!doctype html><meta charset="utf-8"><title>PureJsImage browser validation</title><script type="module" src="/compatibility.js"></script><script type="module" src="/benchmark.js"></script>',
)

const contentTypes: Readonly<Record<string, string>> = {
  '.avif': 'image/avif',
  '.html': 'text/html; charset=utf-8',
  '.heic': 'image/heic',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
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
