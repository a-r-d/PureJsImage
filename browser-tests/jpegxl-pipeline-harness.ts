import { createImageLibrary } from '../src/browser.ts'
import { allCodecs } from '../src/codec-entries/all.ts'
import { explainImage } from '../src/explain.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'

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
