import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { openTiffDocument } from '../../src/codecs/tiff.ts'
import type { ScientificAffineTransform, ScientificDataset } from '../../src/scientific/dataset.ts'
import { ScientificReaderRegistry } from '../../src/scientific/reader.ts'
import { tiffReader } from '../../src/scientific/readers/tiff.ts'
import { HttpRangeSource } from '../../src/sources/http-range.ts'

export type CogViewportSpace = 'pixel' | 'model'

export interface CogViewportBenchmarkOptions {
  readonly fixturePath?: string
  readonly space?: CogViewportSpace
  /** Pixel x/y/width/height or model minX/minY/width/height. */
  readonly viewport?: readonly [number, number, number, number]
  readonly outputWidth?: number
  readonly outputHeight?: number
  readonly blockBytes?: number
  readonly expectedOverviewLevel?: number
}

export interface CogViewportBenchmarkResult {
  readonly sourceBytes: number
  readonly viewportSpace: CogViewportSpace
  readonly viewport: readonly [number, number, number, number]
  readonly basePixelViewport: Readonly<{ x: number; y: number; width: number; height: number }>
  readonly selectedOverviewLevel: number
  readonly selectedOverviewDimensions: Readonly<{ width: number; height: number }>
  readonly selectedPixelViewport: Readonly<{ x: number; y: number; width: number; height: number }>
  readonly tileDimensions: Readonly<{ width: number; height: number }>
  readonly requests: number
  readonly bytesFetched: number
  readonly cacheHits: number
  readonly timeToFirstDecodedTileMs: number
  readonly totalDecodeMs: number
  readonly decodedPixels: number
  readonly warmDecodedPixels: number
}

interface PixelRegion {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const finitePositiveInteger = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be positive`)
  return value
}

const axisLength = (dataset: ScientificDataset, level: number, axisId: string): number => {
  const length = dataset.descriptor.levels?.[level]?.axisLengths.find(
    (axis) => axis.axisId === axisId,
  )?.length
  if (length === undefined) throw new Error(`COG level ${level} is missing axis ${axisId}`)
  return length
}

const transformPoint = (
  affine: ScientificAffineTransform,
  x: number,
  y: number,
): readonly [number, number] => [
  (affine[0] ?? 0) * x + (affine[1] ?? 0) * y + (affine[2] ?? 0),
  (affine[3] ?? 0) * x + (affine[4] ?? 0) * y + (affine[5] ?? 0),
]

const modelToPixelRegion = (
  dataset: ScientificDataset,
  viewport: readonly [number, number, number, number],
): PixelRegion => {
  const inverse = dataset.descriptor.spatialReference?.modelToPixel
  if (inverse === undefined)
    throw new Error('Model viewport requires an invertible spatial reference')
  const [minX, minY, width, height] = viewport
  const corners = [
    transformPoint(inverse, minX, minY),
    transformPoint(inverse, minX + width, minY),
    transformPoint(inverse, minX, minY + height),
    transformPoint(inverse, minX + width, minY + height),
  ]
  const xs = corners.map(([x]) => x)
  const ys = corners.map(([, y]) => y)
  const baseWidth = axisLength(dataset, 0, 'x')
  const baseHeight = axisLength(dataset, 0, 'y')
  const x = Math.max(0, Math.floor(Math.min(...xs)))
  const y = Math.max(0, Math.floor(Math.min(...ys)))
  const right = Math.min(baseWidth, Math.ceil(Math.max(...xs)))
  const bottom = Math.min(baseHeight, Math.ceil(Math.max(...ys)))
  if (right <= x || bottom <= y) throw new Error('Model viewport does not intersect the raster')
  return { x, y, width: right - x, height: bottom - y }
}

const selectOverview = (
  dataset: ScientificDataset,
  baseRegion: PixelRegion,
  outputWidth: number,
  outputHeight: number,
): number => {
  const desiredScale = Math.max(baseRegion.width / outputWidth, baseRegion.height / outputHeight)
  const baseWidth = axisLength(dataset, 0, 'x')
  const baseHeight = axisLength(dataset, 0, 'y')
  let selected = 0
  let selectedScale = 1
  for (let level = 1; level < (dataset.descriptor.levels?.length ?? 0); level += 1) {
    const scale = Math.min(
      baseWidth / axisLength(dataset, level, 'x'),
      baseHeight / axisLength(dataset, level, 'y'),
    )
    if (scale <= desiredScale && scale > selectedScale) {
      selected = level
      selectedScale = scale
    }
  }
  return selected
}

const scaleRegion = (
  dataset: ScientificDataset,
  level: number,
  region: PixelRegion,
): PixelRegion => {
  const baseWidth = axisLength(dataset, 0, 'x')
  const baseHeight = axisLength(dataset, 0, 'y')
  const levelWidth = axisLength(dataset, level, 'x')
  const levelHeight = axisLength(dataset, level, 'y')
  const x = Math.floor((region.x * levelWidth) / baseWidth)
  const y = Math.floor((region.y * levelHeight) / baseHeight)
  const right = Math.min(
    levelWidth,
    Math.ceil(((region.x + region.width) * levelWidth) / baseWidth),
  )
  const bottom = Math.min(
    levelHeight,
    Math.ceil(((region.y + region.height) * levelHeight) / baseHeight),
  )
  return { x, y, width: right - x, height: bottom - y }
}

const simulatedRangeFetch =
  (bytes: Uint8Array): typeof fetch =>
  async (_input, init) => {
    const range = new Headers(init?.headers).get('range')
    const match = range?.match(/^bytes=(\d+)-(\d+)$/)
    if (match === undefined || match === null) return new Response(null, { status: 416 })
    const start = Number(match[1])
    const end = Math.min(Number(match[2]), bytes.byteLength - 1)
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: {
        'content-range': `bytes ${start}-${end}/${bytes.byteLength}`,
        etag: '"purejsimage-cog-benchmark"',
      },
    })
  }

const decodeViewport = async (
  dataset: ScientificDataset,
  level: number,
  region: PixelRegion,
): Promise<{ readonly firstMs: number; readonly totalMs: number; readonly pixels: number }> => {
  const started = performance.now()
  let firstMs: number | undefined
  let pixels = 0
  for await (const block of dataset.readPlane({
    displayAxes: ['x', 'y'],
    fixedIndices: [],
    resolutionLevel: level,
    ...region,
  })) {
    firstMs ??= performance.now() - started
    pixels += block.width * block.height
    block.release?.()
  }
  if (firstMs === undefined) throw new Error('COG viewport produced no decoded blocks')
  return { firstMs, totalMs: performance.now() - started, pixels }
}

export const runCogViewportBenchmark = async (
  options: Readonly<CogViewportBenchmarkOptions> = {},
): Promise<CogViewportBenchmarkResult> => {
  const fixturePath = options.fixturePath ?? 'tests/fixtures/cog/subifd-deflate-rotated.tif'
  const bytes = Uint8Array.from(await readFile(fixturePath))
  const blockBytes = finitePositiveInteger(options.blockBytes ?? 256, 'blockBytes')
  const source = await HttpRangeSource.open('https://fixture.test/viewport.tif', {
    blockBytes,
    maxCacheBytes: blockBytes * 32,
    fetch: simulatedRangeFetch(bytes),
  })
  const document = await new ScientificReaderRegistry([tiffReader]).open({
    primary: { id: 'simulated-remote-cog', name: 'viewport.tif', source },
  })
  const dataset = await document.openDataset('series-0')
  const space = options.space ?? 'pixel'
  const defaultViewport: readonly [number, number, number, number] =
    space === 'model'
      ? (() => {
          const bounds = dataset.descriptor.spatialReference?.bounds
          if (bounds === undefined) throw new Error('Model viewport requires spatial bounds')
          return [bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY]
        })()
      : [0, 0, axisLength(dataset, 0, 'x'), axisLength(dataset, 0, 'y')]
  const viewport = options.viewport ?? defaultViewport
  if (viewport.some((value) => !Number.isFinite(value)) || viewport[2] <= 0 || viewport[3] <= 0) {
    throw new Error('viewport must contain finite x/y/positive width/positive height')
  }
  const basePixelViewport: PixelRegion =
    space === 'model'
      ? modelToPixelRegion(dataset, viewport)
      : { x: viewport[0], y: viewport[1], width: viewport[2], height: viewport[3] }
  const outputWidth = finitePositiveInteger(options.outputWidth ?? 8, 'outputWidth')
  const outputHeight = finitePositiveInteger(options.outputHeight ?? 8, 'outputHeight')
  const selectedOverviewLevel = selectOverview(
    dataset,
    basePixelViewport,
    outputWidth,
    outputHeight,
  )
  const expectedOverviewLevel = options.expectedOverviewLevel ?? 1
  if (selectedOverviewLevel !== expectedOverviewLevel) {
    throw new Error(
      `COG overview selection chose ${selectedOverviewLevel}; expected ${expectedOverviewLevel}`,
    )
  }
  const selectedPixelViewport = scaleRegion(dataset, selectedOverviewLevel, basePixelViewport)
  const tiff = await openTiffDocument(source)
  const selectedDirectory =
    selectedOverviewLevel === 0
      ? tiff.topLevelDirectories[0]
      : tiff.topLevelDirectories[0]?.subIfds[selectedOverviewLevel - 1]
  if (selectedDirectory === undefined) throw new Error('Selected COG overview directory is missing')
  const cold = await decodeViewport(dataset, selectedOverviewLevel, selectedPixelViewport)
  const warm = await decodeViewport(dataset, selectedOverviewLevel, selectedPixelViewport)
  const tileWidth = Number(selectedDirectory.tileWidth)
  const tileHeight = Number(selectedDirectory.tileHeight)
  if (!Number.isSafeInteger(tileWidth) || !Number.isSafeInteger(tileHeight)) {
    throw new Error('Selected COG overview does not expose tile dimensions')
  }
  if (source.stats.bytesFetched >= bytes.byteLength) {
    throw new Error(
      `COG viewport fetched ${source.stats.bytesFetched} of ${bytes.byteLength} bytes; expected a partial source read`,
    )
  }
  return Object.freeze({
    sourceBytes: bytes.byteLength,
    viewportSpace: space,
    viewport: Object.freeze([...viewport] as [number, number, number, number]),
    basePixelViewport: Object.freeze(basePixelViewport),
    selectedOverviewLevel,
    selectedOverviewDimensions: Object.freeze({
      width: axisLength(dataset, selectedOverviewLevel, 'x'),
      height: axisLength(dataset, selectedOverviewLevel, 'y'),
    }),
    selectedPixelViewport: Object.freeze(selectedPixelViewport),
    tileDimensions: Object.freeze({ width: tileWidth, height: tileHeight }),
    requests: source.stats.requests,
    bytesFetched: source.stats.bytesFetched,
    cacheHits: source.stats.cacheHits,
    timeToFirstDecodedTileMs: cold.firstMs,
    totalDecodeMs: cold.totalMs,
    decodedPixels: cold.pixels,
    warmDecodedPixels: warm.pixels,
  })
}

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

const tuple = (raw: string | undefined): readonly [number, number, number, number] | undefined => {
  if (raw === undefined) return undefined
  const values = raw.split(',').map(Number)
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error('--viewport must be x,y,width,height')
  }
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0]
}

const mainPath = process.argv[1]
if (mainPath !== undefined && import.meta.url === pathToFileURL(mainPath).href) {
  const rawSpace = argument('--space')
  if (rawSpace !== undefined && rawSpace !== 'pixel' && rawSpace !== 'model') {
    throw new Error('--space must be pixel or model')
  }
  const parsedViewport = tuple(argument('--viewport'))
  const result = await runCogViewportBenchmark({
    ...(rawSpace === undefined ? {} : { space: rawSpace }),
    ...(parsedViewport === undefined ? {} : { viewport: parsedViewport }),
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}
