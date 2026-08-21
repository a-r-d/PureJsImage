import {
  computeRasterRegionStatistics,
  createNormalizedDifferencePlan,
  createRasterLineProfilePlan,
  createRasterRegionStatisticsPlan,
  createRasterTerrainPlan,
  evaluateRasterBandMathTile,
  evaluateRasterTerrainTile,
  sampleRasterLineProfile,
  type GeoNumericTile,
  type GeoRasterDataset,
  type GeoRasterViewSelection,
  type RasterNoData,
} from 'purejsimage/geo'
import { HttpRangeSource } from 'purejsimage/geo/browser'
import { geoTiffReader, type GeoTiffDocument } from 'purejsimage/geo/readers/geotiff'
import { openGeoZarrHttp, type GeoZarrDocument } from 'purejsimage/geo/readers/geozarr'
import type {
  GeoAnalysisKind,
  GeoDemoMetadata,
  GeoDemoRegion,
  GeoDemoSelection,
  GeoDemoTelemetry,
  GeoDemoWorkerRequest,
  GeoDemoWorkerResponse,
} from './geo-showcase-types.ts'

type ActiveSession =
  | {
      readonly kind: 'cog'
      readonly document: GeoTiffDocument
      readonly source: HttpRangeSource
      dataset: GeoRasterDataset
      metadataRequests: number
      readonly sourceUrl: string
      readonly lifetime: AbortController
    }
  | {
      readonly kind: 'geozarr'
      readonly document: GeoZarrDocument
      dataset: GeoRasterDataset
      readonly sourceUrl: string
      readonly lifetime: AbortController
    }

let active: ActiveSession | undefined
let operation: AbortController | undefined
const maximumPixels = 512 * 384

const post = (message: GeoDemoWorkerResponse, transfer: Transferable[] = []): void => {
  self.postMessage(message, { transfer })
}

const messageFor = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  if (/content-range|byte range|status 206|range response/iu.test(message)) {
    return `Range error: ${message}`
  }
  if (/fetch|network|http .*failed/iu.test(message)) return `CORS or network error: ${message}`
  if (/codec|compression/iu.test(message)) return `Codec error: ${message}`
  if (/crs|spatial|affine|geozarr convention|metadata/iu.test(message)) {
    return `Metadata or CRS error: ${message}`
  }
  return `Source error: ${message}`
}

const closeActive = async (): Promise<void> => {
  operation?.abort(new DOMException('Geo operation cancelled', 'AbortError'))
  operation = undefined
  const previous = active
  active = undefined
  previous?.lifetime.abort(new DOMException('Geo source closed', 'AbortError'))
  await previous?.document.close?.()
}

const telemetry = (session: ActiveSession): GeoDemoTelemetry => {
  if (session.kind === 'cog') {
    const stats = session.source?.stats
    return {
      metadataRequests: session.metadataRequests,
      dataRequests: Math.max(0, (stats?.requests ?? 0) - session.metadataRequests),
      transferredBytes: stats?.transferBytes ?? 0,
      uniqueBytes: stats?.uniqueBytes ?? 0,
      cacheHits: stats?.cacheHits ?? 0,
      coalesced: stats?.coalescedConsumers ?? 0,
      cancelled: stats?.abortedConsumers ?? 0,
      ...(session.source === undefined ? {} : { sourceBytes: session.source.size }),
    }
  }
  const report = session.document.inspectStructure()
  return {
    metadataRequests: report.io.metadataRequests,
    dataRequests: report.io.chunkRequests,
    transferredBytes: report.io.metadataBytes + report.io.chunkBytes,
    uniqueBytes: report.io.uniqueBytes,
    cacheHits: report.io.cacheHits,
    coalesced: report.io.coalescedConsumers,
    cancelled: report.io.cancelledReads,
  }
}

const crsLabel = (dataset: GeoRasterDataset): string => {
  const crs = dataset.descriptor.spatialReference
  if (crs.authority !== undefined && crs.code !== undefined) return `${crs.authority}:${crs.code}`
  return crs.name ?? (crs.state === 'unknown' ? 'Unknown CRS' : 'Incomplete CRS')
}

const bounds = (dataset: GeoRasterDataset): readonly number[] => {
  const value = dataset.descriptor.grid.worldBounds
  return [value.minX, value.minY, value.maxX, value.maxY]
}

const commonMetadata = (session: ActiveSession): Omit<GeoDemoMetadata, 'container'> => {
  const descriptor = session.dataset.descriptor
  return {
    kind: session.kind,
    format: session.document.format,
    datasets: session.document.datasets.map((entry) => ({
      id: entry.id,
      title: entry.name ?? entry.descriptor.title ?? entry.id,
    })),
    datasetId: descriptor.id,
    width: descriptor.grid.width,
    height: descriptor.grid.height,
    sampleType: descriptor.sampleType,
    crs: crsLabel(session.dataset),
    bounds: bounds(session.dataset),
    registration: descriptor.grid.pixelRegistration,
    bands: descriptor.bands.map((band) => ({
      index: band.sourceComponentIndex,
      name: band.name,
      color: band.colorInterpretation,
    })),
    axes: descriptor.axes.map((axis) => ({ id: axis.id, kind: axis.kind, length: axis.length })),
    levels: descriptor.levels.map((level) => ({
      id: level.id,
      width: level.width,
      height: level.height,
      affine: level.geometry.pixelToWorld,
      ...(level.storage.chunkShape === undefined ? {} : { chunkShape: level.storage.chunkShape }),
      ...(Array.isArray(level.storage.metadata?.outerShardShape)
        ? { outerShardShape: level.storage.metadata.outerShardShape.map(Number) }
        : {}),
      ...(level.storage.compression === undefined
        ? {}
        : { compression: level.storage.compression }),
    })),
    sourceUrl: session.sourceUrl,
  }
}

const inspectMetadata = async (session: ActiveSession): Promise<GeoDemoMetadata> => {
  const common = commonMetadata(session)
  if (session.kind === 'cog') {
    const report = await session.document.inspectStructure()
    const first = report.directories[0]
    return {
      ...common,
      container: report.container,
      byteOrder: report.byteOrder,
      tileDimensions:
        first?.tileWidth === undefined || first.tileHeight === undefined
          ? 'strips'
          : `${first.tileWidth} × ${first.tileHeight}`,
      objectSize: report.objectSize,
    }
  }
  const report = session.document.inspectStructure()
  const codecs = new Set<string>()
  for (const dataset of report.datasets) {
    for (const level of dataset.levels) {
      for (const codec of level.array.codecs) codecs.add(codec)
    }
  }
  const inspected = report.datasets.find((entry) => entry.id === session.dataset.descriptor.id)
  return {
    ...common,
    ...(inspected === undefined
      ? {}
      : {
          levels: inspected.levels.map((level) => ({
            id: level.id,
            width: level.array.shape[level.array.shape.length - 1] ?? level.geometry.width,
            height: level.array.shape[level.array.shape.length - 2] ?? level.geometry.height,
            affine: level.geometry.pixelToWorld,
            chunkShape: level.array.logicalChunkShape,
            ...(level.array.outerShardShape === undefined
              ? {}
              : { outerShardShape: level.array.outerShardShape }),
          })),
        }),
    zarrVersion: report.zarrFormat,
    conventions: report.conventions.map((entry) => `${entry.name} · ${entry.uuid}`),
    codecs: [...codecs],
  }
}

const selectedIndex = (selection: GeoDemoSelection, kind: string): number => {
  if (kind === 'time') return selection.time
  if (kind === 'vertical' || kind === 'depth') return selection.vertical
  if (kind === 'band') return selection.band
  return 0
}

const viewSelection = (
  dataset: GeoRasterDataset,
  selection: GeoDemoSelection,
  sourceBands?: readonly number[],
  axisBand?: number,
): GeoRasterViewSelection => ({
  spatialDimensions: [
    dataset.descriptor.spatialDimensions.x.id,
    dataset.descriptor.spatialDimensions.y.id,
  ],
  nonSpatial: dataset.descriptor.axes.map((axis) => ({
    kind: 'index',
    axisId: axis.id,
    index:
      axis.kind === 'band' && axisBand !== undefined
        ? axisBand
        : selectedIndex(selection, axis.kind),
  })),
  sourceBands: sourceBands ?? [dataset.descriptor.bands[0]?.sourceComponentIndex ?? 0],
  levelId: selection.levelId,
})

const displayBands = (
  dataset: GeoRasterDataset,
  selection: GeoDemoSelection,
): readonly number[] => {
  const descriptors = dataset.descriptor.bands
  const bands = descriptors.map((band) => band.sourceComponentIndex)
  const colorBand = (color: 'red' | 'green' | 'blue' | 'nir'): number | undefined =>
    descriptors.find((band) => band.colorInterpretation === color)?.sourceComponentIndex
  if (selection.mode === 'rgb') {
    const red = colorBand('red')
    const green = colorBand('green')
    const blue = colorBand('blue')
    if (red !== undefined && green !== undefined && blue !== undefined) return [red, green, blue]
    throw new Error('RGB mapping requires explicit red, green, and blue band metadata')
  }
  if (selection.mode === 'cir') {
    const nir = colorBand('nir')
    const red = colorBand('red')
    const green = colorBand('green')
    if (nir !== undefined && red !== undefined && green !== undefined) return [nir, red, green]
    throw new Error('CIR mapping requires explicit NIR, red, and green band metadata')
  }
  return [bands[Math.min(selection.band, bands.length - 1)] ?? bands[0] ?? 0]
}

const validateRegion = (region: GeoDemoRegion, width: number, height: number): GeoDemoRegion => {
  const x = Math.max(0, Math.min(Math.floor(region.x), width - 1))
  const y = Math.max(0, Math.min(Math.floor(region.y), height - 1))
  const regionWidth = Math.min(Math.floor(region.width), width - x)
  const regionHeight = Math.min(Math.floor(region.height), height - y)
  if (regionWidth < 1 || regionHeight < 1 || regionWidth * regionHeight > maximumPixels) {
    throw new Error(`Viewport must contain 1 to ${maximumPixels.toLocaleString()} pixels`)
  }
  return { x, y, width: regionWidth, height: regionHeight }
}

const sampleOffset = (tile: GeoNumericTile, x: number, y: number, component: number): number =>
  tile.layout === 'planar'
    ? component * (tile.planeStrideElements ?? 0) + y * tile.rowStrideElements + x
    : y * tile.rowStrideElements + x * tile.componentCount + component

const readTile = async (
  dataset: GeoRasterDataset,
  selection: GeoDemoSelection,
  signal: AbortSignal,
  options: Readonly<{
    readonly region?: GeoDemoRegion
    readonly sourceBands?: readonly number[]
    readonly axisBand?: number
  }> = {},
): Promise<GeoNumericTile> => {
  const level = dataset.descriptor.levels.find((entry) => entry.id === selection.levelId)
  if (level === undefined) throw new Error(`Resolution level ${selection.levelId} is unavailable`)
  const region = validateRegion(options.region ?? selection.region, level.width, level.height)
  const view = dataset.createView(
    viewSelection(dataset, selection, options.sourceBands, options.axisBand),
  )
  const componentCount = options.sourceBands?.length ?? view.selection.sourceBands.length
  const data = new Float64Array(region.width * region.height * componentCount)
  for await (const tile of view.readPixelRegion({ region, signal })) {
    try {
      for (let y = 0; y < tile.height; y += 1) {
        const outputY = tile.y + y - region.y
        for (let x = 0; x < tile.width; x += 1) {
          const outputX = tile.x + x - region.x
          for (let component = 0; component < componentCount; component += 1) {
            const value = tile.data[sampleOffset(tile, x, y, component)]
            data[(outputY * region.width + outputX) * componentCount + component] = Number(value)
          }
        }
      }
    } finally {
      tile.release()
    }
  }
  return {
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
    sampleType: 'float64',
    componentCount,
    layout: 'interleaved',
    rowStrideElements: region.width * componentCount,
    data,
    release() {},
    fixedIndices: [],
    sourceBands: options.sourceBands ?? view.selection.sourceBands,
    levelId: selection.levelId,
  }
}

const rangeFor = (tile: GeoNumericTile, component: number): readonly [number, number] => {
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  for (let y = 0; y < tile.height; y += 1) {
    for (let x = 0; x < tile.width; x += 1) {
      const value = Number(tile.data[sampleOffset(tile, x, y, component)])
      if (!Number.isFinite(value)) continue
      minimum = Math.min(minimum, value)
      maximum = Math.max(maximum, value)
    }
  }
  return minimum < maximum ? [minimum, maximum] : [minimum || 0, (minimum || 0) + 1]
}

const rgbaFor = (tile: GeoNumericTile): Uint8ClampedArray => {
  const output = new Uint8ClampedArray(tile.width * tile.height * 4)
  const ranges = Array.from({ length: tile.componentCount }, (_, component) =>
    rangeFor(tile, component),
  )
  for (let y = 0; y < tile.height; y += 1) {
    for (let x = 0; x < tile.width; x += 1) {
      const pixel = y * tile.width + x
      for (let channel = 0; channel < 3; channel += 1) {
        const component = tile.componentCount === 1 ? 0 : Math.min(channel, tile.componentCount - 1)
        const value = Number(tile.data[sampleOffset(tile, x, y, component)])
        const range = ranges[component] ?? [0, 1]
        output[pixel * 4 + channel] = Number.isFinite(value)
          ? Math.round(((value - range[0]) / (range[1] - range[0])) * 255)
          : 0
      }
      output[pixel * 4 + 3] = 255
    }
  }
  return output
}

const render = async (requestId: number, selection: GeoDemoSelection): Promise<void> => {
  const session = active
  if (session === undefined) throw new Error('Open a geo source first')
  operation?.abort(new DOMException('Superseded by a new viewport', 'AbortError'))
  const controller = new AbortController()
  operation = controller
  const tile = await readTile(session.dataset, selection, controller.signal, {
    sourceBands: displayBands(session.dataset, selection),
  })
  const rgba = rgbaFor(tile)
  post(
    {
      kind: 'frame',
      requestId,
      width: tile.width,
      height: tile.height,
      rgba,
      telemetry: telemetry(session),
    },
    [rgba.buffer],
  )
}

const oneBandTile = async (
  session: ActiveSession,
  selection: GeoDemoSelection,
  axisBand: number,
  signal: AbortSignal,
  region?: GeoDemoRegion,
): Promise<GeoNumericTile> => {
  const componentBands = session.dataset.descriptor.bands
  if (session.dataset.descriptor.axes.some((axis) => axis.kind === 'band')) {
    return readTile(session.dataset, selection, signal, {
      axisBand,
      sourceBands: [session.dataset.descriptor.bands[0]?.sourceComponentIndex ?? 0],
      ...(region === undefined ? {} : { region }),
    })
  }
  const sourceBand =
    componentBands[Math.min(axisBand, componentBands.length - 1)]?.sourceComponentIndex ?? 0
  return readTile(session.dataset, selection, signal, {
    sourceBands: [sourceBand],
    ...(region === undefined ? {} : { region }),
  })
}

const noDataFor = (session: ActiveSession, logicalBand: number): RasterNoData => {
  const descriptor = session.dataset.descriptor
  const band = descriptor.axes.some((axis) => axis.kind === 'band')
    ? descriptor.bands[0]
    : descriptor.bands[Math.min(logicalBand, descriptor.bands.length - 1)]
  const value = band?.noData
  if (typeof value !== 'number') return { kind: 'none' }
  return Number.isNaN(value) ? { kind: 'nan' } : { kind: 'value', value }
}

const analysisSummary = async (
  analysis: GeoAnalysisKind,
  selection: GeoDemoSelection,
  signal: AbortSignal,
): Promise<{ readonly summary: string; readonly tile?: GeoNumericTile }> => {
  const session = active
  if (session === undefined) throw new Error('Open a geo source first')
  if (analysis === 'normalized-difference') {
    const axis = session.dataset.descriptor.axes.find((entry) => entry.kind === 'band')
    const available = axis?.length ?? session.dataset.descriptor.bands.length
    if (available < 2) throw new Error('Normalized difference requires at least two bands')
    const left = await oneBandTile(session, selection, Math.min(2, available - 1), signal)
    const right = await oneBandTile(session, selection, 0, signal)
    const result = evaluateRasterBandMathTile(
      createNormalizedDifferencePlan(
        { name: 'left', valueMode: 'raw', noData: noDataFor(session, Math.min(2, available - 1)) },
        { name: 'right', valueMode: 'raw', noData: noDataFor(session, 0) },
      ),
      [left, right],
      undefined,
      { signal },
    )
    const tile: GeoNumericTile = {
      ...result,
      fixedIndices: [],
      sourceBands: [0],
      levelId: selection.levelId,
    }
    return { summary: 'Normalized difference for the current bounded viewport.', tile }
  }
  if (analysis === 'hillshade') {
    const level = session.dataset.descriptor.levels.find((entry) => entry.id === selection.levelId)
    if (level === undefined) throw new Error('The selected level is unavailable')
    const affine = level.geometry.pixelToWorld
    const outputRegion = validateRegion(selection.region, level.width, level.height)
    const haloRegion = {
      x: Math.max(0, outputRegion.x - 1),
      y: Math.max(0, outputRegion.y - 1),
      width:
        Math.min(level.width, outputRegion.x + outputRegion.width + 1) -
        Math.max(0, outputRegion.x - 1),
      height:
        Math.min(level.height, outputRegion.y + outputRegion.height + 1) -
        Math.max(0, outputRegion.y - 1),
    }
    const terrainSource = await oneBandTile(session, selection, selection.band, signal, haloRegion)
    const result = evaluateRasterTerrainTile(
      createRasterTerrainPlan({
        operation: 'hillshade',
        sourceWidth: level.width,
        sourceHeight: level.height,
        xSpacing: Math.max(Math.hypot(affine[0], affine[3]), Number.EPSILON),
        ySpacing: Math.max(Math.hypot(affine[1], affine[4]), Number.EPSILON),
        xUnit: { kind: 'metre' },
        yUnit: { kind: 'metre' },
        verticalUnit: { kind: 'metre' },
        rowDirection: affine[4] < 0 ? 'south' : 'north',
        edge: 'clamp',
        inputNoData: noDataFor(session, selection.band),
      }),
      terrainSource,
      outputRegion,
      { signal },
    )
    const tile: GeoNumericTile = {
      ...result,
      fixedIndices: [],
      sourceBands: [0],
      levelId: selection.levelId,
    }
    return { summary: 'Hillshade for the current bounded viewport.', tile }
  }
  const source = await oneBandTile(session, selection, selection.band, signal)
  if (analysis === 'statistics') {
    const stats = computeRasterRegionStatistics(
      createRasterRegionStatisticsPlan({ noData: noDataFor(session, selection.band) }),
      source,
      undefined,
      {
        signal,
      },
    )
    return {
      summary: `Count ${stats.count.toLocaleString()}, min ${stats.minimum ?? 'n/a'}, max ${stats.maximum ?? 'n/a'}, mean ${stats.mean?.toFixed(3) ?? 'n/a'}.`,
    }
  }
  if (analysis === 'line-profile') {
    const profile = sampleRasterLineProfile(
      createRasterLineProfilePlan({
        start: { x: source.x, y: source.y },
        end: { x: source.x + source.width - 1, y: source.y + source.height - 1 },
        sampleCount: Math.min(64, Math.max(source.width, source.height)),
        noData: noDataFor(session, selection.band),
      }),
      source,
      { signal },
    )
    const values = Array.from(profile.values)
      .filter(Number.isFinite)
      .slice(0, 8)
      .map((value) => value.toFixed(2))
    return {
      summary: `Diagonal profile (${profile.values.length} samples): ${values.join(', ')}${profile.values.length > values.length ? ', …' : ''}`,
    }
  }
  throw new Error(`Unsupported analysis ${analysis}`)
}

const analyze = async (
  requestId: number,
  analysis: GeoAnalysisKind,
  selection: GeoDemoSelection,
): Promise<void> => {
  const session = active
  if (session === undefined) throw new Error('Open a geo source first')
  operation?.abort(new DOMException('Superseded by a new analysis', 'AbortError'))
  const controller = new AbortController()
  operation = controller
  const result = await analysisSummary(analysis, selection, controller.signal)
  if (result.tile === undefined) {
    post({
      kind: 'analysis',
      requestId,
      analysis,
      summary: result.summary,
      telemetry: telemetry(session),
    })
    return
  }
  const rgba = rgbaFor(result.tile)
  result.tile.release()
  post(
    {
      kind: 'analysis',
      requestId,
      analysis,
      summary: result.summary,
      width: result.tile.width,
      height: result.tile.height,
      rgba,
      telemetry: telemetry(session),
    },
    [rgba.buffer],
  )
}

const samplePoint = async (
  requestId: number,
  selection: GeoDemoSelection,
  x: number,
  y: number,
): Promise<void> => {
  const session = active
  if (session === undefined) throw new Error('Open a geo source first')
  const controller = new AbortController()
  const level = session.dataset.descriptor.levels.find((entry) => entry.id === selection.levelId)
  if (level === undefined) throw new Error('The selected level is unavailable')
  const region = validateRegion(
    { x: Math.floor(x), y: Math.floor(y), width: 1, height: 1 },
    level.width,
    level.height,
  )
  const tile = await readTile(session.dataset, selection, controller.signal, {
    region,
    sourceBands: displayBands(session.dataset, selection),
  })
  const values = Array.from({ length: tile.componentCount }, (_, component) =>
    Number(tile.data[sampleOffset(tile, 0, 0, component)]),
  )
  const affine = level.geometry.pixelToWorld
  const world: readonly [number, number] = [
    affine[0] * x + affine[1] * y + affine[2],
    affine[3] * x + affine[4] * y + affine[5],
  ]
  post({ kind: 'sample', requestId, world, values })
}

const open = async (request: Extract<GeoDemoWorkerRequest, { kind: 'open' }>): Promise<void> => {
  await closeActive()
  const controller = new AbortController()
  operation = controller
  let session: ActiveSession
  if (request.sourceKind === 'cog') {
    const source = await HttpRangeSource.open(request.url, {
      blockBytes: 16 * 1_024,
      maxCacheBytes: 4 * 1_024 * 1_024,
      openSignal: controller.signal,
      lifetimeSignal: controller.signal,
    })
    if (source === undefined) throw new Error('The COG source was not found')
    const document = await geoTiffReader.open({
      primary: {
        id: 'cog',
        name: new URL(request.url).pathname.split('/').pop() ?? 'image.tif',
        source,
      },
      signal: controller.signal,
    })
    const first = document.datasets[0]
    if (first === undefined) throw new Error('The GeoTIFF contains no geo raster dataset')
    const dataset = await document.openDataset(first.id, { signal: controller.signal })
    session = {
      kind: 'cog',
      document,
      source,
      dataset,
      metadataRequests: 0,
      sourceUrl: request.url,
      lifetime: controller,
    }
  } else {
    const document = await openGeoZarrHttp(request.url, {
      signal: controller.signal,
      http: { blockBytes: 64 * 1_024, maxCacheBytesPerSource: 512 * 1_024, maxOpenSources: 32 },
      limits: { maxRegionBytes: 8 * 1_024 * 1_024, maxCachedChunkBytes: 8 * 1_024 * 1_024 },
    })
    const first = document.datasets[0]
    if (first === undefined)
      throw new Error('The GeoZarr store contains no declared raster dataset')
    const dataset = await document.openDataset(first.id, { signal: controller.signal })
    session = { kind: 'geozarr', document, dataset, sourceUrl: request.url, lifetime: controller }
  }
  active = session
  operation = undefined
  const metadata = await inspectMetadata(session)
  if (session.kind === 'cog') session.metadataRequests = session.source.stats.requests
  post({
    kind: 'opened',
    requestId: request.requestId,
    metadata,
    telemetry: telemetry(session),
  })
}

const selectDataset = async (requestId: number, datasetId: string): Promise<void> => {
  const session = active
  if (session === undefined) throw new Error('Open a geo source first')
  operation?.abort(new DOMException('Superseded by a dataset selection', 'AbortError'))
  const controller = new AbortController()
  operation = controller
  session.dataset = await session.document.openDataset(datasetId, { signal: controller.signal })
  operation = undefined
  post({
    kind: 'opened',
    requestId,
    metadata: await inspectMetadata(session),
    telemetry: telemetry(session),
  })
}

const isTrustedMessageOrigin = (origin: string): boolean => {
  if (origin === '' || origin === 'null') return true
  try {
    return new URL(origin).origin === self.location.origin
  } catch {
    return false
  }
}

self.addEventListener('message', (event: MessageEvent<GeoDemoWorkerRequest>) => {
  if (!isTrustedMessageOrigin(event.origin)) return
  const request = event.data
  void (async () => {
    try {
      if (request.kind === 'open') await open(request)
      else if (request.kind === 'dataset') await selectDataset(request.requestId, request.datasetId)
      else if (request.kind === 'render') await render(request.requestId, request.selection)
      else if (request.kind === 'analyze')
        await analyze(request.requestId, request.analysis, request.selection)
      else if (request.kind === 'sample') {
        await samplePoint(request.requestId, request.selection, request.x, request.y)
      } else if (request.kind === 'cancel') {
        operation?.abort(new DOMException('Cancelled by the user', 'AbortError'))
        post({ kind: 'cancelled', requestId: request.requestId })
      } else {
        await closeActive()
        post({ kind: 'closed', requestId: request.requestId })
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        post({ kind: 'cancelled', requestId: request.requestId })
      } else {
        post({ kind: 'error', requestId: request.requestId, message: messageFor(error) })
      }
    }
  })()
})
