import { createImageLibrary, ImageError } from '../src/browser.ts'
import { createWasmJpegAccelerator } from '../src/accelerator-entries/wasm-jpeg-browser.ts'
import { createWasmPngAccelerator } from '../src/accelerator-entries/wasm-png-browser.ts'
import { createWasmJpegAcceleratorWithLoaders } from '../src/accelerators/wasm/jpeg.ts'
import { createWasmPngAcceleratorWithLoaders } from '../src/accelerators/wasm/png.ts'
import { bmpCodec } from '../src/codec-entries/bmp.ts'
import { avifCodec } from '../src/codec-entries/avif.ts'
import { experimentalHeifCodec } from '../src/codec-entries/experimental/heic.ts'
import { createTiffCodec, tiffCodec } from '../src/codec-entries/tiff.ts'
import { gifCodec } from '../src/codec-entries/gif.ts'
import { jpegCodec } from '../src/codec-entries/jpeg.ts'
import { pngCodec } from '../src/codec-entries/png.ts'
import { acceleratePngCodec, type PngDecodeAcceleration } from '../src/codecs/png.ts'
import { webpCodec } from '../src/codec-entries/webp.ts'
import { openOmeTiff } from '../src/scientific/ome-tiff.ts'
import { browserRuntime } from '../src/browser-runtime.ts'
import { rasterToPixels } from '../src/raster.ts'
import { MemorySource } from '../src/source.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { encodeTiffDocument, openTiffDocument } from '../src/tiff/index.ts'
import type { PixelBlock } from '../src/pixel.ts'
import type { ImageInput } from '../src/source.ts'
import type { ImageSink } from '../src/sink.ts'
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

const browserPixels = async (bytes: Uint8Array, type: string): Promise<Uint8ClampedArray> => {
  const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type }))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D OffscreenCanvas context is unavailable')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return context.getImageData(0, 0, canvas.width, canvas.height).data
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
  const tag = await document.topLevelDirectories[0]?.getTag(270, { maxBytes: 4096 })
  if (tag?.kind !== 'ascii' || !tag.value.includes('<OME')) {
    throw new Error('Browser TIFF document did not expose bounded OME metadata')
  }
  const dataset = await openOmeTiff(document)
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
    detail: 'public TIFF document, native OME-TIFF raster, and explicit display conversion passed',
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
  avifQuantizationMatrix,
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
