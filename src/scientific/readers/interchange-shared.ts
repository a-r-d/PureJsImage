import { throwIfAborted } from '../../abort.ts'
import { ImageError, invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import type { RasterBlock, RasterSampleType } from '../../raster.ts'
import { rasterSampleBytes } from '../../raster.ts'
import { MemorySource, readExactly, type ImageSource } from '../../source.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificAxisDescriptor,
  ScientificComponentDescriptor,
  ScientificDataset,
  ScientificMetadataObject,
  ScientificPlaneReadRequest,
  ScientificSeriesBlock,
  ScientificSeriesReadRequest,
} from '../dataset.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
  normalizeScientificSeriesReadRequest,
} from '../dataset.ts'

export interface ContiguousArrayLimits {
  readonly maxRegionBytes: number
  readonly maxReadOperations: number
  readonly rowsPerBlock: number
}

export interface ContiguousValueTransform {
  readonly scale: number
  readonly offset: number
}

export interface ContiguousArrayDefinition {
  readonly source: ImageSource
  readonly dataOffset: number
  readonly sourceSampleType: RasterSampleType
  readonly sourceLittleEndian: boolean
  readonly axes: readonly ScientificAxisDescriptor[]
  readonly components: readonly ScientificComponentDescriptor[]
  readonly metadata?: ScientificMetadataObject
  readonly noDataValue?: number
  readonly transform?: ContiguousValueTransform
  readonly planePairs?: readonly (readonly [horizontal: string, vertical: string])[]
  readonly limits: ContiguousArrayLimits
}

const checkedProduct = (values: readonly number[], label: string): number => {
  let result = 1
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 1) throw invalidInput(`${label} must be positive`)
    result *= value
    if (!Number.isSafeInteger(result)) throw limitExceeded(`${label} exceeds safe integers`)
  }
  return result
}

const positiveLimit = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return value
}

const swapSamples = (input: Uint8Array, bytesPerSample: number): Uint8Array => {
  const output = new Uint8Array(input.byteLength)
  for (let offset = 0; offset < input.byteLength; offset += bytesPerSample) {
    for (let byte = 0; byte < bytesPerSample; byte += 1) {
      output[offset + byte] = input[offset + bytesPerSample - byte - 1] ?? 0
    }
  }
  return output
}

const readNumeric = (
  view: DataView,
  offset: number,
  type: RasterSampleType,
  littleEndian: boolean,
): number => {
  if (type === 'uint8') return view.getUint8(offset)
  if (type === 'int8') return view.getInt8(offset)
  if (type === 'uint16') return view.getUint16(offset, littleEndian)
  if (type === 'int16') return view.getInt16(offset, littleEndian)
  if (type === 'uint32') return view.getUint32(offset, littleEndian)
  if (type === 'int32') return view.getInt32(offset, littleEndian)
  if (type === 'float32') return view.getFloat32(offset, littleEndian)
  if (type === 'float64') return view.getFloat64(offset, littleEndian)
  throw unsupportedOperation(`Numeric scaling for ${type} samples is unsupported`)
}

const transformedSamples = (
  input: Uint8Array,
  type: RasterSampleType,
  littleEndian: boolean,
  transform: ContiguousValueTransform,
): Uint8Array => {
  const sourceBytes = rasterSampleBytes(type)
  const count = input.byteLength / sourceBytes
  const output = new Uint8Array(count * 8)
  const inputView = new DataView(input.buffer, input.byteOffset, input.byteLength)
  const outputView = new DataView(output.buffer)
  for (let index = 0; index < count; index += 1) {
    const value = readNumeric(inputView, index * sourceBytes, type, littleEndian)
    outputView.setFloat64(index * 8, value * transform.scale + transform.offset, false)
  }
  return output
}

class ContiguousArrayDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #definition: ContiguousArrayDefinition
  readonly #axisStrides: readonly number[]
  readonly #sourcePixelBytes: number
  readonly #outputPixelBytes: number

  constructor(definition: ContiguousArrayDefinition) {
    this.#definition = definition
    positiveLimit(definition.limits.maxRegionBytes, 'Interchange maxRegionBytes')
    positiveLimit(definition.limits.maxReadOperations, 'Interchange maxReadOperations')
    positiveLimit(definition.limits.rowsPerBlock, 'Interchange rowsPerBlock')
    if (!Number.isSafeInteger(definition.dataOffset) || definition.dataOffset < 0) {
      throw invalidInput('Interchange data offset must be a non-negative safe integer')
    }
    if (definition.axes.length < 1) throw invalidInput('Interchange array requires an axis')
    if (definition.components.length < 1) {
      throw invalidInput('Interchange array requires a component')
    }
    if (definition.transform !== undefined && definition.components.length !== 1) {
      throw unsupportedOperation('Interchange numeric transforms require one scalar component')
    }
    const sourceBytes = rasterSampleBytes(definition.sourceSampleType)
    const pixels = checkedProduct(
      definition.axes.map((axis) => axis.length),
      'Interchange element count',
    )
    this.#sourcePixelBytes = checkedProduct(
      [sourceBytes, definition.components.length],
      'Interchange source pixel bytes',
    )
    this.#outputPixelBytes = definition.transform === undefined ? this.#sourcePixelBytes : 8
    const payloadBytes = checkedProduct(
      [pixels, this.#sourcePixelBytes],
      'Interchange payload bytes',
    )
    if (definition.dataOffset + payloadBytes > definition.source.size) {
      throw invalidInput('Interchange payload is truncated')
    }
    const strides: number[] = []
    let stride = 1
    for (const axis of definition.axes) {
      strides.push(stride)
      stride = checkedProduct([stride, axis.length], 'Interchange axis stride')
    }
    this.#axisStrides = Object.freeze(strides)
    const planeReads =
      definition.axes.length < 2
        ? ({ kind: 'none' } as const)
        : ({
            kind: 'ordered-axis-pairs' as const,
            pairs: Object.freeze(
              definition.planePairs ?? [
                Object.freeze([
                  definition.axes[0]?.id ?? '',
                  definition.axes[1]?.id ?? '',
                ]) as readonly [string, string],
              ],
            ),
          } as const)
    this.descriptor = normalizeScientificDatasetDescriptor({
      schemaVersion: 1,
      axes: definition.axes,
      sampleType: definition.transform === undefined ? definition.sourceSampleType : 'float64',
      components: definition.components,
      ...(definition.metadata === undefined ? {} : { metadata: definition.metadata }),
      ...(definition.noDataValue === undefined ? {} : { noDataValue: definition.noDataValue }),
      capabilities: {
        regionReads: true,
        resolutionLevels: false,
        planeReads,
        ...(definition.axes.length === 1
          ? { seriesReads: { kind: 'axes' as const, axes: [definition.axes[0]?.id ?? ''] } }
          : {}),
      },
    })
  }

  #fixedPixelOffset(fixedIndices: readonly { readonly axisId: string; readonly index: number }[]) {
    let offset = 0
    for (const fixed of fixedIndices) {
      const axisIndex = this.descriptor.axes.findIndex((axis) => axis.id === fixed.axisId)
      const stride = this.#axisStrides[axisIndex]
      if (axisIndex < 0 || stride === undefined) {
        throw invalidInput(`Unknown interchange fixed axis ${fixed.axisId}`)
      }
      offset += fixed.index * stride
    }
    return offset
  }

  async #readCanonical(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
    const input = await readExactly(
      this.#definition.source,
      offset,
      length,
      signal === undefined ? {} : { signal },
    )
    if (this.#definition.transform !== undefined) {
      return transformedSamples(
        input,
        this.#definition.sourceSampleType,
        this.#definition.sourceLittleEndian,
        this.#definition.transform,
      )
    }
    const bytesPerSample = rasterSampleBytes(this.#definition.sourceSampleType)
    if (bytesPerSample === 1 || !this.#definition.sourceLittleEndian) return Uint8Array.from(input)
    return swapSamples(input, bytesPerSample)
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<RasterBlock> {
    if (this.descriptor.axes.length < 2) {
      throw unsupportedOperation(
        'One-dimensional interchange arrays expose readSeries(), not planes',
      )
    }
    const selected = normalizeScientificPlaneReadRequest(this.descriptor, request)
    const horizontalAxis = this.descriptor.axes.findIndex(
      (axis) => axis.id === selected.displayAxes[0],
    )
    const verticalAxis = this.descriptor.axes.findIndex(
      (axis) => axis.id === selected.displayAxes[1],
    )
    const horizontalStride = this.#axisStrides[horizontalAxis]
    const verticalStride = this.#axisStrides[verticalAxis]
    if (horizontalStride === undefined || verticalStride === undefined) {
      throw invalidInput('Interchange display axes are unavailable')
    }
    const sourceSpanPixels = (selected.width - 1) * horizontalStride + 1
    const sourceRowBytes = checkedProduct(
      [sourceSpanPixels, this.#sourcePixelBytes],
      'Interchange source row bytes',
    )
    const outputRowBytes = checkedProduct(
      [selected.width, this.#outputPixelBytes],
      'Interchange output row bytes',
    )
    const blockRows = Math.max(
      1,
      Math.min(
        this.#definition.limits.rowsPerBlock,
        Math.floor(this.#definition.limits.maxRegionBytes / outputRowBytes),
      ),
    )
    if (outputRowBytes > this.#definition.limits.maxRegionBytes) {
      throw limitExceeded('Interchange row exceeds maxRegionBytes')
    }
    if (sourceRowBytes > this.#definition.limits.maxRegionBytes) {
      throw limitExceeded('Interchange source row span exceeds maxRegionBytes')
    }
    const fixedOffset = this.#fixedPixelOffset(selected.fixedIndices)
    let operations = 0
    for (let localY = 0; localY < selected.height; localY += blockRows) {
      throwIfAborted(selected.signal)
      const height = Math.min(blockRows, selected.height - localY)
      const output = new Uint8Array(outputRowBytes * height)
      for (let row = 0; row < height; row += 1) {
        operations += 1
        if (operations > this.#definition.limits.maxReadOperations) {
          throw limitExceeded('Interchange region exceeds maxReadOperations')
        }
        const pixel =
          fixedOffset + (selected.y + localY + row) * verticalStride + selected.x * horizontalStride
        const span = await readExactly(
          this.#definition.source,
          this.#definition.dataOffset + pixel * this.#sourcePixelBytes,
          sourceRowBytes,
          selected.signal === undefined ? {} : { signal: selected.signal },
        )
        const compact =
          horizontalStride === 1
            ? span
            : (() => {
                const bytes = new Uint8Array(selected.width * this.#sourcePixelBytes)
                for (let x = 0; x < selected.width; x += 1) {
                  const start = x * horizontalStride * this.#sourcePixelBytes
                  bytes.set(
                    span.subarray(start, start + this.#sourcePixelBytes),
                    x * this.#sourcePixelBytes,
                  )
                }
                return bytes
              })()
        const canonical =
          this.#definition.transform === undefined
            ? rasterSampleBytes(this.#definition.sourceSampleType) === 1 ||
              !this.#definition.sourceLittleEndian
              ? Uint8Array.from(compact)
              : swapSamples(compact, rasterSampleBytes(this.#definition.sourceSampleType))
            : transformedSamples(
                compact,
                this.#definition.sourceSampleType,
                this.#definition.sourceLittleEndian,
                this.#definition.transform,
              )
        output.set(canonical, row * outputRowBytes)
      }
      yield {
        x: selected.x,
        y: selected.y + localY,
        width: selected.width,
        height,
        stride: outputRowBytes,
        format: Object.freeze({
          sampleType: this.descriptor.sampleType,
          channels:
            this.#definition.transform === undefined ? this.descriptor.components.length : 1,
          planar: false,
        }),
        data: output,
      }
    }
  }

  async *readSeries(
    request: Readonly<ScientificSeriesReadRequest>,
  ): AsyncIterable<ScientificSeriesBlock> {
    if (this.descriptor.axes.length !== 1) {
      throw unsupportedOperation('Multidimensional interchange arrays do not expose native series')
    }
    const selected = normalizeScientificSeriesReadRequest(this.descriptor, request)
    const outputBytes = checkedProduct(
      [selected.length, this.#outputPixelBytes],
      'Interchange series output bytes',
    )
    if (outputBytes > this.#definition.limits.maxRegionBytes) {
      throw limitExceeded('Interchange series exceeds maxRegionBytes')
    }
    const sourceBytes = selected.length * this.#sourcePixelBytes
    const data = await this.#readCanonical(
      this.#definition.dataOffset + selected.start * this.#sourcePixelBytes,
      sourceBytes,
      selected.signal,
    )
    yield {
      start: selected.start,
      length: selected.length,
      format: Object.freeze({
        sampleType: this.descriptor.sampleType,
        channels: this.#definition.transform === undefined ? this.descriptor.components.length : 1,
        planar: false,
      }),
      data,
    }
  }
}

export const createContiguousArrayDataset = (
  definition: Readonly<ContiguousArrayDefinition>,
): ScientificDataset => new ContiguousArrayDataset(definition)

export const boundedGzipSource = async (
  source: ImageSource,
  maxInputBytes: number,
  maxOutputBytes: number,
  signal?: AbortSignal,
): Promise<MemorySource> => {
  positiveLimit(maxInputBytes, 'Gzip maxInputBytes')
  positiveLimit(maxOutputBytes, 'Gzip maxOutputBytes')
  if (source.size > maxInputBytes) throw limitExceeded('Compressed input exceeds maxInputBytes')
  throwIfAborted(signal)
  const input = await readExactly(source, 0, source.size, signal === undefined ? {} : { signal })
  let stream: ReadableStream<Uint8Array>
  try {
    stream = new Blob([Uint8Array.from(input)])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'))
  } catch {
    throw unsupportedOperation('This runtime does not provide gzip decompression')
  }
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      throwIfAborted(signal)
      const next = await reader.read()
      if (next.done) break
      const chunk = next.value
      length += chunk.byteLength
      if (length > maxOutputBytes) throw limitExceeded('Gzip output exceeds maxOutputBytes')
      chunks.push(chunk)
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined)
    if (error instanceof ImageError || signal?.aborted === true) throw error
    throw invalidInput('Gzip stream is invalid or truncated')
  } finally {
    reader.releaseLock()
  }
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new MemorySource(output)
}
