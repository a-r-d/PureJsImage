import { browserRuntime } from '../../../src/browser-runtime.ts'
import { pngCodec } from '../../../src/codecs/png.ts'
import type { PixelBlock } from '../../../src/pixel.ts'
import {
  cbfReader,
  createScientificLibrary,
  enviReader,
  fitsReader,
  gsfReader,
  measureScientificPlane,
  mrcReader,
  projectScientificVolume,
  renderEnviClassification,
  renderScientificPlane,
  sliceScientificVolume,
  type LabeledScientificPlaneMeasurement,
  type ScientificAxisDescriptor,
  type ScientificDataset,
  type ScientificDocument,
  type ScientificMetadataObject,
  type ScientificMetadataValue,
  type ScientificRange,
  type ScientificResource,
} from '../../../src/scientific/index.ts'
import { BlobSource, MemorySource } from '../../../src/source.ts'
import { Uint8ArraySink } from '../../../src/sink.ts'
import type {
  ScientificDemoMode,
  ScientificDemoRenderSettings,
  ScientificOpenedMetadata,
  ScientificWorkerRequest,
  ScientificWorkerResponse,
} from './scientific-types.ts'

interface WorkerScope {
  onmessage: ((event: MessageEvent<ScientificWorkerRequest>) => void) | null
  postMessage(message: ScientificWorkerResponse, transfer?: readonly Transferable[]): void
}

const library = createScientificLibrary({
  readers: [gsfReader, enviReader, fitsReader, mrcReader, cbfReader],
})
const scope = globalThis as unknown as WorkerScope
let dataset: ScientificDataset | undefined
let document: ScientificDocument | undefined
let documentName = ''
let sourceBytes = 0
let latestSequence = 0
let generation = 0
let latestDisplay:
  | { readonly width: number; readonly height: number; readonly pixels: Uint8ClampedArray }
  | undefined
const rangeCache = new Map<string, LabeledScientificPlaneMeasurement>()

const post = (message: ScientificWorkerResponse, transfer: readonly Transferable[] = []): void => {
  scope.postMessage(message, transfer)
}

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : 'Unknown scientific raster explorer error'

const inputSize = (input: ArrayBuffer | File): number =>
  input instanceof ArrayBuffer ? input.byteLength : input.size

const inputResource = (id: string, name: string, input: ArrayBuffer | File): ScientificResource =>
  Object.freeze({
    id,
    name,
    source: input instanceof File ? new BlobSource(input) : new MemorySource(input),
  })

const isMetadataObject = (
  value: ScientificMetadataValue | undefined,
): value is ScientificMetadataObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const formatMetadata = (
  active: ScientificDataset,
  key: string,
): ScientificMetadataObject | undefined => {
  const value = active.descriptor.metadata?.[key]
  return isMetadataObject(value) ? value : undefined
}

const metadataNumber = (
  metadata: ScientificMetadataObject | undefined,
  key: string,
): number | undefined => {
  const value = metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const metadataString = (
  metadata: ScientificMetadataObject | undefined,
  key: string,
): string | undefined => {
  const value = metadata?.[key]
  return typeof value === 'string' ? value : undefined
}

const axis = (active: ScientificDataset, id: string): ScientificAxisDescriptor | undefined =>
  active.descriptor.axes.find((candidate) => candidate.id === id)

const horizontalAxis = (active: ScientificDataset): ScientificAxisDescriptor =>
  axis(active, 'x') ??
  active.descriptor.axes[0] ??
  (() => {
    throw new Error('Dataset has no horizontal axis')
  })()

const verticalAxis = (active: ScientificDataset): ScientificAxisDescriptor =>
  axis(active, 'y') ??
  active.descriptor.axes[1] ??
  (() => {
    throw new Error('Dataset has no vertical axis')
  })()

const channelAxis = (active: ScientificDataset): ScientificAxisDescriptor | undefined =>
  active.descriptor.axes.find(
    (candidate) => candidate.kind === 'spectral' || candidate.kind === 'channel',
  )

const volumeAxis = (active: ScientificDataset): ScientificAxisDescriptor | undefined =>
  active.descriptor.axes.find(
    (candidate) =>
      candidate.id !== horizontalAxis(active).id &&
      candidate.id !== verticalAxis(active).id &&
      candidate !== channelAxis(active) &&
      candidate.length > 1,
  )

const fixedIndices = (
  active: ScientificDataset,
  displayAxes: readonly [string, string],
  selections: Readonly<Record<string, number>> = {},
) =>
  Object.freeze(
    active.descriptor.axes
      .filter((candidate) => !displayAxes.includes(candidate.id))
      .map((candidate) =>
        Object.freeze({ axisId: candidate.id, index: selections[candidate.id] ?? 0 }),
      ),
  )

const beginDataset = (opened: ScientificDataset, bytes: number): void => {
  dataset = opened
  sourceBytes = bytes
  generation += 1
  rangeCache.clear()
  latestDisplay = undefined
}

const axisStep = (selected: ScientificAxisDescriptor): number | undefined =>
  selected.coordinates.type === 'linear' ? selected.coordinates.step : undefined

const modeForReader = (readerId: string): ScientificDemoMode =>
  readerId === 'purejsimage/gsf'
    ? 'surface'
    : readerId === 'purejsimage/envi'
      ? 'hyperspectral'
      : readerId === 'purejsimage/fits'
        ? 'fits'
        : readerId === 'purejsimage/mrc'
          ? 'mrc'
          : 'cbf'

const openedMetadata = (
  active: ScientificDataset,
  openedDocument: ScientificDocument,
  name: string,
  bytes: number,
): ScientificOpenedMetadata => {
  const x = horizontalAxis(active)
  const y = verticalAxis(active)
  const channels = channelAxis(active)
  const volume = volumeAxis(active)
  const mode = modeForReader(openedDocument.reader.id)
  const spectralCenters = channels?.entries?.map((entry) => entry.spectral?.center ?? null)
  const actualCenters = spectralCenters?.filter((value): value is number => value !== null) ?? []
  const envi = formatMetadata(active, 'purejsimage:envi')
  const fits = formatMetadata(active, 'purejsimage:fits')
  const mrc = formatMetadata(active, 'purejsimage:mrc')
  const cbf = formatMetadata(active, 'purejsimage:cbf')
  const detector = isMetadataObject(cbf?.detector) ? cbf.detector : undefined
  const pixelSizeX = axisStep(x)
  const pixelSizeY = axisStep(y)
  const enviFileType = metadataString(envi, 'fileType')
  const fitsHdu = metadataNumber(fits, 'index')
  const bitpix = metadataNumber(fits, 'bitpix')
  const byteOrder = metadataString(mrc, 'byteOrder')
  const mrcMode = metadataNumber(mrc, 'mode')
  const detectorName = metadataString(detector, 'detectorName')
  const exposureTimeSeconds = metadataNumber(detector, 'exposureTimeSeconds')
  const wavelengthAngstroms = metadataNumber(detector, 'wavelengthAngstroms')
  return {
    mode,
    name,
    width: x.length,
    height: y.length,
    bands: channels?.length ?? 1,
    sampleType: active.descriptor.sampleType,
    sourceBytes: bytes,
    ...(openedDocument.reader.id !== 'purejsimage/gsf' || channels?.entries?.[0]?.name === undefined
      ? {}
      : { title: channels.entries[0].name }),
    ...(channels?.entries?.[0]?.unit === undefined
      ? active.descriptor.components[0]?.unit === undefined
        ? {}
        : { valueUnit: active.descriptor.components[0].unit }
      : { valueUnit: channels.entries[0].unit }),
    ...(pixelSizeX === undefined
      ? {}
      : { pixelSizeX, physicalWidth: Math.abs(pixelSizeX) * x.length }),
    ...(pixelSizeY === undefined
      ? {}
      : { pixelSizeY, physicalHeight: Math.abs(pixelSizeY) * y.length }),
    ...(x.unit === undefined ? {} : { physicalUnit: x.unit }),
    ...(volume === undefined ? {} : { sizeZ: volume.length }),
    ...(spectralCenters === undefined ? {} : { channelCenters: Object.freeze(spectralCenters) }),
    ...(actualCenters.length === 0
      ? {}
      : { wavelengthMin: Math.min(...actualCenters), wavelengthMax: Math.max(...actualCenters) }),
    ...(channels?.unit === undefined ? {} : { wavelengthUnit: channels.unit }),
    ...(enviFileType === undefined
      ? {}
      : { enviFileType: enviFileType === 'ENVI Classification' ? enviFileType : 'ENVI Standard' }),
    ...(Array.isArray(envi?.classes) ? { classificationClasses: envi.classes.length } : {}),
    ...(fitsHdu === undefined ? {} : { fitsHdu }),
    ...(fits === undefined ? {} : { fitsPrimary: fits.primary === true }),
    ...(bitpix === undefined ? {} : { bitpix }),
    ...(openedDocument.reader.id !== 'purejsimage/fits'
      ? {}
      : {
          fitsHdus: Object.freeze(
            openedDocument.datasets.map((summary) => ({
              index: Number.parseInt(summary.id.replace('hdu-', ''), 10),
              canOpenRaster: true,
              label: summary.name ?? summary.id,
            })),
          ),
        }),
    ...(byteOrder === undefined ? {} : { byteOrder }),
    ...(mrcMode === undefined ? {} : { mrcMode }),
    ...(detectorName === undefined ? {} : { detectorName }),
    ...(exposureTimeSeconds === undefined ? {} : { exposureTimeSeconds }),
    ...(wavelengthAngstroms === undefined ? {} : { wavelengthAngstroms }),
  }
}

const openDocument = async (
  name: string,
  bytes: number,
  primary: ScientificResource,
  readerId: string,
  companions?: readonly ScientificResource[],
): Promise<void> => {
  const companionResolver =
    companions === undefined
      ? undefined
      : Object.freeze({
          async resolve(
            request:
              | { readonly kind: 'relative-name'; readonly name: string }
              | { readonly kind: 'role'; readonly role: string; readonly relativeName?: string },
          ) {
            if (request.kind === 'role')
              return companions.find((resource) => resource.id === request.role)
            return companions.find((resource) => resource.name === request.name)
          },
        })
  const openedDocument = await library.open({
    primary,
    readerId,
    ...(companionResolver === undefined ? {} : { companions: companionResolver }),
  })
  const first = openedDocument.datasets[0]
  if (first === undefined) throw new Error('This document contains no supported scientific raster')
  const opened = await openedDocument.openDataset(first.id)
  await document?.close?.()
  document = openedDocument
  documentName = name
  beginDataset(opened, bytes)
  post({ type: 'opened', metadata: openedMetadata(opened, openedDocument, name, bytes) })
}

const openGsfFile = async (name: string, data: ArrayBuffer | File): Promise<void> => {
  post({ type: 'opening', message: 'Reading GSF metadata…' })
  const bytes = inputSize(data)
  await openDocument(name, bytes, inputResource('primary', name, data), 'purejsimage/gsf')
}

const openEnviFiles = async (
  headerName: string,
  dataName: string,
  header: ArrayBuffer | File,
  data: ArrayBuffer | File,
): Promise<void> => {
  post({ type: 'opening', message: 'Parsing the ENVI header and validating the binary raster…' })
  const headerResource = inputResource('header', headerName, header)
  const dataResource = inputResource('data', dataName, data)
  await openDocument(
    `${headerName} + ${dataName}`,
    inputSize(header) + inputSize(data),
    headerResource,
    'purejsimage/envi',
    [headerResource, dataResource],
  )
}

const selectFitsHdu = async (index: number): Promise<void> => {
  const openedDocument = document
  if (openedDocument?.reader.id !== 'purejsimage/fits') {
    throw new Error('Open a FITS document before selecting an HDU')
  }
  const opened = await openedDocument.openDataset(`hdu-${index}`)
  beginDataset(opened, sourceBytes)
  post({
    type: 'opened',
    metadata: openedMetadata(opened, openedDocument, documentName, sourceBytes),
  })
}

const openFitsFile = async (name: string, data: ArrayBuffer | File): Promise<void> => {
  post({ type: 'opening', message: 'Parsing FITS Header/Data Units…' })
  const bytes = inputSize(data)
  await openDocument(name, bytes, inputResource('primary', name, data), 'purejsimage/fits')
}

const openMrcFile = async (name: string, data: ArrayBuffer | File): Promise<void> => {
  post({ type: 'opening', message: 'Parsing the MRC2014 header and validating the volume…' })
  const bytes = inputSize(data)
  await openDocument(name, bytes, inputResource('primary', name, data), 'purejsimage/mrc')
}

const openCbfFile = async (name: string, data: ArrayBuffer | File): Promise<void> => {
  post({ type: 'opening', message: 'Parsing CBF metadata and validating detector counts…' })
  const bytes = inputSize(data)
  await openDocument(name, bytes, inputResource('primary', name, data), 'purejsimage/cbf')
}

const rangeOptions = (settings: ScientificDemoRenderSettings): ScientificRange => {
  if (settings.rangeMode === 'explicit') {
    return { mode: 'explicit', min: settings.rangeMin, max: settings.rangeMax }
  }
  if (settings.rangeMode === 'dataset') return { mode: 'dataset' }
  return { mode: 'percentile', low: settings.percentileLow, high: settings.percentileHigh }
}

const measuredRange = async (
  active: ScientificDataset,
  displayAxes: readonly [string, string],
  selectedIndices: Readonly<Record<string, number>>,
  settings: ScientificDemoRenderSettings,
  viewKey = '',
): Promise<LabeledScientificPlaneMeasurement> => {
  const range = rangeOptions(settings)
  const key = `${generation}:${viewKey}:${JSON.stringify(selectedIndices)}:${range.mode}:${range.mode === 'percentile' ? `${range.low}:${range.high}` : range.mode === 'explicit' ? `${range.min}:${range.max}` : ''}`
  const cached = rangeCache.get(key)
  if (cached) return cached
  const measured = await measureScientificPlane(active, {
    plane: { displayAxes, fixedIndices: fixedIndices(active, displayAxes, selectedIndices) },
    range,
  })
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
  active: ScientificDataset,
  displayAxes: readonly [string, string],
  selectedIndices: Readonly<Record<string, number>>,
  settings: ScientificDemoRenderSettings,
  palette = settings.palette,
  reliefEnabled = false,
  viewKey = '',
): Promise<{
  readonly pixels: Uint8ClampedArray<ArrayBuffer>
  readonly measurement: LabeledScientificPlaneMeasurement
}> => {
  const measurement = await measuredRange(active, displayAxes, selectedIndices, settings, viewKey)
  const image = await renderScientificPlane(active, {
    plane: { displayAxes, fixedIndices: fixedIndices(active, displayAxes, selectedIndices) },
    range: { mode: 'explicit', min: measurement.range.min, max: measurement.range.max },
    scale: settings.scale,
    palette,
    relief:
      reliefEnabled && settings.relief
        ? {
            azimuth: settings.reliefAzimuth,
            elevation: settings.reliefElevation,
            strength: settings.reliefStrength,
          }
        : false,
  })
  return { pixels: await rgbaPixels(image.width, image.height, image.pixels), measurement }
}

const render = async (sequence: number, settings: ScientificDemoRenderSettings): Promise<void> => {
  const active = dataset
  const openedDocument = document
  if (!active || !openedDocument) throw new Error('Open a scientific raster before rendering')
  latestSequence = Math.max(latestSequence, sequence)
  const started = performance.now()
  const x = horizontalAxis(active)
  const y = verticalAxis(active)
  const channels = channelAxis(active)
  const depth = volumeAxis(active)
  let displayed = active
  let displayAxes: readonly [string, string] = [x.id, y.id]
  let viewKey = ''
  if (depth !== undefined) {
    if (settings.projection === 'none') {
      displayAxes =
        settings.sliceAxis === 'xy'
          ? [x.id, y.id]
          : settings.sliceAxis === 'xz'
            ? [x.id, depth.id]
            : [y.id, depth.id]
      const fixedAxis =
        settings.sliceAxis === 'xy' ? depth.id : settings.sliceAxis === 'xz' ? y.id : x.id
      displayed = sliceScientificVolume(active, {
        displayAxes,
        fixedIndices: fixedIndices(active, displayAxes, { [fixedAxis]: settings.sliceIndex }),
      })
    } else {
      displayed = projectScientificVolume(active, {
        displayAxes: [x.id, y.id],
        axis: depth.id,
        fixedIndices: fixedIndices(active, [x.id, y.id], { [depth.id]: 0 }).filter(
          (entry) => entry.axisId !== depth.id,
        ),
        mode: settings.projection,
      })
      displayAxes = [x.id, y.id]
    }
    viewKey = `${settings.projection}:${settings.sliceAxis}:${settings.sliceIndex}`
  }
  const displayX = horizontalAxis(displayed)
  const displayY = verticalAxis(displayed)
  let displayWidth = displayX.length
  let displayHeight = displayY.length
  const channelId = channelAxis(displayed)?.id
  let pixels: Uint8ClampedArray<ArrayBuffer>
  let rangeLabel: string
  let selectionLabel: string | undefined
  let nativeRangeLabel: string | undefined
  const envi = formatMetadata(active, 'purejsimage:envi')
  if (
    openedDocument.reader.id === 'purejsimage/envi' &&
    metadataString(envi, 'fileType') === 'ENVI Classification'
  ) {
    const image = renderEnviClassification(active, { maxWidth: 1_280, maxHeight: 1_280 })
    displayWidth = image.width
    displayHeight = image.height
    pixels = await rgbaPixels(image.width, image.height, image.pixels)
    rangeLabel = `${Array.isArray(envi?.classes) ? envi.classes.length : 0} declared class colors`
    selectionLabel = `ENVI Classification · ${Array.isArray(envi?.classes) ? envi.classes.length : 0} classes`
  } else if (
    openedDocument.reader.id === 'purejsimage/envi' &&
    settings.displayMode === 'composite'
  ) {
    const selectedChannels = [settings.red, settings.green, settings.blue]
    const rendered = []
    for (const channel of selectedChannels) {
      rendered.push(
        await renderChannel(
          displayed,
          displayAxes,
          channelId === undefined ? {} : { [channelId]: channel },
          settings,
          'grayscale',
        ),
      )
    }
    pixels = new Uint8ClampedArray(displayX.length * displayY.length * 4)
    for (let index = 0; index < displayX.length * displayY.length; index += 1) {
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
    selectionLabel = selectedChannels
      .map((channel, index) => {
        const spectral = channels?.entries?.[channel]?.spectral
        return `${'RGB'[index]} band ${channel + 1}${spectral === undefined ? '' : ` (${spectral.center} ${spectral.unit ?? ''})`}`
      })
      .join('; ')
  } else {
    const channel = openedDocument.reader.id === 'purejsimage/envi' ? settings.channel : 0
    const rendered = await renderChannel(
      displayed,
      displayAxes,
      channelId === undefined ? {} : { [channelId]: channel },
      settings,
      settings.palette,
      openedDocument.reader.id === 'purejsimage/gsf',
      viewKey,
    )
    pixels = rendered.pixels
    rangeLabel = `${rendered.measurement.range.min.toPrecision(6)}–${rendered.measurement.range.max.toPrecision(6)}`
    if (settings.rangeMode === 'dataset') nativeRangeLabel = rangeLabel
    if (openedDocument.reader.id === 'purejsimage/envi') {
      const spectral = channels?.entries?.[channel]?.spectral
      selectionLabel =
        `Band ${channel + 1} of ${channels?.length ?? 1}${spectral === undefined ? '' : `, ${spectral.center} ${spectral.unit ?? ''}`}`.trim()
    } else if (depth !== undefined) {
      const sourceLabel =
        openedDocument.reader.id === 'purejsimage/fits'
          ? `HDU ${metadataNumber(formatMetadata(active, 'purejsimage:fits'), 'index') ?? 0}, `
          : ''
      selectionLabel =
        settings.projection === 'none'
          ? `${sourceLabel}${settings.sliceAxis.toUpperCase()} slice ${settings.sliceIndex + 1}`
          : `${sourceLabel}${settings.projection} projection through ${depth.name ?? depth.id}`
    }
  }
  if (sequence < latestSequence) return
  latestDisplay = {
    width: displayWidth,
    height: displayHeight,
    pixels: Uint8ClampedArray.from(pixels),
  }
  post(
    {
      type: 'rendered',
      sequence,
      width: displayWidth,
      height: displayHeight,
      pixels,
      renderMilliseconds: performance.now() - started,
      sourceBytesRead: sourceBytes,
      sourceBytesLabel: 'Source size',
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
  else if (request.type === 'open-envi') {
    operation = openEnviFiles(request.headerName, request.dataName, request.header, request.data)
  } else if (request.type === 'open-fits') operation = openFitsFile(request.name, request.data)
  else if (request.type === 'open-mrc') operation = openMrcFile(request.name, request.data)
  else if (request.type === 'open-cbf') operation = openCbfFile(request.name, request.data)
  else if (request.type === 'select-fits-hdu') operation = selectFitsHdu(request.index)
  else if (request.type === 'download-png') operation = downloadPng()
  else operation = render(request.sequence, request.settings)
  void operation.catch((cause: unknown) => post({ type: 'error', message: errorMessage(cause) }))
}
