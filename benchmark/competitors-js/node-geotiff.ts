import { BaseClient, BaseResponse, fromCustomClient } from 'geotiff'

import {
  correctnessFromView,
  now,
  type NodeCompetitorAdapter,
  type NodeCompetitorContext,
  type NodeCompetitorExecution,
} from './node-common.ts'

const rangeFromHeaders = (headers: HeadersInit | undefined): readonly [number, number] | null => {
  if (headers === undefined) return null
  let value: string | undefined
  if (headers instanceof Headers) {
    value = headers.get('range') ?? undefined
  } else if (Array.isArray(headers)) {
    value = headers.find(([name]) => name.toLowerCase() === 'range')?.[1]
  } else {
    const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === 'range')
    value = entry?.[1]
  }
  if (value === undefined) return null
  const match = /^bytes=(\d+)-(\d+)$/.exec(value)
  if (match === null) throw new Error(`Unsupported GeoTIFF range header: ${value}`)
  return [Number(match[1]), Number(match[2])]
}

class ArrayBufferResponse extends BaseResponse {
  private readonly bytes: Uint8Array
  private readonly start: number
  private readonly total: number

  public constructor(bytes: Uint8Array, start: number, total: number) {
    super()
    this.bytes = bytes
    this.start = start
    this.total = total
  }

  public override get ok(): boolean {
    return true
  }

  public override get status(): number {
    return 206
  }

  public override getHeader(name: string): string | undefined {
    if (name.toLowerCase() === 'content-length') return String(this.bytes.byteLength)
    if (name.toLowerCase() === 'content-range') {
      return `bytes ${this.start}-${this.start + this.bytes.byteLength - 1}/${this.total}`
    }
    return undefined
  }

  public override async getData(): Promise<ArrayBuffer> {
    return this.bytes.slice().buffer
  }
}

class InstrumentedGeoTiffClient extends BaseClient {
  private readonly context: NodeCompetitorContext

  public constructor(context: NodeCompetitorContext) {
    super('scientific://geotiff')
    this.context = context
  }

  public override async request(options: RequestInit = {}): Promise<BaseResponse> {
    const range = rangeFromHeaders(options.headers)
    if (range === null) {
      const bytes = await this.context.source.readComplete()
      return new ArrayBufferResponse(bytes, 0, bytes.byteLength)
    }
    const [start, end] = range
    const total = this.context.fixture.resources.find(({ id }) => id === 'primary')?.sizeBytes ?? 0
    const bytes = await this.context.source.readRange('primary', start, end - start + 1)
    return new ArrayBufferResponse(bytes, start, total)
  }
}

const selectedWindow = (
  width: number,
  height: number,
): readonly [number, number, number, number] => [0, 0, Math.min(64, width), Math.min(48, height)]

const randomWindows = (
  width: number,
  height: number,
): readonly (readonly [number, number, number, number])[] => {
  const windowWidth = Math.min(64, width)
  const windowHeight = Math.min(48, height)
  return [
    [0, 0, windowWidth, windowHeight],
    [
      Math.max(0, Math.floor((width - windowWidth) / 2)),
      Math.max(0, Math.floor((height - windowHeight) / 2)),
      Math.max(0, Math.floor((width - windowWidth) / 2)) + windowWidth,
      Math.max(0, Math.floor((height - windowHeight) / 2)) + windowHeight,
    ],
    [Math.max(0, width - windowWidth), Math.max(0, height - windowHeight), width, height],
  ]
}

const run = async (context: NodeCompetitorContext): Promise<NodeCompetitorExecution> => {
  const started = now()
  const tiff = await fromCustomClient(new InstrumentedGeoTiffClient(context), {
    allowFullFile: false,
  })
  const openStarted = now()
  const image = await tiff.getImage()
  const openMilliseconds = now() - openStarted
  const width = image.getWidth()
  const height = image.getHeight()
  const details = ['native TIFF samples; no RGB conversion']

  if (context.workload.operation === 'metadata') {
    return {
      stages: {
        moduleImportMilliseconds: 0,
        wasmInitializationMilliseconds: 0,
        inputCopyMilliseconds: 0,
        inputBridgeMilliseconds: 0,
        openMilliseconds,
        hierarchyMilliseconds: 0,
        readMilliseconds: 0,
        outputTransferMilliseconds: 0,
        firstUsableDataMilliseconds: now() - started,
      },
      sourceInstrumentation: 'custom-range-source',
      correctness: {
        shape: [width, height],
        nativeSampleType: null,
        sampleSha256: null,
        sampleCount: null,
        outputBytes: 0,
        details,
      },
      cleanup: async () => undefined,
    }
  }

  if (context.workload.operation === 'full') {
    throw new Error('GeoTIFF full decode is intentionally not claimed by this adapter')
  }

  const windows =
    context.workload.operation === 'random-windows'
      ? randomWindows(width, height)
      : [selectedWindow(width, height)]
  let first: ArrayBufferView | null = null
  const readStarted = now()
  for (const window of windows) {
    const raster = await image.readRasters({ window: [...window], interleave: true })
    if (!ArrayBuffer.isView(raster)) throw new Error('GeoTIFF returned a non-typed raster result')
    first ??= raster
  }
  const readMilliseconds = now() - readStarted
  if (first === null || first.byteLength === 0)
    throw new Error('GeoTIFF returned an empty selected raster')
  const selected = windows[0]
  if (selected === undefined) throw new Error('GeoTIFF selected window was not created')
  return {
    stages: {
      moduleImportMilliseconds: 0,
      wasmInitializationMilliseconds: 0,
      inputCopyMilliseconds: 0,
      inputBridgeMilliseconds: 0,
      openMilliseconds,
      hierarchyMilliseconds: 0,
      readMilliseconds,
      outputTransferMilliseconds: 0,
      firstUsableDataMilliseconds: now() - started,
    },
    sourceInstrumentation: 'custom-range-source',
    correctness: correctnessFromView(first, [selected[2], selected[3]], details),
    cleanup: async () => undefined,
  }
}

export const adapter: NodeCompetitorAdapter = {
  initialize: async () => 0,
  run,
}
