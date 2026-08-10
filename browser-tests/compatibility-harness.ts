import { createImageLibrary, ImageError } from '../src/browser.ts'
import { createWasmJpegAccelerator } from '../src/accelerator-entries/wasm-jpeg-browser.ts'
import { createWasmPngAccelerator } from '../src/accelerator-entries/wasm-png-browser.ts'
import { createWasmJpegAcceleratorWithLoaders } from '../src/accelerators/wasm/jpeg.ts'
import { createWasmPngAcceleratorWithLoaders } from '../src/accelerators/wasm/png.ts'
import { avifCodec } from '../src/codec-entries/avif.ts'
import { experimentalHeifCodec } from '../src/codec-entries/experimental/heic.ts'
import { gifCodec } from '../src/codec-entries/gif.ts'
import { jpegCodec } from '../src/codec-entries/jpeg.ts'
import { pngCodec } from '../src/codec-entries/png.ts'
import { webpCodec } from '../src/codec-entries/webp.ts'
import type { ImageInput } from '../src/source.ts'
import type { ImageSink } from '../src/sink.ts'
import type { BrowserCompatibilityHarness, BrowserWorkflowResult } from './types.ts'

const images = createImageLibrary([
  gifCodec,
  jpegCodec,
  pngCodec,
  webpCodec,
  avifCodec,
  experimentalHeifCodec,
])
const wasmImages = createImageLibrary({
  codecs: [jpegCodec, pngCodec],
  accelerators: [createWasmJpegAccelerator({ minimumEncodePixels: 1, minimumPixels: 1 })],
})

const fetchBytes = async (path: string): Promise<Uint8Array<ArrayBuffer>> => {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`Fixture request failed: ${response.status} ${path}`)
  return new Uint8Array(await response.arrayBuffer())
}
const instantiateWasm = async (path: string): Promise<WebAssembly.Instance> => {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`WASM request failed: ${response.status} ${path}`)
  const result = await WebAssembly.instantiate(await response.arrayBuffer())
  return result.instance
}

const outputMetadata = async (bytes: Uint8Array) => (await images.open(bytes)).metadata()

const inputTypes = async (): Promise<readonly BrowserWorkflowResult[]> => {
  const bytes = await fetchBytes('/fixtures/benchmark-input.png')
  const inputs: readonly (readonly [string, ImageInput])[] = [
    ['File', new File([bytes], 'browser-input.png', { type: 'image/png' })],
    ['Blob', new Blob([bytes], { type: 'image/png' })],
    ['ArrayBuffer', Uint8Array.from(bytes).buffer],
    ['Uint8Array', Uint8Array.from(bytes)],
  ]
  const results: BrowserWorkflowResult[] = []
  for (const [name, input] of inputs) {
    const image = await images.open(input)
    const metadata = await image.metadata()
    if (metadata.format !== 'png' || metadata.width !== 640 || metadata.height !== 480) {
      throw new Error(
        `${name} metadata was ${metadata.format} ${metadata.width}x${metadata.height}`,
      )
    }
    const output = await image.resize({ width: 64 }).png().toUint8Array()
    const outputInfo = await outputMetadata(output)
    if (outputInfo.width !== 64 || outputInfo.height !== 48) {
      throw new Error(`${name} output was ${outputInfo.width}x${outputInfo.height}`)
    }
    results.push({
      detail: `${name}: PNG 640x480 -> 64x48 Uint8Array`,
      outputBytes: output.byteLength,
    })
  }

  const blob = await (await images.open(new Blob([bytes]))).resize({ width: 80 }).jpeg().toBlob()
  if (blob.type !== 'image/jpeg' || blob.size === 0) throw new Error('toBlob() did not emit JPEG')
  results.push({ detail: `toBlob(): ${blob.type}`, outputBytes: blob.size })
  return results
}
const resizeDefaultKernel = async (): Promise<BrowserWorkflowResult> => {
  const bytes = await fetchBytes('/fixtures/benchmark-input.png')
  const [defaultOutput, lanczosOutput, bilinearOutput] = await Promise.all([
    (await images.open(bytes)).resize({ width: 64 }).png().toUint8Array(),
    (await images.open(bytes)).resize({ width: 64, kernel: 'lanczos3' }).png().toUint8Array(),
    (await images.open(bytes)).resize({ width: 64, kernel: 'bilinear' }).png().toUint8Array(),
  ])
  if (
    defaultOutput.byteLength !== lanczosOutput.byteLength ||
    defaultOutput.some((value, offset) => value !== lanczosOutput[offset])
  ) {
    throw new Error('Default browser resize output did not match explicit Lanczos3 output')
  }
  if (
    defaultOutput.byteLength === bilinearOutput.byteLength &&
    defaultOutput.every((value, offset) => value === bilinearOutput[offset])
  ) {
    throw new Error('Default browser resize output still matched bilinear output')
  }
  return {
    detail: 'default browser resize matched explicit Lanczos3 and differed from bilinear',
    outputBytes: defaultOutput.byteLength,
  }
}

const jpegPipeline = async (): Promise<BrowserWorkflowResult> => {
  const bytes = await fetchBytes('/fixtures/benchmark-input.jpg')
  const image = await images.open(new File([bytes], 'input.jpg', { type: 'image/jpeg' }))
  const metadata = await image.metadata()
  if (metadata.format !== 'jpeg' || metadata.width !== 640 || metadata.height !== 480) {
    throw new Error(`JPEG metadata was ${metadata.format} ${metadata.width}x${metadata.height}`)
  }
  const output = await image
    .crop({ x: 80, y: 40, width: 480, height: 400 })
    .resize({ width: 120 })
    .rotate(90)
    .jpeg({ quality: 82 })
    .toBlob()
  const result = await (await images.open(output)).metadata()
  if (result.format !== 'jpeg' || result.width !== 100 || result.height !== 120) {
    throw new Error(`JPEG pipeline output was ${result.format} ${result.width}x${result.height}`)
  }
  return {
    detail: 'JPEG crop + resize + rotate + JPEG encode -> 100x120',
    outputBytes: output.size,
  }
}

const wasmJpeg = async (): Promise<BrowserWorkflowResult> => {
  const bytes = await fetchBytes('/fixtures/benchmark-input.jpg')
  const [reference, accelerated] = await Promise.all([
    (await images.open(bytes)).png().toUint8Array(),
    (await wasmImages.open(bytes)).png().toUint8Array(),
  ])
  if (reference.byteLength !== accelerated.byteLength) {
    throw new Error('WASM JPEG output length differs from the TypeScript reference')
  }
  for (let offset = 0; offset < reference.byteLength; offset += 1) {
    if (reference[offset] !== accelerated[offset]) {
      throw new Error(`WASM JPEG output differs at byte ${offset}`)
    }
  }
  return {
    detail: 'Rust/WASM baseline JPEG decode matched the TypeScript reference in the browser',
    outputBytes: accelerated.byteLength,
  }
}
const wasmJpegEncode = async (): Promise<BrowserWorkflowResult> => {
  const bytes = await fetchBytes('/fixtures/benchmark-input.png')
  let scalarLoads = 0
  let simdLoads = 0
  const scalarImages = createImageLibrary({
    codecs: [jpegCodec, pngCodec],
    accelerators: [
      createWasmJpegAcceleratorWithLoaders(
        {
          encoder: async () => {
            scalarLoads += 1
            return instantiateWasm('/jpeg-encoder.wasm')
          },
        },
        { minimumEncodePixels: 1 },
      ),
    ],
  })
  const selectedImages = createImageLibrary({
    codecs: [jpegCodec, pngCodec],
    accelerators: [
      createWasmJpegAcceleratorWithLoaders(
        {
          encoder: async () => {
            scalarLoads += 1
            return instantiateWasm('/jpeg-encoder.wasm')
          },
          simdEncoder: async () => {
            simdLoads += 1
            return instantiateWasm('/jpeg-encoder-simd.wasm')
          },
        },
        { minimumEncodePixels: 1 },
      ),
    ],
  })
  const options = { chromaSubsampling: '420' as const, quality: 84 }
  const [reference, scalar, selected] = await Promise.all([
    (await images.open(bytes)).jpeg(options).toUint8Array(),
    (await scalarImages.open(bytes)).jpeg(options).toUint8Array(),
    (await selectedImages.open(bytes)).jpeg(options).toUint8Array(),
  ])
  if (scalarLoads !== 1 || simdLoads !== 1) {
    throw new Error(`WASM JPEG encoder selection loaded scalar=${scalarLoads}, SIMD=${simdLoads}`)
  }
  if (reference.byteLength !== scalar.byteLength) {
    throw new Error('Scalar WASM JPEG output length differs from the TypeScript reference')
  }
  for (let offset = 0; offset < reference.byteLength; offset += 1) {
    if (reference[offset] !== scalar[offset]) {
      throw new Error(`Scalar WASM JPEG output differs at byte ${offset}`)
    }
  }
  const sizeDifference = Math.abs(selected.byteLength - reference.byteLength) / reference.byteLength
  if (sizeDifference > 0.01) {
    throw new Error(`SIMD WASM JPEG output size differs by ${(sizeDifference * 100).toFixed(2)}%`)
  }
  const metadata = await outputMetadata(selected)
  if (metadata.format !== 'jpeg' || metadata.width < 1 || metadata.height < 1) {
    throw new Error('SIMD WASM JPEG output metadata is invalid')
  }
  return {
    detail: 'SIMD selection and scalar JPEG encoder fallback passed in the browser',
    outputBytes: selected.byteLength,
  }
}
const wasmPng = async (): Promise<BrowserWorkflowResult> => {
  const bytes = await fetchBytes('/fixtures/benchmark-input.png')
  let scalarDecoderLoads = 0
  let scalarEncoderLoads = 0
  let unavailableSimdDecoderLoads = 0
  let unavailableSimdEncoderLoads = 0
  let selectedSimdDecoderLoads = 0
  let selectedSimdEncoderLoads = 0
  let selectedScalarDecoderLoads = 0
  let selectedScalarEncoderLoads = 0
  const publicImages = createImageLibrary({
    codecs: [pngCodec],
    accelerators: [createWasmPngAccelerator({ minimumEncodePixels: 1, minimumPixels: 1 })],
  })
  const scalarFallbackImages = createImageLibrary({
    codecs: [pngCodec],
    accelerators: [
      createWasmPngAcceleratorWithLoaders(
        {
          decoder: async () => {
            scalarDecoderLoads += 1
            return instantiateWasm('/png-codec.wasm')
          },
          simdDecoder: async () => {
            unavailableSimdDecoderLoads += 1
            throw new Error('simulated unavailable SIMD PNG decoder')
          },
          encoder: async () => {
            scalarEncoderLoads += 1
            return instantiateWasm('/png-codec.wasm')
          },
          simdEncoder: async () => {
            unavailableSimdEncoderLoads += 1
            throw new Error('simulated unavailable SIMD PNG encoder')
          },
        },
        { minimumEncodePixels: 1, minimumPixels: 1 },
      ),
    ],
  })
  const simdImages = createImageLibrary({
    codecs: [pngCodec],
    accelerators: [
      createWasmPngAcceleratorWithLoaders(
        {
          decoder: async () => {
            selectedScalarDecoderLoads += 1
            return instantiateWasm('/png-codec.wasm')
          },
          simdDecoder: async () => {
            selectedSimdDecoderLoads += 1
            return instantiateWasm('/png-codec-simd.wasm')
          },
          encoder: async () => {
            selectedScalarEncoderLoads += 1
            return instantiateWasm('/png-codec.wasm')
          },
          simdEncoder: async () => {
            selectedSimdEncoderLoads += 1
            return instantiateWasm('/png-codec-simd.wasm')
          },
        },
        { minimumEncodePixels: 1, minimumPixels: 1 },
      ),
    ],
  })
  const [reference, publicOutput, scalarFallback, simd] = await Promise.all([
    (await images.open(bytes)).png({ compressionLevel: 6 }).toUint8Array(),
    (await publicImages.open(bytes)).png({ compressionLevel: 6 }).toUint8Array(),
    (await scalarFallbackImages.open(bytes)).png({ compressionLevel: 6 }).toUint8Array(),
    (await simdImages.open(bytes)).png({ compressionLevel: 6 }).toUint8Array(),
  ])
  const assertExact = (label: string, actual: Uint8Array): void => {
    if (reference.byteLength !== actual.byteLength) {
      throw new Error(`${label} PNG output length differs from the TypeScript reference`)
    }
    for (let offset = 0; offset < reference.byteLength; offset += 1) {
      if (reference[offset] !== actual[offset]) {
        throw new Error(`${label} PNG output differs at byte ${offset}`)
      }
    }
  }
  assertExact('Public Rust/WASM', publicOutput)
  assertExact('Scalar fallback Rust/WASM', scalarFallback)
  assertExact('SIMD Rust/WASM', simd)
  if (
    unavailableSimdDecoderLoads !== 1 ||
    unavailableSimdEncoderLoads !== 1 ||
    scalarDecoderLoads !== 1 ||
    scalarEncoderLoads !== 1
  ) {
    throw new Error(
      `PNG scalar fallback loaded SIMD decode=${unavailableSimdDecoderLoads}, SIMD encode=${unavailableSimdEncoderLoads}, scalar decode=${scalarDecoderLoads}, scalar encode=${scalarEncoderLoads}`,
    )
  }
  if (
    selectedSimdDecoderLoads !== 1 ||
    selectedSimdEncoderLoads !== 1 ||
    selectedScalarDecoderLoads !== 0 ||
    selectedScalarEncoderLoads !== 0
  ) {
    throw new Error(
      `PNG SIMD selection loaded SIMD decoder=${selectedSimdDecoderLoads}, SIMD encoder=${selectedSimdEncoderLoads}, scalar decoder=${selectedScalarDecoderLoads}, scalar encoder=${selectedScalarEncoderLoads}`,
    )
  }
  return {
    detail: 'SIMD selection and scalar PNG decode/encode fallback matched exact public output',
    outputBytes: simd.byteLength,
  }
}

const progressiveJpeg = async (): Promise<BrowserWorkflowResult> => {
  const bytes = await fetchBytes('/fixtures/benchmark-input.png')
  const resized = (await images.open(bytes)).resize({ width: 160 })
  const baseline = await resized.jpeg({ quality: 86, chromaSubsampling: '420' }).toUint8Array()
  const progressive = await resized
    .jpeg({ quality: 86, chromaSubsampling: '420', progressive: true })
    .toUint8Array()
  let frameMarkers = 0
  let scanMarkers = 0
  for (let offset = 0; offset + 1 < progressive.byteLength; offset += 1) {
    if (progressive[offset] !== 0xff) continue
    if (progressive[offset + 1] === 0xc2) frameMarkers += 1
    if (progressive[offset + 1] === 0xda) scanMarkers += 1
  }
  if (frameMarkers !== 1 || scanMarkers !== 6) {
    throw new Error(
      `Progressive JPEG structure had ${frameMarkers} frames and ${scanMarkers} scans`,
    )
  }
  const metadata = await outputMetadata(progressive)
  if (metadata.format !== 'jpeg' || metadata.width !== 160 || metadata.height !== 120) {
    throw new Error(
      `Progressive JPEG output was ${metadata.format} ${metadata.width}x${metadata.height}`,
    )
  }
  const baselinePixels = await browserPixels(baseline, 'image/jpeg')
  const progressivePixels = await browserPixels(progressive, 'image/jpeg')
  if (baselinePixels.length !== progressivePixels.length) {
    throw new Error('Progressive browser decode changed pixel dimensions')
  }
  for (let offset = 0; offset < baselinePixels.length; offset += 1) {
    if (baselinePixels[offset] !== progressivePixels[offset]) {
      throw new Error(`Progressive browser decode changed pixel ${offset}`)
    }
  }
  return {
    detail: 'six-scan progressive JPEG matched baseline pixels in the browser',
    outputBytes: progressive.byteLength,
  }
}

const animatedGifFrameSelection = async (): Promise<BrowserWorkflowResult> => {
  const bytes = await fetchBytes('/fixtures/animated.gif')
  const image = await images.open(bytes)
  const metadata = await image.metadata()
  if (metadata.frames !== 2) {
    throw new Error(`Animated GIF metadata reported ${metadata.frames ?? 0} frames`)
  }

  try {
    await image.png().toUint8Array()
    throw new Error('Animated GIF pixel decode succeeded without a frame selection')
  } catch (error: unknown) {
    if (!(error instanceof ImageError) || error.code !== 'UNSUPPORTED_OPERATION') throw error
  }

  const output = await (await images.open(bytes, { frame: 0 })).png().toUint8Array()
  const selected = await outputMetadata(output)
  if (selected.format !== 'png' || selected.width !== 2 || selected.height !== 2) {
    throw new Error(
      `Explicit GIF frame 0 output was ${selected.format} ${selected.width}x${selected.height}`,
    )
  }
  return {
    detail: 'animated GIF required explicit frame 0 selection in the browser',
    outputBytes: output.byteLength,
  }
}

const pngAlphaPipeline = async (): Promise<BrowserWorkflowResult> => {
  const bytes = await fetchBytes('/fixtures/alpha.png')
  const image = await images.open(new Blob([bytes], { type: 'image/png' }))
  const metadata = await image.metadata()
  if (!metadata.hasAlpha || metadata.width !== 4 || metadata.height !== 3) {
    throw new Error('Alpha PNG metadata did not preserve the source shape and alpha flag')
  }
  const output = await image.rotate(90).png().toUint8Array()
  const bitmap = await createImageBitmap(new Blob([Uint8Array.from(output)], { type: 'image/png' }))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D OffscreenCanvas context is unavailable')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  const alphaValues = new Set<number>()
  for (let offset = 3; offset < pixels.byteLength; offset += 4) {
    const alpha = pixels[offset]
    if (alpha !== undefined) alphaValues.add(alpha)
  }
  for (const expected of [0, 64, 128, 255]) {
    if (!alphaValues.has(expected)) throw new Error(`Rotated PNG lost alpha value ${expected}`)
  }
  const result = await outputMetadata(output)
  if (result.width !== 3 || result.height !== 4 || !result.hasAlpha) {
    throw new Error('Rotated alpha PNG output metadata is incorrect')
  }
  return {
    detail: 'RGBA PNG rotate + PNG encode preserved alpha values',
    outputBytes: output.byteLength,
  }
}

const browserPixels = async (bytes: Uint8Array, type: string): Promise<Uint8ClampedArray> => {
  const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type }))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D OffscreenCanvas context is unavailable')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return context.getImageData(0, 0, canvas.width, canvas.height).data
}

const sha256 = async (bytes: Uint8Array): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))
  return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('')
}

const rgbPsnr = (expected: Uint8ClampedArray, actual: Uint8ClampedArray): number => {
  if (actual.byteLength !== expected.byteLength) {
    throw new Error(`Browser pixel lengths differ: ${actual.byteLength} != ${expected.byteLength}`)
  }
  let squaredError = 0
  let samples = 0
  for (let offset = 0; offset < expected.byteLength; offset += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = (actual[offset + channel] ?? 0) - (expected[offset + channel] ?? 0)
      squaredError += difference * difference
      samples += 1
    }
  }
  return squaredError === 0
    ? Number.POSITIVE_INFINITY
    : 10 * Math.log10((255 * 255 * samples) / squaredError)
}

const webpLossless = async (): Promise<BrowserWorkflowResult> => {
  const input = await fetchBytes('/fixtures/webp-graphic.png')
  const output = await (await images.open(input)).webp({ lossless: true }).toUint8Array()
  const metadata = await outputMetadata(output)
  if (metadata.format !== 'webp' || metadata.width !== 192 || metadata.height !== 128) {
    throw new Error(
      `Lossless WebP output was ${metadata.format} ${metadata.width}x${metadata.height}`,
    )
  }
  const sourcePixels = await browserPixels(input, 'image/png')
  const decoded = await (await images.open(output)).png().toUint8Array()
  const outputPixels = await browserPixels(decoded, 'image/png')
  if (sourcePixels.length !== outputPixels.length)
    throw new Error('Lossless WebP pixel size changed')
  for (let offset = 0; offset < sourcePixels.length; offset += 1) {
    if (sourcePixels[offset] !== outputPixels[offset]) {
      throw new Error(`Lossless WebP changed browser pixel ${offset}`)
    }
  }
  return {
    detail: 'first-party lossless WebP matched browser RGBA pixels',
    outputBytes: output.byteLength,
  }
}

const webpLossyDecode = async (): Promise<BrowserWorkflowResult> => {
  const encoded = atob(
    'UklGRqQAAABXRUJQVlA4IJgAAABwBACdASogABgAPmUmj0WkIiEb/VQAQAZEs4BmwkBKSJFI4AHVyHQgWMclgAD+/qV1+gM5jXoqf8T/xA/L7f0lia3y/8Hn4WHFIQuFlP1xw1tSDx+ucwX+ndmTYQ35mZkrIBYOX9PWp0ByLB1fAb9EWwcebp60J6lOM+Wjvcp762MmOBNj6axIrCC/NsuuSyHsh32LLNAAAA==',
  )
  const input = Uint8Array.from(encoded, (value) => value.charCodeAt(0))
  const output = await (await images.open(input)).png().toUint8Array()
  const metadata = await outputMetadata(output)
  if (metadata.format !== 'png' || metadata.width !== 32 || metadata.height !== 24) {
    throw new Error(`Lossy WebP decode was ${metadata.format} ${metadata.width}x${metadata.height}`)
  }
  const pixels = await browserPixels(output, 'image/png')
  const center = (12 * 32 + 16) * 4
  if (
    Math.abs((pixels[center] ?? 0) - 149) > 18 ||
    Math.abs((pixels[center + 1] ?? 0) - 171) > 18 ||
    Math.abs((pixels[center + 2] ?? 0) - 189) > 18
  ) {
    throw new Error('Lossy WebP center pixel is outside the validated tolerance')
  }
  return {
    detail: 'first-party lossy WebP macroblock rows decoded to 32x24 PNG',
    outputBytes: output.byteLength,
  }
}

const avifPinnedPng = async (
  file: string,
  width: number,
  height: number,
  expectedSha256: string,
  detail: string,
): Promise<BrowserWorkflowResult> => {
  const input = await fetchBytes(`/fixtures/${file}`)
  const output = await (await images.open(input)).png().toUint8Array()
  const metadata = await outputMetadata(output)
  if (metadata.format !== 'png' || metadata.width !== width || metadata.height !== height) {
    throw new Error(`${detail} output was ${metadata.format} ${metadata.width}x${metadata.height}`)
  }
  const outputPixels = await browserPixels(output, 'image/png')
  const outputSha256 = await sha256(Uint8Array.from(outputPixels))
  if (outputSha256 !== expectedSha256) {
    throw new Error(`${detail} browser RGBA hash was ${outputSha256}`)
  }
  return {
    detail: `${detail} matched the pinned portable RGBA output`,
    outputBytes: output.byteLength,
  }
}

const avifAlphaStraight = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'alpha-straight-64x48.avif',
    64,
    48,
    '1f71b6185c44986fa75681b492345cb5562903e85291a1d3d28b32a1e871b456',
    'Straight-alpha AVIF',
  )

const avifAlphaPremultiplied = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'alpha-premultiplied-64x48.avif',
    64,
    48,
    '23e32ff582d47da3001ceb4058021e61a7683a8bb0e77abaf03b56ec0426e031',
    'Premultiplied-alpha AVIF',
  )
const avifBoundedAlphaRows = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'bounded-row-alpha-lossless-64x192.avif',
    64,
    192,
    'efaa398f2e06433b8640411836cde40b0cd8322f0405153436ab6cfbd8eed2af',
    'Synchronized color-and-alpha-ring AVIF',
  )
const avifBoundedRows = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'bounded-row-lossless-64x192.avif',
    64,
    192,
    '7e977b27d1c17fcac0d6092bca89bc47b4ad289dbff356e38302cc9fce300287',
    'Two-superblock-ring AVIF',
  )
const avifBoundedResize = async (): Promise<BrowserWorkflowResult> => {
  const input = await fetchBytes('/fixtures/bounded-row-lossless-64x192.avif')
  const output = await (await images.open(input))
    .resize({ width: 16, height: 48, fit: 'fill' })
    .png()
    .toUint8Array()
  const metadata = await outputMetadata(output)
  if (metadata.format !== 'png' || metadata.width !== 16 || metadata.height !== 48) {
    throw new Error(
      `Bounded-YUV AVIF resize output was ${metadata.format} ${metadata.width}x${metadata.height}`,
    )
  }
  const outputPixels = await browserPixels(output, 'image/png')
  const outputSha256 = await sha256(Uint8Array.from(outputPixels))
  if (outputSha256 !== '518122334ebc8a3ca083eb18eb8eb95c8de499076a30dc38a5a16d88cbd70c2b') {
    throw new Error(`Bounded-YUV AVIF resize browser RGBA hash was ${outputSha256}`)
  }
  return {
    detail: 'bounded-YUV AVIF resize matched the pinned portable RGBA output',
    outputBytes: output.byteLength,
  }
}

const avifQ0Lossless = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'lossless-q0-64x48.avif',
    64,
    48,
    'd49269082c04c18e7c81ef36bed98bbcd34dd0217e7d4042dad22801fbbbd7bf',
    'Lossless quantizer-context-0 identity-color AVIF',
  )
const avifPalette = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'draw_points_idat.avif',
    33,
    11,
    '2aa96c2acef4969d3e034ccc38d4cbcd80caa3cc1b14dd976fc3a4bcbeb0b07f',
    'Palette-coded screen-content AVIF',
  )
const avifIntrabc = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'blue-and-magenta-crop.avif',
    180,
    100,
    'dfd67e0ae631102f05399763ccae1f0b0e639c38b38f21d000927741c089cc00',
    'Clean-aperture cropped skipped intra-block-copy AVIF',
  )

const avifCleanAperture = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'clean-aperture-lossless-16x12.avif',
    8,
    6,
    'b4f3dd1a9180c53513814f078199ea69d943409cafcd1befdd90595bd66c04dc',
    'Clean-aperture AVIF',
  )

const avifHighBit10 = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'lossless-identity-16x12-10bpc.avif',
    16,
    12,
    '54ce76855c1541d9a61bf24e543cac163c038f47e1e441450ba359c6ceb36a1c',
    'Coded-lossless 10-bit AVIF',
  )

const avifHighBit12 = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'lossless-identity-16x12-12bpc.avif',
    16,
    12,
    '54ce76855c1541d9a61bf24e543cac163c038f47e1e441450ba359c6ceb36a1c',
    'Coded-lossless 12-bit AVIF',
  )

const avifHighBitTiles = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'tiled-lossless-10bpc-yuv444-2x2-256x256.avif',
    256,
    256,
    '50ce8c229e978291fd1ac9397ed3c7becb270c4e81eb5661759ac25b943adff5',
    'Coded-lossless 10-bit 2x2-tile AVIF',
  )

const avifSuperres = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'libaom-superres-denom12-96x64.avif',
    96,
    64,
    'bb31c24e26095af2032ca9f0d039e4061fae90a426cb3b446cb2199191f96e8b',
    'Filter-free AV1 super-resolution AVIF',
  )

const avifGrid = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'sofa_grid1x5_420.avif',
    1024,
    770,
    '7d3fb76660d21f8ffc24a440dc62f3e0ff90dcd933d5b3ee045b93b013dfd962',
    'Cropped-edge 1x5 AVIF grid',
  )

const avifQuantizationMatrix = async (): Promise<BrowserWorkflowResult> => {
  const input = await fetchBytes('/fixtures/sharp-qmatrix-q30-256x192.avif')
  const output = await (await images.open(input)).png().toUint8Array()
  const metadata = await outputMetadata(output)
  if (metadata.format !== 'png' || metadata.width !== 256 || metadata.height !== 192) {
    throw new Error(
      `Quantization-matrix AVIF output was ${metadata.format} ${metadata.width}x${metadata.height}`,
    )
  }
  const [oraclePixels, outputPixels] = await Promise.all([
    browserPixels(input, 'image/avif'),
    browserPixels(output, 'image/png'),
  ])
  const psnr = rgbPsnr(oraclePixels, outputPixels)
  if (psnr <= 39) {
    throw new Error(`Quantization-matrix AVIF browser RGB PSNR was ${psnr.toFixed(2)} dB`)
  }
  return {
    detail: `Sharp/libaom quantization-matrix AVIF matched Chromium at ${psnr.toFixed(2)} dB`,
    outputBytes: output.byteLength,
  }
}

const avifMonochrome = async (): Promise<BrowserWorkflowResult> => {
  const input = await fetchBytes('/fixtures/fox.profile0.8bpc.yuv420.monochrome.avif')
  const output = await (await images.open(input)).png().toUint8Array()
  const metadata = await outputMetadata(output)
  if (metadata.format !== 'png' || metadata.width !== 1204 || metadata.height !== 800) {
    throw new Error(
      `Monochrome AVIF output was ${metadata.format} ${metadata.width}x${metadata.height}`,
    )
  }
  const [oraclePixels, outputPixels] = await Promise.all([
    browserPixels(input, 'image/avif'),
    browserPixels(output, 'image/png'),
  ])
  const psnr = rgbPsnr(oraclePixels, outputPixels)
  if (psnr <= 60) {
    throw new Error(`Monochrome AVIF browser RGB PSNR was ${psnr.toFixed(2)} dB`)
  }
  return {
    detail: `8-bit monochrome AVIF matched Chromium at ${psnr.toFixed(2)} dB`,
    outputBytes: output.byteLength,
  }
}

const avifYuv422 = async (): Promise<BrowserWorkflowResult> => {
  const input = await fetchBytes('/fixtures/fox.profile2.8bpc.yuv422.avif')
  const output = await (await images.open(input)).png().toUint8Array()
  const metadata = await outputMetadata(output)
  if (metadata.format !== 'png' || metadata.width !== 1204 || metadata.height !== 800) {
    throw new Error(
      `YUV 4:2:2 AVIF output was ${metadata.format} ${metadata.width}x${metadata.height}`,
    )
  }
  const outputPixels = await browserPixels(output, 'image/png')
  if (outputPixels.byteLength !== 1204 * 800 * 4) {
    throw new Error(`YUV 4:2:2 AVIF browser output had ${outputPixels.byteLength} RGBA bytes`)
  }
  const outputSha256 = await sha256(Uint8Array.from(outputPixels))
  if (outputSha256 !== '4ef692312c9c87692b548ebbd6ba100feb3ec53f5b1929bdd9f2c86d78a31f95') {
    throw new Error(`YUV 4:2:2 AVIF browser RGBA hash was ${outputSha256}`)
  }
  return {
    detail: '8-bit YUV 4:2:2 AVIF matched the pinned browser RGBA output',
    outputBytes: output.byteLength,
  }
}

const avifYuv444 = async (): Promise<BrowserWorkflowResult> => {
  const input = await fetchBytes('/fixtures/fox.profile1.8bpc.yuv444.avif')
  const output = await (await images.open(input)).png().toUint8Array()
  const metadata = await outputMetadata(output)
  if (metadata.format !== 'png' || metadata.width !== 1204 || metadata.height !== 800) {
    throw new Error(
      `YUV 4:4:4 AVIF output was ${metadata.format} ${metadata.width}x${metadata.height}`,
    )
  }
  const [oraclePixels, outputPixels] = await Promise.all([
    browserPixels(input, 'image/avif'),
    browserPixels(output, 'image/png'),
  ])
  const psnr = rgbPsnr(oraclePixels, outputPixels)
  if (psnr <= 50) {
    throw new Error(`YUV 4:4:4 AVIF browser RGB PSNR was ${psnr.toFixed(2)} dB`)
  }
  return {
    detail: `8-bit YUV 4:4:4 AVIF matched Chromium at ${psnr.toFixed(2)} dB`,
    outputBytes: output.byteLength,
  }
}

const heifPqDisplay = async (): Promise<BrowserWorkflowResult> => {
  const input = await fetchBytes('/fixtures/main10-pq.heic')
  const image = await images.open(input)
  const metadata = await image.metadata()
  if (metadata.format !== 'heif' || metadata.width !== 32 || metadata.height !== 32) {
    throw new Error(
      `Main 10/PQ HEIF metadata was ${metadata.format} ${metadata.width}x${metadata.height}`,
    )
  }
  const output = await image.png().toUint8Array()
  const result = await outputMetadata(output)
  if (result.format !== 'png' || result.width !== 32 || result.height !== 32) {
    throw new Error(`Main 10/PQ HEIF output was ${result.format} ${result.width}x${result.height}`)
  }
  return {
    detail: 'Main 10/PQ HEIF displayed as 32x32 PNG in the browser',
    outputBytes: output.byteLength,
  }
}

const orientation = async (): Promise<BrowserWorkflowResult> => {
  const bytes = await fetchBytes('/fixtures/oriented-6.jpg')
  const source = await images.open(bytes.buffer)
  const metadata = await source.metadata()
  if (metadata.orientation !== 6 || metadata.width !== 640 || metadata.height !== 480) {
    throw new Error(`Oriented JPEG metadata was orientation ${metadata.orientation ?? 1}`)
  }
  const output = await source.autoOrient().png().toBlob()
  const result = await (await images.open(output)).metadata()
  if (result.width !== 480 || result.height !== 640 || (result.orientation ?? 1) !== 1) {
    throw new Error('autoOrient() did not normalize orientation 6 to 480x640')
  }
  return { detail: 'EXIF orientation 6 normalized to 480x640 PNG', outputBytes: output.size }
}

class FailingSink implements ImageSink {
  aborted = false
  #writes = 0

  async write(_chunk: Uint8Array): Promise<void> {
    this.#writes += 1
    if (this.#writes >= 6) throw new Error('intentional browser sink failure')
  }

  async close(): Promise<void> {
    throw new Error('failing sink must not close successfully')
  }

  async abort(_reason: unknown): Promise<void> {
    this.aborted = true
  }
}

const failureCleanup = async (): Promise<BrowserWorkflowResult> => {
  const bytes = await fetchBytes('/fixtures/alpha.png')
  const sink = new FailingSink()
  let failed = false
  try {
    await (await images.open(bytes)).rotate(90).png().toSink(sink)
  } catch (error: unknown) {
    failed = error instanceof Error && error.message === 'intentional browser sink failure'
  }
  if (!failed || !sink.aborted) throw new Error('Failed browser output did not abort its sink')

  const jpegSink = new FailingSink()
  failed = false
  try {
    await (await images.open(bytes))
      .resize({ width: 32 })
      .jpeg({ progressive: true })
      .toSink(jpegSink)
  } catch (error: unknown) {
    failed = error instanceof Error && error.message === 'intentional browser sink failure'
  }
  if (!failed || !jpegSink.aborted) {
    throw new Error('Failed progressive JPEG output did not abort its sink')
  }

  const recovered = await (await images.open(bytes)).rotate(90).png().toUint8Array()
  const metadata = await outputMetadata(recovered)
  if (metadata.width !== 3 || metadata.height !== 4) {
    throw new Error('A failed pipeline left browser execution unable to recover')
  }
  return {
    detail: 'failed PNG and progressive JPEG outputs aborted their sinks; next output succeeded',
    outputBytes: recovered.byteLength,
  }
}

const harness: BrowserCompatibilityHarness = Object.freeze({
  animatedGifFrameSelection,
  avifAlphaPremultiplied,
  avifAlphaStraight,
  avifBoundedAlphaRows,
  avifBoundedRows,
  avifBoundedResize,
  avifCleanAperture,
  avifGrid,
  avifHighBit10,
  avifHighBit12,
  avifHighBitTiles,
  avifSuperres,
  avifIntrabc,
  avifQuantizationMatrix,
  avifQ0Lossless,
  avifPalette,
  avifMonochrome,
  avifYuv422,
  avifYuv444,
  failureCleanup,
  heifPqDisplay,
  inputTypes,
  jpegPipeline,
  orientation,
  pngAlphaPipeline,
  progressiveJpeg,
  resizeDefaultKernel,
  wasmJpeg,
  wasmJpegEncode,
  wasmPng,
  webpLossless,
  webpLossyDecode,
})

window.pureJsImageBrowserTests = harness
