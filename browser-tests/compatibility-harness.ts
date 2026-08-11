import { createWasmJpegAccelerator } from '../src/accelerator-entries/wasm-jpeg-browser.ts'
import { createWasmPngAccelerator } from '../src/accelerator-entries/wasm-png-browser.ts'
import { createWasmJpegAcceleratorWithLoaders } from '../src/accelerators/wasm/jpeg.ts'
import { createWasmPngAcceleratorWithLoaders } from '../src/accelerators/wasm/png.ts'
import { createImageLibrary, ImageError } from '../src/browser.ts'
import { browserRuntime } from '../src/browser-runtime.ts'
import { avifCodec } from '../src/codec-entries/avif.ts'
import { bmpCodec } from '../src/codec-entries/bmp.ts'
import { experimentalHeifCodec } from '../src/codec-entries/experimental/heic.ts'
import { gifCodec } from '../src/codec-entries/gif.ts'
import { jpegCodec } from '../src/codec-entries/jpeg.ts'
import { pngCodec } from '../src/codec-entries/png.ts'
import { createTiffCodec, tiffCodec } from '../src/codec-entries/tiff.ts'
import { webpCodec } from '../src/codec-entries/webp.ts'
import { acceleratePngCodec, type PngDecodeAcceleration } from '../src/codecs/png.ts'
import { defaultImageLimits } from '../src/limits.ts'
import type { PixelBlock } from '../src/pixel.ts'
import { rasterToPixels } from '../src/raster.ts'
import { omeTiffProfile } from '../src/scientific/ome-tiff.ts'
import type { ImageSink } from '../src/sink.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import type { ImageInput } from '../src/source.ts'
import { MemorySource } from '../src/source.ts'
import {
  createTiffProfileRegistry,
  encodeTiffDocument,
  openTiffDocument,
} from '../src/tiff/index.ts'
import type { BrowserCompatibilityHarness, BrowserWorkflowResult } from './types.ts'

const images = createImageLibrary([
  gifCodec,
  jpegCodec,
  pngCodec,
  webpCodec,
  bmpCodec,
  tiffCodec,
  avifCodec,
  experimentalHeifCodec,
])
const composedTiffImages = createImageLibrary([
  pngCodec,
  createTiffCodec({ embeddedCodecs: [webpCodec] }),
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
const unsupportedJpegBoundaries = async (): Promise<BrowserWorkflowResult> => {
  const source = await fetchBytes('/fixtures/benchmark-input.jpg')
  let frame = -1
  for (let offset = 0; offset + 4 < source.byteLength; offset += 1) {
    if (source[offset] === 0xff && source[offset + 1] === 0xc0) {
      frame = offset
      break
    }
  }
  if (frame < 0) throw new Error('Browser JPEG fixture is missing SOF0')

  const arithmetic = Uint8Array.from(source)
  arithmetic[frame + 1] = 0xc9
  const twelveBit = Uint8Array.from(source)
  twelveBit[frame + 4] = 12
  for (const [input, message] of [
    [arithmetic, 'Arithmetic-coded JPEG images are unsupported'],
    [twelveBit, '12-bit JPEG samples are unsupported'],
  ] as const) {
    try {
      await (await images.open(input)).png().toUint8Array()
      throw new Error(`Browser JPEG decode accepted: ${message}`)
    } catch (error) {
      if (
        !(error instanceof ImageError) ||
        error.code !== 'UNSUPPORTED_OPERATION' ||
        error.message !== message
      ) {
        throw error
      }
    }
  }
  const png = await fetchBytes('/fixtures/benchmark-input.png')
  const encoded = await (await images.open(png)).jpeg({ quality: 80 }).toUint8Array()
  const reference = await (await images.open(encoded)).png().toUint8Array()
  let motionJpeg = Uint8Array.from(encoded)
  const huffmanSegments: number[] = []
  for (let offset = 0; offset + 3 < motionJpeg.byteLength; offset += 1) {
    if (motionJpeg[offset] === 0xff && motionJpeg[offset + 1] === 0xc4) {
      huffmanSegments.push(offset)
    }
  }
  for (let index = huffmanSegments.length - 1; index >= 0; index -= 1) {
    const offset = huffmanSegments[index]
    if (offset === undefined) continue
    const length = ((motionJpeg[offset + 2] ?? 0) << 8) | (motionJpeg[offset + 3] ?? 0)
    const end = offset + 2 + length
    const next = new Uint8Array(motionJpeg.byteLength - (end - offset))
    next.set(motionJpeg.subarray(0, offset))
    next.set(motionJpeg.subarray(end), offset)
    motionJpeg = next
  }
  let application = -1
  for (let offset = 0; offset + 7 < motionJpeg.byteLength; offset += 1) {
    if (motionJpeg[offset] === 0xff && motionJpeg[offset + 1] === 0xe0) {
      application = offset
      break
    }
  }
  if (application < 0) throw new Error('Browser JPEG encoder did not write APP0')
  motionJpeg.set([0x41, 0x56, 0x49, 0x31], application + 4)
  const recovered = await (await images.open(motionJpeg)).png().toUint8Array()
  if (
    recovered.byteLength !== reference.byteLength ||
    recovered.some((value, offset) => value !== reference[offset])
  ) {
    throw new Error('Browser AVI1/MJPEG default Huffman tables changed decoded pixels')
  }

  return {
    detail:
      'arithmetic-coded and 12-bit JPEG returned UNSUPPORTED_OPERATION; AVI1/MJPEG default Huffman tables matched the explicit-table decode',
    outputBytes: recovered.byteLength,
  }
}

const tolerantJpegRestartRecovery = async (): Promise<BrowserWorkflowResult> => {
  const source = await fetchBytes('/fixtures/benchmark-input.png')
  const encoded = await (await images.open(source))
    .jpeg({ quality: 82, restartInterval: 3 })
    .toUint8Array()
  let restartMarkers = 0
  let corruptOffset = -1
  for (let offset = 0; offset + 1 < encoded.byteLength; offset += 1) {
    const marker = encoded[offset + 1] ?? 0
    if (encoded[offset] !== 0xff || marker < 0xd0 || marker > 0xd7) continue
    restartMarkers += 1
    if (restartMarkers === 2) {
      corruptOffset = offset + 1
      break
    }
  }
  if (corruptOffset < 0) throw new Error('Browser JPEG restart fixture is incomplete')
  const corrupted = Uint8Array.from(encoded)
  corrupted[corruptOffset] = 0xd7

  try {
    await (await wasmImages.open(corrupted, { tolerantDecoding: false })).png().toUint8Array()
    throw new Error('Strict browser JPEG decode accepted an out-of-order restart marker')
  } catch (error) {
    if (!(error instanceof ImageError) || error.message !== 'Expected JPEG restart marker 1') {
      throw error
    }
  }
  const [reference, output] = await Promise.all([
    (await images.open(corrupted)).png().toUint8Array(),
    (await wasmImages.open(corrupted)).png().toUint8Array(),
  ])
  if (reference.byteLength !== output.byteLength) {
    throw new Error('Tolerant WASM JPEG output length differs from the TypeScript reference')
  }
  for (let offset = 0; offset < reference.byteLength; offset += 1) {
    if (reference[offset] !== output[offset]) {
      throw new Error(`Tolerant WASM JPEG output differs at byte ${offset}`)
    }
  }
  const metadata = await outputMetadata(output)
  if (metadata.format !== 'png' || metadata.width !== 640 || metadata.height !== 480) {
    throw new Error(
      `Default JPEG recovery output was ${metadata.format} ${metadata.width}x${metadata.height}`,
    )
  }
  return {
    detail: 'default tolerant Rust/WASM JPEG restart recovery matched TypeScript at 640x480',
    outputBytes: output.byteLength,
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
  const failedDecode: PngDecodeAcceleration = {
    async decode() {
      throw new Error('simulated PNG WASM decode failure')
    },
  }
  const typescriptFallbackImages = createImageLibrary([acceleratePngCodec(pngCodec, failedDecode)])
  const [reference, publicOutput, scalarFallback, simd, typescriptFallback] = await Promise.all([
    (await images.open(bytes)).png({ compressionLevel: 6 }).toUint8Array(),
    (await publicImages.open(bytes)).png({ compressionLevel: 6 }).toUint8Array(),
    (await scalarFallbackImages.open(bytes)).png({ compressionLevel: 6 }).toUint8Array(),
    (await simdImages.open(bytes)).png({ compressionLevel: 6 }).toUint8Array(),
    (await typescriptFallbackImages.open(bytes)).png({ compressionLevel: 6 }).toUint8Array(),
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
  assertExact('TypeScript decode fallback', typescriptFallback)
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
    detail:
      'SIMD selection plus scalar and TypeScript PNG decode fallback matched exact public output',
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
  const scanOffsets: number[] = []
  const huffmanOffsets: number[] = []
  for (let offset = 0; offset + 1 < progressive.byteLength; offset += 1) {
    if (progressive[offset] !== 0xff) continue
    if (progressive[offset + 1] === 0xc2) frameMarkers += 1
    if (progressive[offset + 1] === 0xda) scanOffsets.push(offset)
    if (progressive[offset + 1] === 0xc4) huffmanOffsets.push(offset)
  }
  if (frameMarkers !== 1 || scanOffsets.length !== 6) {
    throw new Error(
      `Progressive JPEG structure had ${frameMarkers} frames and ${scanOffsets.length} scans`,
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
  const acScan = scanOffsets[2]
  if (acScan === undefined) throw new Error('Progressive browser JPEG is missing its AC scan')
  const scanLength = ((progressive[acScan + 2] ?? 0) << 8) | (progressive[acScan + 3] ?? 0)
  const entropyStart = acScan + 2 + scanLength
  const nextHuffmanTable = huffmanOffsets.find((offset) => offset > entropyStart)
  if (nextHuffmanTable === undefined) {
    throw new Error('Progressive browser JPEG is missing its inter-scan DHT')
  }
  const huffmanLength =
    ((progressive[nextHuffmanTable + 2] ?? 0) << 8) | (progressive[nextHuffmanTable + 3] ?? 0)
  const huffmanEnd = nextHuffmanTable + 2 + huffmanLength
  const truncatedAt = entropyStart + Math.floor((nextHuffmanTable - entropyStart) / 2)
  const partial = new Uint8Array(truncatedAt + huffmanEnd - nextHuffmanTable + 2)
  partial.set(progressive.subarray(0, truncatedAt))
  partial.set(progressive.subarray(nextHuffmanTable, huffmanEnd), truncatedAt)
  partial.set([0xff, 0xd9], partial.byteLength - 2)
  const recovered = await (await images.open(partial)).png().toUint8Array()
  let strictRejected = false
  try {
    await (await images.open(partial, { tolerantDecoding: false })).png().toUint8Array()
  } catch (error) {
    strictRejected =
      error instanceof ImageError &&
      error.code === 'INVALID_INPUT' &&
      error.message === 'Unexpected JPEG marker ffc4'
  }
  if (recovered.byteLength < 50 || !strictRejected) {
    throw new Error('Progressive browser DHT-boundary recovery did not preserve strict opt-out')
  }

  return {
    detail:
      'six-scan progressive JPEG matched baseline pixels and recovered a partial AC scan at a DHT boundary in the browser',
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
const tiffEncodePipeline = async (): Promise<BrowserWorkflowResult> => {
  const input = await fetchBytes('/fixtures/benchmark-input.png')
  const encoded = await (await images.open(input))
    .tiff({
      compression: 'deflate',
      predictor: 'horizontal',
      layout: 'tiles',
      tileWidth: 128,
      tileHeight: 128,
      format: 'bigtiff',
      compressionLevel: 6,
    })
    .toUint8Array()
  const metadata = await (await images.open(encoded)).metadata()
  if (metadata.format !== 'tiff' || metadata.width !== 640 || metadata.height !== 480) {
    throw new Error(
      `Browser TIFF encode produced ${metadata.format} ${metadata.width}x${metadata.height}`,
    )
  }
  const reopened = await (await images.open(encoded)).png().toUint8Array()
  const [expectedPixels, actualPixels] = await Promise.all([
    browserPixels(input, 'image/png'),
    browserPixels(reopened, 'image/png'),
  ])
  if (actualPixels.byteLength !== expectedPixels.byteLength) {
    throw new Error('Browser TIFF round-trip pixel size changed')
  }
  for (let offset = 0; offset < expectedPixels.byteLength; offset += 1) {
    if (actualPixels[offset] !== expectedPixels[offset]) {
      throw new Error(`Browser TIFF round-trip pixel ${offset} changed`)
    }
  }
  const blocks = (
    width: number,
    height: number,
    format: 'rgb8' | 'rgba8',
    data: Uint8Array,
  ): AsyncIterable<PixelBlock> => ({
    async *[Symbol.asyncIterator]() {
      yield {
        x: 0,
        y: 0,
        width,
        height,
        stride: width * (format === 'rgb8' ? 3 : 4),
        format,
        data,
      }
    },
  })
  const documentSink = new Uint8ArraySink()
  await encodeTiffDocument(documentSink, {
    runtime: browserRuntime,
    options: {
      compression: 'deflate',
      predictor: 'horizontal',
      layout: 'tiles',
      tileWidth: 16,
      tileHeight: 16,
      format: 'bigtiff',
    },
    pages: [
      {
        width: 2,
        height: 1,
        pixelFormat: 'rgb8',
        blocks: blocks(2, 1, 'rgb8', Uint8Array.of(1, 2, 3, 4, 5, 6)),
        reducedImages: [
          {
            width: 1,
            height: 1,
            pixelFormat: 'rgb8',
            blocks: blocks(1, 1, 'rgb8', Uint8Array.of(7, 8, 9)),
          },
        ],
      },
      {
        width: 1,
        height: 1,
        pixelFormat: 'rgba8',
        blocks: blocks(1, 1, 'rgba8', Uint8Array.of(10, 11, 12, 13)),
      },
    ],
  })
  const documentBytes = documentSink.toUint8Array()
  const document = await openTiffDocument(new MemorySource(documentBytes))
  if (
    document.topLevelDirectories.length !== 2 ||
    document.directories.length !== 3 ||
    document.topLevelDirectories[0]?.subIfds.length !== 1
  ) {
    throw new Error('Browser structured TIFF document lost pages or its SubIFD pyramid')
  }
  return {
    detail:
      'Deflate-predicted tiled BigTIFF round-tripped exact browser pixels; structured multi-page and SubIFD-pyramid output reopened',
    outputBytes: encoded.byteLength + documentBytes.byteLength,
  }
}

interface BrowserImagePixels {
  readonly height: number
  readonly pixels: Uint8ClampedArray
  readonly width: number
}

const browserImagePixels = async (bytes: Uint8Array, type: string): Promise<BrowserImagePixels> => {
  const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type }))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D OffscreenCanvas context is unavailable')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return {
    width: canvas.width,
    height: canvas.height,
    pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
  }
}

const browserPixels = async (bytes: Uint8Array, type: string): Promise<Uint8ClampedArray> =>
  (await browserImagePixels(bytes, type)).pixels

const portablePngPixels = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const createDecoder = pngCodec.createDecoder
  if (!createDecoder) throw new Error('First-party PNG decoding is unavailable')
  const decoder = await createDecoder(new MemorySource(bytes), defaultImageLimits)
  if (decoder.pixelFormat !== 'rgb8' && decoder.pixelFormat !== 'rgba8') {
    throw new Error(`Expected RGB8 or RGBA8 PNG output, got ${decoder.pixelFormat}`)
  }
  const output = new Uint8Array(decoder.width * decoder.height * 4)
  const channels = decoder.pixelFormat === 'rgb8' ? 3 : 4
  let nextRow = 0
  for await (const block of decoder.decode()) {
    try {
      if (
        block.format !== decoder.pixelFormat ||
        block.x !== 0 ||
        block.y !== nextRow ||
        block.width !== decoder.width
      ) {
        throw new Error('First-party PNG decoder emitted non-contiguous pixel blocks')
      }
      for (let row = 0; row < block.height; row += 1) {
        let sourceOffset = row * block.stride
        let outputOffset = (block.y + row) * decoder.width * 4
        for (let x = 0; x < block.width; x += 1) {
          output[outputOffset] = block.data[sourceOffset] ?? 0
          output[outputOffset + 1] = block.data[sourceOffset + 1] ?? 0
          output[outputOffset + 2] = block.data[sourceOffset + 2] ?? 0
          output[outputOffset + 3] = channels === 4 ? (block.data[sourceOffset + 3] ?? 0) : 255
          sourceOffset += channels
          outputOffset += 4
        }
      }
      nextRow += block.height
    } finally {
      block.release?.()
    }
  }
  if (nextRow !== decoder.height) {
    throw new Error(`First-party PNG decoder emitted ${nextRow} of ${decoder.height} rows`)
  }
  return output
}

const sha256 = async (bytes: Uint8Array | Uint8ClampedArray): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))
  return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('')
}

interface BrowserTiffEntry {
  readonly tag: number
  readonly type: 2 | 3 | 4 | 7
  readonly values: readonly number[]
}

const browserTiffFixture = (
  entriesFor: (stripOffsets: readonly number[]) => BrowserTiffEntry[],
  strips: readonly Uint8Array[],
): Uint8Array => {
  const placeholder = entriesFor(strips.map(() => 0)).sort((left, right) => left.tag - right.tag)
  const entryBytes = (entry: BrowserTiffEntry): number =>
    entry.values.length * (entry.type === 3 ? 2 : entry.type === 4 ? 4 : 1)
  const ifdBytes = 2 + placeholder.length * 12 + 4
  const externalBytes = placeholder.reduce((total, entry) => {
    const bytes = entryBytes(entry)
    return total + (bytes > 4 ? bytes : 0)
  }, 0)
  const pixelOffset = 8 + ifdBytes + externalBytes
  const stripOffsets: number[] = []
  let nextStripOffset = pixelOffset
  for (const strip of strips) {
    stripOffsets.push(nextStripOffset)
    nextStripOffset += strip.byteLength
  }
  const entries = entriesFor(stripOffsets).sort((left, right) => left.tag - right.tag)
  const output = new Uint8Array(nextStripOffset)
  const view = new DataView(output.buffer)
  output.set([0x49, 0x49, 0x2a, 0])
  view.setUint32(4, 8, true)
  view.setUint16(8, entries.length, true)
  let externalOffset = 8 + ifdBytes
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (!entry) continue
    const entryOffset = 10 + index * 12
    const valueBytes = entryBytes(entry)
    const valuesOffset = valueBytes > 4 ? externalOffset : entryOffset + 8
    view.setUint16(entryOffset, entry.tag, true)
    view.setUint16(entryOffset + 2, entry.type, true)
    view.setUint32(entryOffset + 4, entry.values.length, true)
    if (valueBytes > 4) {
      view.setUint32(entryOffset + 8, externalOffset, true)
      externalOffset += valueBytes
    }
    for (let valueIndex = 0; valueIndex < entry.values.length; valueIndex += 1) {
      const elementBytes = entry.type === 3 ? 2 : entry.type === 4 ? 4 : 1
      const offset = valuesOffset + valueIndex * elementBytes
      const value = entry.values[valueIndex] ?? 0
      if (entry.type === 3) view.setUint16(offset, value, true)
      else if (entry.type === 4) view.setUint32(offset, value, true)
      else output[offset] = value
    }
  }
  for (let index = 0; index < strips.length; index += 1) {
    output.set(strips[index] ?? new Uint8Array(), stripOffsets[index] ?? 0)
  }
  return output
}

const scientificTiffDocument = async (): Promise<BrowserWorkflowResult> => {
  const xml = new TextEncoder().encode(
    '<?xml version="1.0"?><OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06"><Image ID="Image:0"><Pixels ID="Pixels:0" DimensionOrder="XYZCT" Type="uint16" SizeX="2" SizeY="1" SizeZ="1" SizeC="3" SizeT="1" PhysicalSizeX="0.5" PhysicalSizeXUnit="µm"><Channel ID="Channel:0" Name="RGB" SamplesPerPixel="3"/><TiffData IFD="0" PlaneCount="1"/></Pixels></Image></OME>',
  )
  const description = Uint8Array.from([...xml, 0])
  const strip = Uint8Array.of(0, 0, 0, 128, 255, 255, 255, 255, 0, 128, 0, 0)
  const input = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [2] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [16, 16, 16] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [2] },
      { tag: 270, type: 2, values: [...description] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [3] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [strip.byteLength] },
      { tag: 284, type: 3, values: [1] },
      { tag: 339, type: 3, values: [1, 1, 1] },
    ],
    [strip],
  )
  const document = await openTiffDocument(new MemorySource(input))
  const directory = document.topLevelDirectories[0]
  if (directory?.offset !== 8 || document.getDirectoryByOffset(8) !== directory) {
    throw new Error('Browser TIFF document did not expose stable IFD offsets')
  }
  const header = await document.readBytes(0, 4, { maxBytes: 4 })
  if (header.join(',') !== '73,73,42,0') {
    throw new Error('Browser TIFF document bounded byte read returned the wrong bytes')
  }
  try {
    await document.readBytes(0, 5, { maxBytes: 4 })
    throw new Error('Browser TIFF document accepted an over-budget byte read')
  } catch (error: unknown) {
    if (!(error instanceof ImageError) || error.code !== 'LIMIT_EXCEEDED') throw error
  }
  const tag = await directory.getTag(270, { maxBytes: 4096 })
  if (tag?.kind !== 'ascii' || !tag.value.includes('<OME')) {
    throw new Error('Browser TIFF document did not expose bounded OME metadata')
  }
  if ((await directory.getTag(270, { maxBytes: 4096 })) !== tag) {
    throw new Error('Browser TIFF document did not reuse an immutable parsed tag')
  }
  const dataset = await createTiffProfileRegistry([omeTiffProfile]).openWith(
    document,
    omeTiffProfile,
  )
  if (
    dataset.sizeX !== 2 ||
    dataset.sizeY !== 1 ||
    dataset.sizeC !== 3 ||
    dataset.sampleType !== 'uint16' ||
    dataset.physicalSizeX?.value !== 0.5
  ) {
    throw new Error('Browser OME-TIFF dataset metadata is incorrect')
  }
  const rasterBlocks = dataset.readPlane({
    z: 0,
    c: [0, 1, 2],
    t: 0,
    x: 0,
    y: 0,
    width: 2,
    height: 1,
  })
  const pixels: number[] = []
  for await (const block of rasterToPixels(rasterBlocks, {
    channels: [0, 1, 2],
    ranges: [
      { black: 0, white: 65_535 },
      { black: 0, white: 65_535 },
      { black: 0, white: 65_535 },
    ],
  })) {
    pixels.push(...block.data)
  }
  if (pixels.join(',') !== '0,128,255,255,128,0') {
    throw new Error(`Browser OME-TIFF display conversion produced ${pixels.join(',')}`)
  }
  return {
    detail:
      'bounded TIFF extension APIs, typed profile opening, native OME-TIFF raster, and explicit display conversion passed',
    outputBytes: input.byteLength,
  }
}

const browserConstantGrayCmykProfile = (): Uint8Array => {
  const tagOffset = 144
  const tagBytes = 176
  const profile = new Uint8Array(tagOffset + tagBytes)
  const view = new DataView(profile.buffer)
  const signature = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      profile[offset + index] = value.charCodeAt(index)
    }
  }
  view.setUint32(0, profile.byteLength, false)
  signature(12, 'mntr')
  signature(16, 'CMYK')
  signature(20, 'XYZ ')
  signature(36, 'acsp')
  view.setUint32(128, 1, false)
  signature(132, 'A2B0')
  view.setUint32(136, tagOffset, false)
  view.setUint32(140, tagBytes, false)
  signature(tagOffset, 'mft2')
  profile[tagOffset + 8] = 4
  profile[tagOffset + 9] = 3
  profile[tagOffset + 10] = 2
  view.setInt32(tagOffset + 12, 65_536, false)
  view.setInt32(tagOffset + 28, 65_536, false)
  view.setInt32(tagOffset + 44, 65_536, false)
  view.setUint16(tagOffset + 48, 2, false)
  view.setUint16(tagOffset + 50, 2, false)
  let offset = tagOffset + 52
  for (let channel = 0; channel < 4; channel += 1) {
    view.setUint16(offset, 0, false)
    view.setUint16(offset + 2, 65_535, false)
    offset += 4
  }
  for (let point = 0; point < 16; point += 1) {
    for (const xyz of [15_797, 16_384, 13_515]) {
      view.setUint16(offset, xyz, false)
      offset += 2
    }
  }
  for (let channel = 0; channel < 3; channel += 1) {
    view.setUint16(offset, 0, false)
    view.setUint16(offset + 2, 65_535, false)
    offset += 4
  }
  return profile
}

const browserPyramidTiffFixture = (): Uint8Array => {
  const rootIfdOffset = 8
  const entriesPerIfd = 11
  const ifdBytes = 2 + entriesPerIfd * 12 + 4
  const levelIfdOffset = rootIfdOffset + ifdBytes
  const rootPixelOffset = levelIfdOffset + ifdBytes
  const levelPixelOffset = rootPixelOffset + 4
  const output = new Uint8Array(levelPixelOffset + 1)
  const view = new DataView(output.buffer)
  output.set([0x49, 0x49, 0x2a, 0])
  view.setUint32(4, rootIfdOffset, true)
  const writeIfd = (
    offset: number,
    entries: readonly {
      readonly tag: number
      readonly type: 3 | 4
      readonly value: number
    }[],
  ): void => {
    view.setUint16(offset, entries.length, true)
    const sorted = [...entries].sort((left, right) => left.tag - right.tag)
    for (let index = 0; index < sorted.length; index += 1) {
      const entry = sorted[index]
      if (!entry) continue
      const entryOffset = offset + 2 + index * 12
      view.setUint16(entryOffset, entry.tag, true)
      view.setUint16(entryOffset + 2, entry.type, true)
      view.setUint32(entryOffset + 4, 1, true)
      if (entry.type === 3) view.setUint16(entryOffset + 8, entry.value, true)
      else view.setUint32(entryOffset + 8, entry.value, true)
    }
  }
  const imageEntries = (
    width: number,
    height: number,
    pixelOffset: number,
  ): {
    readonly tag: number
    readonly type: 3 | 4
    readonly value: number
  }[] => [
    { tag: 256, type: 4, value: width },
    { tag: 257, type: 4, value: height },
    { tag: 258, type: 3, value: 8 },
    { tag: 259, type: 3, value: 1 },
    { tag: 262, type: 3, value: 1 },
    { tag: 273, type: 4, value: pixelOffset },
    { tag: 277, type: 3, value: 1 },
    { tag: 278, type: 4, value: height },
    { tag: 279, type: 4, value: width * height },
    { tag: 284, type: 3, value: 1 },
  ]
  writeIfd(rootIfdOffset, [
    ...imageEntries(2, 2, rootPixelOffset),
    { tag: 330, type: 4, value: levelIfdOffset },
  ])
  writeIfd(levelIfdOffset, [
    { tag: 254, type: 4, value: 1 },
    ...imageEntries(1, 1, levelPixelOffset),
  ])
  output.set([1, 2, 3, 4], rootPixelOffset)
  output[levelPixelOffset] = 222
  return output
}

const packBrowserTiffLzw = (values: Uint8Array): Uint8Array => {
  const codes = [256, ...values, 257]
  const output = new Uint8Array(Math.ceil((codes.length * 9) / 8))
  let bitOffset = 0
  for (const code of codes) {
    for (let bit = 8; bit >= 0; bit -= 1) {
      if ((code & (1 << bit)) !== 0) {
        const byte = bitOffset >>> 3
        output[byte] = (output[byte] ?? 0) | (1 << (7 - (bitOffset & 7)))
      }
      bitOffset += 1
    }
  }
  return output
}

const packBrowserFaxBits = (bits: string): Uint8Array => {
  const output = new Uint8Array(Math.ceil(bits.length / 8))
  for (let index = 0; index < bits.length; index += 1) {
    if (bits[index] === '1') {
      const byte = index >>> 3
      output[byte] = (output[byte] ?? 0) | (1 << (7 - (index & 7)))
    }
  }
  return output
}
const browserZstdRawFrame = (data: Uint8Array): Uint8Array => {
  if (data.byteLength > 255) throw new Error('Browser Zstandard fixture is too large')
  const output = new Uint8Array(data.byteLength + 9)
  output.set([0x28, 0xb5, 0x2f, 0xfd, 0x20, data.byteLength])
  const blockHeader = (data.byteLength << 3) | 1
  output[6] = blockHeader & 0xff
  output[7] = (blockHeader >>> 8) & 0xff
  output[8] = blockHeader >>> 16
  output.set(data, 9)
  return output
}

const legacyTiffAndBmp = async (): Promise<BrowserWorkflowResult> => {
  const encoded = atob(
    'SUkqAAgAAAAKAAABBAABAAAALAEAAAEBBAABAAAAAQAAAAIBAwABAAAACAAAAAMBAwABAAAABQAAAAYBAwABAAAAAQAAABEBBAABAAAAhgAAABUBAwABAAAAAQAAABYBBAABAAAAAQAAABcBBAABAAAAWgEAABwBAwABAAAAAQAAAAAAAAAAAQQQMIBAAQMHECRQsIBBAwcPIESQMIFCBQsXMGTQsIFDBw8fQIQQMYJECRMnUKRQsYJFCxcvYMSQMYNGDRs3cOTQsYNHDx8/gAQRMoRIESNHkCRRsoRJEydPoESRMoVKFStXsGTRsoVLFy9fwIQRM4ZMGTNn0KRRs4ZNGzdv4MSRM4dOHTt38OTRs4dPHz9/AAUSNIhQIUOHECVStIhRI0ePIEWSNIlSJUuXMGXStIlTJ0+fQIUSNYpUKVOnUKVStYpVK1evYMWSNYtWLVu3cOXStYtXL1+/gAUTNoxYMWPHkCVTtoxZM2fPoEWTNo1aNWvXsGXTto1bN2/fwIUTN45cOXPn0KVTt45dO3fv4MWTN49ePXv38OXTt49fP3//ABCAAAMQUIABByCQgAILMNCAAw9AEIEEE1BQgQUXYJCBBhtw0IEHH4AQgggjkFCCCSegkIIKKwQE',
  )
  const legacyTiff = Uint8Array.from(encoded, (value) => value.charCodeAt(0))
  const legacyOutput = await (await images.open(legacyTiff)).png().toUint8Array()
  const legacyPixels = await browserPixels(legacyOutput, 'image/png')
  for (const [x, expected] of [
    [0, 0],
    [255, 255],
    [299, 43],
  ] as const) {
    const offset = x * 4
    if (
      legacyPixels[offset] !== expected ||
      legacyPixels[offset + 1] !== expected ||
      legacyPixels[offset + 2] !== expected
    ) {
      throw new Error(`Legacy TIFF LZW pixel ${x} did not decode to ${expected}`)
    }
  }
  const zstdPixels = Uint8Array.of(0, 20, 80, 140, 220, 255)
  const zstdStrip = browserZstdRawFrame(zstdPixels)
  const zstdTiff = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [3] },
      { tag: 257, type: 4, values: [2] },
      { tag: 258, type: 3, values: [8] },
      { tag: 259, type: 3, values: [50_000] },
      { tag: 262, type: 3, values: [1] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [1] },
      { tag: 278, type: 4, values: [2] },
      { tag: 279, type: 4, values: [zstdStrip.byteLength] },
      { tag: 284, type: 3, values: [1] },
    ],
    [zstdStrip],
  )
  const zstdOutput = await (await images.open(zstdTiff)).png().toUint8Array()
  const decodedZstdPixels = await browserPixels(zstdOutput, 'image/png')
  for (let index = 0; index < zstdPixels.byteLength; index += 1) {
    if (decodedZstdPixels[index * 4] !== zstdPixels[index]) {
      throw new Error(`Zstandard TIFF pixel ${index} changed in the browser`)
    }
  }
  const lercStrip = await fetchBytes('/fixtures/bluemarble_256_256_3_byte.lerc2')
  const lercTiff = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [256] },
      { tag: 257, type: 4, values: [256] },
      { tag: 258, type: 3, values: [8, 8, 8] },
      { tag: 259, type: 3, values: [34_887] },
      { tag: 262, type: 3, values: [2] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [3] },
      { tag: 278, type: 4, values: [256] },
      { tag: 279, type: 4, values: [lercStrip.byteLength] },
      { tag: 284, type: 3, values: [1] },
      { tag: 50_674, type: 4, values: [4, 0] },
    ],
    [lercStrip],
  )
  const lercOutput = await (await images.open(lercTiff)).png().toUint8Array()
  const lercPixels = await browserPixels(lercOutput, 'image/png')
  if (
    lercPixels[0] !== 1 ||
    lercPixels[1] !== 4 ||
    lercPixels[2] !== 19 ||
    lercPixels[(256 * 256 - 1) * 4] !== 0
  ) {
    throw new Error('First-party LERC TIFF pixels changed in the browser')
  }

  const entries = [
    [256, 4, 1, 2],
    [257, 3, 1, 1],
    [258, 3, 3, 0x0008_0008_0008],
    [259, 3, 1, 1],
    [262, 3, 1, 2],
    [273, 16, 1, 0],
    [277, 3, 1, 3],
    [278, 4, 1, 1],
    [279, 16, 1, 6],
    [284, 3, 1, 1],
  ] as const
  const bigTiffPixelOffset = 16 + 8 + entries.length * 20 + 8
  const bigTiff = new Uint8Array(bigTiffPixelOffset + 6)
  const bigView = new DataView(bigTiff.buffer)
  bigTiff.set([0x49, 0x49, 0x2b, 0])
  bigView.setUint16(4, 8, true)
  bigView.setBigUint64(8, 16n, true)
  bigView.setBigUint64(16, BigInt(entries.length), true)
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (!entry) continue
    const offset = 24 + index * 20
    bigView.setUint16(offset, entry[0], true)
    bigView.setUint16(offset + 2, entry[1], true)
    bigView.setBigUint64(offset + 4, BigInt(entry[2]), true)
    bigView.setBigUint64(
      offset + 12,
      BigInt(entry[0] === 273 ? bigTiffPixelOffset : entry[3]),
      true,
    )
    if (entry[0] === 257) bigTiff[offset + 19] = 0xff
  }
  bigTiff.set([10, 20, 30, 200, 150, 100], bigTiffPixelOffset)
  const bigOutput = await (await images.open(bigTiff)).png().toUint8Array()
  const bigPixels = await browserPixels(bigOutput, 'image/png')
  if (
    bigPixels[0] !== 10 ||
    bigPixels[1] !== 20 ||
    bigPixels[2] !== 30 ||
    bigPixels[4] !== 200 ||
    bigPixels[5] !== 150 ||
    bigPixels[6] !== 100
  ) {
    throw new Error('BigTIFF inline SHORT padding changed decoded pixels')
  }

  const tileSegments = [Uint8Array.of(10, 20), Uint8Array.of(30, 99)]
  const legacyTile = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [3] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [8] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [1] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [1] },
      { tag: 279, type: 4, values: [2, 2] },
      { tag: 284, type: 3, values: [1] },
      { tag: 322, type: 4, values: [2] },
      { tag: 323, type: 4, values: [1] },
    ],
    tileSegments,
  )
  const tileOutput = await (await images.open(legacyTile)).png().toUint8Array()
  const tilePixels = await browserPixels(tileOutput, 'image/png')
  if (tilePixels[0] !== 10 || tilePixels[4] !== 20 || tilePixels[8] !== 30) {
    throw new Error('Legacy TIFF tile tables in strip tags changed decoded pixels')
  }

  const faxStrip = packBrowserFaxBits('1001110011')
  const fax = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [8] },
      { tag: 257, type: 4, values: [2] },
      { tag: 258, type: 3, values: [1] },
      { tag: 259, type: 3, values: [3] },
      { tag: 262, type: 3, values: [0] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [1] },
      { tag: 278, type: 4, values: [2] },
      { tag: 279, type: 4, values: [faxStrip.byteLength] },
      { tag: 284, type: 3, values: [1] },
    ],
    [faxStrip],
  )
  const faxOutput = await (await images.open(fax)).png().toUint8Array()
  const faxPixels = await browserPixels(faxOutput, 'image/png')
  if (faxPixels[0] !== 255 || faxPixels[(8 * 2 - 1) * 4] !== 255) {
    throw new Error('TIFF Group 3 rows without EOL markers changed decoded pixels')
  }

  const ycbcrValues = [
    Uint8Array.from([10, 20, 30, 40, 128, 128, 50, 60, 70, 80, 128, 128]),
    Uint8Array.from([90, 100, 200, 200, 128, 128, 0, 0, 0, 0, 128, 128]),
  ]
  const ycbcrStrips = ycbcrValues.map(packBrowserTiffLzw)
  const ycbcr = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [2] },
      { tag: 257, type: 4, values: [5] },
      { tag: 258, type: 3, values: [8, 8, 8] },
      { tag: 259, type: 3, values: [5] },
      { tag: 262, type: 3, values: [6] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [3] },
      { tag: 278, type: 4, values: [4] },
      { tag: 279, type: 4, values: ycbcrStrips.map((strip) => strip.byteLength) },
      { tag: 284, type: 3, values: [1] },
      { tag: 530, type: 3, values: [2, 2] },
    ],
    ycbcrStrips,
  )
  const ycbcrOutput = await (await images.open(ycbcr)).png().toUint8Array()
  const ycbcrPixels = await browserPixels(ycbcrOutput, 'image/png')
  const lastRow = 4 * 2 * 4
  if (
    ycbcrPixels[lastRow] !== 90 ||
    ycbcrPixels[lastRow + 1] !== 90 ||
    ycbcrPixels[lastRow + 4] !== 100 ||
    ycbcrPixels[lastRow + 5] !== 100
  ) {
    throw new Error('Bounded TIFF YCbCr LZW strip padding changed decoded pixels')
  }

  const packed12 = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [3] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [12] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [1] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [1] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [5] },
      { tag: 284, type: 3, values: [1] },
    ],
    [Uint8Array.of(0, 8, 0, 0xff, 0xf0)],
  )
  const packedOutput = await (await images.open(packed12)).png().toUint8Array()
  const packedPixels = await browserPixels(packedOutput, 'image/png')
  if (packedPixels[0] !== 0 || packedPixels[4] !== 128 || packedPixels[8] !== 255) {
    throw new Error('Packed 12-bit TIFF samples did not preserve their full range')
  }

  const signed8 = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [3] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [8] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [1] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [1] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [3] },
      { tag: 284, type: 3, values: [1] },
      { tag: 339, type: 3, values: [2] },
    ],
    [Uint8Array.of(0x80, 0, 0x7f)],
  )
  const signedOutput = await (await images.open(signed8)).png().toUint8Array()
  const signedPixels = await browserPixels(signedOutput, 'image/png')
  if (signedPixels[0] !== 0 || signedPixels[4] !== 128 || signedPixels[8] !== 255) {
    throw new Error(
      `Signed 8-bit TIFF display conversion changed in the browser: ${signedPixels[0]},${signedPixels[4]},${signedPixels[8]}`,
    )
  }

  const floatSamples = new Uint8Array(12)
  const floatView = new DataView(floatSamples.buffer)
  floatView.setFloat32(0, 0, true)
  floatView.setFloat32(4, 0.5, true)
  floatView.setFloat32(8, 1, true)
  const float32 = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [3] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [32] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [1] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [1] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [floatSamples.byteLength] },
      { tag: 284, type: 3, values: [1] },
      { tag: 339, type: 3, values: [3] },
    ],
    [floatSamples],
  )
  const floatOutput = await (await images.open(float32)).png().toUint8Array()
  const floatPixels = await browserPixels(floatOutput, 'image/png')
  if (floatPixels[0] !== 0 || floatPixels[4] !== 127 || floatPixels[8] !== 255) {
    throw new Error(
      `Float32 TIFF display conversion changed in the browser: ${floatPixels[0]},${floatPixels[4]},${floatPixels[8]}`,
    )
  }

  const signedCmyk = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [4] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [8, 8, 8, 8] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [5] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [4] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [16] },
      { tag: 284, type: 3, values: [1] },
      { tag: 339, type: 3, values: [2, 2, 2, 2] },
    ],
    [
      Uint8Array.of(
        0x80,
        0x80,
        0x80,
        0x80,
        0x7f,
        0x80,
        0x80,
        0x80,
        0x80,
        0x80,
        0x80,
        0x7f,
        0,
        0xc0,
        0x80,
        0,
      ),
    ],
  )
  const signedCmykOutput = await (await images.open(signedCmyk)).png().toUint8Array()
  const signedCmykPixels = await browserPixels(signedCmykOutput, 'image/png')
  if (
    signedCmykPixels[0] !== 255 ||
    signedCmykPixels[4] !== 0 ||
    signedCmykPixels[5] !== 255 ||
    signedCmykPixels[6] !== 255 ||
    signedCmykPixels[8] !== 0 ||
    signedCmykPixels[9] !== 0 ||
    signedCmykPixels[10] !== 0 ||
    signedCmykPixels[12] !== 63 ||
    signedCmykPixels[13] !== 95 ||
    signedCmykPixels[14] !== 127
  ) {
    throw new Error('Signed CMYK TIFF display conversion changed in the browser')
  }

  const floatCmykSamples = new Uint8Array(64)
  const floatCmykView = new DataView(floatCmykSamples.buffer)
  const floatCmykValues = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0.5, 0.25, 0, 0.5]
  for (let index = 0; index < floatCmykValues.length; index += 1) {
    floatCmykView.setFloat32(index * 4, floatCmykValues[index] ?? 0, true)
  }
  const floatCmyk = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [4] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [32, 32, 32, 32] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [5] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [4] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [floatCmykSamples.byteLength] },
      { tag: 284, type: 3, values: [1] },
      { tag: 339, type: 3, values: [3, 3, 3, 3] },
    ],
    [floatCmykSamples],
  )
  const floatCmykOutput = await (await images.open(floatCmyk)).png().toUint8Array()
  const floatCmykPixels = await browserPixels(floatCmykOutput, 'image/png')
  if (
    floatCmykPixels[0] !== 255 ||
    floatCmykPixels[4] !== 0 ||
    floatCmykPixels[5] !== 255 ||
    floatCmykPixels[6] !== 255 ||
    floatCmykPixels[8] !== 0 ||
    floatCmykPixels[9] !== 0 ||
    floatCmykPixels[10] !== 0 ||
    floatCmykPixels[12] !== 64 ||
    floatCmykPixels[13] !== 96 ||
    floatCmykPixels[14] !== 128
  ) {
    throw new Error('Float32 CMYK TIFF display conversion changed in the browser')
  }

  const cieLab = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [3] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [8, 8, 8] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [8] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [3] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [9] },
      { tag: 284, type: 3, values: [1] },
    ],
    [Uint8Array.of(0, 0, 0, 138, 81, 70, 75, 68, 144)],
  )
  const cieLabOutput = await (await images.open(cieLab)).png().toUint8Array()
  const cieLabPixels = await browserPixels(cieLabOutput, 'image/png')
  if (
    cieLabPixels[0] !== 0 ||
    cieLabPixels[1] !== 0 ||
    cieLabPixels[2] !== 0 ||
    cieLabPixels[4] !== 255 ||
    cieLabPixels[5] !== 1 ||
    cieLabPixels[6] !== 0 ||
    cieLabPixels[8] !== 0 ||
    cieLabPixels[9] !== 34 ||
    cieLabPixels[10] !== 254
  ) {
    throw new Error('CIELab TIFF color conversion changed in the browser')
  }

  const cmykIccProfile = browserConstantGrayCmykProfile()
  const cmykIcc = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [1] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [8, 8, 8, 8] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [5] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [4] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [4] },
      { tag: 284, type: 3, values: [1] },
      { tag: 34675, type: 7, values: Array.from(cmykIccProfile) },
    ],
    [Uint8Array.of(255, 0, 0, 0)],
  )
  const cmykIccOutput = await (await images.open(cmykIcc)).png().toUint8Array()
  const cmykIccPixels = await browserPixels(cmykIccOutput, 'image/png')
  if (cmykIccPixels[0] !== 188 || cmykIccPixels[1] !== 188 || cmykIccPixels[2] !== 187) {
    throw new Error(
      `CMYK ICC TIFF color conversion changed in the browser: ${cmykIccPixels[0]},${cmykIccPixels[1]},${cmykIccPixels[2]}`,
    )
  }

  const fillOrder = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [3] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [6] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [1] },
      { tag: 266, type: 3, values: [2] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [1] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [3] },
      { tag: 284, type: 3, values: [1] },
    ],
    [Uint8Array.of(0x40, 0xf0, 0x03)],
  )
  const fillOrderOutput = await (await images.open(fillOrder)).png().toUint8Array()
  const fillOrderPixels = await browserPixels(fillOrderOutput, 'image/png')
  if (fillOrderPixels[0] !== 0 || fillOrderPixels[4] !== 129 || fillOrderPixels[8] !== 255) {
    throw new Error('FillOrder 2 packed TIFF decoding changed in the browser')
  }

  const paletteColors = 65_536
  const colorMap = new Array<number>(paletteColors * 3).fill(0)
  colorMap[paletteColors] = 65_535
  colorMap[0x1234] = 0xab00
  colorMap[paletteColors + 0x1234] = 0xcd00
  colorMap[paletteColors * 2 + 0x1234] = 0xef00
  colorMap[0xffff] = 65_535
  const palette16 = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [3] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [16] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [3] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [1] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [6] },
      { tag: 284, type: 3, values: [1] },
      { tag: 320, type: 3, values: colorMap },
    ],
    [Uint8Array.of(0, 0, 0x34, 0x12, 0xff, 0xff)],
  )
  const palette16Output = await (await images.open(palette16)).png().toUint8Array()
  const palette16Pixels = await browserPixels(palette16Output, 'image/png')
  if (
    palette16Pixels[0] !== 0 ||
    palette16Pixels[1] !== 255 ||
    palette16Pixels[2] !== 0 ||
    palette16Pixels[4] !== 170 ||
    palette16Pixels[5] !== 204 ||
    palette16Pixels[6] !== 238 ||
    palette16Pixels[8] !== 255 ||
    palette16Pixels[9] !== 0 ||
    palette16Pixels[10] !== 0
  ) {
    throw new Error('16-bit palette TIFF display conversion changed in the browser')
  }

  const wide64Samples = Uint8Array.of(
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0x80,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
    0xff,
  )
  const wide64 = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [3] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [64] },
      { tag: 259, type: 3, values: [1] },
      { tag: 262, type: 3, values: [1] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [1] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [wide64Samples.byteLength] },
      { tag: 284, type: 3, values: [1] },
    ],
    [wide64Samples],
  )
  const wide64Output = await (await images.open(wide64)).png().toUint8Array()
  const wide64Pixels = await browserPixels(wide64Output, 'image/png')
  if (wide64Pixels[0] !== 0 || wide64Pixels[4] !== 127 || wide64Pixels[8] !== 255) {
    throw new Error(
      `Unsigned 64-bit TIFF display conversion changed in the browser: ${wide64Pixels[0]},${wide64Pixels[4]},${wide64Pixels[8]}`,
    )
  }

  const logLStrip = Uint8Array.of(4, 0, 0x3f, 0xbf, 0x40, 130, 0)
  const logL = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [4] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [16] },
      { tag: 259, type: 3, values: [34676] },
      { tag: 262, type: 3, values: [32844] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [1] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [logLStrip.byteLength] },
      { tag: 284, type: 3, values: [1] },
      { tag: 339, type: 3, values: [2] },
    ],
    [logLStrip],
  )
  const logLOutput = await (await images.open(logL)).png().toUint8Array()
  const logLPixels = await browserPixels(logLOutput, 'image/png')
  if (
    logLPixels[0] !== 0 ||
    logLPixels[4] !== 181 ||
    logLPixels[8] !== 0 ||
    logLPixels[12] !== 255
  ) {
    throw new Error(
      `SGILog TIFF display conversion changed in the browser: ${logLPixels[0]},${logLPixels[4]},${logLPixels[8]},${logLPixels[12]}`,
    )
  }

  const embeddedWebp = await (await images.open(legacyOutput))
    .webp({ lossless: true })
    .toUint8Array()
  const webpTiff = browserTiffFixture(
    (offsets) => [
      { tag: 256, type: 4, values: [300] },
      { tag: 257, type: 4, values: [1] },
      { tag: 258, type: 3, values: [8, 8, 8] },
      { tag: 259, type: 3, values: [50001] },
      { tag: 262, type: 3, values: [2] },
      { tag: 273, type: 4, values: offsets },
      { tag: 277, type: 3, values: [3] },
      { tag: 278, type: 4, values: [1] },
      { tag: 279, type: 4, values: [embeddedWebp.byteLength] },
      { tag: 284, type: 3, values: [1] },
    ],
    [embeddedWebp],
  )
  const webpTiffOutput = await (await composedTiffImages.open(webpTiff)).png().toUint8Array()
  const webpTiffPixels = await browserPixels(webpTiffOutput, 'image/png')
  for (const x of [0, 255, 299]) {
    const offset = x * 4
    if (
      webpTiffPixels[offset] !== legacyPixels[offset] ||
      webpTiffPixels[offset + 1] !== legacyPixels[offset + 1] ||
      webpTiffPixels[offset + 2] !== legacyPixels[offset + 2]
    ) {
      throw new Error(`Explicit WebP-in-TIFF composition changed browser pixel ${x}`)
    }
  }

  const pyramid = browserPyramidTiffFixture()
  const pyramidImage = await images.open(pyramid, { resolutionLevel: 1 })
  const pyramidMetadata = await pyramidImage.metadata()
  if (
    pyramidMetadata.width !== 1 ||
    pyramidMetadata.height !== 1 ||
    pyramidMetadata.resolutionLevels !== 2
  ) {
    throw new Error('TIFF SubIFD metadata did not report the selected pyramid level')
  }
  const pyramidOutput = await pyramidImage.png().toUint8Array()
  const pyramidPixels = await browserPixels(pyramidOutput, 'image/png')
  if (
    pyramidPixels[0] !== 222 ||
    pyramidPixels[1] !== 222 ||
    pyramidPixels[2] !== 222 ||
    pyramidPixels[3] !== 255
  ) {
    throw new Error('TIFF SubIFD selection changed browser pixels')
  }

  const bmp = new Uint8Array(76)
  const bmpView = new DataView(bmp.buffer)
  bmp.set([0x42, 0x4d])
  bmpView.setUint32(2, bmp.byteLength, true)
  bmpView.setUint32(10, 70, true)
  bmpView.setUint32(14, 40, true)
  bmpView.setInt32(18, 3, true)
  bmpView.setInt32(22, 1, true)
  bmpView.setUint16(26, 1, true)
  bmpView.setUint16(28, 4, true)
  bmpView.setUint32(30, 2, true)
  bmpView.setUint32(34, 6, true)
  bmpView.setUint32(46, 4, true)
  bmp.set([0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0], 54)
  bmp.set([4, 0x12, 0, 0, 0, 1], 70)
  const bmpOutput = await (await images.open(bmp)).png().toUint8Array()
  const bmpPixels = await browserPixels(bmpOutput, 'image/png')
  if (
    bmpPixels[0] !== 0 ||
    bmpPixels[1] !== 255 ||
    bmpPixels[2] !== 0 ||
    bmpPixels[4] !== 0 ||
    bmpPixels[5] !== 0 ||
    bmpPixels[6] !== 255 ||
    bmpPixels[8] !== 0 ||
    bmpPixels[9] !== 255 ||
    bmpPixels[10] !== 0
  ) {
    throw new Error('Odd-width RLE4 padding changed decoded BMP pixels')
  }

  return {
    detail:
      'legacy TIFF LZW, first-party Zstandard and LERC, packed 12-bit and FillOrder 2 TIFF, signed, float, numeric and ICC-managed CMYK, CIELab, 16-bit palette, wide unsigned, and SGILog TIFF, TIFF SubIFD pyramids, explicit WebP-in-TIFF, tile aliases, no-EOL Group 3, padded YCbCr LZW, BigTIFF inline values, and odd-width BMP RLE4 decoded exactly',
    outputBytes:
      legacyOutput.byteLength +
      zstdOutput.byteLength +
      lercOutput.byteLength +
      wide64Output.byteLength +
      packedOutput.byteLength +
      webpTiffOutput.byteLength +
      signedOutput.byteLength +
      floatOutput.byteLength +
      signedCmykOutput.byteLength +
      floatCmykOutput.byteLength +
      cieLabOutput.byteLength +
      cmykIccOutput.byteLength +
      fillOrderOutput.byteLength +
      palette16Output.byteLength +
      logLOutput.byteLength +
      pyramidOutput.byteLength +
      bigOutput.byteLength +
      tileOutput.byteLength +
      faxOutput.byteLength +
      ycbcrOutput.byteLength +
      bmpOutput.byteLength,
  }
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
  chromium?: {
    readonly maximumRgbDifference: number
    readonly rgbaSha256: string
  },
): Promise<BrowserWorkflowResult> => {
  const input = await fetchBytes(`/fixtures/${file}`)
  const output = await (await images.open(input)).png().toUint8Array()
  const metadata = await outputMetadata(output)
  if (metadata.format !== 'png' || metadata.width !== width || metadata.height !== height) {
    throw new Error(`${detail} output was ${metadata.format} ${metadata.width}x${metadata.height}`)
  }
  const outputPixels = await portablePngPixels(output)
  const outputSha256 = await sha256(outputPixels)
  if (outputSha256 !== expectedSha256) {
    throw new Error(`${detail} portable RGBA hash was ${outputSha256}`)
  }
  let chromiumDetail = ''
  if (chromium !== undefined && navigator.userAgent.includes('Chrome/')) {
    const chromiumPixels = await browserPixels(input, 'image/avif')
    if (chromiumPixels.byteLength !== outputPixels.byteLength) {
      throw new Error(`${detail} Chromium RGBA dimensions changed`)
    }
    const chromiumSha256 = await sha256(chromiumPixels)
    if (chromiumSha256 !== chromium.rgbaSha256) {
      throw new Error(`${detail} Chromium RGBA hash was ${chromiumSha256}`)
    }
    let maximumRgbDifference = 0
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        maximumRgbDifference = Math.max(
          maximumRgbDifference,
          Math.abs(
            (outputPixels[pixel * 4 + channel] ?? 0) - (chromiumPixels[pixel * 4 + channel] ?? 0),
          ),
        )
      }
    }
    if (maximumRgbDifference !== chromium.maximumRgbDifference) {
      throw new Error(`${detail} maximum Chromium RGB difference was ${maximumRgbDifference}`)
    }
    chromiumDetail = ` and pinned Chromium RGBA output (maximum RGB difference ${maximumRgbDifference})`
  }
  return {
    detail: `${detail} matched the pinned portable RGBA output${chromiumDetail}`,
    outputBytes: output.byteLength,
  }
}

const avifImir = async (): Promise<BrowserWorkflowResult> => {
  const fixtures = [
    {
      file: 'libavif-imir-axis0-160x160.avif',
      portableWidth: 160,
      portableHeight: 160,
      portableSha256: 'ecc5d7baa51289462eb57ed3e9e2202872d4e24438849531f15b04d0d1d8cc8a',
      chromiumWidth: 160,
      chromiumHeight: 160,
      chromiumSha256: 'ecc5d7baa51289462eb57ed3e9e2202872d4e24438849531f15b04d0d1d8cc8a',
    },
    {
      file: 'libavif-imir-axis1-160x160.avif',
      portableWidth: 160,
      portableHeight: 160,
      portableSha256: '150d389f0f9ec73685c3b301933f344e68d045114e96b06d4e09c2ae2d056569',
      chromiumWidth: 160,
      chromiumHeight: 160,
      chromiumSha256: '150d389f0f9ec73685c3b301933f344e68d045114e96b06d4e09c2ae2d056569',
    },
    {
      file: 'libavif-imir-clap-irot-grid-alpha-160x160.avif',
      portableWidth: 96,
      portableHeight: 112,
      portableSha256: 'b3cca86fed0bf074641663fea9611be3ed3a217498b0095864300df265acf533',
      chromiumWidth: 160,
      chromiumHeight: 160,
      chromiumSha256: '5f22a0d268ac2f295e8c8d2fbaa90267a04ea03f5597eb782cf4210738ee9d1f',
    },
  ] as const
  let outputBytes = 0
  for (const fixture of fixtures) {
    const input = await fetchBytes(`/fixtures/${fixture.file}`)
    const output = await (await images.open(input)).autoOrient().png().toUint8Array()
    const metadata = await outputMetadata(output)
    if (
      metadata.format !== 'png' ||
      metadata.width !== fixture.portableWidth ||
      metadata.height !== fixture.portableHeight
    ) {
      throw new Error(
        `${fixture.file} auto-oriented output was ${metadata.format} ${metadata.width}x${metadata.height}`,
      )
    }
    const portableHash = await sha256(await portablePngPixels(output))
    if (portableHash !== fixture.portableSha256) {
      throw new Error(`${fixture.file} portable imir RGBA hash was ${portableHash}`)
    }

    if (navigator.userAgent.includes('Chrome/')) {
      const chromium = await browserImagePixels(input, 'image/avif')
      const chromiumHash = await sha256(Uint8Array.from(chromium.pixels))
      if (
        chromium.width !== fixture.chromiumWidth ||
        chromium.height !== fixture.chromiumHeight ||
        chromiumHash !== fixture.chromiumSha256
      ) {
        throw new Error(
          `${fixture.file} Chromium AVIF output was ${chromium.width}x${chromium.height} ${chromiumHash}`,
        )
      }
    }
    outputBytes += output.byteLength
  }
  return {
    detail: navigator.userAgent.includes('Chrome/')
      ? 'AVIF imir axes and clap+irot grid alpha composition matched pinned portable output; Chromium native outputs were pinned independently'
      : 'AVIF imir axes and clap+irot grid alpha composition matched pinned portable output',
    outputBytes,
  }
}

const avifAlphaStraight = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'alpha-straight-64x48.avif',
    64,
    48,
    '54633c27b86e4034c8c1916134b5bfdd3209e43344bdfbaaaa53abde94b33d02',
    'Straight-alpha AVIF',
  )

const avifAlphaPremultiplied = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'alpha-premultiplied-64x48.avif',
    64,
    48,
    '797e6c9b789c30cdedb63c7f92adc127378f21cfae36809b7eb3499456ab3457',
    'Premultiplied-alpha AVIF',
  )
const avifBoundedAlphaRows = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'bounded-row-alpha-lossless-64x192.avif',
    64,
    192,
    'a56c5a9dfcf52461d2e0000933d1215e011f2d3b82c533b2a0b8eaec8f1f1ec2',
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
    'f803b121d2471ac44b32170380ab02f8174ddf1079f9425de921dde00ac91fc7',
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
const avifResidualIntrabc = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'ms-monochrome-residual-intrabc.avif',
    1280,
    720,
    '6e036207ef682d41edad54421d20bb36ec7f03e34113e2f6fa4ab954779d71c0',
    'Residual intra-block-copy AVIF',
  )
const avifStillPictureEntropy = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'ms-Tomsk-with-thumbnails.avif',
    1280,
    720,
    '3277bbd3ada1d7dc560080465c9957bf9595ff6eaf2b023c62aca4e7a3679c3b',
    'Still-picture intra-block-copy AVIF',
  )

const avifRec2020 = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'libavif-colors-text-wcg-sdr-rec2020.avif',
    200,
    200,
    '087173f8afaaf7c42640d07ef6f0ab873abb494dd3a89d920b11e13b2ad66717',
    'Linear BT.2020 NCLX color-managed AVIF',
  )

const avifHdrGainMap = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'libavif-seine-hdr-gainmap-srgb.avif',
    400,
    300,
    '352475a2b3f3c60de9b6feee3f756a00cfcaa3b4ad19594ea72260064f84bc57',
    'ISO gain-map HDR-to-SDR AVIF',
  )

const avifIcc = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'libavif-paris-icc-exif-xmp.avif',
    403,
    302,
    '2a283d662a75d7b522146ee8e559153b00fe16523e2958a17f988e34929e0b33',
    'RGB matrix/TRC ICC color-managed AVIF',
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

const avifExpandedHighBit = async (): Promise<BrowserWorkflowResult> => {
  const results = await Promise.all([
    avifPinnedPng(
      'coded-lossless-10bpc-yuv420-32x24.avif',
      32,
      24,
      'dd5a14ac11b1c93d66f85cf2cad18c53f87e7beb3c7d53f6d41bd001fa2f0d85',
      'Coded-lossless 10-bit YUV 4:2:0 AVIF',
    ),
    avifPinnedPng(
      'filter-free-lossy-10bpc-yuv420-32x24.avif',
      32,
      24,
      '49fa5a03211fed7d1d0a1f7d47fd1cf3f017b2931423ed9e63597d611035087e',
      'Filter-free lossy 10-bit YUV 4:2:0 AVIF',
    ),
    avifPinnedPng(
      'coded-lossless-12bpc-yuv420-32x24.avif',
      32,
      24,
      'dcbcade0a186058362a48c34b1401d8059ac793d4cd8072eb91ff9d3d8423fba',
      'Coded-lossless 12-bit YUV 4:2:0 AVIF',
    ),
    avifPinnedPng(
      'filter-free-lossy-12bpc-yuv420-32x24.avif',
      32,
      24,
      '07682df7721f5e784519a6a2195f224c61fc256f9aa4f23dcf9068da115fb368',
      'Filter-free lossy 12-bit YUV 4:2:0 AVIF',
    ),
    avifPinnedPng(
      'filter-free-lossy-10bpc-yuv422-32x24.avif',
      32,
      24,
      'b2925f663a008378105940675c9fe1f250c25f7e07d2455ef6c3dd80d6459294',
      'Filter-free lossy 10-bit YUV 4:2:2 AVIF',
    ),
    avifPinnedPng(
      'filter-free-lossy-12bpc-yuv422-32x24.avif',
      32,
      24,
      '6ca5d5de7728ec1be99c4fe5bfa9a9e7458ad15f27c6d8fc4c5fcb21eb6e0baf',
      'Filter-free lossy 12-bit YUV 4:2:2 AVIF',
    ),
    avifPinnedPng(
      'filter-free-lossy-12bpc-yuv444-32x24.avif',
      32,
      24,
      '7b137477c628a55948b560e2af5a95c53803a8eafaccf42c64509e57251efafc',
      'Filter-free lossy 12-bit YUV 4:4:4 AVIF',
    ),
    avifPinnedPng(
      'filter-free-lossy-10bpc-yuv444-32x24.avif',
      32,
      24,
      '432698d3b277e8f80d0c3e1d518bd432a64aed3ff6b1ee78dbf658863fc0a818',
      'Filter-free lossy 10-bit YUV 4:4:4 AVIF',
    ),
    avifPinnedPng(
      'filtered-lossy-10bpc-yuv444-96x64.avif',
      96,
      64,
      'e9e2f8be7c4a179341c0ac312482e5a5d96b209698df253d73fcc642d65e8096',
      'Lossy 10-bit YUV 4:4:4 AVIF with deblocking, CDEF, and Wiener restoration',
    ),
    avifPinnedPng(
      'filtered-lossy-10bpc-yuv420-192x128.avif',
      192,
      128,
      '026ecbc3e3256500066f44b6bdca81dcad6ec99e674e5550cda43291a73594d1',
      'Lossy 10-bit YUV 4:2:0 AVIF with deblocking, CDEF, and Wiener restoration',
      {
        maximumRgbDifference: 3,
        rgbaSha256: '7443afcbe7796fcada187a67a6ab357241cfd0f9e7dca30aa0cb84c1af95c76d',
      },
    ),
    avifPinnedPng(
      'filtered-lossy-10bpc-yuv422-64x64.avif',
      64,
      64,
      '32e1e6c6c8f80c33c099d3cd58351a75fa63fa352177713d67b93fd7ed19d50e',
      'Lossy 10-bit YUV 4:2:2 AVIF with CDEF and Wiener restoration',
      {
        maximumRgbDifference: 3,
        rgbaSha256: 'baca323bd5540446c8e07f66aa037024dcae16e7da0a3b412eb661f25c1eaf1a',
      },
    ),
    avifPinnedPng(
      'self-guided-10bpc-yuv420-320x192.avif',
      320,
      192,
      'e382b8f0373e80e4c9abe67e9c30666db7a39b2d850b3b86af8aa5baea466f5c',
      'Lossy 10-bit YUV 4:2:0 AVIF with self-guided restoration',
      {
        maximumRgbDifference: 6,
        rgbaSha256: 'db0ce9ffa65137d06ebbc394b35f66fb3ae074b4ff9d606ed55aff50e5c62cb0',
      },
    ),
    avifPinnedPng(
      'filtered-lossy-12bpc-yuv420-64x64.avif',
      64,
      64,
      'e44124196c3e453abf158e571592c14b8388ca71875cff1be6f856916c7755f9',
      'Lossy 12-bit YUV 4:2:0 AVIF with deblocking and CDEF',
      {
        maximumRgbDifference: 158,
        rgbaSha256: '45ae308afcdea548bae4ced23d52feab9c00308d1c649986e9265acd77e7fc17',
      },
    ),
    avifPinnedPng(
      'filtered-lossy-12bpc-yuv422-64x64.avif',
      64,
      64,
      'f9b58fa7193daa31e3d4ef22349aeb67a5b1c3f802103c7c7c3fe93f889d8e87',
      'Lossy 12-bit YUV 4:2:2 AVIF with deblocking and CDEF',
      {
        maximumRgbDifference: 3,
        rgbaSha256: 'f116a8766e3887a5c9f9a965951b4edcf88d352e46db3ee3c9cce130ccb96da7',
      },
    ),
    avifPinnedPng(
      'filtered-lossy-12bpc-yuv444-64x64.avif',
      64,
      64,
      '28b88bd4ba31908bab42a410a959bb7d2831ce60572be8dbd4e4685cf3e126f3',
      'Lossy 12-bit YUV 4:4:4 AVIF with deblocking and CDEF',
      {
        maximumRgbDifference: 0,
        rgbaSha256: '28b88bd4ba31908bab42a410a959bb7d2831ce60572be8dbd4e4685cf3e126f3',
      },
    ),
    avifPinnedPng(
      'wiener-12bpc-yuv420-320x192.avif',
      320,
      192,
      '79acf6df2ce865f8ed52b187f4ce446bc5738c50c26d467293f3d2fdd0cbbed1',
      'Lossy 12-bit YUV 4:2:0 AVIF with Wiener restoration',
      {
        maximumRgbDifference: 12,
        rgbaSha256: 'c995dc8727fdb5fc7efa6a54f731c995880d0bded435dce37cf9cea0051140af',
      },
    ),
    avifPinnedPng(
      'self-guided-12bpc-yuv420-320x192.avif',
      320,
      192,
      'f124a01d322a1e0019630803aa12268333635d4e63b25b08e4f19515dfed817a',
      'Lossy 12-bit YUV 4:2:0 AVIF with self-guided restoration',
      {
        maximumRgbDifference: 13,
        rgbaSha256: '163c615b5e0a2b7e740fd29dbb98334026c9db179b16d61dedbf7ff9312d4b2f',
      },
    ),
    avifPinnedPng(
      'self-guided-10bpc-yuv444-320x192.avif',
      320,
      192,
      '4e2f4a1eca619ae7d00d8e9cae8956570579e909ba48796236537c235937ce6b',
      'Lossy 10-bit YUV 4:4:4 AVIF with self-guided restoration',
      {
        maximumRgbDifference: 5,
        rgbaSha256: '78f84b0dc636c9e4fa37a654a63690054075b1053de035ce5492002ae0a9a174',
      },
    ),
  ])
  return {
    detail: results.map((result) => result.detail).join('; '),
    outputBytes: results.reduce((total, result) => total + result.outputBytes, 0),
  }
}
const avifExpandedAlpha = async (): Promise<BrowserWorkflowResult> => {
  const results = await Promise.all([
    avifPinnedPng(
      'xiph-alpha-limited-8bpc-2048x2048.avif',
      2048,
      2048,
      '8264cd14f144270bc3594da6f02ef3c6b22658e93a0844f660ac8648871e8d1a',
      'Limited-range 8-bit alpha AVIF',
    ),
    avifPinnedPng(
      'alpha-full-10bpc-64x48.avif',
      64,
      48,
      'dfc169edd84afdb59f30abcbfd09ddb277783e82ffda2489b60e9429d9f3d5f4',
      'Full-range 10-bit alpha AVIF',
    ),
    avifPinnedPng(
      'alpha-full-12bpc-64x48.avif',
      64,
      48,
      'dfc169edd84afdb59f30abcbfd09ddb277783e82ffda2489b60e9429d9f3d5f4',
      'Full-range 12-bit alpha AVIF',
    ),
    avifPinnedPng(
      'libavif-color-grid-alpha-items-80x80.avif',
      80,
      80,
      'bfc6eb86c18a9be89e5b52ff7dfc2faba3e84d4c1368bf18b478ec4f4947ff49',
      'Color grid with per-tile alpha auxiliaries',
    ),
    avifPinnedPng(
      'libavif-color-irot-alpha-noirot-512x256.avif',
      512,
      256,
      '5102863ca73f618c60944e490aa3982e7a1afd6975f4d0edf12b40ac85c88f82',
      'Primary irot with independently signaled alpha transform',
    ),
  ])
  return {
    detail: results.map((result) => result.detail).join('; '),
    outputBytes: results.reduce((total, result) => total + result.outputBytes, 0),
  }
}
const avifHdrRejected = async (): Promise<BrowserWorkflowResult> => {
  let inputBytes = 0
  for (const file of [
    'unsupported-hdr-pq-10bpc-yuv420-32x24.avif',
    'unsupported-hdr-hlg-10bpc-yuv420-32x24.avif',
  ]) {
    const bytes = await fetchBytes(`/fixtures/${file}`)
    inputBytes += bytes.byteLength
    const image = await images.open(bytes)
    const metadata = await image.metadata()
    if (metadata.format !== 'avif' || metadata.bitDepth !== 10) {
      throw new Error(`${file} metadata inspection failed`)
    }
    try {
      await image.png().toUint8Array()
      throw new Error(`${file} HDR pixel decode unexpectedly succeeded`)
    } catch (error: unknown) {
      if (
        !(error instanceof ImageError) ||
        error.code !== 'UNSUPPORTED_OPERATION' ||
        error.message !== 'HDR AVIF SDR decode requires a compatible gain-map alternate image'
      ) {
        throw error
      }
    }
  }
  return {
    detail: 'PQ and HLG AVIF metadata remained inspectable and SDR pixel decode rejected both',
    outputBytes: inputBytes,
  }
}

const avifLossyMultitile = async (): Promise<BrowserWorkflowResult> => {
  const results = await Promise.all([
    avifPinnedPng(
      'libaom-lossy-multitile-yuv420-256x256.avif',
      256,
      256,
      '64d50b1df2d192b1dcac24d4bd0e0df6996c00a1a3ecbd97bd9a888edf3dd737',
      'Lossy 8-bit 2x2-tile AVIF with loop filter, CDEF, and restoration',
    ),
    avifPinnedPng(
      'libaom-full-header-tile-groups-yuv420-256x256.avif',
      256,
      256,
      '05ab2273ba3952c41d53daf0b45afd709e5025f709ea8c87fef4a0dbacb0a966',
      'Non-reduced AV1 frame header with four tile-group OBUs',
    ),
    avifPinnedPng(
      'libavif-bounded-filtered-yuv420-3840x2160.avif',
      3840,
      2160,
      'fa0ee4c2f74aef92f77ce700eb60f001b6502db9c5d540b43bdddb59fdcc3880',
      'Filtered 8-bit 8x2-tile 4K AVIF within the bounded codec working-set limit',
    ),
  ])
  return {
    detail: results.map((result) => result.detail).join('; '),
    outputBytes: results.reduce((total, result) => total + result.outputBytes, 0),
  }
}
const avifGainMapGrid = async (): Promise<BrowserWorkflowResult> => {
  const results = await Promise.all([
    avifPinnedPng(
      'libavif_color_grid_alpha_grid_gainmap_nogrid.avif',
      512,
      600,
      'ea8a15d99b5f28a7858b097b8b82056ce65898f51bb2ff0d2c5715bdcfeff2fd',
      'Resampled AVIF gain map over aligned color and alpha grids',
    ),
    avifPinnedPng(
      'libavif_color_grid_gainmap_different_grid.avif',
      512,
      600,
      '4091bcc2b181c37e1b03bb6ec2b086b77516318b58cef4c75e8a8b5b0989f81e',
      'Independently tiled and resampled AVIF gain-map grid',
    ),
    avifPinnedPng(
      'libavif_color_nogrid_alpha_nogrid_gainmap_grid.avif',
      128,
      200,
      'b6ab4171d2d9030704c753aff99765c47b0829f537b2e92138eb90e64f3e0441',
      'AVIF gain-map grid over single color and alpha items',
    ),
    avifPinnedPng(
      'libavif_seine_hdr_gainmap_small_srgb.avif',
      400,
      300,
      'a3a2ea2482c9d96b7b98b47dc1d874229a079d0860ccac0ed8ee77e19b3580b1',
      'Resampled single-item AVIF gain map',
    ),
  ])
  return {
    detail: results.map((result) => result.detail).join('; '),
    outputBytes: results.reduce((total, result) => total + result.outputBytes, 0),
  }
}
const avifFilmGrain = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'film-grain-test1-yuv420-64x48.avif',
    64,
    48,
    'ceff8604f5dc42f3a16a67dc2b8afc56d3fe8674567353b82c2e8384f10835dd',
    'Normative AV1 film-grain synthesis',
  )

const avifNonstillSequence = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'ms-mexico-nonstill-sequence.avif',
    1920,
    1080,
    '99f28f0e2fdc30dab25ad903ce043e7af30b7097d1f3402e692b3f8629bff6c1',
    'Non-still AV1 sequence header with one shown key frame',
  )
const avifLayeredSelection = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'xiph-tiger-3layer-lsel0-1216x832.avif',
    1216,
    832,
    'd04f5c88fa8e105b354967755d1261ade0e214f85bb8707b97fcd0568098b68e',
    'Three-frame AVIF item with lsel spatial layer 0',
  )
const avifSelectedBaseLayer = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'tiger-3layer-3res-lsel0.avif',
    304,
    208,
    'd9f8a13bbe9f0e86540c431cf3cfdcd1ffd00b345526cefcd7faa1904ab6ba3a',
    'Selected 304x208 AVIF base layer with a frame-dimension override',
  )
const avifCommonPhotoSyntax = async (): Promise<BrowserWorkflowResult> => {
  const results = await Promise.all([
    avifPinnedPng(
      'diagnostic-baby-ffmpeg-crf30-yuv420.avif',
      576,
      576,
      '819d046be8dfc6b72fb722488216cdb4dfcb8e6eb2953a53932a7a2f03baeccb',
      'FFmpeg 4:2:0 coefficient-context AVIF',
    ),
    avifPinnedPng(
      'diagnostic-baby-ffmpeg-crf45-yuv444.avif',
      576,
      576,
      '030e44892698be8cb28a3d2fd75bfc65b0fc656f2e03314c89dadd1e8f99f89f',
      'FFmpeg 4:4:4 coefficient-context AVIF',
    ),
    avifPinnedPng(
      'diagnostic-mc3-sharp-q50-yuv420.avif',
      576,
      576,
      'cfac5f91515b6bdea3a784881a9918584f8058996192cb9616cca33a52cbf78b',
      'Sharp palette-context AVIF',
    ),
  ])
  return {
    detail: results.map((result) => result.detail).join('; '),
    outputBytes: results.reduce((total, result) => total + result.outputBytes, 0),
  }
}

const avifSuperres = async (): Promise<BrowserWorkflowResult> => {
  const results = await Promise.all([
    avifPinnedPng(
      'libaom-superres-denom12-96x64.avif',
      96,
      64,
      'bb31c24e26095af2032ca9f0d039e4061fae90a426cb3b446cb2199191f96e8b',
      'Filter-free single-band AV1 super-resolution AVIF',
    ),
    avifPinnedPng(
      'libaom-superres-denom12-yuv420-320x192.avif',
      320,
      192,
      '9bc16a4112c7b0b41b2fc587802b50e321c3bf669a4e66f6404887532384af5d',
      'Filter-free multi-band AV1 super-resolution AVIF',
    ),
  ])
  return {
    detail: results.map((result) => result.detail).join('; '),
    outputBytes: results.reduce((total, result) => total + result.outputBytes, 0),
  }
}

const avifFilteredSuperres = (): Promise<BrowserWorkflowResult> =>
  avifPinnedPng(
    'libaom-filtered-superres-denom12-yuv420-320x192.avif',
    320,
    192,
    '87d8605b420d0aeb1e2f012fdab7a8fa9c30ff4f7fa9115a927485122125f8a8',
    'CDEF and loop-restored AV1 super-resolution AVIF',
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
  avifCommonPhotoSyntax,
  avifGrid,
  avifHighBit10,
  avifHighBit12,
  avifHighBitTiles,
  avifExpandedHighBit,
  avifExpandedAlpha,
  avifHdrRejected,
  avifHdrGainMap,
  avifIcc,
  avifImir,
  avifFilteredSuperres,
  avifLossyMultitile,
  avifGainMapGrid,
  avifFilmGrain,
  avifNonstillSequence,
  avifLayeredSelection,
  avifSelectedBaseLayer,
  avifSuperres,
  avifIntrabc,
  avifResidualIntrabc,
  avifStillPictureEntropy,
  avifQuantizationMatrix,
  avifRec2020,
  avifQ0Lossless,
  avifPalette,
  avifMonochrome,
  avifYuv422,
  avifYuv444,
  failureCleanup,
  heifPqDisplay,
  inputTypes,
  legacyTiffAndBmp,
  jpegPipeline,
  unsupportedJpegBoundaries,
  tolerantJpegRestartRecovery,
  orientation,
  scientificTiffDocument,
  pngAlphaPipeline,
  progressiveJpeg,
  resizeDefaultKernel,
  tiffEncodePipeline,
  wasmJpeg,
  wasmJpegEncode,
  wasmPng,
  webpLossless,
  webpLossyDecode,
})

window.pureJsImageBrowserTests = harness
