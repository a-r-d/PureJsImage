import { hdrRgbaToPng, hdrRgbToPng, sdrRgbaToPng, sdrRgbToPng } from '../examples/jpegxl-display.ts'
import { createImageLibrary } from '../src/browser.ts'
import { allCodecs } from '../src/codec-entries/all.ts'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { readJpegXlSourceFrameStructures } from '../src/codecs/jpegxl-decode.ts'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import { encodeJpegXlVarDct8 } from '../src/codecs/jpegxl-vardct-encode.ts'
import {
  encodeJpegXlDocumentPatchCandidate,
  useLargeDocumentModularCandidate,
} from '../src/codecs/jpegxl-modular-encode.ts'
import { pngCodec } from '../src/codecs/png.ts'
import { createEvidenceSession } from '../src/evidence.ts'
import { explainImage } from '../src/explain.ts'
import {
  encodeJpegXlAnimation,
  encodeJpegXlNative,
  inspectJpegXl,
  jpegXlNativeUnsignedPlanes,
  openJpegXlSequence,
} from '../src/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { type ImageSource, MemorySource } from '../src/source.ts'

export const verifyJpegXlScreenshotPatch = async () => {
  const width = 512,
    pixels = new Uint8Array(width * width * 3)
  pixels.fill(240)
  for (let cellY = 2; cellY < 30; cellY++) {
    for (let cellX = 2; cellX < 30; cellX++) {
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          if (x !== 2 && x !== 5 && y !== 2 && y !== 5) continue
          const at = ((cellY * 16 + y) * width + cellX * 16 + x) * 3
          pixels[at] = 20
          pixels[at + 1] = 30
          pixels[at + 2] = 40
        }
      }
    }
  }
  const sink = new Uint8ArraySink()
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width,
    height: width,
    pixelFormat: 'rgb8',
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
    options: { mode: 'lossy', effort: 7, distance: 3, container: false },
    limits: defaultImageLimits,
  })
  if (!encoder) throw new Error('JPEG XL screenshot encoder is unavailable')
  await encoder.write({
    x: 0,
    y: 0,
    width,
    height: width,
    stride: width * 3,
    format: 'rgb8',
    data: pixels,
  })
  await encoder.finish()
  const encoded = sink.toUint8Array()
  const frames = await readJpegXlSourceFrameStructures(
    new MemorySource(encoded),
    defaultImageLimits,
  )
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
  if (!decoder) throw new Error('JPEG XL screenshot decoder is unavailable')
  let squared = 0,
    samples = 0
  for await (const block of decoder.decode()) {
    try {
      for (let y = 0; y < block.height; y++) {
        for (let x = 0; x < block.width * 3; x++) {
          const source = pixels[(block.y + y) * width * 3 + x] ?? 0
          const decoded = block.data[y * block.stride + x] ?? 0
          squared += (source - decoded) ** 2
          samples++
        }
      }
    } finally {
      block.release?.()
    }
  }
  return {
    bytes: encoded.length,
    frames: frames.map((frame) => [frame.frameType, frame.encoding, frame.frameFlags]),
    samples,
    rmse: Math.sqrt(squared / samples),
  }
}

export const verifyJpegXlDocumentPatch = async () => {
  const width = 256,
    height = 256,
    pixels = new Uint8Array(width * height * 3)
  pixels.fill(255)
  for (let cellY = 0; cellY < 25; cellY++)
    for (let cellX = 0; cellX < 25; cellX++)
      for (let y = 0; y < 6; y++)
        for (let x = 0; x < 6; x++) {
          const offset = ((cellY * 10 + y) * width + cellX * 10 + x) * 3
          pixels[offset] = 18
          pixels[offset + 1] = 24
          pixels[offset + 2] = 30
        }
  const memory = new JpegXlEncoderMemory(268_435_456)
  let candidate: Awaited<ReturnType<typeof encodeJpegXlDocumentPatchCandidate>>
  try {
    candidate = await encodeJpegXlDocumentPatchCandidate(
      pixels,
      width,
      height,
      {
        mode: 'lossy',
        effort: 7,
        distance: 3,
        progressive: false,
        container: false,
        codestreamLevel: 5,
        sampleBitDepth: 8,
        orientation: 1,
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
        toneMapping: {
          intensityTarget: 255,
          minNits: 0,
          relativeToMaxDisplay: false,
          linearBelow: 0,
        },
      },
      memory,
      async () => {},
    )
  } finally {
    memory.close()
  }
  if (!candidate) throw new Error('Document patch candidate was not selected')
  const encoded = new Uint8Array(candidate.byteLength)
  encoded.set(candidate.header)
  let offset = candidate.header.length
  for (const part of candidate.sections) {
    encoded.set(part, offset)
    offset += part.length
  }
  const frames = await readJpegXlSourceFrameStructures(
    new MemorySource(encoded),
    defaultImageLimits,
  )
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), {
    ...defaultImageLimits,
    maxDecodedBytes: 6_000_000,
  })
  if (!decoder) throw new Error('Document patch decoder is unavailable')
  let samples = 0,
    maximum = 0
  for await (const block of decoder.decode()) {
    try {
      for (let y = 0; y < block.height; y++)
        for (let x = 0; x < width * 3; x++) {
          const expected = pixels[(block.y + y) * width * 3 + x] ?? 0
          const actual = block.data[y * block.stride + x] ?? 0
          maximum = Math.max(maximum, Math.abs(expected - actual))
          samples++
        }
    } finally {
      block.release?.()
    }
  }
  return {
    bytes: encoded.length,
    frames: frames.map((frame) => [frame.frameType, frame.encoding, frame.frameFlags]),
    samples,
    maximum,
  }
}

export const verifyJpegXlLargeDocumentSelection = () => {
  const width = 2800,
    height = 3000,
    pixels = new Uint8Array(width * height * 3)
  pixels.fill(255)
  const options = {
    effort: 7,
    distance: 3,
    progressive: false,
    sampleBitDepth: 8,
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
  } as const
  const eligible = useLargeDocumentModularCandidate(pixels, width, height, 'rgb8', options)
  pixels.fill(0)
  const darkExcluded = !useLargeDocumentModularCandidate(pixels, width, height, 'rgb8', options)
  return { eligible, darkExcluded }
}

export const verifyLevelTenJpegXl = async (bytes: Uint8Array) => {
  const sequence = await openJpegXlSequence(bytes)
  let samples = 0
  let checksum = 0
  let first: number[] = []
  try {
    for await (const layer of sequence.layers()) {
      const planes = jpegXlNativeUnsignedPlanes(layer)
      first = Array.from(planes[0]?.subarray(0, 4) ?? [])
      for (const plane of planes)
        for (const value of plane) {
          samples++
          checksum = (Math.imul(checksum, 31) + value) >>> 0
        }
    }
  } finally {
    await sequence.close()
  }
  const values = Uint32Array.of(0, 0x8000_0000, 1, 0x3f80_0000, 0xbf80_0000)
  const encoded = await encodeJpegXlNative({
    width: values.length,
    height: 1,
    color: [{ data: values, bitDepth: 32, sampleFormat: 'binary32' }],
  })
  const inspection = await inspectJpegXl(encoded)
  const groupedValues = new Uint32Array(1_025)
  for (let index = 0; index < groupedValues.length; index++)
    groupedValues[index] = index % 5 === 0 ? 0x8000_0000 : (index * 2_654_435_761) >>> 0
  const grouped = await encodeJpegXlNative({
    width: groupedValues.length,
    height: 1,
    color: [{ data: groupedValues, bitDepth: 32, sampleFormat: 'binary32' }],
  })
  const groupedSequence = await openJpegXlSequence(grouped)
  let groupedChecksum = 0
  let groupedSamples = 0
  try {
    for await (const layer of groupedSequence.layers())
      for (const plane of jpegXlNativeUnsignedPlanes(layer))
        for (const value of plane) {
          groupedSamples++
          groupedChecksum = (Math.imul(groupedChecksum, 31) + value) >>> 0
        }
  } finally {
    await groupedSequence.close()
  }
  const vardctWidth = 1_025,
    vardctHeight = 9,
    vardctPixels = Uint8Array.from(
      { length: vardctWidth * vardctHeight * 3 },
      (_, index) => (index * 29) & 255,
    ),
    vardctSink = new Uint8ArraySink()
  const vardctEncoder = await jpegxlCodec.createEncoder?.(vardctSink, {
    width: vardctWidth,
    height: vardctHeight,
    pixelFormat: 'rgb8',
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
    options: {
      mode: 'lossy',
      distance: 1,
      effort: 7,
      progressive: true,
      codestreamLevel: 10,
    },
    limits: defaultImageLimits,
  })
  if (!vardctEncoder) throw new Error('Missing Level 10 VarDCT encoder')
  await vardctEncoder.write({
    x: 0,
    y: 0,
    width: vardctWidth,
    height: vardctHeight,
    stride: vardctWidth * 3,
    format: 'rgb8',
    data: vardctPixels,
  })
  await vardctEncoder.finish()
  const vardct = vardctSink.toUint8Array()
  const vardctInspection = await inspectJpegXl(vardct)
  const animationPixels = new Uint8Array(16),
    animationView = new DataView(animationPixels.buffer)
  for (let pixel = 0; pixel < 2; pixel++) {
    for (let channel = 0; channel < 3; channel++)
      animationView.setUint16(pixel * 8 + channel * 2, pixel ? 255 : 0, false)
    animationView.setUint16(pixel * 8 + 6, pixel ? 65_535 : 0, false)
  }
  async function* frames() {
    yield { width: 2, height: 1, data: animationPixels, durationTicks: 1 }
  }
  const animationChunks: Uint8Array[] = []
  let animationBytes = 0
  for await (const chunk of encodeJpegXlAnimation(frames(), {
    width: 2,
    height: 1,
    pixelFormat: 'rgba16',
    colorSemantics: {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: 'straight',
      provenance: 'assumed-default',
      renderingIntent: 'relative',
    },
    animation: {
      ticksPerSecondNumerator: 24,
      ticksPerSecondDenominator: 1,
      loops: 0,
      haveTimecodes: false,
    },
    encoding: { mode: 'lossy', sampleBitDepth: 8, alphaBitDepth: 16 },
  })) {
    animationChunks.push(chunk)
    animationBytes += chunk.length
  }
  const animation = new Uint8Array(animationBytes)
  let animationOffset = 0
  for (const chunk of animationChunks) {
    animation.set(chunk, animationOffset)
    animationOffset += chunk.length
  }
  const animationInspection = await inspectJpegXl(animation)
  const animationSequence = await openJpegXlSequence(animation)
  let animationAlpha: number[]
  try {
    animationAlpha = Array.from((await animationSequence.frame(0)).planes[3] ?? [])
  } finally {
    await animationSequence.close()
  }
  return {
    samples,
    checksum,
    first,
    writerKind: inspection.kind,
    writerLevel: inspection.level,
    groupedSamples,
    groupedChecksum,
    vardctBytes: vardct.length,
    vardctKind: vardctInspection.kind,
    vardctLevel: vardctInspection.level,
    animationKind: animationInspection.kind,
    animationLevel: animationInspection.level,
    animationAlpha,
  }
}

export const verifyLazyJpegXl = async (bytes: Uint8Array) => {
  let requestedBytes = 0
  const source: ImageSource = {
    size: bytes.length,
    async read(offset, length) {
      requestedBytes += length
      return bytes.slice(offset, offset + length)
    },
  }
  const frames = await readJpegXlSourceFrameStructures(source, defaultImageLimits, {}, 83)
  const headerRequestedBytes = requestedBytes
  requestedBytes = 0
  const evidence = createEvidenceSession({ mode: 'summary' })
  const decoder = await jpegxlCodec.createDecoder?.(source, defaultImageLimits, {
    evidence: evidence.context,
  })
  if (!decoder || !('managedPeakBytes' in decoder)) throw new Error('Missing measured decoder')
  const openPeakBytes = decoder.managedPeakBytes
  const openRequestedBytes = requestedBytes
  let checksum = 0
  let rows = 0
  for await (const block of decoder.decode()) {
    for (const value of block.data) checksum = (Math.imul(checksum, 31) + value) >>> 0
    rows += block.height
    block.release?.()
  }
  const report = evidence.finalize()
  const image = await createImageLibrary([jpegxlCodec]).open(bytes)
  const plan = await explainImage(image.jpegxl())
  return {
    frameEnds: frames.map((frame) => frame.codestreamEndOffset),
    headerRequestedBytes,
    openPeakBytes,
    openRequestedBytes,
    decodeDuringOpen: decoder.execution?.decodeDuringOpen,
    planPixelDecode: plan.io.pixelDecode,
    rows,
    checksum,
    managedMemory: report.managedMemory,
  }
}

export const runJpegXlPipelines = async (
  load: (name: string) => Promise<Uint8Array> = async (name) => {
    const response = await fetch(`/fixtures/jpegxl-m4-${name}`)
    if (!response.ok) throw new Error(`Missing fixture ${name}`)
    return new Uint8Array(await response.arrayBuffer())
  },
): Promise<
  readonly { id: string; format: string; checksum: number; width: number; height: number }[]
> => {
  const Image = createImageLibrary(allCodecs)
  const results: { id: string; format: string; checksum: number; width: number; height: number }[] =
    []
  for (const id of [
    'srgb-8',
    'srgb-12',
    'srgb-straight-12-16',
    'p3-8',
    'pq-10',
    'hlg-12',
    'vardct-srgb-12',
  ]) {
    const hdr = id.startsWith('pq') || id.startsWith('hlg')
    const alpha = id.includes('straight')
    const image = await Image.open(
      await load(`${id}.jxl`),
      hdr ? { hdrOutput: 'tone-map-srgb' } : id === 'p3-8' ? { colorOutput: 'srgb' } : {},
    )
    for (const fit of ['contain', 'cover', 'fill'] as const) {
      const pipeline = image
        .autoOrient()
        .convertPixelFormat({ format: alpha ? 'rgba8' : 'rgb8' })
        .resize({ width: 4, height: 3, fit, kernel: 'bilinear' })
      for (const format of ['jpeg', 'png', 'webp', 'avif', 'tiff'] as const) {
        const encodedImage =
          format === 'jpeg'
            ? pipeline.jpeg({ quality: 95 })
            : format === 'png'
              ? pipeline.png()
              : format === 'webp'
                ? pipeline.webp({ lossless: true })
                : format === 'avif'
                  ? pipeline.avif()
                  : pipeline.tiff()
        const encoded = await encodedImage.toUint8Array()
        const codec = allCodecs.find((codec) => codec.format === format)
        const decoder = await codec?.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
        if (!decoder) throw new Error(`Missing output decoder ${format}`)
        let checksum = 2166136261
        for await (const block of decoder.decode()) {
          try {
            for (const byte of block.data) checksum = Math.imul(checksum ^ byte, 16777619) >>> 0
          } finally {
            block.release?.()
          }
        }
        if (decoder.width !== 4 || decoder.height !== 3)
          throw new Error('Incorrect transform dimensions')
        results.push({
          id: `${id}:${fit}`,
          format,
          checksum,
          width: decoder.width,
          height: decoder.height,
        })
      }
    }
    const controller = new AbortController()
    controller.abort()
    let cancelled = false
    try {
      await image.png().toUint8Array({ signal: controller.signal })
    } catch (error) {
      cancelled = error instanceof Error
    }
    if (!cancelled) throw new Error('Pipeline ignored cancellation')
  }
  const plan = await explainImage((await Image.open(await load('srgb-12.jxl'))).jpegxl())
  if (
    plan.decoderExecution?.sampleBitDepths[0] !== 12 ||
    plan.encoderNegotiation.pixelFormat !== 'rgb16'
  )
    throw new Error('Planner lost native precision')
  return results
}

export const verifyRemoteJpegXl = async (url: string) => {
  const { HttpRangeSource } = await import('../src/sources/http-range.ts')
  const source = await HttpRangeSource.open(url, { blockBytes: 32, maxCacheBytes: 128 })
  const Image = createImageLibrary(allCodecs)
  const image = await Image.open(source)
  const controller = new AbortController()
  controller.abort()
  let cancelled = false
  try {
    await image.jpegxl().toUint8Array({ signal: controller.signal })
  } catch (error) {
    cancelled = error instanceof Error
  }
  if (!cancelled) throw new Error('Range pipeline ignored cancellation')
  const output = await image
    .crop({ x: 2, y: 1, width: 1, height: 1 })
    .resize({ width: 2, height: 2, fit: 'fill', kernel: 'nearest' })
    .convertPixelFormat({ format: 'rgb8' })
    .png()
    .toUint8Array()
  const codec = allCodecs.find((codec) => codec.format === 'png')
  const decoder = await codec?.createDecoder?.(new MemorySource(output), defaultImageLimits)
  if (!decoder) throw new Error('Missing PNG decoder')
  const values: number[] = []
  for await (const block of decoder.decode()) {
    try {
      values.push(...block.data)
    } finally {
      block.release?.()
    }
  }
  const stats = source.stats
  source.clearCache()
  if (stats.requests < 2 || stats.cacheBytes > 128)
    throw new Error('Range request/cache gate failed')
  return { values, requests: stats.requests, cacheBytes: stats.cacheBytes }
}

export const verifyFloatJpegXl = async (input: Uint8Array) => {
  const Image = createImageLibrary(allCodecs)
  const pipeline = (await Image.open(input))
    .resize({ width: 4, height: 3, fit: 'fill', kernel: 'bilinear', colorSpace: 'linear-light' })
    .convertPixelFormat({ format: 'rgb8', range: { minimum: 0, maximum: 1 } })
    .jpegxl()
  const plan = await explainImage(pipeline)
  if (
    plan.source.pixelFormat !== 'rgbf32' ||
    !plan.precision.stages.some((stage) => stage.precisionLoss)
  )
    throw new Error('Planner lost the explicit float conversion')
  const encoded = await pipeline.toUint8Array()
  const decoder = await allCodecs
    .find((codec) => codec.format === 'jpegxl')
    ?.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
  if (!decoder) throw new Error('Missing JPEG XL decoder')
  const pixels: number[] = []
  for await (const block of decoder.decode()) {
    try {
      pixels.push(...block.data)
    } finally {
      block.release?.()
    }
  }
  return {
    width: decoder.width,
    height: decoder.height,
    colorSemantics: decoder.colorSemantics,
    pixels,
  }
}

export const verifyJpegXlRemediation = async (
  load: (name: string) => Promise<Uint8Array> = async (name) => {
    const response = await fetch(`/fixtures/jpegxl-remediation-${name}.jxl`)
    if (!response.ok) throw new Error(`Missing ${name}`)
    return new Uint8Array(await response.arrayBuffer())
  },
) => {
  const { inspectJpegXl } = await import('../src/jpegxl.ts')
  const { jpegxlCodec } = await import('../src/codecs/jpegxl.ts')
  const Image = createImageLibrary([jpegxlCodec])
  const results = []
  for (const id of [
    'hlg-12',
    'hlg-alpha-12-8',
    'pq-12',
    'pq-alpha-12-16',
    'gray-alpha-8-8',
    'gray-alpha-12-8',
    'gray-alpha-16-16',
    'gray-associated-12-8',
  ]) {
    const input = await load(id)
    const alpha = id.includes('alpha') || id.includes('associated')
    const image = await Image.open(input, { colorOutput: 'preserve', alphaOutput: 'straight' })
    const pipeline = image
      .convertPixelFormat({ format: alpha ? 'rgba16' : 'rgb16' })
      .resize({ width: 4, height: 3, fit: 'fill' })
      .jpegxl()
    const output = await pipeline.toUint8Array()
    const inspection = await inspectJpegXl(output)
    const plan = await explainImage(pipeline)
    const decoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(output),
      defaultImageLimits,
      { colorOutput: 'preserve' },
    )
    if (!decoder) throw new Error('Missing decoder')
    const samples = []
    for await (const block of decoder.decode()) {
      try {
        samples.push(...block.data)
      } finally {
        block.release?.()
      }
    }
    results.push({
      id,
      toneMapping: inspection.toneMapping,
      bitDepth: inspection.bitDepth,
      semantics: decoder.colorSemantics,
      samples,
      encoderNegotiation: plan.encoderNegotiation,
    })
  }
  return results
}

export const verifyJpegXlEncoderBudgets = async (): Promise<readonly unknown[]> => {
  const codec = allCodecs.find((codec) => codec.format === 'jpegxl')
  if (!codec?.createEncoder) throw new Error('JPEG XL encoder missing')
  const results: unknown[] = []
  for (const effort of [1, 3, 5, 7] as const) {
    let peak = 0
    for (const boundary of ['measure', 'at', 'below'] as const) {
      let bytes = 0
      const encoder = await codec.createEncoder(
        {
          async write(data) {
            bytes += data.byteLength
          },
          async close() {},
          async abort() {},
        },
        {
          width: 32,
          height: 24,
          pixelFormat: 'rgb8',
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
          options: {
            effort,
            ...(boundary === 'measure'
              ? {}
              : { maxWorkingBytes: boundary === 'at' ? peak : peak - 1 }),
          },
          limits: defaultImageLimits,
        },
      )
      const data = new Uint8Array(32 * 24 * 3)
      for (let index = 0; index < data.length; index += 1) data[index] = (index * 17) & 255
      await encoder.write({
        x: 0,
        y: 0,
        width: 32,
        height: 24,
        stride: 32 * 3,
        format: 'rgb8',
        data,
      })
      let errorCode: unknown
      try {
        await encoder.finish()
      } catch (error) {
        if (typeof error !== 'object' || error === null || !('code' in error)) throw error
        errorCode = error.code
      }
      if (
        !('managedPeakBytes' in encoder) ||
        typeof encoder.managedPeakBytes !== 'number' ||
        !('managedLiveBytes' in encoder) ||
        !('managedLiveAllocations' in encoder)
      )
        throw new Error('Missing memory counters')
      if (boundary === 'measure') peak = encoder.managedPeakBytes
      results.push({
        effort,
        boundary,
        bytes,
        peak: encoder.managedPeakBytes,
        live: encoder.managedLiveBytes,
        allocations: encoder.managedLiveAllocations,
        errorCode,
      })
    }
  }
  return results
}

export async function verifyJpegXlDisplayRecipes(
  load: (group: string, id: string) => Promise<Uint8Array> = async (group, id) => {
    const response = await fetch(`/fixtures/jpegxl-${group}-${id}.jxl`)
    if (!response.ok) throw new Error(`Missing display fixture ${id}`)
    return new Uint8Array(await response.arrayBuffer())
  },
) {
  const results = []
  for (const [group, id, recipe] of [
    ['m4', 'srgb-8', sdrRgbToPng],
    ['m4', 'srgb-12', sdrRgbToPng],
    ['m4', 'srgb-straight-8-8', sdrRgbaToPng],
    ['m4', 'srgb-straight-12-16', sdrRgbaToPng],
    ['m4', 'srgb-premultiplied-12-8', sdrRgbaToPng],
    ['m4', 'oriented-icc', sdrRgbToPng],
    ['remediation', 'hlg-12', hdrRgbToPng],
    ['remediation', 'pq-12', hdrRgbToPng],
    ['remediation', 'hlg-alpha-12-8', hdrRgbaToPng],
    ['remediation', 'pq-alpha-12-16', hdrRgbaToPng],
  ] as const) {
    const png = await recipe(await load(group, id))
    const decoder = await pngCodec.createDecoder?.(new MemorySource(png), defaultImageLimits)
    if (!decoder) throw new Error('Missing PNG decoder')
    let checksum = 2166136261
    for await (const block of decoder.decode()) {
      try {
        for (const byte of block.data) checksum = Math.imul(checksum ^ byte, 16777619) >>> 0
      } finally {
        block.release?.()
      }
    }
    results.push({
      id,
      width: decoder.width,
      height: decoder.height,
      pixelFormat: decoder.pixelFormat,
      colorSemantics: decoder.colorSemantics,
      bitDepth: png[24],
      checksum,
    })
  }
  return results
}

export const verifyProgressiveJpegXl = async (bytes: Uint8Array) => {
  const { openJpegXlSession } = await import('../src/jpegxl.ts')
  const evidence = createEvidenceSession({ mode: 'trace' })
  const session = await openJpegXlSession(bytes, { evidence: evidence.context })
  const stages: { kind: string; passes: number; checksum: number; groups: readonly number[] }[] = []
  let checksum = 0
  for await (const event of session.progressive({
    region: { x: 10, y: 10, width: 20, height: 20 },
    scaleDenominator: 2,
  })) {
    if (event.type === 'stage-start') checksum = 0
    else if (event.type === 'block') {
      for (const value of event.block.data) checksum = (checksum * 31 + value) >>> 0
      event.block.release?.()
    } else if (event.type === 'stage-complete')
      stages.push({
        kind: event.stage.kind,
        passes: event.stage.completedPasses,
        checksum,
        groups: event.stage.plan.groupIds,
      })
  }
  const bytesBefore = session.sourceSectionBytes
  for await (const event of session.decode({ until: 'dc', scaleDenominator: 8 }))
    if (event.type === 'block') event.block.release?.()
  const reused = session.sourceSectionBytes === bytesBefore
  await session.close()
  const controller = new AbortController()
  const cancellationEvidence = createEvidenceSession({ mode: 'trace' })
  cancellationEvidence.subscribe((event) => {
    if (event.type === 'allocation' && event.category === 'jpegxl-vardct-dc-preview-restoration')
      setTimeout(() => controller.abort(), 0)
  })
  const cancelSession = await openJpegXlSession(bytes, { evidence: cancellationEvidence.context })
  let cancelled = false
  try {
    for await (const event of cancelSession.native({
      scaleDenominator: 8,
      signal: controller.signal,
    }))
      if (event.type === 'block') event.block.release?.()
  } catch (error) {
    cancelled = error instanceof Error && error.name === 'AbortError'
  }
  await cancelSession.close()
  return {
    stages,
    reused,
    cancelled,
    liveBytes: session.managedLiveBytes + cancelSession.managedLiveBytes,
  }
}

export async function verifyM7ForwardJpegXl(
  load: (name: string) => Promise<Uint8Array> = async (name) => {
    const response = await fetch(`/fixtures/jpegxl-m4-${name}`)
    if (!response.ok) throw new Error(`Missing fixture ${name}`)
    return new Uint8Array(await response.arrayBuffer())
  },
) {
  const Image = createImageLibrary([jpegxlCodec])
  const results: { id: string; progressive: boolean; format: string; samples: number[] }[] = []
  for (const id of [
    'srgb-8',
    'srgb-12',
    'srgb-straight-12-16',
    'p3-8',
    'pq-10',
    'vardct-srgb-12',
  ]) {
    const image = await Image.open(await load(`${id}.jxl`))
    for (const [distance, progressive] of [
      [1, false],
      [1, true],
      [3, false],
      [3, true],
    ] as const) {
      const bytes = await image
        .jpegxl({ mode: 'lossy', distance, effort: 3, progressive })
        .toUint8Array()
      const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
      if (!decoder) throw new Error('Missing forward output decoder')
      const samples: number[] = []
      for await (const block of decoder.decode()) {
        const floating = block.format.endsWith('f32')
        const sampleBytes = floating ? 4 : block.format.endsWith('16') ? 2 : 1
        const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
        const channels = block.format.startsWith('gray')
          ? 1
          : block.format.startsWith('rgba')
            ? 4
            : 3
        for (let y = 0; y < block.height; y++)
          for (let x = 0; x < block.width * channels; x++) {
            const offset = y * block.stride + x * sampleBytes
            samples.push(
              floating
                ? view.getFloat32(offset, false)
                : sampleBytes === 2
                  ? view.getUint16(offset, false)
                  : (block.data[offset] ?? 0),
            )
          }
        block.release?.()
      }
      results.push({ id: `${id}-d${distance}`, progressive, format: decoder.pixelFormat, samples })
    }
  }
  return results
}

export async function verifyM7EffortSevenAlpha() {
  const width = 65,
    height = 33,
    pixels = new Uint8Array(width * height * 4),
    sink = new Uint8ArraySink()
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      pixels[offset] = x < 32 ? 228 : 25
      pixels[offset + 1] = (x * 11 + y * 3) & 255
      pixels[offset + 2] = (y * 7) & 255
      pixels[offset + 3] = (x * 17 + y * 29) & 255
    }
  for (const part of encodeJpegXlVarDct8(pixels, width, height, 3, undefined, 4, 7))
    await sink.write(part)
  const bytes = sink.toUint8Array()
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
  if (!decoder || decoder.pixelFormat !== 'rgba8') throw new Error('Missing RGBA8 decoder')
  const decoded = new Uint8Array(pixels.length)
  for await (const block of decoder.decode()) {
    for (let y = 0; y < block.height; y++)
      decoded.set(
        block.data.subarray(y * block.stride, y * block.stride + block.width * 4),
        (block.y + y) * width * 4,
      )
    block.release?.()
  }
  let alphaMaximumError = 0
  for (let offset = 3; offset < pixels.length; offset += 4)
    alphaMaximumError = Math.max(
      alphaMaximumError,
      Math.abs((decoded[offset] ?? 0) - (pixels[offset] ?? 0)),
    )
  return { encoded: Array.from(bytes), decoded: Array.from(decoded), alphaMaximumError }
}

export async function verifyM7EffortOneGroups() {
  const width = 513,
    height = 257
  const results: { kind: string; bytes: number; samples: number[] }[] = []
  for (const kind of ['varied', 'dc-only', 'flat'] as const) {
    const pixels = new Uint8Array(width * height * 3)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        for (let c = 0; c < 3; c++)
          pixels[(y * width + x) * 3 + c] =
            kind === 'flat'
              ? 128
              : kind === 'dc-only'
                ? ((x >> 3) * 17 + (y >> 3) * 11 + c * 53) & 255
                : (x * 17 + y * 11 + c * 53 + ((x * y) >> 4)) & 255
    const sink = new Uint8ArraySink()
    const encoder = await jpegxlCodec.createEncoder?.(sink, {
      width,
      height,
      pixelFormat: 'rgb8',
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
      options: { mode: 'lossy', distance: 1, effort: 1, maxWorkingBytes: 16 * 1024 * 1024 },
    })
    if (!encoder) throw new Error('Missing forward encoder')
    await encoder.write({
      x: 0,
      y: 0,
      width,
      height,
      stride: width * 3,
      format: 'rgb8',
      data: pixels,
    })
    await encoder.finish()
    const bytes = sink.toUint8Array()
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
    if (!decoder) throw new Error('Missing forward decoder')
    const samples = new Uint8Array(pixels.length)
    for await (const block of decoder.decode()) {
      if (block.format !== 'rgb8') throw new Error('Unexpected forward format')
      for (let y = 0; y < block.height; y++)
        samples.set(
          block.data.subarray(y * block.stride, y * block.stride + block.width * 3),
          ((block.y + y) * width + block.x) * 3,
        )
      block.release?.()
    }
    results.push({ kind, bytes: bytes.length, samples: Array.from(samples) })
  }
  return results
}

export async function verifyM7ScalarPalettes(width: number, height: number) {
  const pixels = new Uint8Array(width * height * 6)
  for (let position = 0; position < width * height; position++) {
    for (let channel = 0; channel < 3; channel++) {
      const index = (position * (channel * 4 + 3) + (position >>> 6) * (channel * 7 + 1)) % 251
      const value = index * index + channel * 53
      pixels[position * 6 + channel * 2] = value >>> 8
      pixels[position * 6 + channel * 2 + 1] = value
    }
  }
  const sink = new Uint8ArraySink()
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width,
    height,
    pixelFormat: 'rgb16',
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
    options: { effort: 7, maxWorkingBytes: 16 * 1024 * 1024 },
  })
  if (!encoder) throw new Error('Missing scalar palette encoder')
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
  const bytes = sink.toUint8Array()
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits, {
    colorOutput: 'preserve',
  })
  if (!decoder || decoder.pixelFormat !== 'rgb16')
    throw new Error('Missing native scalar palette decoder')
  let rows = 0
  for await (const block of decoder.decode()) {
    for (let y = 0; y < block.height; y++) {
      for (let x = 0; x < width * 6; x++) {
        if (block.data[y * block.stride + x] !== pixels[(block.y + y) * width * 6 + x])
          throw new Error('Scalar palette sample mismatch')
      }
      rows++
    }
    block.release?.()
  }
  if (rows !== height) throw new Error('Incomplete scalar palette output')
  return Array.from(bytes)
}

export const verifyJpegXlM8Sequence = async (bytes: Uint8Array) => {
  const { openJpegXlSequence, encodeJpegXlAnimation } = await import('../src/jpegxl.ts')
  const sequence = await openJpegXlSequence(bytes)
  const selected = await sequence.frame(1)
  let checksum = 0
  for (let i = 0; i < selected.width * selected.height; i++)
    for (let c = 0; c < 4; c++)
      checksum =
        (checksum * 31 +
          Math.round(Math.max(0, Math.min(1, selected.planes[c]?.[i] ?? 1)) * 255)) >>>
        0
  const controller = new AbortController()
  const iterator = sequence.frames(controller.signal)[Symbol.asyncIterator]()
  await iterator.next()
  controller.abort()
  let cancelled = false
  try {
    await iterator.next()
  } catch {
    cancelled = true
  }
  await sequence.close()
  async function* input() {
    yield { width: 2, height: 2, data: new Uint8Array(16).fill(255), durationTicks: 3 }
    yield { width: 2, height: 2, data: new Uint8Array(16), durationTicks: 5 }
  }
  const parts: Uint8Array[] = []
  for await (const part of encodeJpegXlAnimation(input(), {
    width: 2,
    height: 2,
    pixelFormat: 'rgba8',
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
    animation: {
      ticksPerSecondNumerator: 30000,
      ticksPerSecondDenominator: 1001,
      loops: 2,
      haveTimecodes: false,
    },
  }))
    parts.push(part)
  const encoded = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    encoded.set(part, offset)
    offset += part.length
  }
  const roundtrip = await openJpegXlSequence(encoded)
  const second = await roundtrip.frame(1)
  await roundtrip.close()
  return {
    checksum,
    cancelled,
    startTicks: selected.startTicks.toString(),
    durationTicks: selected.durationTicks,
    encodedStartTicks: second.startTicks.toString(),
    encodedDurationTicks: second.durationTicks,
    animation: second.header.animation,
    alpha: second.planes[3]?.[0],
  }
}

export const verifyJpegXlM8Native = async (bytes: Uint8Array, profile: Uint8Array) => {
  const { openJpegXlSequence, encodeJpegXlNative } = await import('../src/jpegxl.ts')
  const sequence = await openJpegXlSequence(bytes)
  const checksums: number[] = []
  try {
    for await (const layer of sequence.layers()) {
      for (const plane of layer.planes.slice(3)) {
        let checksum = 0
        for (let i = 0; i < plane.length; i++) checksum = (checksum * 31 + (plane[i] ?? 0)) >>> 0
        checksums.push(checksum)
      }
    }
  } finally {
    await sequence.close()
  }
  const plane = { data: Uint16Array.of(0, 100, 32768, 65535), bitDepth: 16 }
  const encoded = await encodeJpegXlNative({
    width: 4,
    height: 1,
    color: [plane],
    iccProfile: profile,
    extraChannels: [{ ...plane, type: 0, name: 'coverage' }],
  })
  const roundtrip = await openJpegXlSequence(encoded)
  let result: { samples: number[][]; profileMatches: boolean; name: string | undefined } | undefined
  try {
    for await (const layer of roundtrip.layers()) {
      const actual = layer.header.iccProfile
      result = {
        samples: layer.planes.map((plane) => Array.from(plane)),
        profileMatches:
          actual?.length === profile.length &&
          profile.every((value, index) => actual[index] === value),
        name: layer.header.extraChannels[0]?.name,
      }
    }
  } finally {
    await roundtrip.close()
  }
  return { checksums, result }
}

export const verifyJpegXlM8WideGamut = async (bytes: Uint8Array) => {
  const { openJpegXlSequence } = await import('../src/jpegxl.ts')
  const sequence = await openJpegXlSequence(bytes)
  try {
    const frame = await sequence.frame(0)
    let checksum = 0
    for (const plane of frame.planes)
      for (const value of plane)
        checksum = (checksum * 31 + Math.round(Math.max(0, Math.min(1, value)) * 255)) >>> 0
    return {
      sourcePrimaries: frame.header.colorSemanticsPrimaries,
      semantics: frame.colorSemantics,
      checksum,
    }
  } finally {
    await sequence.close()
  }
}

export const verifyJpegXlSelectiveHdr = async (bytes: Uint8Array): Promise<boolean> => {
  const { openJpegXlSession } = await import('../src/jpegxl.ts')
  const session = await openJpegXlSession(bytes, { maxCachedBytes: 0 })
  let valid = session.stages.find((stage) => stage.kind === 'dc')?.status !== 'unavailable'
  let seen = false
  try {
    if (valid)
      for await (const event of session.progressive({ until: 'dc' })) {
        if (event.type !== 'block') continue
        if (event.block.format !== 'rgbf32') {
          valid = false
          break
        }
        const pixel = new DataView(
          event.block.data.buffer,
          event.block.data.byteOffset,
          event.block.data.byteLength,
        ).getFloat32(0, false)
        valid = Number.isFinite(pixel) && pixel > 0
        seen = true
        break
      }
    valid = valid && seen && session.sourceSectionBytes < bytes.byteLength
  } finally {
    await session.close()
  }
  if (session.managedLiveBytes !== 0)
    throw new Error('JPEG XL selective HDR session retained managed bytes')
  return valid
}

export const verifyJpegXlSelectiveHdrAlpha = async (bytes: Uint8Array): Promise<boolean> => {
  const { openJpegXlSession } = await import('../src/jpegxl.ts')
  const session = await openJpegXlSession(bytes, { maxCachedBytes: 0 })
  let seen = false
  let valid = true
  try {
    for await (const event of session.progressive({ until: 'dc' })) {
      if (event.type !== 'block') continue
      if (event.block.format !== 'rgbaf32') {
        valid = false
        break
      }
      const alpha = new DataView(
        event.block.data.buffer,
        event.block.data.byteOffset,
        event.block.data.byteLength,
      ).getFloat32(12, false)
      valid = Math.abs(alpha - 0.5) <= 0.001
      seen = true
      break
    }
    valid = valid && seen && session.sourceSectionBytes < bytes.byteLength
  } finally {
    await session.close()
  }
  if (session.managedLiveBytes !== 0)
    throw new Error('JPEG XL selective HDR alpha session retained managed bytes')
  return valid
}

export const verifyJpegXlGrayscaleExact = async (source: Uint8Array): Promise<boolean> => {
  const { inspectJpegReconstructionEligibility, reconstructJpegFromJpegXl, transcodeJpegToJpegXl } =
    await import('../src/jpegxl.ts')
  const eligible = await inspectJpegReconstructionEligibility(source)
  if (!eligible.eligible || eligible.sourceProfile?.components !== 1) return false
  const encoded = await transcodeJpegToJpegXl(source, { reconstruction: 'required' })
  const restored = await reconstructJpegFromJpegXl(encoded.data)
  if (restored.length !== source.length || restored.some((value, index) => value !== source[index]))
    return false
  const decoder = await jpegxlCodec.createDecoder?.(
    new MemorySource(encoded.data),
    defaultImageLimits,
  )
  if (!decoder || decoder.colorSemantics?.family !== 'gray') return false
  let decoded = 0
  for await (const block of decoder.decode()) {
    if (block.format !== 'gray8') return false
    decoded += block.width * block.height
    block.release?.()
  }
  return decoded === eligible.sourceProfile.width * eligible.sourceProfile.height
}

export const verifyLosslessPaletteRgba = async () => {
  const width = 64,
    height = 64,
    pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const color = (x * 5 + y * 11) % 73
      const offset = (y * width + x) * 4
      pixels[offset] = (color * 17) & 255
      pixels[offset + 1] = (color * 29) & 255
      pixels[offset + 2] = (color * 43) & 255
      pixels[offset + 3] = (x + y) % 5 === 0 ? 0 : 255
    }
  const sink = new Uint8ArraySink()
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width,
    height,
    pixelFormat: 'rgba8',
    colorSemantics: {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: 'straight',
      provenance: 'assumed-default',
      renderingIntent: 'relative',
    },
    options: { mode: 'lossless', effort: 7 },
  })
  if (!encoder) throw new Error('Missing JPEG XL palette encoder')
  await encoder.write({
    x: 0,
    y: 0,
    width,
    height,
    stride: width * 4,
    format: 'rgba8',
    data: pixels,
  })
  await encoder.finish()
  const encoded = sink.toUint8Array()
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits, {
    colorOutput: 'preserve',
  })
  if (!decoder || decoder.pixelFormat !== 'rgba8') throw new Error('RGBA decode unavailable')
  let rows = 0
  for await (const block of decoder.decode()) {
    try {
      for (let y = 0; y < block.height; y++) {
        const actual = block.data.subarray(y * block.stride, y * block.stride + width * 4)
        const expected = pixels.subarray((block.y + y) * width * 4, (block.y + y + 1) * width * 4)
        for (let sample = 0; sample < expected.length; sample++)
          if (actual[sample] !== expected[sample]) throw new Error('RGBA sample changed')
        rows++
      }
    } finally {
      block.release?.()
    }
  }
  if (rows !== height) throw new Error('RGBA row count changed')
  return { bytes: encoded.length, rows }
}
