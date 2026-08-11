import { browserRuntime } from '../../../src/browser-runtime.ts'
import { pngCodec } from '../../../src/codecs/png.ts'
import type { PixelBlock } from '../../../src/pixel.ts'
import {
  measureScientificPlane,
  openEnvi,
  openFits,
  openGsf,
  renderScientificPlane,
  type EnviDataset,
  type FitsDataset,
  type FitsDocument,
  type GsfDataset,
  type MultidimensionalRasterDataset,
  type ScientificPlaneMeasurement,
  type ScientificRange,
} from '../../../src/scientific/index.ts'
import { Uint8ArraySink } from '../../../src/sink.ts'
import type {
  ScientificDemoRenderSettings,
  ScientificOpenedMetadata,
  ScientificWorkerRequest,
  ScientificWorkerResponse,
} from './scientific-types.ts'

interface WorkerScope {
  onmessage: ((event: MessageEvent<ScientificWorkerRequest>) => void) | null
  postMessage(message: ScientificWorkerResponse, transfer?: readonly Transferable[]): void
}

type DemoDataset = GsfDataset | EnviDataset | FitsDataset

const scope = globalThis as unknown as WorkerScope
let dataset: DemoDataset | undefined
let fitsDocument: FitsDocument | undefined
let fitsName = ''
let sourceBytes = 0
let latestSequence = 0
let generation = 0
let latestDisplay:
  | { readonly width: number; readonly height: number; readonly pixels: Uint8ClampedArray }
  | undefined
const rangeCache = new Map<string, ScientificPlaneMeasurement>()

const post = (message: ScientificWorkerResponse, transfer: readonly Transferable[] = []): void => {
  scope.postMessage(message, transfer)
}

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : 'Unknown scientific raster explorer error'

const inputSize = (input: ArrayBuffer | File): number =>
  input instanceof ArrayBuffer ? input.byteLength : input.size

const beginDataset = (opened: DemoDataset, bytes: number): void => {
  dataset = opened
  sourceBytes = bytes
  generation += 1
  rangeCache.clear()
  latestDisplay = undefined
}

const gsfMetadata = (opened: GsfDataset, name: string, bytes: number): ScientificOpenedMetadata => {
  const pixelX = opened.physicalSizeX
  const pixelY = opened.physicalSizeY
  return {
    mode: 'surface',
    name,
    width: opened.sizeX,
    height: opened.sizeY,
    bands: 1,
    sampleType: opened.sampleType,
    sourceBytes: bytes,
    ...(opened.channels[0]?.name === undefined ? {} : { title: opened.channels[0].name }),
    ...(opened.channels[0]?.unit === undefined ? {} : { valueUnit: opened.channels[0].unit }),
    ...(pixelX === undefined ? {} : { pixelSizeX: pixelX.value }),
    ...(pixelY === undefined ? {} : { pixelSizeY: pixelY.value }),
    ...(pixelX === undefined ? {} : { physicalWidth: pixelX.value * opened.sizeX }),
    ...(pixelY === undefined ? {} : { physicalHeight: pixelY.value * opened.sizeY }),
    ...(pixelX?.unit === undefined ? {} : { physicalUnit: pixelX.unit }),
  }
}

const enviMetadata = (
  opened: EnviDataset,
  name: string,
  bytes: number,
): ScientificOpenedMetadata => {
  const centers = opened.channels.map((channel) => channel.spectral?.center ?? null)
  const actual = centers.filter((center): center is number => center !== null)
  const unit = opened.channels.find((channel) => channel.spectral?.unit !== undefined)?.spectral
    ?.unit
  return {
    mode: 'hyperspectral',
    name,
    width: opened.sizeX,
    height: opened.sizeY,
    bands: opened.sizeC,
    sampleType: opened.sampleType,
    sourceBytes: bytes,
    channelCenters: Object.freeze(centers),
    ...(actual.length === 0
      ? {}
      : { wavelengthMin: Math.min(...actual), wavelengthMax: Math.max(...actual) }),
    ...(unit === undefined ? {} : { wavelengthUnit: unit }),
  }
}

const fitsMetadata = (
  opened: FitsDataset,
  document: FitsDocument,
  name: string,
  bytes: number,
): ScientificOpenedMetadata => ({
  mode: 'fits',
  name,
  width: opened.sizeX,
  height: opened.sizeY,
  bands: 1,
  sizeZ: opened.sizeZ,
  sampleType: opened.sampleType,
  sourceBytes: bytes,
  fitsHdu: opened.hdu.index,
  fitsPrimary: opened.hdu.primary,
  bitpix: opened.bitpix,
  bscale: opened.bscale,
  bzero: opened.bzero,
  storedSampleType: opened.storedSampleType,
  ...(opened.blank === undefined ? {} : { blank: opened.blank }),
  fitsHdus: Object.freeze(
    document.hdus.map((hdu) => ({
      index: hdu.index,
      canOpenRaster: hdu.canOpenRaster,
      label: `HDU ${hdu.index}: ${hdu.primary ? 'Primary' : (hdu.extensionType ?? 'Extension')} ${hdu.dimensions.length === 0 ? '(empty)' : hdu.dimensions.join(' × ')}`,
    })),
  ),
})

const openGsfFile = async (name: string, data: ArrayBuffer | File): Promise<void> => {
  post({ type: 'opening', message: 'Reading GSF metadata…' })
  const bytes = inputSize(data)
  const opened = await openGsf(data, { maxInputBytes: Math.max(bytes, 1) })
  fitsDocument = undefined
  beginDataset(opened, bytes)
  post({ type: 'opened', metadata: gsfMetadata(opened, name, bytes) })
}

const openEnviFiles = async (
  headerName: string,
  dataName: string,
  header: ArrayBuffer | File,
  data: ArrayBuffer | File,
): Promise<void> => {
  post({ type: 'opening', message: 'Parsing the ENVI header and validating the binary raster…' })
  const headerBytes = inputSize(header)
  const dataBytes = inputSize(data)
  const opened = await openEnvi({
    header,
    data,
    maxInputBytes: Math.max(headerBytes, dataBytes, 1),
    maxFrames: 100_000,
  })
  fitsDocument = undefined
  beginDataset(opened, headerBytes + dataBytes)
  post({
    type: 'opened',
    metadata: enviMetadata(opened, `${headerName} + ${dataName}`, sourceBytes),
  })
}

const selectFitsHdu = async (index: number): Promise<void> => {
  const document = fitsDocument
  if (!document) throw new Error('Open a FITS document before selecting an HDU')
  const opened = await document.openImage(index)
  beginDataset(opened, sourceBytes)
  post({ type: 'opened', metadata: fitsMetadata(opened, document, fitsName, sourceBytes) })
}

const openFitsFile = async (name: string, data: ArrayBuffer | File): Promise<void> => {
  post({ type: 'opening', message: 'Parsing FITS Header/Data Units…' })
  const bytes = inputSize(data)
  const document = await openFits(data, { maxInputBytes: Math.max(bytes, 1), maxFrames: 100_000 })
  fitsDocument = document
  fitsName = name
  sourceBytes = bytes
  const first = document.hdus.find((hdu) => hdu.canOpenRaster)
  if (!first) throw new Error('This FITS file contains no supported image array')
  await selectFitsHdu(first.index)
}

const rangeOptions = (settings: ScientificDemoRenderSettings): ScientificRange => {
  if (settings.rangeMode === 'explicit') {
    return { mode: 'explicit', min: settings.rangeMin, max: settings.rangeMax }
  }
  if (settings.rangeMode === 'dataset') return { mode: 'dataset' }
  return { mode: 'percentile', low: settings.percentileLow, high: settings.percentileHigh }
}

const measuredRange = async (
  active: MultidimensionalRasterDataset,
  z: number,
  channel: number,
  settings: ScientificDemoRenderSettings,
): Promise<ScientificPlaneMeasurement> => {
  const range = rangeOptions(settings)
  const key = `${generation}:${z}:${channel}:${range.mode}:${range.mode === 'percentile' ? `${range.low}:${range.high}` : range.mode === 'explicit' ? `${range.min}:${range.max}` : ''}`
  const cached = rangeCache.get(key)
  if (cached) return cached
  const measured = await measureScientificPlane(active, { plane: { z, c: channel, t: 0 }, range })
  rangeCache.set(key, measured)
  return measured
}

const rgbaPixels = async (
  width: number,
  height: number,
  blocks: AsyncIterable<PixelBlock>,
): Promise<Uint8ClampedArray<ArrayBuffer>> => {
  const output = new Uint8ClampedArray(width * height * 4)
  for await (const block of blocks) {
    try {
      if (block.format !== 'rgb8')
        throw new Error(`Cannot display ${block.format} scientific pixels`)
      for (let row = 0; row < block.height; row += 1) {
        for (let x = 0; x < block.width; x += 1) {
          const source = row * block.stride + x * 3
          const target = ((block.y + row) * width + block.x + x) * 4
          output[target] = block.data[source] ?? 0
          output[target + 1] = block.data[source + 1] ?? 0
          output[target + 2] = block.data[source + 2] ?? 0
          output[target + 3] = 255
        }
      }
    } finally {
      block.release?.()
    }
  }
  return output
}

const renderChannel = async (
  active: DemoDataset,
  z: number,
  channel: number,
  settings: ScientificDemoRenderSettings,
  palette = settings.palette,
): Promise<{
  readonly pixels: Uint8ClampedArray<ArrayBuffer>
  readonly measurement: ScientificPlaneMeasurement
}> => {
  const measurement = await measuredRange(active, z, channel, settings)
  const image = await renderScientificPlane(active, {
    plane: { z, c: channel, t: 0 },
    range: { mode: 'explicit', min: measurement.range.min, max: measurement.range.max },
    scale: settings.scale,
    palette,
    relief:
      active.format === 'gsf' && settings.relief
        ? {
            azimuth: settings.reliefAzimuth,
            elevation: settings.reliefElevation,
            strength: settings.reliefStrength,
          }
        : false,
  })
  return { pixels: await rgbaPixels(active.sizeX, active.sizeY, image.pixels), measurement }
}

const render = async (sequence: number, settings: ScientificDemoRenderSettings): Promise<void> => {
  const active = dataset
  if (!active) throw new Error('Open a scientific raster before rendering')
  latestSequence = Math.max(latestSequence, sequence)
  const started = performance.now()
  const z = active.format === 'fits' ? settings.z : 0
  let pixels: Uint8ClampedArray<ArrayBuffer>
  let rangeLabel: string
  let selectionLabel: string | undefined
  let nativeRangeLabel: string | undefined
  if (active.format === 'envi' && settings.displayMode === 'composite') {
    const channels = [settings.red, settings.green, settings.blue]
    const rendered = []
    for (const channel of channels)
      rendered.push(await renderChannel(active, 0, channel, settings, 'grayscale'))
    pixels = new Uint8ClampedArray(active.sizeX * active.sizeY * 4)
    for (let index = 0; index < active.sizeX * active.sizeY; index += 1) {
      pixels[index * 4] = rendered[0]?.pixels[index * 4] ?? 0
      pixels[index * 4 + 1] = rendered[1]?.pixels[index * 4] ?? 0
      pixels[index * 4 + 2] = rendered[2]?.pixels[index * 4] ?? 0
      pixels[index * 4 + 3] = 255
    }
    rangeLabel = rendered
      .map(
        ({ measurement }) =>
          `${measurement.range.min.toPrecision(4)}–${measurement.range.max.toPrecision(4)}`,
      )
      .join(' / ')
    const labels = channels.map((channel, index) => {
      const center = active.channels[channel]?.spectral?.center
      return `${'RGB'[index]} band ${channel + 1}${center === undefined ? '' : ` (${center} ${active.channels[channel]?.spectral?.unit ?? ''})`}`
    })
    selectionLabel = labels.join('; ')
  } else {
    const channel = active.format === 'envi' ? settings.channel : 0
    const rendered = await renderChannel(active, z, channel, settings)
    pixels = rendered.pixels
    rangeLabel = `${rendered.measurement.range.min.toPrecision(6)}–${rendered.measurement.range.max.toPrecision(6)}`
    if (settings.rangeMode === 'dataset') nativeRangeLabel = rangeLabel
    if (active.format === 'envi') {
      const spectral = active.channels[channel]?.spectral
      selectionLabel =
        `Band ${channel + 1} of ${active.sizeC}${spectral === undefined ? '' : `, ${spectral.center} ${spectral.unit ?? ''}`}`.trim()
    } else if (active.format === 'fits') {
      selectionLabel = `HDU ${active.hdu.index}, Z plane ${z + 1} of ${active.sizeZ}`
    }
  }
  if (sequence < latestSequence) return
  latestDisplay = {
    width: active.sizeX,
    height: active.sizeY,
    pixels: Uint8ClampedArray.from(pixels),
  }
  const sourceBytesRead =
    active.format === 'envi' || active.format === 'fits' ? active.sourceBytesRead : sourceBytes
  post(
    {
      type: 'rendered',
      sequence,
      width: active.sizeX,
      height: active.sizeY,
      pixels,
      renderMilliseconds: performance.now() - started,
      sourceBytesRead,
      sourceBytesLabel:
        active.format === 'envi'
          ? 'Binary bytes read'
          : active.format === 'fits'
            ? 'FITS bytes read'
            : 'Input size',
      rangeLabel,
      ...(selectionLabel === undefined ? {} : { selectionLabel }),
      ...(nativeRangeLabel === undefined ? {} : { nativeRangeLabel }),
    },
    [pixels.buffer],
  )
}

const downloadPng = async (): Promise<void> => {
  const display = latestDisplay
  if (!display) throw new Error('Render a scientific display before downloading it')
  const sink = new Uint8ArraySink()
  const createEncoder = pngCodec.createEncoder
  if (!createEncoder) throw new Error('PureJsImage PNG encoder is unavailable')
  const encoder = await createEncoder(sink, {
    width: display.width,
    height: display.height,
    pixelFormat: 'rgba8',
    options: {},
    runtime: browserRuntime,
  })
  await encoder.write({
    x: 0,
    y: 0,
    width: display.width,
    height: display.height,
    stride: display.width * 4,
    format: 'rgba8',
    data: new Uint8Array(
      display.pixels.buffer,
      display.pixels.byteOffset,
      display.pixels.byteLength,
    ),
  })
  await encoder.finish()
  const data = Uint8Array.from(sink.toUint8Array())
  post({ type: 'png', data }, [data.buffer])
}

scope.onmessage = (event): void => {
  const request = event.data
  let operation: Promise<void>
  if (request.type === 'open-gsf') operation = openGsfFile(request.name, request.data)
  else if (request.type === 'open-envi')
    operation = openEnviFiles(request.headerName, request.dataName, request.header, request.data)
  else if (request.type === 'open-fits') operation = openFitsFile(request.name, request.data)
  else if (request.type === 'select-fits-hdu') operation = selectFitsHdu(request.index)
  else if (request.type === 'download-png') operation = downloadPng()
  else operation = render(request.sequence, request.settings)
  void operation.catch((cause: unknown) => post({ type: 'error', message: errorMessage(cause) }))
}
