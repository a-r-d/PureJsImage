import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import type { RasterBlock } from '../../raster.ts'
import { MemorySource, readExactly, type ImageSource } from '../../source.ts'
import { parseXmlDocument, xmlChild, xmlLocalName, type XmlElement } from '../../xml.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificDataset,
  ScientificPlaneReadRequest,
} from '../dataset.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificMetadataObject,
  normalizeScientificPlaneReadRequest,
} from '../dataset.ts'
import { openZipArchive, type ZipArchive, type ZipLimits } from '../formats/zip.ts'
import type {
  ScientificOpenContext,
  ScientificReader,
  ScientificReaderDescriptor,
} from '../reader.ts'
import { descriptorWithFormatMetadata, resourceHasHint, singleDatasetDocument } from './shared.ts'

export interface X3pReaderLimits extends ZipLimits {
  readonly maxXmlBytes?: number
  readonly maxSurfaceBytes?: number
  readonly rowsPerBlock?: number
}

interface AxisDefinition {
  readonly dataType: 'I' | 'L' | 'F' | 'D'
  readonly increment?: number
  readonly offset?: number
}

interface ParsedX3p {
  readonly width: number
  readonly height: number
  readonly x: AxisDefinition
  readonly y: AxisDefinition
  readonly z: AxisDefinition
  readonly pointSource: ImageSource
  readonly valid?: Uint8Array
  readonly metadata: Readonly<Record<string, string | number>>
}

const requiredChild = (element: XmlElement, name: string): XmlElement => {
  const child = xmlChild(element, name)
  if (child === undefined) throw invalidInput(`X3P requires ${name}`)
  return child
}

const requiredText = (element: XmlElement, name: string): string => {
  const value = requiredChild(element, name).text.trim()
  if (value.length === 0) throw invalidInput(`X3P ${name} is empty`)
  return value
}

const finite = (label: string, value: string): number => {
  const number = Number(value)
  if (!Number.isFinite(number)) throw invalidInput(`X3P ${label} must be finite`)
  return number
}

const positiveIntegerText = (element: XmlElement, name: string): number => {
  const value = Number(requiredText(element, name))
  if (!Number.isSafeInteger(value) || value < 1)
    throw invalidInput(`X3P ${name} must be a positive integer`)
  return value
}

const dataType = (value: string): AxisDefinition['dataType'] => {
  if (value === 'I' || value === 'L' || value === 'F' || value === 'D') return value
  throw unsupportedOperation(`X3P data type ${value} is unsupported`)
}

const axis = (axes: XmlElement, name: string, incrementalRequired: boolean): AxisDefinition => {
  const element = requiredChild(axes, name)
  const axisType = requiredText(element, 'AxisType')
  if (incrementalRequired && axisType !== 'I')
    throw unsupportedOperation(`X3P ${name} must be incremental in the surface subset`)
  if (!incrementalRequired && axisType !== 'A' && axisType !== 'I')
    throw unsupportedOperation(`X3P ${name} axis type ${axisType} is unsupported`)
  const incrementElement = xmlChild(element, 'Increment')
  const offsetElement = xmlChild(element, 'Offset')
  const increment =
    incrementElement === undefined
      ? undefined
      : finite(`${name} increment`, incrementElement.text.trim())
  const offset =
    offsetElement === undefined ? undefined : finite(`${name} offset`, offsetElement.text.trim())
  if (incrementalRequired && (increment === undefined || increment <= 0))
    throw invalidInput(`X3P ${name} requires a positive increment`)
  return Object.freeze({
    dataType: dataType(requiredText(element, 'DataType')),
    ...(increment === undefined ? {} : { increment }),
    ...(offset === undefined ? {} : { offset }),
  })
}

const sampleBytes = (type: AxisDefinition['dataType']): number =>
  type === 'I' ? 2 : type === 'L' || type === 'F' ? 4 : 8

const openMemberSource = async (
  archive: ZipArchive,
  path: string,
  signal?: AbortSignal,
): Promise<ImageSource> => {
  const entry = archive.get(path)
  if (entry === undefined) throw invalidInput(`X3P member ${path} is missing`)
  const options = signal === undefined ? {} : { signal }
  return entry.compression === 'stored'
    ? archive.openStored(path, options)
    : new MemorySource(await archive.read(path, options))
}

const parseX3p = async (
  archive: ZipArchive,
  limits: Required<Pick<X3pReaderLimits, 'maxXmlBytes' | 'maxSurfaceBytes'>>,
  signal?: AbortSignal,
): Promise<ParsedX3p> => {
  const main = archive.get('main.xml')
  if (main === undefined) throw invalidInput('X3P main.xml is missing')
  if (main.uncompressedBytes > limits.maxXmlBytes)
    throw limitExceeded(`X3P main.xml exceeds ${limits.maxXmlBytes} bytes`)
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(
      await archive.read('main.xml', signal === undefined ? {} : { signal }),
    )
  } catch {
    throw invalidInput('X3P main.xml is not valid UTF-8')
  }
  const root = parseXmlDocument(source, {
    maxCharacters: limits.maxXmlBytes,
    maxElements: 100_000,
    maxDepth: 64,
  })
  if (xmlLocalName(root.name) !== 'ISO5436_2') throw invalidInput('X3P XML root is not ISO5436_2')
  const record1 = requiredChild(root, 'Record1')
  if (requiredText(record1, 'FeatureType') !== 'SUR')
    throw unsupportedOperation('X3P support is limited to surface records')
  const axes = requiredChild(record1, 'Axes')
  const x = axis(axes, 'CX', true)
  const y = axis(axes, 'CY', true)
  const z = axis(axes, 'CZ', false)
  const record3 = requiredChild(root, 'Record3')
  const dimensions = requiredChild(record3, 'MatrixDimension')
  const width = positiveIntegerText(dimensions, 'SizeX')
  const height = positiveIntegerText(dimensions, 'SizeY')
  if (positiveIntegerText(dimensions, 'SizeZ') !== 1)
    throw unsupportedOperation('X3P multilayer matrices are not yet supported')
  const dataLink = requiredChild(record3, 'DataLink')
  const pointPath = requiredText(dataLink, 'PointDataLink')
  const pointSource = await openMemberSource(archive, pointPath, signal)
  const bytes = BigInt(width) * BigInt(height) * BigInt(sampleBytes(z.dataType))
  if (bytes > BigInt(limits.maxSurfaceBytes))
    throw limitExceeded(`X3P surface exceeds ${limits.maxSurfaceBytes} bytes`)
  if (bytes !== BigInt(pointSource.size))
    throw invalidInput('X3P point-data size does not match its matrix and Z type')
  const validLink = xmlChild(dataLink, 'ValidPointsLink')?.text.trim()
  let valid: Uint8Array | undefined
  if (validLink !== undefined && validLink.length > 0) {
    valid = await archive.read(validLink, signal === undefined ? {} : { signal })
    const expected = Math.ceil((width * height) / 8)
    if (valid.byteLength !== expected)
      throw invalidInput('X3P valid-point mask size is inconsistent')
  }
  const record2 = xmlChild(root, 'Record2')
  const instrument = record2 === undefined ? undefined : xmlChild(record2, 'Instrument')
  const metadata = Object.freeze({
    revision: requiredText(record1, 'Revision'),
    ...(record2 === undefined
      ? {}
      : {
          date: xmlChild(record2, 'Date')?.text.trim() ?? '',
          creator: xmlChild(record2, 'Creator')?.text.trim() ?? '',
          comment: xmlChild(record2, 'Comment')?.text.trim() ?? '',
        }),
    ...(instrument === undefined
      ? {}
      : {
          manufacturer: xmlChild(instrument, 'Manufacturer')?.text.trim() ?? '',
          model: xmlChild(instrument, 'Model')?.text.trim() ?? '',
          serial: xmlChild(instrument, 'Serial')?.text.trim() ?? '',
        }),
  })
  return Object.freeze({
    width,
    height,
    x,
    y,
    z,
    pointSource,
    ...(valid === undefined ? {} : { valid }),
    metadata,
  })
}

class X3pDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #parsed: ParsedX3p
  readonly #rowsPerBlock: number
  constructor(parsed: ParsedX3p, resourceId: string, rowsPerBlock: number) {
    this.#parsed = parsed
    this.#rowsPerBlock = rowsPerBlock
    this.descriptor = normalizeScientificDatasetDescriptor({
      schemaVersion: 1,
      axes: [
        {
          id: 'x',
          name: 'X',
          kind: 'space',
          length: parsed.width,
          unit: 'm',
          coordinates: {
            type: 'linear',
            origin: parsed.x.offset ?? 0,
            step: parsed.x.increment ?? 1,
          },
          calibration: { kind: 'embedded', resourceId, locator: 'x3p:Record1/Axes/CX' },
        },
        {
          id: 'y',
          name: 'Y',
          kind: 'space',
          length: parsed.height,
          unit: 'm',
          coordinates: {
            type: 'linear',
            origin: parsed.y.offset ?? 0,
            step: parsed.y.increment ?? 1,
          },
          calibration: { kind: 'embedded', resourceId, locator: 'x3p:Record1/Axes/CY' },
        },
      ],
      sampleType: 'float64',
      components: [{ id: 'z', name: 'Z', kind: 'scalar', unit: 'm' }],
      metadata: normalizeScientificMetadataObject({
        ...parsed.metadata,
        zDataType: parsed.z.dataType,
        zIncrement: parsed.z.increment ?? null,
        zOffset: parsed.z.offset ?? null,
        mask: parsed.valid === undefined ? 'absent' : 'valid-points bit field',
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
    const storedBytes = sampleBytes(this.#parsed.z.dataType)
    const rowBytes = selected.width * 8
    for (let localY = 0; localY < selected.height; localY += this.#rowsPerBlock) {
      const height = Math.min(this.#rowsPerBlock, selected.height - localY)
      const output = new Uint8Array(rowBytes * height)
      const view = new DataView(output.buffer)
      for (let row = 0; row < height; row += 1) {
        const first = (selected.y + localY + row) * this.#parsed.width + selected.x
        const input = await readExactly(
          this.#parsed.pointSource,
          first * storedBytes,
          selected.width * storedBytes,
          selected.signal === undefined ? {} : { signal: selected.signal },
        )
        const source = new DataView(input.buffer, input.byteOffset, input.byteLength)
        for (let x = 0; x < selected.width; x += 1) {
          if ((x & 0xfff) === 0) throwIfAborted(selected.signal)
          const sample = first + x
          const valid =
            this.#parsed.valid === undefined ||
            (((this.#parsed.valid[Math.floor(sample / 8)] ?? 0) >>> (sample % 8)) & 1) === 1
          const raw =
            this.#parsed.z.dataType === 'I'
              ? source.getInt16(x * 2, true)
              : this.#parsed.z.dataType === 'L'
                ? source.getInt32(x * 4, true)
                : this.#parsed.z.dataType === 'F'
                  ? source.getFloat32(x * 4, true)
                  : source.getFloat64(x * 8, true)
          const value = valid
            ? raw * (this.#parsed.z.increment ?? 1) + (this.#parsed.z.offset ?? 0)
            : Number.NaN
          view.setFloat64((row * selected.width + x) * 8, value, false)
        }
      }
      yield {
        x: selected.x,
        y: selected.y + localY,
        width: selected.width,
        height,
        stride: rowBytes,
        format: Object.freeze({ sampleType: 'float64', channels: 1, planar: false }),
        data: output,
      }
    }
  }
}

export const x3pReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/x3p',
  version: '1.0.0',
  format: 'X3P surface exchange',
  extensions: Object.freeze(['x3p']),
  mediaTypes: Object.freeze(['application/x-x3p']),
  capabilities: Object.freeze({ resources: 'single', datasets: 'single', axes: 'xy' }),
})

export const createX3pReader = (
  options: Readonly<{ readonly limits?: Readonly<X3pReaderLimits> }> = {},
): ScientificReader => {
  const maxXmlBytes = options.limits?.maxXmlBytes ?? 4_194_304
  const maxSurfaceBytes = options.limits?.maxSurfaceBytes ?? 536_870_912
  const rowsPerBlock = options.limits?.rowsPerBlock ?? 32
  if (
    ![maxXmlBytes, maxSurfaceBytes, rowsPerBlock].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  )
    throw invalidInput('X3P limits must be positive safe integers')
  return Object.freeze({
    descriptor: x3pReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      const bytes = await context.primary.source.read(
        0,
        4,
        context.signal === undefined ? {} : { signal: context.signal },
      )
      const zip =
        bytes.byteLength === 4 &&
        bytes[0] === 0x50 &&
        bytes[1] === 0x4b &&
        bytes[2] === 0x03 &&
        bytes[3] === 0x04
      const hinted = resourceHasHint(
        context.primary,
        x3pReaderDescriptor.extensions,
        x3pReaderDescriptor.mediaTypes,
      )
      if (!zip || !hinted)
        return Object.freeze({
          confidence: 0,
          reason: zip ? 'ZIP bytes lack an X3P resource hint' : 'ZIP signature is absent',
        })
      return Object.freeze({ confidence: 0.6, reason: 'ZIP signature and X3P resource hint match' })
    },
    async open(context: Readonly<ScientificOpenContext>) {
      const archive = await openZipArchive(
        context.primary.source,
        options.limits ?? {},
        context.signal,
      )
      const parsed = await parseX3p(archive, { maxXmlBytes, maxSurfaceBytes }, context.signal)
      const formatMetadata = normalizeScientificMetadataObject({
        ...parsed.metadata,
        width: parsed.width,
        height: parsed.height,
      })
      const dataset = descriptorWithFormatMetadata(
        new X3pDataset(parsed, context.primary.id, rowsPerBlock),
        'purejsimage:x3p',
        formatMetadata,
      )
      return singleDatasetDocument({
        context,
        reader: x3pReaderDescriptor,
        metadata: formatMetadata,
        dataset,
        datasetId: 'surface',
        datasetName: 'Surface',
      })
    },
  })
}

export const x3pReader = createX3pReader()
