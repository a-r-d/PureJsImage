import type { PixelBlock } from '../../../src/pixel.ts'
import {
  openEnvi,
  openGsf,
  renderScientificPlane,
  renderSpectralBand,
  renderSpectralComposite,
  type EnviDataset,
  type GsfDataset,
  type MultidimensionalRasterDataset,
  type ScientificRange,
} from '../../../src/scientific/index.ts'
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

const scope = globalThis as unknown as WorkerScope
let dataset: GsfDataset | EnviDataset | undefined
let sourceBytes = 0
let latestSequence = 0

const post = (message: ScientificWorkerResponse, transfer: readonly Transferable[] = []): void => {
  scope.postMessage(message, transfer)
}

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : 'Unknown scientific raster explorer error'

const dataRange = async (
  opened: MultidimensionalRasterDataset,
  channel: number,
): Promise<{ readonly min: number; readonly max: number }> => {
  const scanned = await renderScientificPlane(opened, {
    plane: { z: 0, c: channel, t: 0 },
    range: { mode: 'dataset' },
  })
  return scanned.range
}

const gsfMetadata = async (
  opened: GsfDataset,
  name: string,
  bytes: number,
): Promise<ScientificOpenedMetadata> => {
  const range = await dataRange(opened, 0)
  const pixelX = opened.physicalSizeX
  const pixelY = opened.physicalSizeY
  return {
    mode: 'surface',
    name,
    width: opened.sizeX,
    height: opened.sizeY,
    bands: 1,
    sampleType: opened.sampleType,
    dataMin: range.min,
    dataMax: range.max,
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

const enviMetadata = async (
  opened: EnviDataset,
  name: string,
  bytes: number,
): Promise<ScientificOpenedMetadata> => {
  const spectral = opened.channels.flatMap((channel) =>
    channel.spectral === undefined ? [] : [channel.spectral],
  )
  const initialChannel = Math.floor(opened.sizeC / 2)
  const range = await dataRange(opened, initialChannel)
  return {
    mode: 'hyperspectral',
    name,
    width: opened.sizeX,
    height: opened.sizeY,
    bands: opened.sizeC,
    sampleType: opened.sampleType,
    dataMin: range.min,
    dataMax: range.max,
    sourceBytes: bytes,
    ...(spectral[0] === undefined
      ? {}
      : {
          wavelengthMin: Math.min(...spectral.map(({ center }) => center)),
          wavelengthMax: Math.max(...spectral.map(({ center }) => center)),
        }),
    ...(spectral[0]?.unit === undefined ? {} : { wavelengthUnit: spectral[0].unit }),
  }
}

const openGsfFile = async (name: string, data: ArrayBuffer): Promise<void> => {
  post({ type: 'opening', message: 'Reading native float32 GSF metadata and samples…' })
  const opened = await openGsf(data, { maxInputBytes: Math.max(data.byteLength, 1) })
  dataset = opened
  sourceBytes = data.byteLength
  post({ type: 'opened', metadata: await gsfMetadata(opened, name, data.byteLength) })
}

const openEnviFiles = async (
  headerName: string,
  dataName: string,
  header: ArrayBuffer,
  data: ArrayBuffer,
): Promise<void> => {
  post({
    type: 'opening',
    message: 'Parsing the ENVI header and validating the paired binary raster…',
  })
  const opened = await openEnvi({
    header,
    data,
    maxInputBytes: Math.max(header.byteLength, data.byteLength, 1),
  })
  dataset = opened
  sourceBytes = header.byteLength + data.byteLength
  post({
    type: 'opened',
    metadata: await enviMetadata(opened, `${headerName} + ${dataName}`, sourceBytes),
  })
}

const rangeOptions = (settings: ScientificDemoRenderSettings): ScientificRange => {
  if (settings.rangeMode === 'explicit') {
    return { mode: 'explicit', min: settings.rangeMin, max: settings.rangeMax }
  }
  if (settings.rangeMode === 'dataset') return { mode: 'dataset' }
  return {
    mode: 'percentile',
    low: settings.percentileLow,
    high: settings.percentileHigh,
  }
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

const render = async (sequence: number, settings: ScientificDemoRenderSettings): Promise<void> => {
  const active = dataset
  if (!active) throw new Error('Open a scientific raster before rendering')
  latestSequence = Math.max(latestSequence, sequence)
  const started = performance.now()
  const range = rangeOptions(settings)
  let blocks: AsyncIterable<PixelBlock>
  let rangeLabel: string
  let selectionLabel: string | undefined
  if (active.format === 'envi' && settings.displayMode === 'composite') {
    const composite = await renderSpectralComposite(active, {
      red: settings.red,
      green: settings.green,
      blue: settings.blue,
      range,
      scale: settings.scale,
    })
    blocks = composite.pixels
    rangeLabel = composite.ranges
      .map(({ min, max }) => `${min.toPrecision(4)}–${max.toPrecision(4)}`)
      .join(' / ')
    selectionLabel =
      `R ${composite.red.requested} → ${composite.red.selected}; G ${composite.green.requested} → ${composite.green.selected}; B ${composite.blue.requested} → ${composite.blue.selected} ${composite.red.unit ?? ''}`.trim()
  } else if (active.format === 'envi') {
    const band = await renderSpectralBand(active, {
      wavelength: settings.wavelength,
      range,
      scale: settings.scale,
      palette: settings.palette,
    })
    blocks = band.image.pixels
    rangeLabel = `${band.image.range.min.toPrecision(6)}–${band.image.range.max.toPrecision(6)}`
    selectionLabel =
      `Requested ${band.selection.requested} ${band.selection.unit ?? ''} → channel ${band.selection.channel + 1} at ${band.selection.selected} ${band.selection.unit ?? ''}`.trim()
  } else {
    const image = await renderScientificPlane(active, {
      plane: { z: 0, c: 0, t: 0 },
      range,
      scale: settings.scale,
      palette: settings.palette,
      relief: settings.relief
        ? {
            azimuth: settings.reliefAzimuth,
            elevation: settings.reliefElevation,
            strength: settings.reliefStrength,
          }
        : false,
    })
    blocks = image.pixels
    rangeLabel = `${image.range.min.toExponential(5)}–${image.range.max.toExponential(5)}`
  }
  const pixels = await rgbaPixels(active.sizeX, active.sizeY, blocks)
  if (sequence < latestSequence) return
  const sourceBytesRead = active.format === 'envi' ? active.sourceBytesRead : sourceBytes
  post(
    {
      type: 'rendered',
      sequence,
      width: active.sizeX,
      height: active.sizeY,
      pixels,
      renderMilliseconds: performance.now() - started,
      sourceBytesRead,
      sourceBytesLabel: active.format === 'envi' ? 'Binary bytes read' : 'Input size',
      rangeLabel,
      ...(selectionLabel === undefined ? {} : { selectionLabel }),
    },
    [pixels.buffer],
  )
}

scope.onmessage = (event): void => {
  const request = event.data
  const operation =
    request.type === 'open-gsf'
      ? openGsfFile(request.name, request.data)
      : request.type === 'open-envi'
        ? openEnviFiles(request.headerName, request.dataName, request.header, request.data)
        : render(request.sequence, request.settings)
  void operation.catch((cause: unknown) => post({ type: 'error', message: errorMessage(cause) }))
}
