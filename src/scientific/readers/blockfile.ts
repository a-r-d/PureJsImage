import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded } from '../../errors.ts'
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
import { createContiguousArrayDataset } from './interchange-shared.ts'
import { resourceHasHint } from './shared.ts'

export interface BlockfileReaderLimits {
  readonly maxFrames?: number
  readonly maxFramePixels?: number
  readonly maxHeaderBytes?: number
  readonly maxRegionBytes?: number
  readonly maxReadOperations?: number
  readonly rowsPerBlock?: number
}

export interface BlockfileReaderOptions {
  readonly limits?: BlockfileReaderLimits
}

interface ParsedBlockfile {
  readonly littleEndian: boolean
  readonly dataOffset1: number
  readonly dataOffset2: number
  readonly dpSize: number
  readonly nx: number
  readonly ny: number
  readonly sx: number
  readonly sy: number
  readonly sdp: number
  readonly dpRotation: number
  readonly scanRotation: number
  readonly beamEnergy: number
  readonly cameraLength: number
  readonly acquisitionTime: number
  readonly note: string
}

interface ResolvedLimits {
  readonly maxFrames: number
  readonly maxFramePixels: number
  readonly maxHeaderBytes: number
  readonly maxRegionBytes: number
  readonly maxReadOperations: number
  readonly rowsPerBlock: number
}

const positive = (value: number | undefined, fallback: number, label: string): number => {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1)
    throw invalidInput(`${label} must be positive`)
  return resolved
}

const resolveLimits = (input: BlockfileReaderLimits = {}): Readonly<ResolvedLimits> =>
  Object.freeze({
    maxFrames: positive(input.maxFrames, 1_000_000, 'BLO maxFrames'),
    maxFramePixels: positive(input.maxFramePixels, 67_108_864, 'BLO maxFramePixels'),
    maxHeaderBytes: positive(input.maxHeaderBytes, 1_048_576, 'BLO maxHeaderBytes'),
    maxRegionBytes: positive(input.maxRegionBytes, 67_108_864, 'BLO maxRegionBytes'),
    maxReadOperations: positive(input.maxReadOperations, 1_048_576, 'BLO maxReadOperations'),
    rowsPerBlock: positive(input.rowsPerBlock, 32, 'BLO rowsPerBlock'),
  })

const parseBlockfile = async (
  source: ImageSource,
  limits: Readonly<ResolvedLimits>,
  signal?: AbortSignal,
): Promise<ParsedBlockfile> => {
  const bytes = await readExactly(source, 0, 240, signal === undefined ? {} : { signal })
  const id = new TextDecoder('latin1').decode(bytes.subarray(0, 6))
  if (id !== 'IMGBLO') throw invalidInput('BLO ID is missing')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const littleEndian = view.getUint16(6, true) === 0x0102
  if (!littleEndian && view.getUint16(6, false) !== 0x0102)
    throw invalidInput('BLO magic is invalid')
  const u16 = (offset: number): number => view.getUint16(offset, littleEndian)
  const u32 = (offset: number): number => view.getUint32(offset, littleEndian)
  const f64 = (offset: number): number => view.getFloat64(offset, littleEndian)
  const dataOffset1 = u32(8)
  const dataOffset2 = u32(12)
  const dpSize = u16(20)
  const nx = u16(24)
  const ny = u16(26)
  const frames = nx * ny
  const framePixels = dpSize * dpSize
  if (nx < 1 || ny < 1 || frames > limits.maxFrames)
    throw limitExceeded(`BLO frame count exceeds ${limits.maxFrames}`)
  if (dpSize < 1 || framePixels > limits.maxFramePixels)
    throw limitExceeded(`BLO frame pixels exceed ${limits.maxFramePixels}`)
  if (dataOffset1 < 240 || dataOffset2 < dataOffset1 + frames)
    throw invalidInput('BLO data offsets are invalid')
  if (dataOffset1 > limits.maxHeaderBytes)
    throw limitExceeded(`BLO header exceeds ${limits.maxHeaderBytes} bytes`)
  const recordBytes = 6 + framePixels
  const expected = dataOffset2 + frames * recordBytes
  if (!Number.isSafeInteger(expected) || expected !== source.size)
    throw invalidInput('BLO file size does not match its dimensions')
  const noteBytes = await readExactly(
    source,
    240,
    dataOffset1 - 240,
    signal === undefined ? {} : { signal },
  )
  const note = new TextDecoder('latin1').decode(noteBytes).replaceAll('\0', '').trim()
  return Object.freeze({
    littleEndian,
    dataOffset1,
    dataOffset2,
    dpSize,
    nx,
    ny,
    sx: f64(30),
    sy: f64(38),
    sdp: u16(50),
    dpRotation: u16(22) / 100,
    scanRotation: u16(28) / 100,
    beamEnergy: u32(46),
    cameraLength: u32(52) / 10,
    acquisitionTime: f64(56),
    note,
  })
}

class BlockfileDiffractionDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #source: ImageSource
  readonly #parsed: ParsedBlockfile
  readonly #limits: Readonly<ResolvedLimits>

  constructor(
    source: ImageSource,
    parsed: ParsedBlockfile,
    limits: Readonly<ResolvedLimits>,
    resourceId: string,
  ) {
    this.#source = source
    this.#parsed = parsed
    this.#limits = limits
    const diffractionStep = parsed.sdp === 0 ? undefined : 100 / parsed.sdp
    this.descriptor = normalizeScientificDatasetDescriptor({
      schemaVersion: 1,
      axes: [
        {
          id: 'kx',
          name: 'Diffraction X',
          kind: 'other',
          length: parsed.dpSize,
          ...(diffractionStep === undefined ? {} : { unit: 'cm' }),
          coordinates:
            diffractionStep === undefined
              ? { type: 'index' }
              : { type: 'linear', origin: 0, step: diffractionStep },
          ...(diffractionStep === undefined
            ? {}
            : {
                calibration: {
                  kind: 'embedded',
                  resourceId,
                  locator: 'blo:SDP',
                  formula: 'step = 100 / SDP cm',
                },
              }),
        },
        {
          id: 'ky',
          name: 'Diffraction Y',
          kind: 'other',
          length: parsed.dpSize,
          ...(diffractionStep === undefined ? {} : { unit: 'cm' }),
          coordinates:
            diffractionStep === undefined
              ? { type: 'index' }
              : { type: 'linear', origin: 0, step: diffractionStep },
          ...(diffractionStep === undefined
            ? {}
            : {
                calibration: {
                  kind: 'embedded',
                  resourceId,
                  locator: 'blo:SDP',
                  formula: 'step = 100 / SDP cm',
                },
              }),
        },
        {
          id: 'scanX',
          name: 'Scan X',
          kind: 'space',
          length: parsed.nx,
          unit: 'nm',
          coordinates: { type: 'linear', origin: 0, step: parsed.sx },
          calibration: { kind: 'embedded', resourceId, locator: 'blo:SX' },
        },
        {
          id: 'scanY',
          name: 'Scan Y',
          kind: 'space',
          length: parsed.ny,
          unit: 'nm',
          coordinates: { type: 'linear', origin: 0, step: parsed.sy },
          calibration: { kind: 'embedded', resourceId, locator: 'blo:SY' },
        },
      ],
      sampleType: 'uint8',
      components: [{ id: 'intensity', name: 'Diffraction intensity', kind: 'intensity' }],
      capabilities: {
        regionReads: true,
        resolutionLevels: false,
        planeReads: { kind: 'ordered-axis-pairs', pairs: [['kx', 'ky']] },
      },
    })
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<RasterBlock> {
    const selected = normalizeScientificPlaneReadRequest(this.descriptor, request)
    const scanX = selected.fixedIndices.find((entry) => entry.axisId === 'scanX')?.index ?? 0
    const scanY = selected.fixedIndices.find((entry) => entry.axisId === 'scanY')?.index ?? 0
    const frame = scanY * this.#parsed.nx + scanX
    const frameBytes = this.#parsed.dpSize * this.#parsed.dpSize
    const recordOffset = this.#parsed.dataOffset2 + frame * (frameBytes + 6)
    const header = await readExactly(
      this.#source,
      recordOffset,
      6,
      selected.signal === undefined ? {} : { signal: selected.signal },
    )
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
    if (
      view.getUint16(0, this.#parsed.littleEndian) !== 0x55aa ||
      view.getUint32(2, this.#parsed.littleEndian) !== frame
    )
      throw invalidInput('BLO frame header is invalid')
    const rowBytes = selected.width
    if (rowBytes > this.#limits.maxRegionBytes)
      throw limitExceeded('BLO row exceeds maxRegionBytes')
    const blockRows = Math.max(
      1,
      Math.min(this.#limits.rowsPerBlock, Math.floor(this.#limits.maxRegionBytes / rowBytes)),
    )
    let operations = 1
    for (let localY = 0; localY < selected.height; localY += blockRows) {
      throwIfAborted(selected.signal)
      const height = Math.min(blockRows, selected.height - localY)
      const data = new Uint8Array(rowBytes * height)
      for (let row = 0; row < height; row += 1) {
        operations += 1
        if (operations > this.#limits.maxReadOperations)
          throw limitExceeded('BLO request exceeds maxReadOperations')
        const fileY = this.#parsed.dpSize - 1 - (selected.y + localY + row)
        const bytes = await readExactly(
          this.#source,
          recordOffset + 6 + fileY * this.#parsed.dpSize + selected.x,
          rowBytes,
          selected.signal === undefined ? {} : { signal: selected.signal },
        )
        data.set(bytes, row * rowBytes)
      }
      yield {
        x: selected.x,
        y: selected.y + localY,
        width: selected.width,
        height,
        stride: rowBytes,
        format: Object.freeze({ sampleType: 'uint8', channels: 1, planar: false }),
        data,
      }
    }
  }
}

export const blockfileReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/blockfile',
  version: '1.0.0',
  format: 'NanoMegas ASTAR blockfile',
  extensions: Object.freeze(['blo']),
  mediaTypes: Object.freeze(['application/x-nanomegas-blo']),
  capabilities: Object.freeze({
    resources: 'single',
    datasets: 'diffraction-and-navigator',
    axes: '4d-stem',
  }),
})

export const createBlockfileReader = (
  options: Readonly<BlockfileReaderOptions> = {},
): ScientificReader => {
  const limits = resolveLimits(options.limits)
  return Object.freeze({
    descriptor: blockfileReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      const bytes = await context.primary.source.read(
        0,
        8,
        context.signal === undefined ? {} : { signal: context.signal },
      )
      const matches =
        new TextDecoder('latin1').decode(bytes.subarray(0, 6)) === 'IMGBLO' &&
        ((bytes[6] === 0x02 && bytes[7] === 0x01) || (bytes[6] === 0x01 && bytes[7] === 0x02))
      if (!matches) return Object.freeze({ confidence: 0, reason: 'BLO ID/magic is absent' })
      const hinted = resourceHasHint(
        context.primary,
        blockfileReaderDescriptor.extensions,
        blockfileReaderDescriptor.mediaTypes,
      )
      return Object.freeze({ confidence: hinted ? 1 : 0.99, reason: 'BLO ID and magic match' })
    },
    async open(context: Readonly<ScientificOpenContext>): Promise<ScientificDocument> {
      const parsed = await parseBlockfile(context.primary.source, limits, context.signal)
      const metadata: ScientificMetadataObject = normalizeScientificMetadataObject({
        dpRotationDegrees: parsed.dpRotation,
        scanRotationDegrees: parsed.scanRotation,
        beamEnergyVolts: parsed.beamEnergy,
        cameraLengthMillimeters: parsed.cameraLength,
        acquisitionSerialDate: parsed.acquisitionTime,
        note: parsed.note,
      })
      const diffractionIdentity = await createScientificDatasetIdentity({
        reader: blockfileReaderDescriptor,
        datasetId: 'diffraction',
        resources: [context.primary],
      })
      const navigatorIdentity = await createScientificDatasetIdentity({
        reader: blockfileReaderDescriptor,
        datasetId: 'navigator',
        resources: [context.primary],
      })
      const diffraction = identifyScientificDataset(
        new BlockfileDiffractionDataset(context.primary.source, parsed, limits, context.primary.id),
        diffractionIdentity,
      )
      const navigator = identifyScientificDataset(
        createContiguousArrayDataset({
          source: context.primary.source,
          dataOffset: parsed.dataOffset1,
          sourceSampleType: 'uint8',
          sourceLittleEndian: false,
          axes: [
            {
              id: 'scanX',
              name: 'Scan X',
              kind: 'space',
              length: parsed.nx,
              unit: 'nm',
              coordinates: { type: 'linear', origin: 0, step: parsed.sx },
              calibration: { kind: 'embedded', resourceId: context.primary.id, locator: 'blo:SX' },
            },
            {
              id: 'scanY',
              name: 'Scan Y',
              kind: 'space',
              length: parsed.ny,
              unit: 'nm',
              coordinates: { type: 'linear', origin: 0, step: parsed.sy },
              calibration: { kind: 'embedded', resourceId: context.primary.id, locator: 'blo:SY' },
            },
          ],
          components: [{ id: 'intensity', name: 'Virtual bright field', kind: 'intensity' }],
          metadata,
          limits,
        }),
        navigatorIdentity,
      )
      const opened = new Map<string, ScientificDataset>([
        ['diffraction', diffraction],
        ['navigator', navigator],
      ])
      return Object.freeze({
        reader: Object.freeze({
          id: blockfileReaderDescriptor.id,
          version: blockfileReaderDescriptor.version,
        }),
        format: blockfileReaderDescriptor.format,
        metadata,
        datasets: Object.freeze([
          Object.freeze({
            id: 'diffraction',
            name: 'Diffraction patterns',
            descriptor: diffraction.descriptor,
            identity: diffractionIdentity,
          }),
          Object.freeze({
            id: 'navigator',
            name: 'Virtual bright field',
            descriptor: navigator.descriptor,
            identity: navigatorIdentity,
          }),
        ]),
        async openDataset(id: string, openOptions?: Readonly<AbortOptions>) {
          throwIfAborted(openOptions?.signal ?? context.signal)
          const dataset = opened.get(id)
          if (dataset === undefined) throw invalidInput(`Unknown BLO dataset ${id}`)
          return dataset
        },
      })
    },
  })
}

export const blockfileReader = createBlockfileReader()
