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
} from '../dataset.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificMetadataObject,
  normalizeScientificPlaneReadRequest,
} from '../dataset.ts'
import type {
  ScientificDocument,
  ScientificOpenContext,
  ScientificReader,
  ScientificReaderDescriptor,
} from '../reader.ts'
import { createScientificDatasetIdentity, identifyScientificDataset } from '../reader.ts'
import { resourceHasHint } from './shared.ts'

const signature = new TextEncoder().encode(':NANONIS_VERSION:')
const endMarker = new TextEncoder().encode(':SCANIT_END:')
const binaryMarker = Uint8Array.of(0x1a, 0x04)

export interface NanonisSxmReaderLimits {
  readonly maxHeaderBytes?: number
  readonly maxDatasets?: number
  readonly rowsPerBlock?: number
}

export interface NanonisSxmReaderOptions {
  readonly limits?: Readonly<NanonisSxmReaderLimits>
}

interface SxmChannel {
  readonly name: string
  readonly unit: string
  readonly direction: 'forward' | 'backward'
  readonly dataOffset: number
  readonly calibration: number
  readonly offset: number
}

interface ParsedSxm {
  readonly width: number
  readonly height: number
  readonly rangeX: number
  readonly rangeY: number
  readonly offsetX: number
  readonly offsetY: number
  readonly angle: number
  readonly bias?: number
  readonly setpoint?: string
  readonly scanDirection: string
  readonly channels: readonly SxmChannel[]
  readonly header: Readonly<Record<string, string>>
}

const positiveInteger = (label: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) throw invalidInput(`${label} must be positive`)
  return value
}

const finite = (label: string, value: string): number => {
  const parsed = Number(value.trim())
  if (!Number.isFinite(parsed)) throw invalidInput(`Nanonis SXM ${label} must be finite`)
  return parsed
}

const splitNumbers = (label: string, value: string, count: number): readonly number[] => {
  const values = value
    .trim()
    .split(/\s+/u)
    .map((part) => finite(label, part))
  if (values.length !== count) throw invalidInput(`Nanonis SXM ${label} requires ${count} values`)
  return values
}

const findBytes = (haystack: Uint8Array, needle: Uint8Array, start = 0): number => {
  outer: for (let offset = start; offset <= haystack.byteLength - needle.byteLength; offset += 1) {
    for (let index = 0; index < needle.byteLength; index += 1) {
      if (haystack[offset + index] !== needle[index]) continue outer
    }
    return offset
  }
  return -1
}

const parseSections = (text: string): ReadonlyMap<string, string> => {
  const sections = new Map<string, string>()
  const matches = [...text.matchAll(/^:([^:\r\n]+):\r?$/gmu)]
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const name = match?.[1]
    if (match === undefined || name === undefined || match.index === undefined) continue
    const start = match.index + match[0].length
    const end = matches[index + 1]?.index ?? text.length
    if (sections.has(name)) throw invalidInput(`Nanonis SXM section ${name} occurs more than once`)
    sections.set(
      name,
      text
        .slice(start, end)
        .replace(/^\r?\n/u, '')
        .replace(/\r?\n$/u, ''),
    )
  }
  return sections
}

const required = (sections: ReadonlyMap<string, string>, name: string): string => {
  const value = sections.get(name)
  if (value === undefined || value.trim().length === 0)
    throw invalidInput(`Nanonis SXM requires ${name}`)
  return value
}

const parseChannels = (
  value: string,
  dataOffset: number,
  planeBytes: number,
  maximum: number,
): readonly SxmChannel[] => {
  const lines = value.split(/\r?\n/u).filter((line) => line.trim().length > 0)
  if (lines.length < 2 || !lines[0]?.includes('Direction'))
    throw invalidInput('Nanonis SXM DATA_INFO header is invalid')
  const channels: SxmChannel[] = []
  let plane = 0
  for (const line of lines.slice(1)) {
    const fields = line.trim().split(/\t+/u)
    if (fields.length < 6) throw invalidInput('Nanonis SXM DATA_INFO row is truncated')
    const name = fields[1]?.trim().replaceAll('_', ' ') ?? ''
    const unit = fields[2]?.trim() ?? ''
    const direction = fields[3]?.trim().toLowerCase()
    const calibration = finite('channel calibration', fields[4] ?? '')
    const offset = finite('channel offset', fields[5] ?? '')
    const directions: readonly ('forward' | 'backward')[] =
      direction === 'both'
        ? ['forward', 'backward']
        : direction === 'forward'
          ? ['forward']
          : direction === 'backward'
            ? ['backward']
            : (() => {
                throw unsupportedOperation(`Nanonis SXM direction ${direction} is unsupported`)
              })()
    for (const selected of directions) {
      if (channels.length >= maximum)
        throw limitExceeded(`Nanonis SXM exposes more than ${maximum} datasets`)
      channels.push(
        Object.freeze({
          name,
          unit,
          direction: selected,
          calibration,
          offset,
          dataOffset: dataOffset + plane * planeBytes,
        }),
      )
      plane += 1
    }
  }
  return Object.freeze(channels)
}

const parseSxm = async (
  source: ImageSource,
  limits: Required<NanonisSxmReaderLimits>,
  signal?: AbortSignal,
): Promise<ParsedSxm> => {
  throwIfAborted(signal)
  const amount = Math.min(source.size, limits.maxHeaderBytes)
  const prefix = await source.read(0, amount, signal === undefined ? {} : { signal })
  if (findBytes(prefix, signature) !== 0) throw invalidInput('Nanonis SXM signature is missing')
  const end = findBytes(prefix, endMarker)
  if (end < 0) {
    if (source.size > amount)
      throw limitExceeded(`Nanonis SXM header exceeds ${limits.maxHeaderBytes} bytes`)
    throw truncatedInput('Nanonis SXM SCANIT_END marker is missing')
  }
  const marker = findBytes(prefix, binaryMarker, end + endMarker.byteLength)
  if (marker < 0) throw truncatedInput('Nanonis SXM binary marker is missing')
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(
      prefix.subarray(0, end + endMarker.byteLength),
    )
  } catch {
    throw invalidInput('Nanonis SXM header is not valid UTF-8')
  }
  const sections = parseSections(text)
  const version = required(sections, 'NANONIS_VERSION').trim()
  if (version !== '2') throw unsupportedOperation(`Nanonis SXM version ${version} is unsupported`)
  const storage = required(sections, 'SCANIT_TYPE').trim().split(/\s+/u)
  if (storage[0] !== 'FLOAT' || storage[1] !== 'MSBFIRST') {
    throw unsupportedOperation('Nanonis SXM supports only FLOAT MSBFIRST image data')
  }
  const dimensions = splitNumbers('SCAN_PIXELS', required(sections, 'SCAN_PIXELS'), 2)
  const width = positiveInteger('Nanonis SXM width', dimensions[0] ?? 0)
  const height = positiveInteger('Nanonis SXM height', dimensions[1] ?? 0)
  const range = splitNumbers('SCAN_RANGE', required(sections, 'SCAN_RANGE'), 2)
  const offsets = splitNumbers('SCAN_OFFSET', required(sections, 'SCAN_OFFSET'), 2)
  if ((range[0] ?? 0) <= 0 || (range[1] ?? 0) <= 0)
    throw invalidInput('Nanonis SXM scan range must be positive')
  const dataOffset = marker + binaryMarker.byteLength
  const planeBytesBig = BigInt(width) * BigInt(height) * 4n
  if (planeBytesBig > BigInt(Number.MAX_SAFE_INTEGER))
    throw limitExceeded('Nanonis SXM plane is too large')
  const planeBytes = Number(planeBytesBig)
  const channels = parseChannels(
    required(sections, 'DATA_INFO'),
    dataOffset,
    planeBytes,
    limits.maxDatasets,
  )
  const expected = BigInt(dataOffset) + BigInt(channels.length) * planeBytesBig
  if (expected > BigInt(source.size)) throw truncatedInput('Nanonis SXM image payload is truncated')
  if (expected < BigInt(source.size))
    throw invalidInput('Nanonis SXM contains unexpected trailing data')
  const header = Object.freeze(Object.fromEntries(sections))
  const zController = sections.get('Z-CONTROLLER')?.split(/\r?\n/u).at(-1)?.trim()
  return Object.freeze({
    width,
    height,
    rangeX: range[0] ?? 0,
    rangeY: range[1] ?? 0,
    offsetX: offsets[0] ?? 0,
    offsetY: offsets[1] ?? 0,
    angle: finite('SCAN_ANGLE', required(sections, 'SCAN_ANGLE')),
    ...(sections.get('BIAS') === undefined
      ? {}
      : { bias: finite('BIAS', sections.get('BIAS') ?? '') }),
    ...(zController === undefined || zController.length === 0 ? {} : { setpoint: zController }),
    scanDirection: required(sections, 'SCAN_DIR').trim().toLowerCase(),
    channels,
    header,
  })
}

const datasetId = (channel: SxmChannel, index: number): string => {
  const name =
    channel.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-|-$/gu, '') || 'channel'
  return `${name}-${channel.direction}-${index}`
}

class SxmDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #source: ImageSource
  readonly #channel: SxmChannel
  readonly #width: number
  readonly #height: number
  readonly #rowsPerBlock: number

  constructor(
    source: ImageSource,
    parsed: ParsedSxm,
    channel: SxmChannel,
    resourceId: string,
    rowsPerBlock: number,
  ) {
    this.#source = source
    this.#channel = channel
    this.#width = parsed.width
    this.#height = parsed.height
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
            origin: parsed.offsetX,
            step: parsed.rangeX / Math.max(1, parsed.width - 1),
          },
          calibration: {
            kind: 'embedded',
            resourceId,
            locator: 'sxm:SCAN_OFFSET[0],SCAN_RANGE[0],SCAN_PIXELS[0]',
          },
        },
        {
          id: 'y',
          name: 'Y (file row order)',
          kind: 'space',
          length: parsed.height,
          unit: 'm',
          coordinates: {
            type: 'linear',
            origin: parsed.offsetY + parsed.rangeY,
            step: -parsed.rangeY / Math.max(1, parsed.height - 1),
          },
          calibration: {
            kind: 'embedded',
            resourceId,
            locator: 'sxm:SCAN_OFFSET[1],SCAN_RANGE[1],SCAN_PIXELS[1]',
            note: 'Rows remain in recorded top-to-bottom file order; no vertical flip is applied.',
          },
        },
      ],
      sampleType: 'float32',
      components: [
        {
          id: 'value',
          name: channel.name,
          kind: 'scalar',
          ...(channel.unit.length === 0 ? {} : { unit: channel.unit }),
        },
      ],
      metadata: normalizeScientificMetadataObject({
        direction: channel.direction,
        scanDirection: parsed.scanDirection,
        calibration: channel.calibration,
        offset: channel.offset,
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
    const rowBytes = selected.width * 4
    for (let localY = 0; localY < selected.height; localY += this.#rowsPerBlock) {
      throwIfAborted(selected.signal)
      const height = Math.min(this.#rowsPerBlock, selected.height - localY)
      const data = new Uint8Array(rowBytes * height)
      for (let row = 0; row < height; row += 1) {
        const offset =
          this.#channel.dataOffset + ((selected.y + localY + row) * this.#width + selected.x) * 4
        data.set(
          await readExactly(
            this.#source,
            offset,
            rowBytes,
            selected.signal === undefined ? {} : { signal: selected.signal },
          ),
          row * rowBytes,
        )
      }
      yield {
        x: selected.x,
        y: selected.y + localY,
        width: selected.width,
        height,
        stride: rowBytes,
        format: Object.freeze({ sampleType: 'float32', channels: 1, planar: false }),
        data,
      }
    }
  }
}

export const nanonisSxmReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/nanonis-sxm',
  version: '1.0.0',
  format: 'Nanonis SXM',
  extensions: Object.freeze(['sxm']),
  mediaTypes: Object.freeze(['application/x-nanonis-sxm']),
  capabilities: Object.freeze({ resources: 'single', datasets: 'multiple', axes: 'xy' }),
})

export const createNanonisSxmReader = (
  options: Readonly<NanonisSxmReaderOptions> = {},
): ScientificReader => {
  const limits: Required<NanonisSxmReaderLimits> = Object.freeze({
    maxHeaderBytes: positiveInteger(
      'Nanonis SXM maxHeaderBytes',
      options.limits?.maxHeaderBytes ?? 1_048_576,
    ),
    maxDatasets: positiveInteger('Nanonis SXM maxDatasets', options.limits?.maxDatasets ?? 1_024),
    rowsPerBlock: positiveInteger('Nanonis SXM rowsPerBlock', options.limits?.rowsPerBlock ?? 32),
  })
  return Object.freeze({
    descriptor: nanonisSxmReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      const bytes = await context.primary.source.read(
        0,
        signature.byteLength,
        context.signal === undefined ? {} : { signal: context.signal },
      )
      const matches =
        bytes.byteLength === signature.byteLength &&
        bytes.every((byte, index) => byte === signature[index])
      if (!matches)
        return Object.freeze({ confidence: 0, reason: 'Nanonis SXM signature is absent' })
      const hinted = resourceHasHint(
        context.primary,
        nanonisSxmReaderDescriptor.extensions,
        nanonisSxmReaderDescriptor.mediaTypes,
      )
      return Object.freeze({
        confidence: hinted ? 1 : 0.99,
        reason: hinted ? 'Nanonis SXM signature and hint match' : 'Nanonis SXM signature matches',
      })
    },
    async open(context: Readonly<ScientificOpenContext>): Promise<ScientificDocument> {
      const parsed = await parseSxm(context.primary.source, limits, context.signal)
      const metadata: ScientificMetadataObject = normalizeScientificMetadataObject({
        width: parsed.width,
        height: parsed.height,
        rangeX: parsed.rangeX,
        rangeY: parsed.rangeY,
        offsetX: parsed.offsetX,
        offsetY: parsed.offsetY,
        angleDegrees: parsed.angle,
        scanDirection: parsed.scanDirection,
        ...(parsed.bias === undefined ? {} : { biasVolts: parsed.bias }),
        ...(parsed.setpoint === undefined ? {} : { zController: parsed.setpoint }),
        header: parsed.header,
      })
      const datasets = []
      const opened = new Map<string, ScientificDataset>()
      for (let index = 0; index < parsed.channels.length; index += 1) {
        const channel = parsed.channels[index]
        if (channel === undefined) continue
        const id = datasetId(channel, index)
        const identity = await createScientificDatasetIdentity({
          reader: nanonisSxmReaderDescriptor,
          datasetId: id,
          resources: [context.primary],
        })
        const dataset = identifyScientificDataset(
          new SxmDataset(
            context.primary.source,
            parsed,
            channel,
            context.primary.id,
            limits.rowsPerBlock,
          ),
          identity,
        )
        opened.set(id, dataset)
        datasets.push(
          Object.freeze({
            id,
            name: `${channel.name} (${channel.direction})`,
            descriptor: dataset.descriptor,
            identity,
          }),
        )
      }
      return Object.freeze({
        reader: Object.freeze({
          id: nanonisSxmReaderDescriptor.id,
          version: nanonisSxmReaderDescriptor.version,
        }),
        format: nanonisSxmReaderDescriptor.format,
        metadata,
        datasets: Object.freeze(datasets),
        async openDataset(id: string, openOptions?: Readonly<AbortOptions>) {
          throwIfAborted(openOptions?.signal ?? context.signal)
          const dataset = opened.get(id)
          if (dataset === undefined) throw invalidInput(`Unknown Nanonis SXM dataset ${id}`)
          return dataset
        },
      })
    },
  })
}

export const nanonisSxmReader = createNanonisSxmReader()
