import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, relative, resolve } from 'node:path'
import { build as buildAstro } from 'astro'
import { build } from 'esbuild'
import { GifWriter } from 'omggif'
import { PNG } from 'pngjs'
import { main10PqFixture } from '../benchmark/heif/compatibility/generated-fixtures.ts'
import { jpegCodec } from '../src/codec-entries/jpeg.ts'
import { pngCodec } from '../src/codec-entries/png.ts'
import { createImageLibrary } from '../src/index.ts'

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
await buildAstro({
  root: resolve('docs-astro'),
  outDir: outputDirectory,
  base: '/',
})
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
await build({
  absWorkingDir: process.cwd(),
  bundle: true,
  charset: 'utf8',
  entryPoints: {
    'wsi-viewer': 'docs-astro/src/scripts/wsi-viewer.ts',
    'wsi-worker': 'docs-astro/src/scripts/wsi-worker.ts',
  },
  entryNames: '[name]',
  format: 'esm',
  legalComments: 'none',
  logLevel: 'silent',
  minify: true,
  outdir: resolve(outputDirectory, 'assets'),
  platform: 'browser',
  sourcemap: false,
  target: ['es2022'],
})

await mkdir(resolve(outputDirectory, 'assets'), { recursive: true })
await build({
  absWorkingDir: process.cwd(),
  banner: {
    js: '/* Generated from docs-astro/src/scripts/demo.ts for browser validation. */',
  },
  bundle: true,
  charset: 'utf8',
  entryPoints: ['docs-astro/src/scripts/demo.ts'],
  format: 'esm',
  legalComments: 'none',
  logLevel: 'silent',
  minify: true,
  outfile: resolve(outputDirectory, 'assets/demo-app.js'),
  platform: 'browser',
  sourcemap: false,
  target: ['es2022'],
})
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
  'benchmark/corpus/files/jp2/openjpeg-lossless-rgb16.jp2',
  resolve(fixtureDirectory, 'openjpeg-lossless-rgb16.jp2'),
)
await copyFile(
  'benchmark/fixtures/jpegxl/conformance-alpha-nonpremultiplied.jxl',
  resolve(fixtureDirectory, 'jpegxl-alpha-12bit.jxl'),
)
await copyFile(
  'tests/fixtures/jpegxl/permuted-large-gray8.jxl',
  resolve(fixtureDirectory, 'jpegxl-permuted-large-gray8.jxl'),
)
await copyFile(
  'tests/fixtures/bluemarble_256_256_3_byte.lerc2',
  resolve(fixtureDirectory, 'bluemarble_256_256_3_byte.lerc2'),
)
await copyFile(
  'benchmark/corpus/files/avif/sharp-qmatrix-q30-256x192.avif',
  resolve(fixtureDirectory, 'sharp-qmatrix-q30-256x192.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/rav1e-segmentation-q60-512x512.avif',
  resolve(fixtureDirectory, 'rav1e-segmentation-q60-512x512.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/svt-skipped-intra-tx-size-512x512.avif',
  resolve(fixtureDirectory, 'svt-skipped-intra-tx-size-512x512.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/fox.profile0.8bpc.yuv420.monochrome.avif',
  resolve(fixtureDirectory, 'fox.profile0.8bpc.yuv420.monochrome.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/fox.profile2.8bpc.yuv422.avif',
  resolve(fixtureDirectory, 'fox.profile2.8bpc.yuv422.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/fox.profile1.8bpc.yuv444.avif',
  resolve(fixtureDirectory, 'fox.profile1.8bpc.yuv444.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/alpha-straight-64x48.avif',
  resolve(fixtureDirectory, 'alpha-straight-64x48.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/alpha-premultiplied-64x48.avif',
  resolve(fixtureDirectory, 'alpha-premultiplied-64x48.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/lossless-q0-64x48.avif',
  resolve(fixtureDirectory, 'lossless-q0-64x48.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/draw_points_idat.avif',
  resolve(fixtureDirectory, 'draw_points_idat.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/lossless-identity-16x12-10bpc.avif',
  resolve(fixtureDirectory, 'lossless-identity-16x12-10bpc.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/lossless-identity-16x12-12bpc.avif',
  resolve(fixtureDirectory, 'lossless-identity-16x12-12bpc.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/coded-lossless-10bpc-yuv420-32x24.avif',
  resolve(fixtureDirectory, 'coded-lossless-10bpc-yuv420-32x24.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/filter-free-lossy-10bpc-yuv420-32x24.avif',
  resolve(fixtureDirectory, 'filter-free-lossy-10bpc-yuv420-32x24.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/coded-lossless-12bpc-yuv420-32x24.avif',
  resolve(fixtureDirectory, 'coded-lossless-12bpc-yuv420-32x24.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/unsupported-hdr-pq-10bpc-yuv420-32x24.avif',
  resolve(fixtureDirectory, 'unsupported-hdr-pq-10bpc-yuv420-32x24.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/unsupported-hdr-hlg-10bpc-yuv420-32x24.avif',
  resolve(fixtureDirectory, 'unsupported-hdr-hlg-10bpc-yuv420-32x24.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/libavif-colors-hdr-p3.avif',
  resolve(fixtureDirectory, 'libavif-colors-hdr-p3.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/hdr-hlg-10bpc-yuv444-32x24.avif',
  resolve(fixtureDirectory, 'hdr-hlg-10bpc-yuv444-32x24.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/identity-pq-10bpc-yuv444-16x12.avif',
  resolve(fixtureDirectory, 'identity-pq-10bpc-yuv444-16x12.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/libavif-cosmos1650-yuv444-10bpc-p3pq.avif',
  resolve(fixtureDirectory, 'libavif-cosmos1650-yuv444-10bpc-p3pq.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/ms-chimera-hdr-matrix10-1920x1008.avif',
  resolve(fixtureDirectory, 'ms-chimera-hdr-matrix10-1920x1008.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/colors-animated-12bpc-keyframes-0-2-3.avif',
  resolve(fixtureDirectory, 'colors-animated-12bpc-keyframes-0-2-3.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/colors-animated-8bpc-alpha-exif-xmp.avif',
  resolve(fixtureDirectory, 'colors-animated-8bpc-alpha-exif-xmp.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/filter-free-lossy-12bpc-yuv420-32x24.avif',
  resolve(fixtureDirectory, 'filter-free-lossy-12bpc-yuv420-32x24.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/filter-free-lossy-10bpc-yuv422-32x24.avif',
  resolve(fixtureDirectory, 'filter-free-lossy-10bpc-yuv422-32x24.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/filter-free-lossy-12bpc-yuv422-32x24.avif',
  resolve(fixtureDirectory, 'filter-free-lossy-12bpc-yuv422-32x24.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/filter-free-lossy-12bpc-yuv444-32x24.avif',
  resolve(fixtureDirectory, 'filter-free-lossy-12bpc-yuv444-32x24.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/filter-free-lossy-10bpc-yuv444-32x24.avif',
  resolve(fixtureDirectory, 'filter-free-lossy-10bpc-yuv444-32x24.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/filtered-lossy-10bpc-yuv444-96x64.avif',
  resolve(fixtureDirectory, 'filtered-lossy-10bpc-yuv444-96x64.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/filtered-lossy-10bpc-yuv420-192x128.avif',
  resolve(fixtureDirectory, 'filtered-lossy-10bpc-yuv420-192x128.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/filtered-lossy-10bpc-yuv422-64x64.avif',
  resolve(fixtureDirectory, 'filtered-lossy-10bpc-yuv422-64x64.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/self-guided-10bpc-yuv420-320x192.avif',
  resolve(fixtureDirectory, 'self-guided-10bpc-yuv420-320x192.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/filtered-lossy-12bpc-yuv420-64x64.avif',
  resolve(fixtureDirectory, 'filtered-lossy-12bpc-yuv420-64x64.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/filtered-lossy-12bpc-yuv422-64x64.avif',
  resolve(fixtureDirectory, 'filtered-lossy-12bpc-yuv422-64x64.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/filtered-lossy-12bpc-yuv444-64x64.avif',
  resolve(fixtureDirectory, 'filtered-lossy-12bpc-yuv444-64x64.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/wiener-12bpc-yuv420-320x192.avif',
  resolve(fixtureDirectory, 'wiener-12bpc-yuv420-320x192.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/self-guided-12bpc-yuv420-320x192.avif',
  resolve(fixtureDirectory, 'self-guided-12bpc-yuv420-320x192.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/restoration-12bpc-yuv422-320x192.avif',
  resolve(fixtureDirectory, 'restoration-12bpc-yuv422-320x192.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/restoration-12bpc-yuv444-320x192.avif',
  resolve(fixtureDirectory, 'restoration-12bpc-yuv444-320x192.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/restoration-matrix-wiener-12bpc-yuv422-642x386.avif',
  resolve(fixtureDirectory, 'restoration-matrix-wiener-12bpc-yuv422-642x386.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/restoration-matrix-sgr-12bpc-yuv422-642x386.avif',
  resolve(fixtureDirectory, 'restoration-matrix-sgr-12bpc-yuv422-642x386.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/restoration-matrix-switchable-12bpc-yuv444-642x386.avif',
  resolve(fixtureDirectory, 'restoration-matrix-switchable-12bpc-yuv444-642x386.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/self-guided-10bpc-yuv444-320x192.avif',
  resolve(fixtureDirectory, 'self-guided-10bpc-yuv444-320x192.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/xiph-alpha-limited-8bpc-2048x2048.avif',
  resolve(fixtureDirectory, 'xiph-alpha-limited-8bpc-2048x2048.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/alpha-full-10bpc-64x48.avif',
  resolve(fixtureDirectory, 'alpha-full-10bpc-64x48.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/alpha-full-12bpc-64x48.avif',
  resolve(fixtureDirectory, 'alpha-full-12bpc-64x48.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/libavif-color-grid-alpha-items-80x80.avif',
  resolve(fixtureDirectory, 'libavif-color-grid-alpha-items-80x80.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/libavif-color-irot-alpha-noirot-512x256.avif',
  resolve(fixtureDirectory, 'libavif-color-irot-alpha-noirot-512x256.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/libavif-imir-axis0-160x160.avif',
  resolve(fixtureDirectory, 'libavif-imir-axis0-160x160.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/libavif-imir-axis1-160x160.avif',
  resolve(fixtureDirectory, 'libavif-imir-axis1-160x160.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/libavif-imir-clap-irot-grid-alpha-160x160.avif',
  resolve(fixtureDirectory, 'libavif-imir-clap-irot-grid-alpha-160x160.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/xiph-tiger-3layer-lsel0-1216x832.avif',
  resolve(fixtureDirectory, 'xiph-tiger-3layer-lsel0-1216x832.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/tiger-3layer-3res-lsel0.avif',
  resolve(fixtureDirectory, 'tiger-3layer-3res-lsel0.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/tiled-lossless-10bpc-yuv444-2x2-256x256.avif',
  resolve(fixtureDirectory, 'tiled-lossless-10bpc-yuv444-2x2-256x256.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/libaom-lossy-multitile-yuv420-256x256.avif',
  resolve(fixtureDirectory, 'libaom-lossy-multitile-yuv420-256x256.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/libaom-full-header-tile-groups-yuv420-256x256.avif',
  resolve(fixtureDirectory, 'libaom-full-header-tile-groups-yuv420-256x256.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/libavif-bounded-filtered-yuv420-3840x2160.avif',
  resolve(fixtureDirectory, 'libavif-bounded-filtered-yuv420-3840x2160.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/libavif_color_grid_alpha_grid_gainmap_nogrid.avif',
  resolve(fixtureDirectory, 'libavif_color_grid_alpha_grid_gainmap_nogrid.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/libavif_color_grid_gainmap_different_grid.avif',
  resolve(fixtureDirectory, 'libavif_color_grid_gainmap_different_grid.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/libavif_color_nogrid_alpha_nogrid_gainmap_grid.avif',
  resolve(fixtureDirectory, 'libavif_color_nogrid_alpha_nogrid_gainmap_grid.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/libavif_seine_hdr_gainmap_small_srgb.avif',
  resolve(fixtureDirectory, 'libavif_seine_hdr_gainmap_small_srgb.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/film-grain-test1-yuv420-64x48.avif',
  resolve(fixtureDirectory, 'film-grain-test1-yuv420-64x48.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/ms-mexico-nonstill-sequence.avif',
  resolve(fixtureDirectory, 'ms-mexico-nonstill-sequence.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/diagnostic-baby-ffmpeg-crf30-yuv420.avif',
  resolve(fixtureDirectory, 'diagnostic-baby-ffmpeg-crf30-yuv420.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/diagnostic-baby-ffmpeg-crf45-yuv444.avif',
  resolve(fixtureDirectory, 'diagnostic-baby-ffmpeg-crf45-yuv444.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/diagnostic-mc3-sharp-q50-yuv420.avif',
  resolve(fixtureDirectory, 'diagnostic-mc3-sharp-q50-yuv420.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/libaom-superres-denom12-96x64.avif',
  resolve(fixtureDirectory, 'libaom-superres-denom12-96x64.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/libaom-superres-denom12-yuv420-320x192.avif',
  resolve(fixtureDirectory, 'libaom-superres-denom12-yuv420-320x192.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/libaom-filtered-superres-denom12-yuv420-320x192.avif',
  resolve(fixtureDirectory, 'libaom-filtered-superres-denom12-yuv420-320x192.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/blue-and-magenta-crop.avif',
  resolve(fixtureDirectory, 'blue-and-magenta-crop.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/ms-monochrome-residual-intrabc.avif',
  resolve(fixtureDirectory, 'ms-monochrome-residual-intrabc.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/ms-Tomsk-with-thumbnails.avif',
  resolve(fixtureDirectory, 'ms-Tomsk-with-thumbnails.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/clean-aperture-lossless-16x12.avif',
  resolve(fixtureDirectory, 'clean-aperture-lossless-16x12.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/linku-kimono-crop.avif',
  resolve(fixtureDirectory, 'linku-kimono-crop.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/bounded-row-lossless-64x192.avif',
  resolve(fixtureDirectory, 'bounded-row-lossless-64x192.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/bounded-row-alpha-lossless-64x192.avif',
  resolve(fixtureDirectory, 'bounded-row-alpha-lossless-64x192.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/sofa_grid1x5_420.avif',
  resolve(fixtureDirectory, 'sofa_grid1x5_420.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/libavif-colors-text-wcg-sdr-rec2020.avif',
  resolve(fixtureDirectory, 'libavif-colors-text-wcg-sdr-rec2020.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/libavif-seine-hdr-gainmap-srgb.avif',
  resolve(fixtureDirectory, 'libavif-seine-hdr-gainmap-srgb.avif'),
)
await copyFile(
  'benchmark/corpus/files/avif/libavif-paris-icc-exif-xmp.avif',
  resolve(fixtureDirectory, 'libavif-paris-icc-exif-xmp.avif'),
)
await copyFile(
  'tests/fixtures/aperio-cmu-1-small-region.svs',
  resolve(fixtureDirectory, 'aperio-cmu-1-small-region.svs'),
)
await copyFile(
  'tests/fixtures/scientific-surface/nanonis-afm-generic4.sxm',
  resolve(fixtureDirectory, 'nanonis-afm-generic4.sxm'),
)
await copyFile(
  'tests/fixtures/scientific-surface/asylum-afm-v5.ibw',
  resolve(fixtureDirectory, 'asylum-afm-v5.ibw'),
)
await copyFile(
  'tests/fixtures/scientific-surface/digital-surf-compressed.sur',
  resolve(fixtureDirectory, 'digital-surf-compressed.sur'),
)
await copyFile(
  'tests/fixtures/scientific-surface/iso5436-sample4.x3p',
  resolve(fixtureDirectory, 'iso5436-sample4.x3p'),
)
await copyFile(resolve(outputDirectory, 'index.html'), resolve(outputDirectory, 'homepage.html'))
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
    const requestUrl = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
    const pathname = requestUrl.pathname
    const requested = pathname.endsWith('/') ? `${pathname}index.html` : pathname
    const path = resolve(outputDirectory, `.${decodeURIComponent(requested)}`)
    const escaped = relative(outputDirectory, path)
    if (escaped.startsWith('..') || escaped.includes('/../')) {
      response.writeHead(403).end('Forbidden')
      return
    }
    const data = await readFile(path)
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d+)$/)
    if (range) {
      const rangeDelay = Number(requestUrl.searchParams.get('rangeDelay') ?? '0')
      if (Number.isFinite(rangeDelay) && rangeDelay > 0 && rangeDelay <= 1_000) {
        await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, rangeDelay))
      }
      const start = Number(range[1])
      const requestedEnd = Number(range[2])
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(requestedEnd) ||
        start < 0 ||
        requestedEnd < start ||
        start >= data.byteLength
      ) {
        response.writeHead(416, { 'content-range': `bytes */${data.byteLength}` }).end()
        return
      }
      const end = Math.min(requestedEnd, data.byteLength - 1)
      const body = data.subarray(start, end + 1)
      response.writeHead(206, {
        'accept-ranges': 'bytes',
        'access-control-allow-origin': '*',
        'access-control-expose-headers': 'Content-Range',
        'cache-control': 'no-store',
        'content-length': body.byteLength,
        'content-range': `bytes ${start}-${end}/${data.byteLength}`,
        'content-type': contentTypes[extname(path)] ?? 'application/octet-stream',
      })
      response.end(body)
      return
    }
    response.writeHead(200, {
      'accept-ranges': 'bytes',
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
