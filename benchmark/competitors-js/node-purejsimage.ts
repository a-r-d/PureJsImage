import { createHash } from 'node:crypto'
import { type RasterBlock, rasterSampleBytes } from '../../src/raster.ts'
import {
  type ScientificCompanionRequest,
  type ScientificReader,
  ScientificReaderRegistry,
  type ScientificResource,
} from '../../src/scientific/reader.ts'
import { aperioSvsReader } from '../../src/scientific/readers/aperio-svs.ts'
import { metaImageReader } from '../../src/scientific/readers/meta-image.ts'
import { createMrcReader } from '../../src/scientific/readers/mrc.ts'
import { niftiReader } from '../../src/scientific/readers/nifti.ts'
import { npyReader } from '../../src/scientific/readers/npy.ts'
import { nrrdReader } from '../../src/scientific/readers/nrrd.ts'
import { tiffReader } from '../../src/scientific/readers/tiff.ts'
import type { ImageSource } from '../../src/source.ts'
import type { PreparedResource } from '../scientific-readers/types.ts'
import {
  type NodeCompetitorAdapter,
  type NodeCompetitorContext,
  type NodeCompetitorExecution,
  now,
  primaryResource,
} from './node-common.ts'

const benchmarkMrcReader = createMrcReader({
  limits: {
    maxInputBytes: 1024 * 1024 * 1024,
    maxDecodedBytes: 1024 * 1024 * 1024,
    maxPixels: 300_000_000,
    maxWidth: 32_768,
    maxHeight: 32_768,
  },
})

class TrackedImageSource implements ImageSource {
  public readonly size: number
  readonly #resource: PreparedResource
  readonly #context: NodeCompetitorContext

  public constructor(resource: PreparedResource, context: NodeCompetitorContext) {
    this.size = resource.sizeBytes
    this.#resource = resource
    this.#context = context
  }

  public read(offset: number, length: number): Promise<Uint8Array> {
    return this.#context.source.readRange(this.#resource.id, offset, length)
  }
}

const readerForFixture = (fixtureId: string): ScientificReader => {
  if (
    fixtureId === 'ordinary-tiff' ||
    fixtureId === 'tiff-bigtiff' ||
    fixtureId === 'tiff-medium' ||
    fixtureId === 'tiff-large'
  )
    return tiffReader
  if (fixtureId === 'aperio-svs') return aperioSvsReader
  if (
    fixtureId === 'nifti' ||
    fixtureId === 'nifti-gzip' ||
    fixtureId === 'nifti-medium' ||
    fixtureId === 'nifti-large'
  )
    return niftiReader
  if (
    fixtureId === 'nrrd-raw' ||
    fixtureId === 'nrrd-gzip' ||
    fixtureId === 'nrrd-medium' ||
    fixtureId === 'nrrd-large'
  )
    return nrrdReader
  if (fixtureId === 'meta-image-mha' || fixtureId === 'meta-image-mhd') return metaImageReader
  if (fixtureId === 'mrc-volume' || fixtureId === 'mrc-medium' || fixtureId === 'mrc-large')
    return benchmarkMrcReader
  if (
    fixtureId === 'npy-c-order' ||
    fixtureId === 'npy-fortran-order' ||
    fixtureId === 'npy-medium' ||
    fixtureId === 'npy-large'
  )
    return npyReader
  throw new Error(`PureJsImage has no benchmark reader mapping for ${fixtureId}`)
}

const resourceSet = (
  context: NodeCompetitorContext,
): {
  readonly primary: ScientificResource
  readonly resolve: (
    request: Readonly<ScientificCompanionRequest>,
  ) => ScientificResource | undefined
} => {
  const resources = context.fixture.resources.map((resource) => ({
    prepared: resource,
    scientific: {
      id: resource.id,
      ...(resource.name === null ? {} : { name: resource.name }),
      source: new TrackedImageSource(resource, context),
    },
  }))
  const primary = primaryResource(context.fixture)
  const primaryEntry = resources.find(({ prepared }) => prepared.id === primary.id)
  if (primaryEntry === undefined) throw new Error(`Fixture ${context.fixture.id} has no primary`)
  return {
    primary: primaryEntry.scientific,
    resolve(request) {
      const requestedName =
        request.kind === 'relative-name' ? request.name : (request.relativeName ?? request.role)
      return resources.find(
        ({ prepared }) =>
          prepared.id === requestedName ||
          prepared.name === requestedName ||
          prepared.name?.endsWith(`/${requestedName}`) === true,
      )?.scientific
    },
  }
}

const appendBlock = (
  hash: ReturnType<typeof createHash>,
  block: RasterBlock,
): { readonly bytes: number; readonly samples: number } => {
  const bytesPerSample = rasterSampleBytes(block.format.sampleType)
  const rowBytes = block.width * bytesPerSample * (block.format.planar ? 1 : block.format.channels)
  let bytes = 0
  for (let channel = 0; channel < (block.format.planar ? block.format.channels : 1); channel += 1) {
    const planeOffset = channel * (block.planeStride ?? block.stride * block.height)
    for (let row = 0; row < block.height; row += 1) {
      const offset = planeOffset + row * block.stride
      const values = block.data.subarray(offset, offset + rowBytes)
      if (values.byteLength !== rowBytes) throw new Error('PureJsImage returned a truncated block')
      hash.update(values)
      bytes += values.byteLength
    }
  }
  return {
    bytes,
    samples: block.width * block.height * block.format.channels,
  }
}

interface PlaneAxis {
  readonly id: string
  readonly length: number
}

const selectedAxes = (axes: readonly PlaneAxis[]): readonly [PlaneAxis, PlaneAxis] => {
  const varying = axes.filter(({ length }) => length > 1)
  const horizontal = varying[0] ?? axes[0]
  const vertical = varying[1] ?? axes[1]
  if (horizontal === undefined || vertical === undefined || horizontal.id === vertical.id) {
    throw new Error('PureJsImage benchmark dataset has fewer than two plane axes')
  }
  return [horizontal, vertical]
}

interface PlaneWindow {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const randomWindows = (width: number, height: number): readonly PlaneWindow[] => {
  const windowWidth = Math.min(64, width)
  const windowHeight = Math.min(48, height)
  return [
    { x: 0, y: 0, width: windowWidth, height: windowHeight },
    {
      x: Math.max(0, Math.floor((width - windowWidth) / 2)),
      y: Math.max(0, Math.floor((height - windowHeight) / 2)),
      width: windowWidth,
      height: windowHeight,
    },
    {
      x: Math.max(0, width - windowWidth),
      y: Math.max(0, height - windowHeight),
      width: windowWidth,
      height: windowHeight,
    },
  ]
}

const run = async (context: NodeCompetitorContext): Promise<NodeCompetitorExecution> => {
  const started = now()
  const reader = readerForFixture(context.fixture.id)
  const resources = resourceSet(context)
  const registry = new ScientificReaderRegistry([reader])
  const openStarted = now()
  const document = await registry.open({
    primary: resources.primary,
    companions: { resolve: async (request) => resources.resolve(request) },
    readerId: reader.descriptor.id,
    readerVersion: reader.descriptor.version,
  })
  const summary = document.datasets[0]
  if (summary === undefined) throw new Error('PureJsImage returned no scientific dataset')
  const dataset = await document.openDataset(summary.id)
  const openMilliseconds = now() - openStarted
  const descriptor = dataset.descriptor
  const descriptorShape = descriptor.axes.map(({ length }) => length)
  const shape =
    context.fixture.id === 'npy-c-order' || context.fixture.id === 'npy-medium'
      ? [...descriptorShape].reverse()
      : descriptorShape
  const details = [
    `reader=${document.reader.id}@${document.reader.version}`,
    `resourceModel=${context.fixture.resources.length === 1 ? 'single' : 'companion-set'}`,
    'native scientific reader; no display conversion',
  ]

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
        shape,
        nativeSampleType: descriptor.sampleType,
        sampleSha256: null,
        sampleCount: null,
        outputBytes: 0,
        details,
      },
      cleanup: async () => document.close?.(),
    }
  }

  const [horizontal, vertical] = selectedAxes(descriptor.axes)
  const fixedIndices = descriptor.axes
    .filter(({ id }) => id !== horizontal.id && id !== vertical.id)
    .map(({ id }) => ({ axisId: id, index: 0 }))
  const selectedWidth = Math.min(64, horizontal.length)
  const selectedHeight = Math.min(48, vertical.length)
  const windows: readonly PlaneWindow[] =
    context.workload.operation === 'random-windows'
      ? randomWindows(horizontal.length, vertical.length)
      : [
          context.workload.operation === 'selected'
            ? { x: 0, y: 0, width: selectedWidth, height: selectedHeight }
            : { x: 0, y: 0, width: horizontal.length, height: vertical.length },
        ]
  const hash = createHash('sha256')
  let outputBytes = 0
  let sampleCount = 0
  let firstUsableDataMilliseconds: number | null = null
  const readStarted = now()
  for (const window of windows) {
    const blocks = dataset.readPlane({
      displayAxes: [horizontal.id, vertical.id],
      fixedIndices,
      ...window,
    })
    for await (const block of blocks) {
      try {
        firstUsableDataMilliseconds ??= now() - started
        const consumed = appendBlock(hash, block)
        outputBytes += consumed.bytes
        sampleCount += consumed.samples
      } finally {
        block.release?.()
      }
    }
  }
  if (firstUsableDataMilliseconds === null || sampleCount === 0) {
    throw new Error('PureJsImage returned no native samples')
  }
  const firstWindow = windows[0]
  if (firstWindow === undefined) throw new Error('PureJsImage created no read window')
  return {
    stages: {
      moduleImportMilliseconds: 0,
      wasmInitializationMilliseconds: 0,
      inputCopyMilliseconds: 0,
      inputBridgeMilliseconds: 0,
      openMilliseconds,
      hierarchyMilliseconds: 0,
      readMilliseconds: now() - readStarted,
      outputTransferMilliseconds: 0,
      firstUsableDataMilliseconds,
    },
    sourceInstrumentation: 'custom-range-source',
    correctness: {
      shape:
        context.workload.operation === 'selected' || context.workload.operation === 'random-windows'
          ? [firstWindow.width, firstWindow.height]
          : shape,
      nativeSampleType: descriptor.sampleType,
      sampleSha256: hash.digest('hex'),
      sampleCount,
      outputBytes,
      details,
    },
    cleanup: async () => document.close?.(),
  }
}

export const adapter: NodeCompetitorAdapter = {
  initialize: async () => 0,
  run,
}
