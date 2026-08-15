import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded, truncatedInput, unsupportedOperation } from '../../errors.ts'
import type { RasterBlock } from '../../raster.ts'
import { readExactly, type ImageSource } from '../../source.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificDataset,
  ScientificMetadataObject,
  ScientificPlaneReadRequest,
  ScientificSeriesBlock,
  ScientificSeriesReadRequest,
} from '../dataset.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificMetadataObject,
  normalizeScientificPlaneReadRequest,
  normalizeScientificSeriesReadRequest,
} from '../dataset.ts'
import type {
  ScientificDocument,
  ScientificOpenContext,
  ScientificReader,
  ScientificReaderDescriptor,
} from '../reader.ts'
import { createScientificDatasetIdentity, identifyScientificDataset } from '../reader.ts'
import { resourceHasHint } from './shared.ts'

const fixedHeaderBytes = 512
const compressedSignature = 'DSCOMPRESSED'
const uncompressedSignature = 'DIGITAL SURF'

export interface DigitalSurfReaderLimits {
  readonly maxObjects?: number
  readonly maxCommentBytes?: number
  readonly maxPrivateBytes?: number
  readonly maxDecodedBytes?: number
  readonly maxCompressionStreams?: number
  readonly rowsPerBlock?: number
}

interface SurfaceObject {
  readonly index: number
  readonly objectType: number
  readonly objectName: string
  readonly operatorName: string
  readonly width: number
  readonly height: number
  readonly totalPoints: number
  readonly layers: number
  readonly pointBits: 16 | 32
  readonly zMin: number
  readonly specialPoints: boolean
  readonly xSpacing: number
  readonly ySpacing: number
  readonly zSpacing: number
  readonly xName: string
  readonly yName: string
  readonly zName: string
  readonly xUnit: string
  readonly yUnit: string
  readonly zUnit: string
  readonly zUnitRatio: number
  readonly xOffset: number
  readonly yOffset: number
  readonly zOffset: number
  readonly comment: string
  readonly raw: Uint8Array<ArrayBuffer>
  readonly numberOfObjects: number
  readonly channelsPerObject: number
}

const positiveInteger = (label: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) throw invalidInput(`${label} must be positive`)
  return value
}

class Cursor {
  readonly bytes: Uint8Array
  readonly view: DataView
  offset = 0
  constructor(bytes: Uint8Array) {
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  take(length: number): Uint8Array {
    if (this.offset + length > this.bytes.byteLength)
      throw truncatedInput('Digital Surf header is truncated')
    const value = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return value
  }
  i16(): number {
    const value = this.view.getInt16(this.offset, true)
    this.offset += 2
    return value
  }
  u16(): number {
    const value = this.view.getUint16(this.offset, true)
    this.offset += 2
    return value
  }
  i32(): number {
    const value = this.view.getInt32(this.offset, true)
    this.offset += 4
    return value
  }
  u32(): number {
    const value = this.view.getUint32(this.offset, true)
    this.offset += 4
    return value
  }
  f32(): number {
    const value = this.view.getFloat32(this.offset, true)
    this.offset += 4
    return value
  }
}

const text = (bytes: Uint8Array): string =>
  new TextDecoder('windows-1252').decode(bytes).replace(/[\0 \t\r\n]+$/gu, '')

const inflate = async (
  bytes: Uint8Array,
  expected: number,
  maximum: number,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> => {
  throwIfAborted(signal)
  if (typeof DecompressionStream !== 'function')
    throw unsupportedOperation('Compressed Digital Surf data requires DecompressionStream')
  const reader = new Blob([Uint8Array.from(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'))
    .getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    if (signal?.aborted === true) {
      await reader.cancel(signal.reason)
      throwIfAborted(signal)
    }
    const result = await reader.read()
    if (result.done) break
    total += result.value.byteLength
    if (total > maximum || total > expected) {
      await reader.cancel()
      throw limitExceeded('Digital Surf decompressed data exceeds its declared bounded size')
    }
    chunks.push(result.value)
  }
  if (total !== expected)
    throw invalidInput('Digital Surf compressed stream decoded to an unexpected size')
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

interface ParsedFixedHeader {
  readonly signature: string
  readonly numberOfObjects: number
  readonly objectType: number
  readonly objectName: string
  readonly operatorName: string
  readonly channelsPerObject: number
  readonly wSize: number
  readonly pointBits: 16 | 32
  readonly zMin: number
  readonly width: number
  readonly height: number
  readonly totalPoints: number
  readonly xSpacing: number
  readonly ySpacing: number
  readonly zSpacing: number
  readonly xName: string
  readonly yName: string
  readonly zName: string
  readonly xUnit: string
  readonly yUnit: string
  readonly zUnit: string
  readonly zUnitRatio: number
  readonly specialPoints: boolean
  readonly compressedSize: number
  readonly commentSize: number
  readonly privateSize: number
  readonly xOffset: number
  readonly yOffset: number
  readonly zOffset: number
}

const parseFixedHeader = (bytes: Uint8Array): ParsedFixedHeader => {
  const cursor = new Cursor(bytes)
  const signatureValue = text(cursor.take(12))
  if (signatureValue !== compressedSignature && signatureValue !== uncompressedSignature)
    throw invalidInput('Digital Surf signature is missing')
  cursor.i16() // format
  const numberOfObjects = cursor.u16()
  const version = cursor.i16()
  if (version < 1) throw unsupportedOperation(`Digital Surf version ${version} is unsupported`)
  const objectType = cursor.i16()
  const objectName = text(cursor.take(30))
  const operatorName = text(cursor.take(30))
  const channelsPerObject = cursor.i16()
  cursor.i16() // acquisition
  cursor.i16() // range
  const specialPoints = cursor.i16() === 1
  cursor.i16() // absolute
  cursor.f32() // gauge
  const wSize = cursor.u32()
  const pointBitsValue = cursor.i16()
  if (pointBitsValue !== 16 && pointBitsValue !== 32)
    throw unsupportedOperation(`Digital Surf ${pointBitsValue}-bit points are unsupported`)
  const zMin = cursor.i32()
  cursor.i32() // z max
  const width = cursor.i32()
  const height = cursor.i32()
  const totalPoints = cursor.i32()
  const xSpacing = cursor.f32()
  const ySpacing = cursor.f32()
  const zSpacing = cursor.f32()
  const xName = text(cursor.take(16))
  const yName = text(cursor.take(16))
  const zName = text(cursor.take(16))
  const xUnit = text(cursor.take(16))
  const yUnit = text(cursor.take(16))
  const zUnit = text(cursor.take(16))
  cursor.take(16 * 3) // length units
  cursor.f32() // x ratio
  cursor.f32() // y ratio
  const zUnitRatio = cursor.f32()
  cursor.i16()
  cursor.i16()
  cursor.i16()
  cursor.take(12)
  for (let index = 0; index < 7; index += 1) cursor.i16()
  cursor.f32()
  const compressedSize = cursor.u32()
  cursor.take(6)
  const commentSize = cursor.i16()
  const privateSize = cursor.i16()
  cursor.take(128)
  const xOffset = cursor.f32()
  const yOffset = cursor.f32()
  const zOffset = cursor.f32()
  cursor.f32()
  cursor.f32()
  cursor.take(13)
  cursor.take(13)
  if (cursor.offset !== fixedHeaderBytes)
    throw new Error(`Digital Surf fixed-header parser consumed ${cursor.offset} bytes`)
  if (numberOfObjects < 0 || channelsPerObject < 0 || width < 1 || height < 1 || totalPoints < 1)
    throw invalidInput('Digital Surf dimensions and object counts must be positive')
  if (commentSize < 0 || privateSize < 0)
    throw unsupportedOperation('Digital Surf extended variable sections are unsupported')
  if (
    !Number.isFinite(xSpacing) ||
    !Number.isFinite(ySpacing) ||
    !Number.isFinite(zSpacing) ||
    !Number.isFinite(zUnitRatio) ||
    zUnitRatio === 0
  )
    throw invalidInput('Digital Surf calibration is invalid')
  return {
    signature: signatureValue,
    numberOfObjects,
    objectType,
    objectName,
    operatorName,
    channelsPerObject,
    wSize,
    pointBits: pointBitsValue,
    zMin,
    width,
    height,
    totalPoints,
    xSpacing,
    ySpacing,
    zSpacing,
    xName,
    yName,
    zName,
    xUnit,
    yUnit,
    zUnit,
    zUnitRatio,
    specialPoints,
    compressedSize,
    commentSize,
    privateSize,
    xOffset,
    yOffset,
    zOffset,
  }
}

const decodeCompressed = async (
  bytes: Uint8Array,
  expected: number,
  limits: Required<DigitalSurfReaderLimits>,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> => {
  const cursor = new Cursor(bytes)
  const streams = cursor.u32()
  if (streams < 1 || streams > limits.maxCompressionStreams)
    throw limitExceeded(`Digital Surf compression streams exceed ${limits.maxCompressionStreams}`)
  const rawSizes: number[] = []
  const compressedSizes: number[] = []
  let rawTotal = 0
  for (let index = 0; index < streams; index += 1) {
    const raw = cursor.u32()
    const compressed = cursor.u32()
    rawTotal += raw
    if (rawTotal > limits.maxDecodedBytes)
      throw limitExceeded('Digital Surf decoded object exceeds maxDecodedBytes')
    rawSizes.push(raw)
    compressedSizes.push(compressed)
  }
  if (rawTotal !== expected)
    throw invalidInput('Digital Surf compressed directory raw size is inconsistent')
  const output = new Uint8Array(expected)
  let outputOffset = 0
  for (let index = 0; index < streams; index += 1) {
    const compressedSize = compressedSizes[index] ?? 0
    const rawSize = rawSizes[index] ?? 0
    const decoded = await inflate(
      cursor.take(compressedSize),
      rawSize,
      limits.maxDecodedBytes,
      signal,
    )
    output.set(decoded, outputOffset)
    outputOffset += decoded.byteLength
  }
  if (cursor.offset !== bytes.byteLength)
    throw invalidInput('Digital Surf compressed data has trailing bytes')
  return output
}

const parseObjects = async (
  source: ImageSource,
  limits: Required<DigitalSurfReaderLimits>,
  signal?: AbortSignal,
): Promise<readonly SurfaceObject[]> => {
  const objects: SurfaceObject[] = []
  let offset = 0
  let decodedTotal = 0
  let expectedRecords: number | undefined
  while (offset < source.size) {
    throwIfAborted(signal)
    const readOptions = signal === undefined ? {} : { signal }
    if (objects.length >= limits.maxObjects)
      throw limitExceeded(`Digital Surf contains more than ${limits.maxObjects} records`)
    const fixed = parseFixedHeader(await readExactly(source, offset, fixedHeaderBytes, readOptions))
    if (objects.length === 0) {
      expectedRecords = Math.max(1, fixed.numberOfObjects) * Math.max(1, fixed.channelsPerObject)
      if (expectedRecords > limits.maxObjects)
        throw limitExceeded(`Digital Surf declares more than ${limits.maxObjects} records`)
    }
    offset += fixedHeaderBytes
    if (fixed.commentSize > limits.maxCommentBytes)
      throw limitExceeded('Digital Surf comment exceeds maxCommentBytes')
    if (fixed.privateSize > limits.maxPrivateBytes)
      throw limitExceeded('Digital Surf private zone exceeds maxPrivateBytes')
    const comment = text(await readExactly(source, offset, fixed.commentSize, readOptions))
    offset += fixed.commentSize
    offset += fixed.privateSize
    if (offset > source.size) throw truncatedInput('Digital Surf private zone is truncated')
    const values = BigInt(fixed.totalPoints) * BigInt(Math.max(fixed.wSize, 1))
    const rawBytesBig = values * BigInt(fixed.pointBits / 8)
    if (rawBytesBig > BigInt(limits.maxDecodedBytes))
      throw limitExceeded('Digital Surf decoded object exceeds maxDecodedBytes')
    const rawBytes = Number(rawBytesBig)
    decodedTotal += rawBytes
    if (decodedTotal > limits.maxDecodedBytes)
      throw limitExceeded('Digital Surf decoded objects exceed maxDecodedBytes')
    let raw: Uint8Array<ArrayBuffer>
    if (fixed.signature === compressedSignature) {
      if (fixed.compressedSize < 4 || fixed.compressedSize > source.size - offset)
        throw truncatedInput('Digital Surf compressed data is truncated')
      raw = await decodeCompressed(
        await readExactly(source, offset, fixed.compressedSize, readOptions),
        rawBytes,
        limits,
        signal,
      )
      offset += fixed.compressedSize
    } else {
      raw = Uint8Array.from(await readExactly(source, offset, rawBytes, readOptions))
      offset += rawBytes
    }
    objects.push(
      Object.freeze({
        index: objects.length,
        objectType: fixed.objectType,
        objectName: fixed.objectName,
        operatorName: fixed.operatorName,
        width: fixed.width,
        height: fixed.height,
        totalPoints: fixed.totalPoints,
        layers: Math.max(fixed.wSize, 1),
        pointBits: fixed.pointBits,
        zMin: fixed.zMin,
        specialPoints: fixed.specialPoints,
        xSpacing: fixed.xSpacing,
        ySpacing: fixed.ySpacing,
        zSpacing: fixed.zSpacing,
        xName: fixed.xName,
        yName: fixed.yName,
        zName: fixed.zName,
        xUnit: fixed.xUnit,
        yUnit: fixed.yUnit,
        zUnit: fixed.zUnit,
        zUnitRatio: fixed.zUnitRatio,
        xOffset: fixed.xOffset,
        yOffset: fixed.yOffset,
        zOffset: fixed.zOffset,
        comment,
        raw,
        numberOfObjects: fixed.numberOfObjects,
        channelsPerObject: fixed.channelsPerObject,
      }),
    )
    if (expectedRecords !== undefined && objects.length === expectedRecords) break
  }
  if (expectedRecords !== objects.length)
    throw truncatedInput('Digital Surf object sequence is truncated')
  if (offset !== source.size) throw invalidInput('Digital Surf file has unexpected trailing data')
  return Object.freeze(objects)
}

const supportedSurfaceType = (type: number): boolean =>
  type === 2 || type === 5 || type === 8 || type === 10 || type === 11
const supportedProfileType = (type: number): boolean => type === 1 || type === 4 || type === 7

const writeValue = (
  object: SurfaceObject,
  inputIndex: number,
  output: DataView,
  outputOffset: number,
): void => {
  const input = new DataView(object.raw.buffer, object.raw.byteOffset, object.raw.byteLength)
  const stored =
    object.pointBits === 16
      ? input.getInt16(inputIndex * 2, true)
      : input.getInt32(inputIndex * 4, true)
  const missing = object.specialPoints && stored === object.zMin - 2
  const value = missing
    ? Number.NaN
    : (stored - object.zMin) * (object.zSpacing / object.zUnitRatio) + object.zOffset
  output.setFloat64(outputOffset, value, false)
}

class DigitalSurfDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #object: SurfaceObject
  readonly #rowsPerBlock: number
  readonly #profile: boolean
  constructor(object: SurfaceObject, resourceId: string, rowsPerBlock: number) {
    this.#object = object
    this.#rowsPerBlock = rowsPerBlock
    this.#profile = supportedProfileType(object.objectType)
    if (!this.#profile && !supportedSurfaceType(object.objectType))
      throw unsupportedOperation(
        `Digital Surf object type ${object.objectType} is outside the surface/profile subset`,
      )
    this.descriptor = normalizeScientificDatasetDescriptor({
      schemaVersion: 1,
      axes: this.#profile
        ? [
            {
              id: 'x',
              name: object.xName || 'X',
              kind: 'space',
              length: object.width,
              ...(object.xUnit ? { unit: object.xUnit } : {}),
              coordinates: { type: 'linear', origin: object.xOffset, step: object.xSpacing },
              calibration: { kind: 'embedded', resourceId, locator: 'sur:H18,H21,H27,H53' },
            },
            ...(object.layers === 1
              ? []
              : [
                  {
                    id: 'layer',
                    name: 'Layer',
                    kind: 'index' as const,
                    length: object.layers,
                    coordinates: { type: 'linear' as const, origin: 0, step: 1 },
                  },
                ]),
          ]
        : [
            {
              id: 'x',
              name: object.xName || 'X',
              kind: 'space',
              length: object.width,
              ...(object.xUnit ? { unit: object.xUnit } : {}),
              coordinates: { type: 'linear', origin: object.xOffset, step: object.xSpacing },
              calibration: { kind: 'embedded', resourceId, locator: 'sur:H18,H21,H27,H53' },
            },
            {
              id: 'y',
              name: object.yName || 'Y',
              kind: 'space',
              length: object.height,
              ...(object.yUnit ? { unit: object.yUnit } : {}),
              coordinates: { type: 'linear', origin: object.yOffset, step: object.ySpacing },
              calibration: { kind: 'embedded', resourceId, locator: 'sur:H19,H22,H28,H54' },
            },
            ...(object.layers === 1
              ? []
              : [
                  {
                    id: 'layer',
                    name: 'Layer',
                    kind: 'index' as const,
                    length: object.layers,
                    coordinates: { type: 'linear' as const, origin: 0, step: 1 },
                  },
                ]),
          ],
      sampleType: 'float64',
      components: [
        {
          id: 'value',
          name: object.zName || 'Z',
          kind: 'scalar',
          ...(object.zUnit ? { unit: object.zUnit } : {}),
        },
      ],
      metadata: normalizeScientificMetadataObject({
        objectType: object.objectType,
        objectName: object.objectName,
        operatorName: object.operatorName,
        comment: object.comment,
        integerStorageBits: object.pointBits,
        scaleFormula: '(stored - Zmin) * Zspacing / ZunitRatio + Zoffset',
      }),
      capabilities: this.#profile
        ? {
            regionReads: true,
            resolutionLevels: false,
            planeReads: { kind: 'none' },
            seriesReads: { kind: 'axes', axes: ['x'] },
          }
        : {
            regionReads: true,
            resolutionLevels: false,
            planeReads: { kind: 'ordered-axis-pairs', pairs: [['x', 'y']] },
          },
    })
  }
  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<RasterBlock> {
    if (this.#profile) throw unsupportedOperation('Digital Surf profiles use readSeries()')
    const selected = normalizeScientificPlaneReadRequest(this.descriptor, request)
    const layer = selected.fixedIndices.find(({ axisId }) => axisId === 'layer')?.index ?? 0
    const rowBytes = selected.width * 8
    for (let localY = 0; localY < selected.height; localY += this.#rowsPerBlock) {
      throwIfAborted(selected.signal)
      const height = Math.min(this.#rowsPerBlock, selected.height - localY)
      const data = new Uint8Array(rowBytes * height)
      const output = new DataView(data.buffer)
      for (let row = 0; row < height; row += 1)
        for (let x = 0; x < selected.width; x += 1) {
          if ((x & 0xfff) === 0) throwIfAborted(selected.signal)
          writeValue(
            this.#object,
            ((selected.y + localY + row) * this.#object.width + selected.x + x) *
              this.#object.layers +
              layer,
            output,
            (row * selected.width + x) * 8,
          )
        }
      yield {
        x: selected.x,
        y: selected.y + localY,
        width: selected.width,
        height,
        stride: rowBytes,
        format: Object.freeze({ sampleType: 'float64', channels: 1, planar: false }),
        data,
      }
    }
  }
  async *readSeries(
    request: Readonly<ScientificSeriesReadRequest>,
  ): AsyncIterable<ScientificSeriesBlock> {
    if (!this.#profile) throw unsupportedOperation('Digital Surf surface maps use readPlane()')
    const selected = normalizeScientificSeriesReadRequest(this.descriptor, request)
    throwIfAborted(selected.signal)
    const layer = selected.fixedIndices.find(({ axisId }) => axisId === 'layer')?.index ?? 0
    const data = new Uint8Array(selected.length * 8)
    const output = new DataView(data.buffer)
    for (let index = 0; index < selected.length; index += 1) {
      if ((index & 0xfff) === 0) throwIfAborted(selected.signal)
      writeValue(
        this.#object,
        (selected.start + index) * this.#object.layers + layer,
        output,
        index * 8,
      )
    }
    yield {
      start: selected.start,
      length: selected.length,
      format: Object.freeze({ sampleType: 'float64', channels: 1, planar: false }),
      data,
    }
  }
}

export const digitalSurfReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/digital-surf',
  version: '1.0.0',
  format: 'Digital Surf SUR/PRO',
  extensions: Object.freeze(['sur', 'pro']),
  mediaTypes: Object.freeze(['application/x-digitalsurf-sur']),
  capabilities: Object.freeze({ resources: 'single', datasets: 'multiple', axes: 'x-or-xy' }),
})

export const createDigitalSurfReader = (
  options: Readonly<{ readonly limits?: Readonly<DigitalSurfReaderLimits> }> = {},
): ScientificReader => {
  const limits: Required<DigitalSurfReaderLimits> = Object.freeze({
    maxObjects: positiveInteger('Digital Surf maxObjects', options.limits?.maxObjects ?? 1_024),
    maxCommentBytes: positiveInteger(
      'Digital Surf maxCommentBytes',
      options.limits?.maxCommentBytes ?? 1_048_576,
    ),
    maxPrivateBytes: positiveInteger(
      'Digital Surf maxPrivateBytes',
      options.limits?.maxPrivateBytes ?? 16_777_216,
    ),
    maxDecodedBytes: positiveInteger(
      'Digital Surf maxDecodedBytes',
      options.limits?.maxDecodedBytes ?? 536_870_912,
    ),
    maxCompressionStreams: positiveInteger(
      'Digital Surf maxCompressionStreams',
      options.limits?.maxCompressionStreams ?? 8,
    ),
    rowsPerBlock: positiveInteger('Digital Surf rowsPerBlock', options.limits?.rowsPerBlock ?? 32),
  })
  return Object.freeze({
    descriptor: digitalSurfReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      const bytes = await context.primary.source.read(
        0,
        12,
        context.signal === undefined ? {} : { signal: context.signal },
      )
      const value = text(bytes)
      if (value !== compressedSignature && value !== uncompressedSignature)
        return Object.freeze({ confidence: 0, reason: 'Digital Surf signature is absent' })
      const hinted = resourceHasHint(
        context.primary,
        digitalSurfReaderDescriptor.extensions,
        digitalSurfReaderDescriptor.mediaTypes,
      )
      return Object.freeze({
        confidence: hinted ? 1 : 0.99,
        reason: hinted ? 'Digital Surf signature and hint match' : 'Digital Surf signature matches',
      })
    },
    async open(context: Readonly<ScientificOpenContext>): Promise<ScientificDocument> {
      const objects = await parseObjects(context.primary.source, limits, context.signal)
      const metadata: ScientificMetadataObject = normalizeScientificMetadataObject({
        records: objects.length,
        declaredObjects: objects[0]?.numberOfObjects ?? 0,
        channelsPerObject: objects[0]?.channelsPerObject ?? 0,
      })
      const datasets = []
      const opened = new Map<string, ScientificDataset>()
      for (const object of objects) {
        const id = `object-${object.index}`
        const identity = await createScientificDatasetIdentity({
          reader: digitalSurfReaderDescriptor,
          datasetId: id,
          resources: [context.primary],
        })
        const dataset = identifyScientificDataset(
          new DigitalSurfDataset(object, context.primary.id, limits.rowsPerBlock),
          identity,
        )
        opened.set(id, dataset)
        datasets.push(
          Object.freeze({
            id,
            name: object.objectName || `Object ${object.index + 1}`,
            descriptor: dataset.descriptor,
            identity,
            ...(dataset.descriptor.metadata === undefined
              ? {}
              : { metadata: dataset.descriptor.metadata }),
          }),
        )
      }
      return Object.freeze({
        reader: Object.freeze({
          id: digitalSurfReaderDescriptor.id,
          version: digitalSurfReaderDescriptor.version,
        }),
        format: digitalSurfReaderDescriptor.format,
        metadata,
        datasets: Object.freeze(datasets),
        async openDataset(id: string, openOptions?: Readonly<AbortOptions>) {
          throwIfAborted(openOptions?.signal ?? context.signal)
          const dataset = opened.get(id)
          if (dataset === undefined) throw invalidInput(`Unknown Digital Surf dataset ${id}`)
          return dataset
        },
      })
    },
  })
}

export const digitalSurfReader = createDigitalSurfReader()
