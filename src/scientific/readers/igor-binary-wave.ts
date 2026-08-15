import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded, truncatedInput, unsupportedOperation } from '../../errors.ts'
import type { RasterBlock, RasterSampleType } from '../../raster.ts'
import { rasterSampleBytes } from '../../raster.ts'
import { readExactly, type ImageSource } from '../../source.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificAxisDescriptor,
  ScientificDataset,
  ScientificPlaneReadRequest,
} from '../dataset.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificMetadataObject,
  normalizeScientificPlaneReadRequest,
} from '../dataset.ts'
import type {
  ScientificOpenContext,
  ScientificReader,
  ScientificReaderDescriptor,
} from '../reader.ts'
import { descriptorWithFormatMetadata, resourceHasHint, singleDatasetDocument } from './shared.ts'

const binaryHeaderBytes = 64
const waveHeaderBytes = 320
const dataOffset = binaryHeaderBytes + waveHeaderBytes

export interface IgorBinaryWaveReaderLimits {
  readonly maxNoteBytes?: number
  readonly maxLabelBytes?: number
  readonly maxTrailingBytes?: number
  readonly rowsPerBlock?: number
}

interface IbwHeader {
  readonly littleEndian: boolean
  readonly dimensions: readonly number[]
  readonly pointCount: number
  readonly sampleType: RasterSampleType
  readonly bytesPerSample: number
  readonly name: string
  readonly dataUnit?: string
  readonly dimensionUnits: readonly (string | undefined)[]
  readonly scales: readonly number[]
  readonly origins: readonly number[]
  readonly labels: readonly (readonly string[])[]
  readonly note: string
  readonly creationDate: number
  readonly modificationDate: number
  readonly trailingBytes: number
}

const positiveInteger = (label: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) throw invalidInput(`${label} must be positive`)
  return value
}

const integer = (view: DataView, offset: number, littleEndian: boolean): number =>
  view.getInt32(offset, littleEndian)
const unsigned = (view: DataView, offset: number, littleEndian: boolean): number =>
  view.getUint32(offset, littleEndian)
const short = (view: DataView, offset: number, littleEndian: boolean): number =>
  view.getUint16(offset, littleEndian)

const fixedString = (bytes: Uint8Array): string => {
  const nul = bytes.indexOf(0)
  const content = bytes.subarray(0, nul < 0 ? bytes.byteLength : nul)
  if (content.some((byte) => byte < 0x20 || byte > 0x7e))
    throw invalidInput('IBW fixed string contains non-ASCII data')
  return new TextDecoder('ascii').decode(content)
}

const unit = (inline: Uint8Array, extended: Uint8Array): string | undefined => {
  const value = extended.byteLength === 0 ? fixedString(inline) : fixedString(extended)
  return value.length === 0 ? undefined : value
}

const checkedProduct = (values: readonly number[], label: string): number => {
  let result = 1n
  for (const value of values) result *= BigInt(value)
  if (result > BigInt(Number.MAX_SAFE_INTEGER))
    throw limitExceeded(`IBW ${label} exceeds safe integers`)
  return Number(result)
}

const sampleType = (code: number): RasterSampleType => {
  if ((code & 0x01) !== 0) throw unsupportedOperation('Complex IBW waves are unsupported')
  const unsignedFlag = (code & 0x40) !== 0
  const base = code & ~0x40
  if (base === 0x02 && !unsignedFlag) return 'float32'
  if (base === 0x04 && !unsignedFlag) return 'float64'
  if (base === 0x08) return unsignedFlag ? 'uint8' : 'int8'
  if (base === 0x10) return unsignedFlag ? 'uint16' : 'int16'
  if (base === 0x20) return unsignedFlag ? 'uint32' : 'int32'
  if (code === 0) throw unsupportedOperation('Text IBW waves are unsupported')
  throw unsupportedOperation(`IBW numeric type 0x${code.toString(16)} is unsupported`)
}

const checksumValid = (bytes: Uint8Array, littleEndian: boolean): boolean => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let sum = 0
  for (let offset = 0; offset < bytes.byteLength; offset += 2)
    sum = (sum + view.getUint16(offset, littleEndian)) & 0xffff
  return sum === 0
}

const parseLabels = (
  bytes: Uint8Array,
  sizes: readonly number[],
): readonly (readonly string[])[] => {
  const output: (readonly string[])[] = []
  let offset = 0
  for (const size of sizes) {
    if (size % 32 !== 0 || offset + size > bytes.byteLength)
      throw invalidInput('IBW dimension labels are malformed')
    const labels: string[] = []
    for (let index = 0; index < size; index += 32)
      labels.push(fixedString(bytes.subarray(offset + index, offset + index + 32)))
    output.push(Object.freeze(labels))
    offset += size
  }
  return Object.freeze(output)
}

const parseIbw = async (
  source: ImageSource,
  limits: Required<IgorBinaryWaveReaderLimits>,
  signal?: AbortSignal,
): Promise<IbwHeader> => {
  throwIfAborted(signal)
  const readOptions = signal === undefined ? {} : { signal }
  if (source.size < dataOffset) throw truncatedInput('IBW v5 headers are truncated')
  const headers = await readExactly(source, 0, dataOffset, readOptions)
  const littleEndian = headers[0] === 5 && headers[1] === 0
  const bigEndian = headers[0] === 0 && headers[1] === 5
  if (!littleEndian && !bigEndian) throw unsupportedOperation('Only IBW version 5 is supported')
  if (!checksumValid(headers, littleEndian)) throw invalidInput('IBW header checksum is invalid')
  const view = new DataView(headers.buffer, headers.byteOffset, headers.byteLength)
  const wfmSize = integer(view, 4, littleEndian)
  const formulaSize = integer(view, 8, littleEndian)
  const noteSize = integer(view, 12, littleEndian)
  const dataUnitSize = integer(view, 16, littleEndian)
  const dimensionUnitSizes = Array.from({ length: 4 }, (_, index) =>
    integer(view, 20 + index * 4, littleEndian),
  )
  const labelSizes = Array.from({ length: 4 }, (_, index) =>
    integer(view, 36 + index * 4, littleEndian),
  )
  const stringIndicesSize = integer(view, 52, littleEndian)
  const optionsSize1 = integer(view, 56, littleEndian)
  const optionsSize2 = integer(view, 60, littleEndian)
  const sizes = [
    wfmSize,
    formulaSize,
    noteSize,
    dataUnitSize,
    ...dimensionUnitSizes,
    ...labelSizes,
    stringIndicesSize,
    optionsSize1,
    optionsSize2,
  ]
  if (sizes.some((value) => value < 0)) throw invalidInput('IBW section sizes must be non-negative')
  if (noteSize > limits.maxNoteBytes)
    throw limitExceeded(`IBW note exceeds ${limits.maxNoteBytes} bytes`)
  if (labelSizes.reduce((sum, value) => sum + value, 0) > limits.maxLabelBytes)
    throw limitExceeded(`IBW labels exceed ${limits.maxLabelBytes} bytes`)
  if (formulaSize !== 0) throw unsupportedOperation('Formula-dependent IBW waves are unsupported')
  if (stringIndicesSize !== 0) throw unsupportedOperation('IBW string indices are unsupported')
  if (optionsSize1 !== 0 || optionsSize2 !== 0)
    throw unsupportedOperation('IBW private option sections are unsupported')
  const waveOffset = binaryHeaderBytes
  const dimensionsAll = Array.from({ length: 4 }, (_, index) =>
    integer(view, waveOffset + 68 + index * 4, littleEndian),
  )
  if (dimensionsAll.some((value) => value < 0))
    throw invalidInput('IBW dimensions must be non-negative')
  const firstZero = dimensionsAll.indexOf(0)
  const dimensions = Object.freeze(dimensionsAll.slice(0, firstZero < 0 ? 4 : firstZero))
  if (dimensions.length < 2 || dimensions.length > 4 || dimensions.some((value) => value < 1)) {
    throw unsupportedOperation('IBW support is limited to numeric 2D through 4D waves')
  }
  if (dimensionsAll.slice(dimensions.length).some((value) => value !== 0))
    throw invalidInput('IBW dimensions must be contiguous')
  const pointCount = integer(view, waveOffset + 12, littleEndian)
  if (pointCount !== checkedProduct(dimensions, 'point count'))
    throw invalidInput('IBW point count does not match dimensions')
  const resolvedSampleType = sampleType(short(view, waveOffset + 16, littleEndian))
  const bytesPerSample = rasterSampleBytes(resolvedSampleType)
  const dataBytes = checkedProduct([pointCount, bytesPerSample], 'wave data size')
  if (wfmSize !== waveHeaderBytes + dataBytes)
    throw invalidInput('IBW wfmSize does not match wave dimensions and type')
  const sectionTotal =
    binaryHeaderBytes +
    wfmSize +
    formulaSize +
    noteSize +
    dataUnitSize +
    dimensionUnitSizes.reduce((a, b) => a + b, 0) +
    labelSizes.reduce((a, b) => a + b, 0)
  if (sectionTotal > source.size) throw truncatedInput('IBW auxiliary sections are truncated')
  const trailingBytes = source.size - sectionTotal
  if (trailingBytes > limits.maxTrailingBytes)
    throw limitExceeded(`IBW trailing data exceeds ${limits.maxTrailingBytes} bytes`)
  let cursor = binaryHeaderBytes + wfmSize
  cursor += formulaSize
  const noteBytes = await readExactly(source, cursor, noteSize, readOptions)
  cursor += noteSize
  const dataExtendedUnit = await readExactly(source, cursor, dataUnitSize, readOptions)
  cursor += dataUnitSize
  const dimensionExtendedUnits: Uint8Array[] = []
  for (const size of dimensionUnitSizes) {
    dimensionExtendedUnits.push(await readExactly(source, cursor, size, readOptions))
    cursor += size
  }
  const labelsBytes = await readExactly(
    source,
    cursor,
    labelSizes.reduce((sum, value) => sum + value, 0),
    readOptions,
  )
  let note: string
  try {
    note = new TextDecoder('utf-8', { fatal: true }).decode(noteBytes).replaceAll('\r', '\n')
  } catch {
    note = new TextDecoder('windows-1252').decode(noteBytes).replaceAll('\r', '\n')
  }
  const dataUnit = unit(headers.subarray(waveOffset + 148, waveOffset + 152), dataExtendedUnit)
  const dimensionUnits = dimensions.map((_, index) =>
    unit(
      headers.subarray(waveOffset + 152 + index * 4, waveOffset + 156 + index * 4),
      dimensionExtendedUnits[index] ?? new Uint8Array(),
    ),
  )
  const scales = dimensions.map((_, index) =>
    view.getFloat64(waveOffset + 84 + index * 8, littleEndian),
  )
  const origins = dimensions.map((_, index) =>
    view.getFloat64(waveOffset + 116 + index * 8, littleEndian),
  )
  if (
    scales.some((value) => !Number.isFinite(value)) ||
    origins.some((value) => !Number.isFinite(value))
  ) {
    throw invalidInput('IBW axis calibration must be finite')
  }
  return Object.freeze({
    littleEndian,
    dimensions,
    pointCount,
    sampleType: resolvedSampleType,
    bytesPerSample,
    name: fixedString(headers.subarray(waveOffset + 28, waveOffset + 60)),
    ...(dataUnit === undefined ? {} : { dataUnit }),
    dimensionUnits: Object.freeze(dimensionUnits),
    scales: Object.freeze(scales),
    origins: Object.freeze(origins),
    labels: parseLabels(labelsBytes, labelSizes).slice(0, dimensions.length),
    note,
    creationDate: unsigned(view, waveOffset + 4, littleEndian),
    modificationDate: unsigned(view, waveOffset + 8, littleEndian),
    trailingBytes,
  })
}

const axisId = (index: number): string => (index === 0 ? 'x' : index === 1 ? 'y' : `dim${index}`)

class IbwDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #source: ImageSource
  readonly #header: IbwHeader
  readonly #rowsPerBlock: number

  constructor(source: ImageSource, header: IbwHeader, resourceId: string, rowsPerBlock: number) {
    this.#source = source
    this.#header = header
    this.#rowsPerBlock = rowsPerBlock
    const axes: ScientificAxisDescriptor[] = header.dimensions.map((length, index) => {
      const labels = header.labels[index] ?? []
      const elementLabels = labels.length === length + 1 ? labels.slice(1) : []
      return {
        id: axisId(index),
        name: labels[0] || (index === 0 ? 'X' : index === 1 ? 'Y' : `Dimension ${index}`),
        kind: index < 2 ? 'space' : elementLabels.length > 0 ? 'channel' : 'index',
        length,
        ...(header.dimensionUnits[index] === undefined
          ? {}
          : { unit: header.dimensionUnits[index] }),
        coordinates: {
          type: 'linear',
          origin: header.origins[index] ?? 0,
          step: header.scales[index] ?? 1,
        },
        calibration: {
          kind: 'embedded',
          resourceId,
          locator: `ibw:WaveHeader5.sfA[${index}],sfB[${index}],dimUnits[${index}]`,
        },
        ...(elementLabels.length === 0
          ? {}
          : {
              entries: Object.freeze(
                elementLabels.map((name, entry) =>
                  Object.freeze({ id: `${axisId(index)}-${entry}`, name }),
                ),
              ),
            }),
      }
    })
    this.descriptor = normalizeScientificDatasetDescriptor({
      schemaVersion: 1,
      axes,
      sampleType: header.sampleType,
      components: [
        {
          id: 'value',
          name: header.name || 'Wave value',
          kind: 'scalar',
          ...(header.dataUnit === undefined ? {} : { unit: header.dataUnit }),
        },
      ],
      metadata: normalizeScientificMetadataObject({
        name: header.name,
        note: header.note,
        creationDate: header.creationDate,
        modificationDate: header.modificationDate,
        trailingBytes: header.trailingBytes,
      }),
      capabilities: {
        regionReads: true,
        resolutionLevels: false,
        planeReads: { kind: 'ordered-axis-pairs', pairs: [['x', 'y']] },
      },
    })
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<RasterBlock> {
    const selected = normalizeScientificPlaneReadRequest(this.descriptor, request)
    let plane = 0
    let stride = (this.#header.dimensions[0] ?? 0) * (this.#header.dimensions[1] ?? 0)
    for (let dimension = 2; dimension < this.#header.dimensions.length; dimension += 1) {
      const fixed =
        selected.fixedIndices.find(({ axisId: id }) => id === axisId(dimension))?.index ?? 0
      plane += fixed * stride
      stride *= this.#header.dimensions[dimension] ?? 1
    }
    const rowBytes = selected.width * this.#header.bytesPerSample
    for (let localY = 0; localY < selected.height; localY += this.#rowsPerBlock) {
      throwIfAborted(selected.signal)
      const height = Math.min(this.#rowsPerBlock, selected.height - localY)
      const output = new Uint8Array(rowBytes * height)
      for (let row = 0; row < height; row += 1) {
        const sample =
          plane + (selected.y + localY + row) * (this.#header.dimensions[0] ?? 0) + selected.x
        const input = await readExactly(
          this.#source,
          dataOffset + sample * this.#header.bytesPerSample,
          rowBytes,
          selected.signal === undefined ? {} : { signal: selected.signal },
        )
        if (!this.#header.littleEndian || this.#header.bytesPerSample === 1)
          output.set(input, row * rowBytes)
        else
          for (let index = 0; index < input.byteLength; index += this.#header.bytesPerSample) {
            if ((index & 0xffff) === 0) throwIfAborted(selected.signal)
            for (let byte = 0; byte < this.#header.bytesPerSample; byte += 1)
              output[row * rowBytes + index + byte] =
                input[index + this.#header.bytesPerSample - byte - 1] ?? 0
          }
      }
      yield {
        x: selected.x,
        y: selected.y + localY,
        width: selected.width,
        height,
        stride: rowBytes,
        format: Object.freeze({ sampleType: this.#header.sampleType, channels: 1, planar: false }),
        data: output,
      }
    }
  }
}

export const igorBinaryWaveReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/igor-binary-wave',
  version: '1.0.0',
  format: 'Igor Binary Wave v5',
  extensions: Object.freeze(['ibw']),
  mediaTypes: Object.freeze(['application/x-igor-binary-wave']),
  capabilities: Object.freeze({ resources: 'single', datasets: 'single', axes: '2d-4d' }),
})

export const createIgorBinaryWaveReader = (
  options: Readonly<{ readonly limits?: Readonly<IgorBinaryWaveReaderLimits> }> = {},
): ScientificReader => {
  const limits: Required<IgorBinaryWaveReaderLimits> = Object.freeze({
    maxNoteBytes: positiveInteger('IBW maxNoteBytes', options.limits?.maxNoteBytes ?? 4_194_304),
    maxLabelBytes: positiveInteger('IBW maxLabelBytes', options.limits?.maxLabelBytes ?? 4_194_304),
    maxTrailingBytes: positiveInteger(
      'IBW maxTrailingBytes',
      options.limits?.maxTrailingBytes ?? 4_194_304,
    ),
    rowsPerBlock: positiveInteger('IBW rowsPerBlock', options.limits?.rowsPerBlock ?? 32),
  })
  return Object.freeze({
    descriptor: igorBinaryWaveReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      const bytes = await context.primary.source.read(
        0,
        2,
        context.signal === undefined ? {} : { signal: context.signal },
      )
      const matches =
        bytes.byteLength === 2 &&
        ((bytes[0] === 5 && bytes[1] === 0) || (bytes[0] === 0 && bytes[1] === 5))
      if (!matches)
        return Object.freeze({ confidence: 0, reason: 'IBW v5 version marker is absent' })
      const hinted = resourceHasHint(
        context.primary,
        igorBinaryWaveReaderDescriptor.extensions,
        igorBinaryWaveReaderDescriptor.mediaTypes,
      )
      return Object.freeze({
        confidence: hinted ? 0.99 : 0.8,
        reason: hinted ? 'IBW v5 marker and hint match' : 'IBW v5 marker matches',
      })
    },
    async open(context: Readonly<ScientificOpenContext>) {
      const header = await parseIbw(context.primary.source, limits, context.signal)
      const formatMetadata = normalizeScientificMetadataObject({
        dimensions: header.dimensions,
        name: header.name,
        note: header.note,
        byteOrder: header.littleEndian ? 'little-endian' : 'big-endian',
      })
      const dataset = descriptorWithFormatMetadata(
        new IbwDataset(context.primary.source, header, context.primary.id, limits.rowsPerBlock),
        'purejsimage:igor-binary-wave',
        formatMetadata,
      )
      return singleDatasetDocument({
        context,
        reader: igorBinaryWaveReaderDescriptor,
        metadata: formatMetadata,
        dataset,
        datasetId: 'wave',
        datasetName: header.name || 'Wave',
      })
    },
  })
}

export const igorBinaryWaveReader = createIgorBinaryWaveReader()
