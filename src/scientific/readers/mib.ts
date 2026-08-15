import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import type { RasterBlock, RasterSampleType } from '../../raster.ts'
import { rasterSampleBytes } from '../../raster.ts'
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
  ScientificResource,
} from '../reader.ts'
import { createScientificDatasetIdentity, identifyScientificDataset } from '../reader.ts'
import { resourceHasHint } from './shared.ts'

export interface MibReaderLimits {
  readonly maxFrames?: number
  readonly maxFramePixels?: number
  readonly maxHeaderBytes?: number
  readonly maxRegionBytes?: number
  readonly maxReadOperations?: number
  readonly rowsPerBlock?: number
}

export interface MibReaderOptions {
  readonly limits?: MibReaderLimits
}

interface ResolvedLimits {
  readonly maxFrames: number
  readonly maxFramePixels: number
  readonly maxHeaderBytes: number
  readonly maxRegionBytes: number
  readonly maxReadOperations: number
  readonly rowsPerBlock: number
}

interface MibHeader {
  readonly fields: readonly string[]
  readonly headerBytes: number
  readonly width: number
  readonly height: number
  readonly sampleType: RasterSampleType
  readonly dataCode: string
  readonly geometry: string
  readonly timestamp: string
  readonly exposureNanoseconds: number
}

const positive = (value: number | undefined, fallback: number, label: string): number => {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1)
    throw invalidInput(`${label} must be positive`)
  return resolved
}

const resolveLimits = (input: MibReaderLimits = {}): Readonly<ResolvedLimits> =>
  Object.freeze({
    maxFrames: positive(input.maxFrames, 10_000_000, 'MIB maxFrames'),
    maxFramePixels: positive(input.maxFramePixels, 67_108_864, 'MIB maxFramePixels'),
    maxHeaderBytes: positive(input.maxHeaderBytes, 65_536, 'MIB maxHeaderBytes'),
    maxRegionBytes: positive(input.maxRegionBytes, 67_108_864, 'MIB maxRegionBytes'),
    maxReadOperations: positive(input.maxReadOperations, 1_048_576, 'MIB maxReadOperations'),
    rowsPerBlock: positive(input.rowsPerBlock, 32, 'MIB rowsPerBlock'),
  })

const parseHeader = (bytes: Uint8Array): MibHeader => {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replaceAll('\0', '')
  } catch {
    throw invalidInput('MIB frame header is not valid UTF-8')
  }
  const fields = Object.freeze(text.split(',').map((field) => field.trim()))
  if (fields.length < 10) throw invalidInput('MIB frame header is truncated')
  const headerBytes = Number(fields[2])
  const width = Number(fields[4])
  const height = Number(fields[5])
  if (
    (headerBytes !== 384 && headerBytes !== 768) ||
    !Number.isSafeInteger(width) ||
    width < 1 ||
    !Number.isSafeInteger(height) ||
    height < 1
  ) {
    throw invalidInput('MIB frame geometry is invalid')
  }
  const dataCode = fields[6] ?? ''
  const sampleType: RasterSampleType =
    dataCode === 'U08'
      ? 'uint8'
      : dataCode === 'U16'
        ? 'uint16'
        : dataCode === 'U32'
          ? 'uint32'
          : (() => {
              if (dataCode === 'R64')
                throw unsupportedOperation('Raw packed R64 MIB data is unsupported')
              throw unsupportedOperation(`MIB data code ${dataCode} is unsupported`)
            })()
  const exposureText = fields.at(-3) ?? ''
  const exposureNanoseconds = Number(exposureText.replace(/ns$/iu, ''))
  if (!Number.isFinite(exposureNanoseconds) || exposureNanoseconds < 0)
    throw invalidInput('MIB exposure is invalid')
  return Object.freeze({
    fields,
    headerBytes,
    width,
    height,
    sampleType,
    dataCode,
    geometry: fields[7] ?? '',
    timestamp: fields.at(-4) ?? '',
    exposureNanoseconds,
  })
}

const readFirstHeader = async (source: ImageSource, signal?: AbortSignal): Promise<MibHeader> => {
  const prefix = await readExactly(
    source,
    0,
    Math.min(384, source.size),
    signal === undefined ? {} : { signal },
  )
  const provisional = parseHeader(prefix)
  if (provisional.headerBytes === 384) return provisional
  return parseHeader(await readExactly(source, 0, 768, signal === undefined ? {} : { signal }))
}

const stem = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot > name.lastIndexOf('/') ? name.slice(0, dot) : name
}

const optionalHdr = async (
  context: Readonly<ScientificOpenContext>,
  limits: Readonly<ResolvedLimits>,
): Promise<
  | { readonly resource: ScientificResource; readonly fields: Readonly<Record<string, string>> }
  | undefined
> => {
  if (context.companions === undefined || context.primary.name === undefined) return undefined
  const resource = await context.companions.resolve(
    { kind: 'relative-name', name: `${stem(context.primary.name)}.hdr` },
    context.signal === undefined ? {} : { signal: context.signal },
  )
  if (resource === undefined) return undefined
  if (resource.source.size > limits.maxHeaderBytes)
    throw limitExceeded('MIB HDR sidecar exceeds maxHeaderBytes')
  const bytes = await readExactly(
    resource.source,
    0,
    resource.source.size,
    context.signal === undefined ? {} : { signal: context.signal },
  )
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw invalidInput('MIB HDR sidecar is not valid UTF-8')
  }
  const fields: Record<string, string> = {}
  for (const line of text.split(/\r?\n|\r/u)) {
    if (line.startsWith('HDR') || line.startsWith('End\t') || line.trim().length === 0) continue
    const tab = line.indexOf('\t')
    if (tab < 1) throw invalidInput('MIB HDR sidecar line is invalid')
    const key = line.slice(0, tab).replace(/:$/u, '').trim()
    if (fields[key] !== undefined) throw invalidInput(`MIB HDR field ${key} occurs more than once`)
    fields[key] = line.slice(tab + 1).trim()
  }
  return Object.freeze({ resource, fields: Object.freeze(fields) })
}

class MibDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #source: ImageSource
  readonly #header: MibHeader
  readonly #frameCount: number
  readonly #scanX: number
  readonly #scanY: number
  readonly #limits: Readonly<ResolvedLimits>

  constructor(
    source: ImageSource,
    header: MibHeader,
    frameCount: number,
    scanX: number,
    scanY: number,
    limits: Readonly<ResolvedLimits>,
  ) {
    this.#source = source
    this.#header = header
    this.#frameCount = frameCount
    this.#scanX = scanX
    this.#scanY = scanY
    this.#limits = limits
    const navigationAxes =
      scanY > 1
        ? [
            {
              id: 'scanX',
              name: 'Scan X',
              kind: 'space' as const,
              length: scanX,
              coordinates: { type: 'index' as const },
            },
            {
              id: 'scanY',
              name: 'Scan Y',
              kind: 'space' as const,
              length: scanY,
              coordinates: { type: 'index' as const },
            },
          ]
        : [
            {
              id: 'frame',
              name: 'Frame',
              kind: 'index' as const,
              length: frameCount,
              coordinates: { type: 'index' as const },
            },
          ]
    this.descriptor = normalizeScientificDatasetDescriptor({
      schemaVersion: 1,
      axes: [
        {
          id: 'kx',
          name: 'Detector X',
          kind: 'reciprocal-space',
          length: header.width,
          coordinates: { type: 'index' },
        },
        {
          id: 'ky',
          name: 'Detector Y',
          kind: 'reciprocal-space',
          length: header.height,
          coordinates: { type: 'index' },
        },
        ...navigationAxes,
      ],
      sampleType: header.sampleType,
      components: [{ id: 'counts', name: 'Detector counts', kind: 'intensity' }],
      metadata: {
        exposureSeconds: header.exposureNanoseconds / 1e9,
        timestamp: header.timestamp,
        geometry: header.geometry,
      },
      capabilities: {
        regionReads: true,
        resolutionLevels: false,
        planeReads: { kind: 'ordered-axis-pairs', pairs: [['kx', 'ky']] },
      },
    })
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<RasterBlock> {
    const selected = normalizeScientificPlaneReadRequest(this.descriptor, request)
    const frame =
      this.#scanY > 1
        ? (selected.fixedIndices.find((entry) => entry.axisId === 'scanY')?.index ?? 0) *
            this.#scanX +
          (selected.fixedIndices.find((entry) => entry.axisId === 'scanX')?.index ?? 0)
        : (selected.fixedIndices.find((entry) => entry.axisId === 'frame')?.index ?? 0)
    if (frame < 0 || frame >= this.#frameCount) throw invalidInput('MIB frame is outside the file')
    const sampleBytes = rasterSampleBytes(this.#header.sampleType)
    const framePixels = this.#header.width * this.#header.height
    const recordBytes = this.#header.headerBytes + framePixels * sampleBytes
    const recordOffset = frame * recordBytes
    const current = parseHeader(
      await readExactly(
        this.#source,
        recordOffset,
        this.#header.headerBytes,
        selected.signal === undefined ? {} : { signal: selected.signal },
      ),
    )
    if (
      current.width !== this.#header.width ||
      current.height !== this.#header.height ||
      current.sampleType !== this.#header.sampleType ||
      current.headerBytes !== this.#header.headerBytes
    )
      throw invalidInput('MIB frame headers disagree')
    const rowBytes = selected.width * sampleBytes
    if (rowBytes > this.#limits.maxRegionBytes)
      throw limitExceeded('MIB row exceeds maxRegionBytes')
    const rows = Math.max(
      1,
      Math.min(this.#limits.rowsPerBlock, Math.floor(this.#limits.maxRegionBytes / rowBytes)),
    )
    let operations = 1
    for (let localY = 0; localY < selected.height; localY += rows) {
      throwIfAborted(selected.signal)
      const height = Math.min(rows, selected.height - localY)
      const data = new Uint8Array(rowBytes * height)
      for (let row = 0; row < height; row += 1) {
        operations += 1
        if (operations > this.#limits.maxReadOperations)
          throw limitExceeded('MIB request exceeds maxReadOperations')
        const fileY = this.#header.height - 1 - (selected.y + localY + row)
        const offset =
          recordOffset +
          this.#header.headerBytes +
          (fileY * this.#header.width + selected.x) * sampleBytes
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
        format: Object.freeze({ sampleType: this.#header.sampleType, channels: 1, planar: false }),
        data,
      }
    }
  }
}

export const mibReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/mib',
  version: '1.0.0',
  format: 'Quantum Detectors Merlin MIB',
  extensions: Object.freeze(['mib']),
  mediaTypes: Object.freeze(['application/x-merlin-mib']),
  capabilities: Object.freeze({
    resources: 'single-with-optional-sidecar',
    datasets: 'single',
    axes: '4d-stem',
  }),
})

export const createMibReader = (options: Readonly<MibReaderOptions> = {}): ScientificReader => {
  const limits = resolveLimits(options.limits)
  return Object.freeze({
    descriptor: mibReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      try {
        const header = await readFirstHeader(context.primary.source, context.signal)
        const hinted = resourceHasHint(
          context.primary,
          mibReaderDescriptor.extensions,
          mibReaderDescriptor.mediaTypes,
        )
        return Object.freeze({
          confidence: hinted ? 1 : 0.98,
          reason: `MIB ${header.dataCode} frame structure matches`,
        })
      } catch (error) {
        if (error instanceof Error && error.message.includes('R64')) {
          const hinted = resourceHasHint(
            context.primary,
            mibReaderDescriptor.extensions,
            mibReaderDescriptor.mediaTypes,
          )
          return Object.freeze({
            confidence: hinted ? 1 : 0.98,
            reason: 'MIB packed R64 frame structure matches but requires an unsupported decoder',
          })
        }
        return Object.freeze({ confidence: 0, reason: 'MIB frame structure is absent' })
      }
    },
    async open(context: Readonly<ScientificOpenContext>): Promise<ScientificDocument> {
      throwIfAborted(context.signal)
      const header = await readFirstHeader(context.primary.source, context.signal)
      const framePixels = header.width * header.height
      if (!Number.isSafeInteger(framePixels) || framePixels > limits.maxFramePixels)
        throw limitExceeded(`MIB frame pixels exceed ${limits.maxFramePixels}`)
      const recordBytes = header.headerBytes + framePixels * rasterSampleBytes(header.sampleType)
      if (context.primary.source.size % recordBytes !== 0)
        throw invalidInput('MIB file ends with an incomplete frame')
      const frameCount = context.primary.source.size / recordBytes
      if (!Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > limits.maxFrames)
        throw limitExceeded(`MIB frame count exceeds ${limits.maxFrames}`)
      const hdr = await optionalHdr(context, limits)
      const framesPerTrigger = Number(hdr?.fields['Frames per Trigger (Number)'] ?? '0')
      const framesInAcquisition = Number(hdr?.fields['Frames in Acquisition (Number)'] ?? '0')
      const hasNavigation =
        Number.isSafeInteger(framesPerTrigger) &&
        framesPerTrigger > 0 &&
        framesInAcquisition === frameCount &&
        frameCount % framesPerTrigger === 0
      const scanX = hasNavigation ? framesPerTrigger : frameCount
      const scanY = hasNavigation ? frameCount / framesPerTrigger : 1
      const resources = hdr === undefined ? [context.primary] : [context.primary, hdr.resource]
      const identity = await createScientificDatasetIdentity({
        reader: mibReaderDescriptor,
        datasetId: 'diffraction',
        resources,
      })
      const dataset = identifyScientificDataset(
        new MibDataset(context.primary.source, header, frameCount, scanX, scanY, limits),
        identity,
      )
      const metadata: ScientificMetadataObject = normalizeScientificMetadataObject({
        frameHeader: header.fields,
        frameCount,
        exposureSeconds: header.exposureNanoseconds / 1e9,
        timestamp: header.timestamp,
        geometry: header.geometry,
        ...(hdr === undefined ? {} : { hdr: hdr.fields }),
      })
      return Object.freeze({
        reader: Object.freeze({ id: mibReaderDescriptor.id, version: mibReaderDescriptor.version }),
        format: mibReaderDescriptor.format,
        metadata,
        datasets: Object.freeze([
          Object.freeze({
            id: 'diffraction',
            name: 'Merlin diffraction frames',
            descriptor: dataset.descriptor,
            identity,
          }),
        ]),
        async openDataset(id: string, openOptions?: { readonly signal?: AbortSignal }) {
          throwIfAborted(openOptions?.signal ?? context.signal)
          if (id !== 'diffraction') throw invalidInput(`Unknown MIB dataset ${id}`)
          return dataset
        },
      })
    },
  })
}

export const mibReader = createMibReader()
