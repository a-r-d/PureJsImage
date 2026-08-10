import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import packageJson from '../../package.json' with { type: 'json' }
import type {
  Engine,
  EngineExecution,
  EngineKind,
  ImageMetadata,
  PipelineWorkflow,
} from '../types.ts'

type RawOperation = Extract<PipelineWorkflow['operations'][number], { type: 'raw' }>

interface PureImage {
  metadata(): Promise<ImageMetadata>
  autoOrient(): PureImage
  rotate(degrees: number): PureImage
  flip(): PureImage
  flop(): PureImage
  crop(options: { x: number; y: number; width: number; height: number }): PureImage
  resize(options: {
    width?: number
    height?: number
    fit?: 'contain'
    position?: 'center'
    background?: string
    withoutEnlargement?: boolean
  }): PureImage
  encode(
    format: 'bmp' | 'jpeg' | 'png' | 'tiff' | 'webp',
    options: {
      quality?: number
      compressionLevel?: number
      lossless?: boolean
      background?: string
    },
  ): { toBuffer(): Promise<Uint8Array> }
}

interface PureImageLibrary {
  open(input: Uint8Array, options?: { readonly tolerantDecoding?: boolean }): Promise<PureImage>
}

interface PureImageLibraryConfiguration {
  readonly codecs: readonly unknown[]
  readonly accelerators: readonly PureImageAccelerator[]
}

interface PureImageAccelerator {
  readonly format: string
  readonly id: string
  readonly kind: string
  accelerate(reference: unknown): unknown
}

interface PureImageModule {
  createImageLibrary(
    registration: readonly unknown[] | PureImageLibraryConfiguration,
  ): PureImageLibrary
}

interface NamedImport {
  readonly path: string
  readonly exportName: string
}

export interface PureJsImageEngineOptions {
  readonly id: string
  readonly kind: EngineKind
  readonly versionSuffix: string
  readonly codecs?: readonly NamedImport[]
  readonly accelerators?: readonly NamedImport[]
}
interface DirectPixelBlock {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly stride: number
  readonly format: string
  readonly data: Uint8Array
  readonly release?: () => void
}

interface DirectDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat: string
  decode(request?: {
    readonly x?: number
    readonly y?: number
    readonly width?: number
    readonly height?: number
  }): AsyncIterable<DirectPixelBlock>
}

interface DirectCodec {
  createDecoder(
    source: {
      readonly size: number
      read(offset: number, length: number): Promise<Uint8Array>
    },
    limits: Readonly<Record<string, number>>,
  ): Promise<DirectDecoder>
}
const isDirectCodec = (value: unknown): value is DirectCodec =>
  typeof value === 'object' &&
  value !== null &&
  'createDecoder' in value &&
  typeof value.createDecoder === 'function'

const isDirectLimits = (value: unknown): value is Readonly<Record<string, number>> =>
  typeof value === 'object' &&
  value !== null &&
  Object.values(value).every((limit) => typeof limit === 'number')

const bytesPerPixel = (format: string): number => {
  if (format === 'gray8') return 1
  if (format === 'gray16') return 2
  if (format === 'rgb8') return 3
  if (format === 'rgba8') return 4
  if (format === 'rgb16') return 6
  if (format === 'rgba16') return 8
  throw new Error(`Raw TIFF benchmark does not support ${format} pixels`)
}

const rawTiffDecode = async (
  input: Buffer,
  operation: RawOperation,
  format: string,
): Promise<EngineExecution> => {
  const entryUrl = pathToFileURL(entry)
  const [codecModule, limitsModule]: unknown[] = await Promise.all([
    import(new URL('./codec-entries/tiff.js', entryUrl).href),
    import(new URL('./limits.js', entryUrl).href),
  ])
  const codec =
    typeof codecModule === 'object' && codecModule !== null
      ? Reflect.get(codecModule, 'tiffCodec')
      : undefined
  const limits =
    typeof limitsModule === 'object' && limitsModule !== null
      ? Reflect.get(limitsModule, 'defaultImageLimits')
      : undefined
  if (!isDirectCodec(codec) || !isDirectLimits(limits)) {
    throw new Error(`${entry} does not expose the direct TIFF decoder`)
  }

  let sourceBytesRead = 0
  const source = {
    size: input.byteLength,
    async read(offset: number, length: number): Promise<Uint8Array> {
      const end = Math.min(input.byteLength, offset + length)
      const bytes = input.subarray(offset, end)
      sourceBytesRead += bytes.byteLength
      return bytes
    },
  }
  const decoder = await codec.createDecoder(source, limits)
  const width = operation.width ?? decoder.width - (operation.x ?? 0)
  const height = operation.height ?? decoder.height - (operation.y ?? 0)
  const digest = createHash('sha256')
  const pixelBytes = bytesPerPixel(decoder.pixelFormat)
  const rowBytes = width * pixelBytes
  let decodedBytes = 0
  let maximumDecodedBlockBytes = 0
  let expectedY = 0
  for await (const block of decoder.decode({
    ...(operation.x === undefined ? {} : { x: operation.x }),
    ...(operation.y === undefined ? {} : { y: operation.y }),
    ...(operation.width === undefined ? {} : { width: operation.width }),
    ...(operation.height === undefined ? {} : { height: operation.height }),
  })) {
    if (
      block.x !== 0 ||
      block.y !== expectedY ||
      block.width !== width ||
      block.stride < rowBytes ||
      block.format !== decoder.pixelFormat
    ) {
      block.release?.()
      throw new Error('Direct TIFF decoder returned invalid raw block geometry')
    }
    maximumDecodedBlockBytes = Math.max(maximumDecodedBlockBytes, block.data.byteLength)
    for (let row = 0; row < block.height; row += 1) {
      const start = row * block.stride
      digest.update(block.data.subarray(start, start + rowBytes))
      decodedBytes += rowBytes
    }
    expectedY += block.height
    block.release?.()
  }
  if (expectedY !== height) {
    throw new Error(`Direct TIFF decoder returned ${expectedY} of ${height} rows`)
  }
  return {
    decoded: {
      format,
      width,
      height,
      pixelFormat: decoder.pixelFormat,
      bytes: decodedBytes,
      sha256: digest.digest('hex'),
    },
    sourceBytesRead,
    maximumDecodedBlockBytes,
  }
}

const entry = process.env.PUREJSIMAGE_ENTRY ?? './dist/index.js'

const isImageModule = (value: unknown): value is PureImageModule =>
  typeof value === 'object' &&
  value !== null &&
  'createImageLibrary' in value &&
  typeof value.createImageLibrary === 'function'

const isAccelerator = (value: unknown): value is PureImageAccelerator =>
  typeof value === 'object' &&
  value !== null &&
  'format' in value &&
  typeof value.format === 'string' &&
  'id' in value &&
  typeof value.id === 'string' &&
  'kind' in value &&
  typeof value.kind === 'string' &&
  'accelerate' in value &&
  typeof value.accelerate === 'function'

const isImageCodec = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  'format' in value &&
  typeof value.format === 'string'

const loadImageLibrary = async (
  codecImports: readonly NamedImport[],
  acceleratorImports: readonly NamedImport[],
): Promise<PureImageLibrary> => {
  const entryUrl = pathToFileURL(entry)
  const namedImports = [...codecImports, ...acceleratorImports]
  const [module, codecModule, ...namedModules]: unknown[] = await Promise.all([
    import(entryUrl.href),
    import(new URL('./codec-entries/all.js', entryUrl).href),
    ...namedImports.map(({ path }) => import(new URL(path, entryUrl).href)),
  ])
  if (!isImageModule(module)) {
    throw new Error(`${entry} does not export createImageLibrary`)
  }
  if (
    typeof codecModule !== 'object' ||
    codecModule === null ||
    !('allCodecs' in codecModule) ||
    !Array.isArray(codecModule.allCodecs)
  ) {
    throw new Error(`${entry} has no valid all-codec entry point`)
  }
  const additionalCodecs = codecImports.map(({ exportName }, index) => {
    const codecModule = namedModules[index]
    const codec =
      typeof codecModule === 'object' && codecModule !== null
        ? Reflect.get(codecModule, exportName)
        : undefined
    if (!isImageCodec(codec)) {
      throw new Error(`${entry} has no valid ${exportName} codec export`)
    }
    return codec
  })
  const codecs = [...codecModule.allCodecs, ...additionalCodecs]
  if (acceleratorImports.length === 0) return module.createImageLibrary(codecs)

  const acceleratorModules = namedModules.slice(codecImports.length)
  const accelerators = acceleratorImports.map(({ exportName }, index) => {
    const acceleratorModule = acceleratorModules[index]
    const accelerator =
      typeof acceleratorModule === 'object' && acceleratorModule !== null
        ? Reflect.get(acceleratorModule, exportName)
        : undefined
    if (!isAccelerator(accelerator)) {
      throw new Error(`${entry} has no valid ${exportName} accelerator export`)
    }
    return accelerator
  })
  return module.createImageLibrary({ codecs, accelerators })
}

const applyOperations = async ({
  Image,
  workflow,
  input,
}: {
  Image: PureImageLibrary
  workflow: PipelineWorkflow
  input: Buffer
}): Promise<EngineExecution> => {
  const rawOperation = workflow.operations.find(
    (operation): operation is RawOperation => operation.type === 'raw',
  )
  if (rawOperation) {
    if (workflow.operations.length !== 1) {
      throw new Error('Raw TIFF benchmark operation must be the only pipeline operation')
    }
    return rawTiffDecode(input, rawOperation, workflow.expected.format)
  }

  let image = await Image.open(input)
  let output: Uint8Array | undefined

  for (const operation of workflow.operations) {
    switch (operation.type) {
      case 'metadata':
        return { metadata: await image.metadata() }
      case 'autoOrient':
        image = image.autoOrient()
        break
      case 'rotate':
        image = image.rotate(operation.degrees)
        break
      case 'flip':
        image = image.flip()
        break
      case 'flop':
        image = image.flop()
        break
      case 'crop':
        image = image.crop({
          x: operation.x,
          y: operation.y,
          width: operation.width,
          height: operation.height,
        })
        break
      case 'resize':
        image = image.resize({
          ...(operation.width !== undefined ? { width: operation.width } : {}),
          ...(operation.height !== undefined ? { height: operation.height } : {}),
          ...(operation.withoutEnlargement ? { withoutEnlargement: true } : {}),
        })
        break
      case 'contain':
        image = image.resize({
          width: operation.width,
          height: operation.height,
          fit: 'contain',
          ...(operation.position ? { position: operation.position } : {}),
          background: operation.background,
        })
        break
      case 'encode':
        output = await image
          .encode(operation.format, {
            ...(operation.quality ? { quality: operation.quality } : {}),
            ...(operation.compressionLevel !== undefined
              ? { compressionLevel: operation.compressionLevel }
              : {}),
            ...(operation.lossless !== undefined ? { lossless: operation.lossless } : {}),
            ...(operation.background ? { background: operation.background } : {}),
          })
          .toBuffer()
        break
      default:
        throw new Error('Unsupported operation')
    }
  }

  return output ? { output } : {}
}

export const createPureJsImageEngine = async (
  options: PureJsImageEngineOptions,
): Promise<Engine> => {
  const Image = await loadImageLibrary(options.codecs ?? [], options.accelerators ?? [])
  const hasExperimentalHeic = options.codecs?.some(
    ({ exportName }) => exportName === 'experimentalHeifCodec',
  )
  return {
    id: options.id,
    version: `${packageJson.version} (workspace${options.versionSuffix})`,
    kind: options.kind,
    packageName: 'purejsimage',
    unsupportedReason: (workflow): string | undefined =>
      workflow.id === 'heif-iphone-resize-jpeg' && !hasExperimentalHeic
        ? 'The default PureJsImage codecs do not include experimental HEIF/HEIC'
        : undefined,
    execute: async ({ workflow, inputs }): Promise<EngineExecution> => {
      if (!workflow.batch) {
        const input = inputs[0]
        if (!input) throw new Error('Pipeline workflow has no input image')
        return applyOperations({ Image, workflow, input })
      }

      let output: Uint8Array | undefined
      let outputBytes = 0
      for (let index = 0; index < workflow.batch.count; index += 1) {
        const input = inputs[index % inputs.length]
        if (!input) throw new Error('Batch workflow has no input images')
        const image = await Image.open(input)
        output = await image
          .resize({ width: workflow.batch.width })
          .encode('jpeg', { quality: workflow.batch.quality })
          .toBuffer()
        outputBytes += output.byteLength
      }
      if (!output) throw new Error('Batch workflow produced no output')
      return { output, outputBytes, outputCount: workflow.batch.count }
    },
  }
}
