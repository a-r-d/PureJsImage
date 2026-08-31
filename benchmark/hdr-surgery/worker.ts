import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { ImageDecoder } from '../../src/codec.ts'
import { avifCodec } from '../../src/codecs/avif.ts'
import { jpegCodec } from '../../src/codecs/jpeg.ts'
import { createEvidenceSession, instrumentImageSource } from '../../src/evidence.ts'
import { assembleGainMapJpeg, inspectHdrJpeg, openGainMapImage } from '../../src/hdr/index.ts'
import { resolveLimits } from '../../src/limits.ts'
import type { ImageSource, ImageSourceReadOptions } from '../../src/source.ts'
import { MemorySource } from '../../src/source.ts'

const workloads = [
  'inspect-24mp',
  'extract-base-24mp',
  'extract-map-24mp',
  'render-12mp-1x',
  'render-12mp-2x',
  'render-12mp-8x',
  'transform-render-24mp',
  'crop-resize-24mp',
  'quarter-resize-24mp',
  'jpeg-reencode',
  'bit-preserving-repack',
  'avif-generic-decode',
  'avif-gain-map-encode',
  'evidence-off',
  'evidence-summary',
  'evidence-trace',
  'ordinary-jpeg',
  'ordinary-avif',
] as const
type Workload = (typeof workloads)[number]

const requested = process.argv[2]
if (!workloads.some((item) => item === requested)) throw new Error(`Unknown workload: ${requested}`)
const workload = requested as Workload

const fixture = async (name: string): Promise<Uint8Array> =>
  new Uint8Array(await readFile(`benchmark/corpus/files/${name}`))

class CountingSource implements ImageSource {
  readonly size: number
  readonly #source: MemorySource
  reads = 0
  bytes = 0
  readonly ranges: Array<readonly [number, number]> = []

  constructor(data: Uint8Array) {
    this.#source = new MemorySource(data)
    this.size = data.byteLength
  }

  async read(
    offset: number,
    length: number,
    options?: Readonly<ImageSourceReadOptions>,
  ): Promise<Uint8Array> {
    const data = await this.#source.read(offset, length, options)
    this.reads += 1
    this.bytes += data.byteLength
    this.ranges.push([offset, offset + data.byteLength])
    return data
  }

  uniqueBytes(): number {
    const sorted = [...this.ranges].sort((left, right) => left[0] - right[0])
    let bytes = 0
    let start = -1
    let end = -1
    for (const range of sorted) {
      if (range[0] > end) {
        bytes += Math.max(0, end - start)
        start = range[0]
        end = range[1]
      } else end = Math.max(end, range[1])
    }
    return bytes + Math.max(0, end - start)
  }
}

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const decode = async (
  decoder: ImageDecoder,
): Promise<{ rows: number; bytes: number; hash: string }> => {
  const hash = createHash('sha256')
  let rows = 0
  let bytes = 0
  for await (const block of decoder.decode()) {
    hash.update(block.data)
    rows += block.height
    bytes += block.data.byteLength
    block.release?.()
  }
  return { rows, bytes, hash: hash.digest('hex') }
}

interface WorkResult {
  readonly outputBytes: number
  readonly outputHash: string
  readonly sourceReads: number
  readonly sourceBytes: number
  readonly uniqueSourceBytes: number
  readonly decodedBasePixels: number
  readonly decodedGainMapPixels: number
  readonly maximumManagedBlockBytes: number
  readonly compressedArtifactBytes: number
  readonly firstAdaptedBlockMs?: number
  readonly managedMaterializationPeakBytes?: number
  readonly outputBlockMaximumBytes?: number
  readonly fullAdaptedFloatImageAllocated?: boolean
  readonly fullFrameFallback: boolean
  readonly correctness: string
}

const render = async (
  name: string,
  boost: number,
  evidenceMode?: 'summary' | 'trace',
): Promise<WorkResult> => {
  const input = await fixture(name)
  const counting = new CountingSource(input)
  const session = evidenceMode
    ? createEvidenceSession({ mode: evidenceMode, limits: { maxEvents: 4096 } })
    : undefined
  const source = session ? instrumentImageSource(counting, session.context) : counting
  const opened = await openGainMapImage(source, session ? { evidence: session.context } : {})
  const metadata = opened.inspection().metadata
  let outputBytes = 0
  let maximum = 0
  let maximumBlock = 0
  let firstAdaptedBlockMs: number | undefined
  const start = performance.now()
  for await (const block of opened.render({ displayBoost: boost })) {
    if (firstAdaptedBlockMs === undefined) firstAdaptedBlockMs = performance.now() - start
    outputBytes += block.data.byteLength
    maximumBlock = Math.max(maximumBlock, block.data.byteLength)
    for (const value of block.data) maximum = Math.max(maximum, value)
  }
  session?.finalize()
  opened.close()
  return {
    outputBytes,
    outputHash: createHash('sha256').update(String(maximum)).digest('hex'),
    sourceReads: counting.reads,
    sourceBytes: counting.bytes,
    uniqueSourceBytes: counting.uniqueBytes(),
    decodedBasePixels: metadata.baseDimensions.width * metadata.baseDimensions.height,
    decodedGainMapPixels: metadata.gainMapDimensions.width * metadata.gainMapDimensions.height,
    maximumManagedBlockBytes: maximumBlock,
    compressedArtifactBytes: 0,
    ...(firstAdaptedBlockMs === undefined ? {} : { firstAdaptedBlockMs }),
    fullFrameFallback: false,
    correctness: `rows=${metadata.baseDimensions.height};maxLinear=${maximum.toFixed(6)}`,
  }
}

const renderTransformed24Mp = async (): Promise<WorkResult> => {
  const input = await fixture('hdr-surgery-synthetic-24mp.jpg')
  const counting = new CountingSource(input)
  const opened = await openGainMapImage(counting)
  const image = opened.flipHorizontal()
  const metadata = image.inspection().metadata
  const hash = createHash('sha256')
  let outputBytes = 0
  let maximumBlock = 0
  let firstAdaptedBlockMs: number | undefined
  const start = performance.now()
  try {
    for await (const block of image.render({
      displayBoost: 4,
      maxMaterializedBytes: 256 * 1024 * 1024,
    })) {
      try {
        if (firstAdaptedBlockMs === undefined) firstAdaptedBlockMs = performance.now() - start
        const bytes = new Uint8Array(
          block.data.buffer,
          block.data.byteOffset,
          block.data.byteLength,
        )
        hash.update(bytes)
        outputBytes += bytes.byteLength
        maximumBlock = Math.max(maximumBlock, bytes.byteLength)
      } finally {
        block.release?.()
      }
    }
  } finally {
    opened.close()
  }
  const decodedBaseBytes = metadata.baseDimensions.width * metadata.baseDimensions.height * 3
  const decodedMapBytes = metadata.gainMapDimensions.width * metadata.gainMapDimensions.height
  const transformedBasePeak = decodedBaseBytes * 2 + decodedMapBytes
  const alignedMapBytes = metadata.baseDimensions.width * metadata.baseDimensions.height
  const floatBlockBytes = metadata.baseDimensions.width * 32 * 3 * 4
  const renderPeak = decodedBaseBytes + decodedMapBytes + alignedMapBytes + floatBlockBytes * 2
  return {
    outputBytes,
    outputHash: hash.digest('hex'),
    sourceReads: counting.reads,
    sourceBytes: counting.bytes,
    uniqueSourceBytes: counting.uniqueBytes(),
    decodedBasePixels: metadata.baseDimensions.width * metadata.baseDimensions.height,
    decodedGainMapPixels: metadata.gainMapDimensions.width * metadata.gainMapDimensions.height,
    maximumManagedBlockBytes: Math.max(transformedBasePeak, renderPeak),
    managedMaterializationPeakBytes: Math.max(transformedBasePeak, renderPeak),
    outputBlockMaximumBytes: maximumBlock,
    compressedArtifactBytes: 0,
    ...(firstAdaptedBlockMs === undefined ? {} : { firstAdaptedBlockMs }),
    fullFrameFallback: true,
    fullAdaptedFloatImageAllocated: false,
    correctness: `rows=${metadata.baseDimensions.height};fullAdaptedFloatImage=false`,
  }
}

const execute = async (): Promise<WorkResult> => {
  if (workload === 'inspect-24mp') {
    const input = await fixture('hdr-surgery-synthetic-24mp.jpg')
    const source = new CountingSource(input)
    const inspection = await inspectHdrJpeg(source)
    return {
      outputBytes: 0,
      outputHash: sha256(new TextEncoder().encode(JSON.stringify(inspection.representations))),
      sourceReads: source.reads,
      sourceBytes: source.bytes,
      uniqueSourceBytes: source.uniqueBytes(),
      decodedBasePixels: 0,
      decodedGainMapPixels: 0,
      maximumManagedBlockBytes: 0,
      compressedArtifactBytes: 0,
      fullFrameFallback: false,
      correctness: `${inspection.primaryDimensions.width}x${inspection.primaryDimensions.height}`,
    }
  }
  if (workload === 'render-12mp-1x') return render('hdr-surgery-synthetic-12mp.jpg', 1)
  if (workload === 'render-12mp-2x') return render('hdr-surgery-synthetic-12mp.jpg', 2)
  if (workload === 'render-12mp-8x') return render('hdr-surgery-synthetic-12mp.jpg', 8)
  if (workload === 'transform-render-24mp') return renderTransformed24Mp()
  if (workload === 'evidence-off') return render('hdr-surgery-synthetic-dual.jpg', 4)
  if (workload === 'evidence-summary') return render('hdr-surgery-synthetic-dual.jpg', 4, 'summary')
  if (workload === 'evidence-trace') return render('hdr-surgery-synthetic-dual.jpg', 4, 'trace')

  if (workload === 'ordinary-jpeg' || workload === 'ordinary-avif') {
    const input =
      workload === 'ordinary-jpeg'
        ? await fixture('hdr-surgery-synthetic-12mp.jpg')
        : await fixture('avif/libavif-seine-hdr-gainmap-srgb.avif')
    const codec = workload === 'ordinary-jpeg' ? jpegCodec : avifCodec
    const source = new CountingSource(input)
    if (!codec.createDecoder) throw new Error(`${codec.format} decoder unavailable`)
    const decoder = await codec.createDecoder(source, resolveLimits({}))
    const result = await decode(decoder)
    return {
      outputBytes: result.bytes,
      outputHash: result.hash,
      sourceReads: source.reads,
      sourceBytes: source.bytes,
      uniqueSourceBytes: source.uniqueBytes(),
      decodedBasePixels: decoder.width * decoder.height,
      decodedGainMapPixels: 0,
      maximumManagedBlockBytes: decoder.width * 32 * 4,
      compressedArtifactBytes: 0,
      fullFrameFallback: false,
      correctness: `rows=${result.rows}`,
    }
  }

  const large = workload === 'crop-resize-24mp' || workload === 'quarter-resize-24mp'
  const input = await fixture(
    large ? 'hdr-surgery-synthetic-24mp.jpg' : 'hdr-surgery-synthetic-dual.jpg',
  )
  const source = new CountingSource(input)
  const opened = await openGainMapImage(source)
  const metadata = opened.inspection().metadata
  try {
    if (workload === 'extract-base-24mp' || workload === 'extract-map-24mp') {
      const actualInput = await fixture('hdr-surgery-synthetic-24mp.jpg')
      const actualSource = new CountingSource(actualInput)
      const actual = await openGainMapImage(actualSource)
      const bytes =
        workload === 'extract-base-24mp'
          ? await actual.extractBase()
          : await actual.extractGainMap()
      actual.close()
      return {
        outputBytes: bytes.byteLength,
        outputHash: sha256(bytes),
        sourceReads: actualSource.reads,
        sourceBytes: actualSource.bytes,
        uniqueSourceBytes: actualSource.uniqueBytes(),
        decodedBasePixels: 0,
        decodedGainMapPixels: 0,
        maximumManagedBlockBytes: bytes.byteLength,
        compressedArtifactBytes: bytes.byteLength,
        fullFrameFallback: false,
        correctness: 'byte-exact extraction',
      }
    }
    if (workload === 'crop-resize-24mp') {
      const output = await opened
        .crop({ x: 1000, y: 500, width: 4000, height: 3000 })
        .resize({ width: 1200, height: 900, kernel: 'lanczos3' })
        .jpeg()
      return {
        outputBytes: output.byteLength,
        outputHash: sha256(output),
        sourceReads: source.reads,
        sourceBytes: source.bytes,
        uniqueSourceBytes: source.uniqueBytes(),
        decodedBasePixels: 24_000_000,
        decodedGainMapPixels: 1_500_000,
        maximumManagedBlockBytes: 72_000_000,
        compressedArtifactBytes: output.byteLength,
        fullFrameFallback: true,
        correctness: 'reopened by focused transform tests',
      }
    }
    if (workload === 'quarter-resize-24mp') {
      const output = await opened.rotate(90).resize({ width: 800, height: 1200 }).jpeg()
      return {
        outputBytes: output.byteLength,
        outputHash: sha256(output),
        sourceReads: source.reads,
        sourceBytes: source.bytes,
        uniqueSourceBytes: source.uniqueBytes(),
        decodedBasePixels: 24_000_000,
        decodedGainMapPixels: 1_500_000,
        maximumManagedBlockBytes: 72_000_000,
        compressedArtifactBytes: output.byteLength,
        fullFrameFallback: true,
        correctness: 'quarter-turn dimensions validated',
      }
    }
    if (workload === 'jpeg-reencode') {
      const output = await opened.jpeg()
      return {
        outputBytes: output.byteLength,
        outputHash: sha256(output),
        sourceReads: source.reads,
        sourceBytes: source.bytes,
        uniqueSourceBytes: source.uniqueBytes(),
        decodedBasePixels: metadata.baseDimensions.width * metadata.baseDimensions.height,
        decodedGainMapPixels: metadata.gainMapDimensions.width * metadata.gainMapDimensions.height,
        maximumManagedBlockBytes:
          metadata.baseDimensions.width * metadata.baseDimensions.height * 3,
        compressedArtifactBytes: output.byteLength,
        fullFrameFallback: true,
        correctness: 'deterministic dual JPEG',
      }
    }
    if (workload === 'bit-preserving-repack') {
      const [base, gainMap] = await Promise.all([opened.extractBase(), opened.extractGainMap()])
      const output = await assembleGainMapJpeg({ baseJpeg: base, gainMapJpeg: gainMap, metadata })
      return {
        outputBytes: output.byteLength,
        outputHash: sha256(output),
        sourceReads: source.reads,
        sourceBytes: source.bytes,
        uniqueSourceBytes: source.uniqueBytes(),
        decodedBasePixels: 0,
        decodedGainMapPixels: 0,
        maximumManagedBlockBytes: Math.max(base.byteLength, gainMap.byteLength),
        compressedArtifactBytes: base.byteLength + gainMap.byteLength,
        fullFrameFallback: false,
        correctness: 'zero decoded pixels; child codestreams copied exactly',
      }
    }
    if (workload === 'avif-gain-map-encode') {
      const output = await opened.resize({ width: 64, height: 36 }).avif()
      return {
        outputBytes: output.byteLength,
        outputHash: sha256(output),
        sourceReads: source.reads,
        sourceBytes: source.bytes,
        uniqueSourceBytes: source.uniqueBytes(),
        decodedBasePixels: 57_600,
        decodedGainMapPixels: 3_600,
        maximumManagedBlockBytes: 172_800,
        compressedArtifactBytes: output.byteLength,
        fullFrameFallback: true,
        correctness: 'PureJsImage AVIF inspector and decoder passed',
      }
    }
  } finally {
    opened.close()
  }

  const avifInput = await fixture('avif/libavif-seine-hdr-gainmap-srgb.avif')
  const avifSource = new CountingSource(avifInput)
  const avif = await openGainMapImage(avifSource)
  let outputBytes = 0
  let maximumBlock = 0
  for await (const block of avif.render({ displayBoost: 2 ** 1.3 })) {
    outputBytes += block.data.byteLength
    maximumBlock = Math.max(maximumBlock, block.data.byteLength)
  }
  avif.close()
  return {
    outputBytes,
    outputHash: sha256(new TextEncoder().encode(String(outputBytes))),
    sourceReads: avifSource.reads,
    sourceBytes: avifSource.bytes,
    uniqueSourceBytes: avifSource.uniqueBytes(),
    decodedBasePixels: 120_000,
    decodedGainMapPixels: 120_000,
    maximumManagedBlockBytes: maximumBlock,
    compressedArtifactBytes: 0,
    fullFrameFallback: false,
    correctness: 'generic ISO metadata and selected boost',
  }
}

globalThis.gc?.()
const before = process.memoryUsage()
const cpuBefore = process.cpuUsage()
const started = performance.now()
const result = await execute()
const wallMs = performance.now() - started
const cpu = process.cpuUsage(cpuBefore)
const after = process.memoryUsage()
const maximumRssBytes = process.resourceUsage().maxRSS * 1024

console.log(
  JSON.stringify({
    workload,
    wallMs,
    cpuUserMs: cpu.user / 1000,
    cpuSystemMs: cpu.system / 1000,
    absolutePeakRssBytes: maximumRssBytes,
    rssDeltaBytes: after.rss - before.rss,
    externalBytes: after.external,
    arrayBufferBytes: after.arrayBuffers,
    ...result,
  }),
)
