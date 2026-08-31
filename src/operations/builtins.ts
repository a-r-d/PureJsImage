import { invalidInput } from '../errors.ts'
import type {
  Background,
  BmpEncodeOptions,
  HdrEncodeOptions,
  JpegEncodeOptions,
  JpegXlEncodeOptions,
  NetpbmEncodeOptions,
  PipelineOperation,
  PngEncodeOptions,
  QoiEncodeOptions,
  ResizeFit,
  ResizeKernel,
  ResizePosition,
  TgaEncodeOptions,
  TiffEncodeOptions,
  WebpEncodeOptions,
} from '../pipeline.ts'
import {
  createAvifEncodeOperation,
  createBmpEncodeOperation,
  createCropOperation,
  createHdrEncodeOperation,
  createJpegEncodeOperation,
  createJpegXlEncodeOperation,
  createLutOperation,
  createNetpbmEncodeOperation,
  createPngEncodeOperation,
  createQoiEncodeOperation,
  createResizeOperation,
  createRotateOperation,
  createTgaEncodeOperation,
  createTiffEncodeOperation,
  createWebpEncodeOperation,
  createWindowOperation,
} from '../pipeline.ts'
import type {
  OperationExecutionCharacteristic,
  OperationJsonValue,
  OperationReproducibility,
  OperationValidationLimits,
  OperationValidationResult,
  ParameterSchema,
} from './descriptor.ts'
import { coreValueTypeDescriptors } from './descriptor.ts'
import type { OperationDefinition } from './registry.ts'
import {
  createOperationDefinition,
  createOperationRegistry,
  createValueTypeDefinition,
  createValueTypeRegistry,
} from './registry.ts'

type ParameterRecord = Readonly<Record<string, OperationJsonValue>>

const isParameterRecord = (value: OperationJsonValue): value is ParameterRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const parameterRecord = (value: OperationJsonValue): ParameterRecord => {
  if (!isParameterRecord(value)) {
    throw invalidInput('Built-in operation parameters must be an object')
  }
  return value
}

const numberParameter = (value: ParameterRecord, key: string): number | undefined => {
  const entry = value[key]
  if (entry === undefined) return undefined
  if (typeof entry !== 'number' || !Number.isFinite(entry)) {
    throw invalidInput(`${key} must be a finite number`)
  }
  return entry
}

const stringParameter = (value: ParameterRecord, key: string): string | undefined => {
  const entry = value[key]
  if (entry === undefined) return undefined
  if (typeof entry !== 'string') throw invalidInput(`${key} must be a string`)
  return entry
}

const booleanParameter = (value: ParameterRecord, key: string): boolean | undefined => {
  const entry = value[key]
  if (entry === undefined) return undefined
  if (typeof entry !== 'boolean') throw invalidInput(`${key} must be a boolean`)
  return entry
}

const isBackground = (value: string): value is Background =>
  value === 'transparent' || /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/u.test(value)

const backgroundParameter = (value: ParameterRecord): Background | undefined => {
  const background = stringParameter(value, 'background')
  if (background === undefined) return undefined
  if (!isBackground(background)) {
    throw invalidInput('Background must be transparent, #RRGGBB, or #RRGGBBAA')
  }
  return background
}

const enumParameter = <Value extends string>(
  value: ParameterRecord,
  key: string,
  allowed: readonly Value[],
): Value | undefined => {
  const entry = stringParameter(value, key)
  if (entry === undefined) return undefined
  for (const candidate of allowed) {
    if (entry === candidate) return candidate
  }
  throw invalidInput(`${key} has an unsupported value`)
}

const objectSchema = (
  properties: Readonly<Record<string, ParameterSchema>> = {},
  required: readonly string[] = [],
): ParameterSchema =>
  Object.freeze({
    type: 'object',
    properties: Object.freeze({ ...properties }),
    ...(required.length === 0 ? {} : { required: Object.freeze([...required]) }),
    closed: true,
  })

const imagePort = Object.freeze({
  name: 'image',
  valueType: Object.freeze({ id: 'purejsimage.image', version: 1 }),
})

const outputImagePort = Object.freeze({
  name: 'result',
  valueType: Object.freeze({ id: 'purejsimage.image', version: 1 }),
})

const encodedPort = Object.freeze({
  name: 'encoded',
  valueType: Object.freeze({ id: 'purejsimage.encoded-image', version: 1 }),
})

const builtInDefinition = (options: {
  readonly id: string
  readonly title: string
  readonly category: string
  readonly execution?: OperationExecutionCharacteristic
  readonly reproducibility?: OperationReproducibility
  readonly parameters?: ParameterSchema
  readonly encoded?: boolean
  lower(parameters: OperationJsonValue): PipelineOperation
}): OperationDefinition<PipelineOperation> => {
  const definition = createOperationDefinition<PipelineOperation>({
    descriptor: {
      id: options.id,
      version: 1,
      title: options.title,
      category: options.category,
      tags: [options.category],
      inputs: [imagePort],
      outputs: [options.encoded === true ? encodedPort : outputImagePort],
      parameters: options.parameters ?? objectSchema(),
      execution: options.execution ?? 'tile-local',
      reproducibility: options.reproducibility ?? { class: 'bit-exact' },
      builtIn: true,
    },
    lower: ({ parameters }) => options.lower(parameters),
  })
  return Object.freeze({
    ...definition,
    normalizeParameters(
      input: unknown,
      limits: Readonly<OperationValidationLimits> = {},
    ): OperationValidationResult<OperationJsonValue> {
      const normalized = definition.normalizeParameters(input, limits)
      if (normalized.value === undefined) return normalized
      try {
        options.lower(normalized.value)
        return normalized
      } catch (error) {
        return Object.freeze({
          valid: false,
          issues: Object.freeze([
            Object.freeze({
              code: 'invalid-value' as const,
              path: '',
              message: error instanceof Error ? error.message : 'Built-in operation is invalid',
            }),
          ]),
        })
      }
    },
  })
}

const directDefinition = (
  id: string,
  title: string,
  operation: PipelineOperation,
  execution: OperationExecutionCharacteristic = 'tile-local',
): OperationDefinition<PipelineOperation> =>
  builtInDefinition({
    id,
    title,
    category: execution === 'metadata-only' ? 'metadata' : 'transform',
    execution,
    lower: () => operation,
  })

const positiveInteger = Object.freeze({ type: 'integer', minimum: 1 }) satisfies ParameterSchema
const booleanSchema = Object.freeze({ type: 'boolean' }) satisfies ParameterSchema
const backgroundSchema = Object.freeze({
  type: 'string',
  minLength: 7,
  maxLength: 11,
}) satisfies ParameterSchema

const resizeDefinition = builtInDefinition({
  id: 'purejsimage.transform.resize',
  title: 'Resize',
  category: 'transform',
  execution: 'neighborhood',
  parameters: objectSchema({
    width: positiveInteger,
    height: positiveInteger,
    fit: { type: 'enum', values: ['contain', 'cover', 'fill', 'inside', 'outside'] },
    position: { type: 'enum', values: ['center'] },
    background: backgroundSchema,
    withoutEnlargement: booleanSchema,
    kernel: { type: 'enum', values: ['nearest', 'bilinear', 'lanczos3'] },
  }),
  lower(parameters) {
    const value = parameterRecord(parameters)
    const fit = enumParameter<ResizeFit>(value, 'fit', [
      'contain',
      'cover',
      'fill',
      'inside',
      'outside',
    ])
    const position = enumParameter<ResizePosition>(value, 'position', ['center'])
    const kernel = enumParameter<ResizeKernel>(value, 'kernel', ['nearest', 'bilinear', 'lanczos3'])
    const width = numberParameter(value, 'width')
    const height = numberParameter(value, 'height')
    if (width === undefined && height === undefined) {
      throw invalidInput('Resize requires a width or height')
    }
    const background = backgroundParameter(value)
    const withoutEnlargement = booleanParameter(value, 'withoutEnlargement')
    const common = {
      ...(fit === undefined ? {} : { fit }),
      ...(position === undefined ? {} : { position }),
      ...(kernel === undefined ? {} : { kernel }),
      ...(background === undefined ? {} : { background }),
      ...(withoutEnlargement === undefined ? {} : { withoutEnlargement }),
    }
    return width === undefined
      ? createResizeOperation({ height: height ?? Number.NaN, ...common })
      : createResizeOperation({ width, ...(height === undefined ? {} : { height }), ...common })
  },
})

const encodeDefinition = (
  format: string,
  parameters: ParameterSchema,
  lower: (value: ParameterRecord) => PipelineOperation,
): OperationDefinition<PipelineOperation> =>
  builtInDefinition({
    id: `purejsimage.encode.${format}`,
    title: `Encode ${format.toUpperCase()}`,
    category: 'encode',
    parameters,
    encoded: true,
    execution: 'dataset-transform',
    reproducibility: { class: 'backend-stable' },
    lower: (value) => lower(parameterRecord(value)),
  })

const optionalBackground = (value: ParameterRecord): { readonly background?: Background } => {
  const background = backgroundParameter(value)
  return background === undefined ? {} : { background }
}

const lowerJpeg = (value: ParameterRecord): PipelineOperation => {
  const options: JpegEncodeOptions = {}
  const quality = numberParameter(value, 'quality')
  const progressive = booleanParameter(value, 'progressive')
  const background = backgroundParameter(value)
  const chromaSubsampling = enumParameter(value, 'chromaSubsampling', ['420', '422', '444'])
  const restartInterval = numberParameter(value, 'restartInterval')
  if (quality !== undefined) options.quality = quality
  if (progressive !== undefined) options.progressive = progressive
  if (background !== undefined) options.background = background
  if (chromaSubsampling !== undefined) options.chromaSubsampling = chromaSubsampling
  if (restartInterval !== undefined) options.restartInterval = restartInterval
  return createJpegEncodeOperation(options)
}

const lowerJpegXl = (value: ParameterRecord): PipelineOperation => {
  const options: JpegXlEncodeOptions = {}
  const mode = enumParameter(value, 'mode', ['lossless'])
  const effort = numberParameter(value, 'effort')
  const container = booleanParameter(value, 'container')
  if (mode !== undefined) options.mode = mode
  if (effort === 1) options.effort = effort
  else if (effort !== undefined) throw invalidInput('JPEG XL effort must be 1')
  if (container !== undefined) options.container = container
  return createJpegXlEncodeOperation(options)
}

const lowerPng = (value: ParameterRecord): PipelineOperation => {
  const options: PngEncodeOptions = {}
  const compressionLevel = numberParameter(value, 'compressionLevel')
  if (compressionLevel !== undefined) options.compressionLevel = compressionLevel
  return createPngEncodeOperation(options)
}

const lowerWebp = (value: ParameterRecord): PipelineOperation => {
  const options: WebpEncodeOptions = {}
  const lossless = booleanParameter(value, 'lossless')
  const effort = numberParameter(value, 'effort')
  const nearLossless = numberParameter(value, 'nearLossless')
  const quality = numberParameter(value, 'quality')
  if (lossless !== undefined) options.lossless = lossless
  if (effort !== undefined) options.effort = effort
  if (nearLossless !== undefined) options.nearLossless = nearLossless
  if (quality !== undefined) options.quality = quality
  return createWebpEncodeOperation(options)
}

const lowerBmp = (value: ParameterRecord): PipelineOperation => {
  const options: BmpEncodeOptions = {}
  const alpha = booleanParameter(value, 'alpha')
  if (alpha !== undefined) options.alpha = alpha
  return createBmpEncodeOperation(options)
}

const lowerHdr = (value: ParameterRecord): PipelineOperation => {
  const options: HdrEncodeOptions = {}
  const exposure = numberParameter(value, 'exposure')
  const gamma = numberParameter(value, 'gamma')
  if (exposure !== undefined) options.exposure = exposure
  if (gamma !== undefined) options.gamma = gamma
  return createHdrEncodeOperation(options)
}

const lowerQoi = (value: ParameterRecord): PipelineOperation => {
  const options: QoiEncodeOptions = {}
  if (value.channels === 3 || value.channels === 4) options.channels = value.channels
  const colorspace = enumParameter(value, 'colorspace', ['srgb', 'linear'])
  if (colorspace !== undefined) options.colorspace = colorspace
  return createQoiEncodeOperation(options)
}

const lowerNetpbm = (value: ParameterRecord): PipelineOperation => {
  const options: NetpbmEncodeOptions = {}
  const format = enumParameter(value, 'format', ['pbm', 'pgm', 'ppm', 'pam', 'pfm'])
  const ascii = booleanParameter(value, 'ascii')
  const endian = enumParameter(value, 'endian', ['little', 'big'])
  const scale = numberParameter(value, 'scale')
  if (format !== undefined) options.format = format
  if (ascii !== undefined) options.ascii = ascii
  if (value.bitDepth === 8 || value.bitDepth === 16) options.bitDepth = value.bitDepth
  if (endian !== undefined) options.endian = endian
  if (scale !== undefined) options.scale = scale
  return createNetpbmEncodeOperation(options)
}

const lowerTga = (value: ParameterRecord): PipelineOperation => {
  const options: TgaEncodeOptions = {}
  const alpha = booleanParameter(value, 'alpha')
  const rle = booleanParameter(value, 'rle')
  if (alpha !== undefined) options.alpha = alpha
  if (rle !== undefined) options.rle = rle
  return createTgaEncodeOperation(options)
}

const lowerTiff = (value: ParameterRecord): PipelineOperation => {
  const options: TiffEncodeOptions = {}
  const compression = enumParameter(value, 'compression', ['deflate'])
  const predictor = enumParameter(value, 'predictor', ['horizontal'])
  const layout = enumParameter(value, 'layout', ['strips', 'tiles'])
  const compressionLevel = numberParameter(value, 'compressionLevel')
  const rowsPerStrip = numberParameter(value, 'rowsPerStrip')
  const tileWidth = numberParameter(value, 'tileWidth')
  const tileHeight = numberParameter(value, 'tileHeight')
  const format = enumParameter(value, 'format', ['classic', 'bigtiff', 'auto'])
  if (compression !== undefined) options.compression = compression
  if (predictor !== undefined) options.predictor = predictor
  if (layout !== undefined) options.layout = layout
  if (compressionLevel !== undefined) options.compressionLevel = compressionLevel
  if (rowsPerStrip !== undefined) options.rowsPerStrip = rowsPerStrip
  if (tileWidth !== undefined) options.tileWidth = tileWidth
  if (tileHeight !== undefined) options.tileHeight = tileHeight
  if (format !== undefined) options.format = format
  return createTiffEncodeOperation(options)
}

const pipelineOperationDefinitions: readonly OperationDefinition<PipelineOperation>[] =
  Object.freeze([
    directDefinition(
      'purejsimage.metadata.auto-orient',
      'Auto orient',
      Object.freeze({ type: 'autoOrient' }),
      'dataset-transform',
    ),
    directDefinition(
      'purejsimage.metadata.keep-exif',
      'Keep EXIF',
      Object.freeze({ type: 'keepExif' }),
      'metadata-only',
    ),
    directDefinition(
      'purejsimage.metadata.keep-icc',
      'Keep ICC',
      Object.freeze({ type: 'keepIcc' }),
      'metadata-only',
    ),
    builtInDefinition({
      id: 'purejsimage.transform.crop',
      title: 'Crop',
      category: 'transform',
      execution: 'dataset-transform',
      parameters: objectSchema(
        {
          x: { type: 'integer', minimum: 0 },
          y: { type: 'integer', minimum: 0 },
          width: positiveInteger,
          height: positiveInteger,
        },
        ['x', 'y', 'width', 'height'],
      ),
      lower(parameters) {
        const value = parameterRecord(parameters)
        return createCropOperation({
          x: numberParameter(value, 'x') ?? Number.NaN,
          y: numberParameter(value, 'y') ?? Number.NaN,
          width: numberParameter(value, 'width') ?? Number.NaN,
          height: numberParameter(value, 'height') ?? Number.NaN,
        })
      },
    }),
    resizeDefinition,
    builtInDefinition({
      id: 'purejsimage.transform.window',
      title: 'Window',
      category: 'transform',
      parameters: objectSchema(
        {
          center: { type: 'number', finiteOnly: true },
          width: { type: 'number', minimum: 0, exclusiveMinimum: true, finiteOnly: true },
        },
        ['center', 'width'],
      ),
      lower(parameters) {
        const value = parameterRecord(parameters)
        return createWindowOperation({
          center: numberParameter(value, 'center') ?? Number.NaN,
          width: numberParameter(value, 'width') ?? Number.NaN,
        })
      },
    }),
    builtInDefinition({
      id: 'purejsimage.transform.lut',
      title: 'Lookup table',
      category: 'transform',
      parameters: objectSchema(
        {
          format: { type: 'enum', values: ['gray8', 'rgb8', 'rgba8'] },
          table: {
            type: 'array',
            items: { type: 'integer', minimum: 0, maximum: 255 },
            minItems: 256,
            maxItems: 1_024,
          },
        },
        ['format', 'table'],
      ),
      lower(parameters) {
        const value = parameterRecord(parameters)
        const format = enumParameter(value, 'format', ['gray8', 'rgb8', 'rgba8'])
        const table = value.table
        if (format === undefined || !Array.isArray(table))
          throw invalidInput('LUT parameters are invalid')
        const bytes = new Uint8Array(table.length)
        for (let index = 0; index < table.length; index += 1) {
          const entry = table[index]
          if (typeof entry !== 'number') throw invalidInput('LUT table contains a non-number')
          bytes[index] = entry
        }
        return createLutOperation({ format, table: bytes })
      },
    }),
    builtInDefinition({
      id: 'purejsimage.transform.rotate',
      title: 'Rotate',
      category: 'transform',
      execution: 'neighborhood',
      parameters: objectSchema(
        { degrees: { type: 'number', finiteOnly: true }, background: backgroundSchema },
        ['degrees'],
      ),
      lower(parameters) {
        const value = parameterRecord(parameters)
        return createRotateOperation(
          numberParameter(value, 'degrees') ?? Number.NaN,
          optionalBackground(value),
        )
      },
    }),
    directDefinition(
      'purejsimage.transform.flip',
      'Flip',
      Object.freeze({ type: 'flip' }),
      'dataset-transform',
    ),
    directDefinition(
      'purejsimage.transform.flop',
      'Flop',
      Object.freeze({ type: 'flop' }),
      'dataset-transform',
    ),
    encodeDefinition('avif', objectSchema({ background: backgroundSchema }), (value) =>
      createAvifEncodeOperation(optionalBackground(value)),
    ),
    encodeDefinition(
      'jpeg',
      objectSchema({
        quality: { type: 'integer', minimum: 1, maximum: 100 },
        progressive: booleanSchema,
        background: backgroundSchema,
        chromaSubsampling: { type: 'enum', values: ['420', '422', '444'] },
        restartInterval: { type: 'integer', minimum: 0, maximum: 65_535 },
      }),
      lowerJpeg,
    ),
    encodeDefinition(
      'jpegxl',
      objectSchema({
        mode: { type: 'enum', values: ['lossless'] },
        effort: { type: 'integer', minimum: 1, maximum: 1 },
        container: booleanSchema,
      }),
      lowerJpegXl,
    ),
    encodeDefinition(
      'png',
      objectSchema({ compressionLevel: { type: 'integer', minimum: 0, maximum: 9 } }),
      lowerPng,
    ),
    encodeDefinition(
      'webp',
      objectSchema({
        lossless: booleanSchema,
        effort: { type: 'integer', minimum: 0, maximum: 6 },
        nearLossless: { type: 'integer', minimum: 0, maximum: 100 },
        quality: { type: 'integer', minimum: 1, maximum: 100 },
      }),
      lowerWebp,
    ),
    encodeDefinition('bmp', objectSchema({ alpha: booleanSchema }), lowerBmp),
    encodeDefinition(
      'hdr',
      objectSchema({
        exposure: { type: 'number', minimum: 0, exclusiveMinimum: true },
        gamma: { type: 'number', minimum: 0, exclusiveMinimum: true },
      }),
      lowerHdr,
    ),
    encodeDefinition(
      'qoi',
      objectSchema({
        channels: { type: 'enum', values: [3, 4] },
        colorspace: { type: 'enum', values: ['srgb', 'linear'] },
      }),
      lowerQoi,
    ),
    encodeDefinition(
      'netpbm',
      objectSchema({
        format: { type: 'enum', values: ['pbm', 'pgm', 'ppm', 'pam', 'pfm'] },
        ascii: booleanSchema,
        bitDepth: { type: 'enum', values: [8, 16] },
        endian: { type: 'enum', values: ['little', 'big'] },
        scale: { type: 'number', minimum: 0, exclusiveMinimum: true },
      }),
      lowerNetpbm,
    ),
    encodeDefinition('tga', objectSchema({ alpha: booleanSchema, rle: booleanSchema }), lowerTga),
    encodeDefinition(
      'tiff',
      objectSchema({
        compression: { type: 'enum', values: ['deflate'] },
        predictor: { type: 'enum', values: ['horizontal'] },
        layout: { type: 'enum', values: ['strips', 'tiles'] },
        compressionLevel: { type: 'integer', minimum: 0, maximum: 9 },
        rowsPerStrip: positiveInteger,
        tileWidth: positiveInteger,
        tileHeight: positiveInteger,
        format: { type: 'enum', values: ['classic', 'bigtiff', 'auto'] },
      }),
      lowerTiff,
    ),
  ])

export const builtInOperationDefinitions: readonly OperationDefinition[] =
  pipelineOperationDefinitions

export const builtInOperationDescriptors = Object.freeze(
  builtInOperationDefinitions.map((definition) => definition.descriptor),
)

export const createBuiltInOperationRegistry = () =>
  createOperationRegistry(builtInOperationDefinitions)

export const createCoreValueTypeRegistry = () =>
  createValueTypeRegistry(
    coreValueTypeDescriptors.map((descriptor) => createValueTypeDefinition({ descriptor })),
  )
