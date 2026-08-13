import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput, unsupportedOperation } from '../../errors.ts'
import type { RasterBlock } from '../../raster.ts'
import { toScientificDataset } from '../dataset-adapters.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificAxisDescriptor,
  ScientificDataset,
  ScientificPlaneReadRequest,
} from '../dataset-v2.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificMetadataObject,
  normalizeScientificPlaneReadRequest,
} from '../dataset-v2.ts'
import type { FitsDocument, FitsHdu, FitsHeaderValue } from '../formats/fits.ts'
import { openFits } from '../formats/fits.ts'
import type {
  ScientificDocument,
  ScientificOpenContext,
  ScientificReader,
  ScientificReaderDescriptor,
} from '../reader.ts'
import { createScientificDatasetIdentity, identifyScientificDataset } from '../reader.ts'
import { resourceHasHint } from './shared.ts'

const fitsCardBytes = 80

export const fitsReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/fits',
  version: '1.0.0',
  format: 'FITS',
  extensions: Object.freeze(['fits', 'fit', 'fts']),
  mediaTypes: Object.freeze(['application/fits', 'image/fits']),
  capabilities: Object.freeze({ resources: 'single', datasets: 'multiple', axes: 'ranked' }),
})

const hasFitsSignature = (bytes: Uint8Array): boolean => {
  if (bytes.byteLength !== fitsCardBytes) return false
  let text = ''
  for (const byte of bytes) {
    if (byte < 0x20 || byte > 0x7e) return false
    text += String.fromCharCode(byte)
  }
  return text.startsWith('SIMPLE  =')
}

const cardValue = (hdu: FitsHdu, keyword: string): FitsHeaderValue | undefined =>
  hdu.cards.find((card) => card.kind === 'value' && card.keyword === keyword)?.value

const cardNumber = (hdu: FitsHdu, keyword: string): number | undefined => {
  const value = cardValue(hdu, keyword)
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const cardString = (hdu: FitsHdu, keyword: string): string | undefined => {
  const value = cardValue(hdu, keyword)
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

const fitsValueMetadata = (value: FitsHeaderValue): unknown =>
  typeof value === 'bigint' ? Object.freeze({ kind: 'integer', decimal: value.toString() }) : value

const hduMetadata = (hdu: FitsHdu) => ({
  index: hdu.index,
  primary: hdu.primary,
  bitpix: hdu.bitpix,
  dimensions: hdu.dimensions,
  dataByteOffset: hdu.dataByteOffset,
  dataByteLength: hdu.dataByteLength,
  ...(hdu.extensionType === undefined ? {} : { extensionType: hdu.extensionType }),
  cards: hdu.cards.map((card) => ({
    keyword: card.keyword,
    kind: card.kind,
    ...(card.value === undefined ? {} : { value: fitsValueMetadata(card.value) }),
    ...(card.comment === undefined ? {} : { comment: card.comment }),
    ...(card.text === undefined ? {} : { text: card.text }),
    raw: card.raw,
  })),
})

const fitsAxisKind = (name: string | undefined, index: number) => {
  const normalized = name?.toUpperCase() ?? ''
  if (/TIME|UTC|MJD/u.test(normalized)) return 'time' as const
  if (/FREQ|WAVE|ENER|VELO/u.test(normalized)) return 'spectral' as const
  return index < 2 ? ('space' as const) : ('other' as const)
}

const fitsAxis = (hdu: FitsHdu, index: number, length: number): ScientificAxisDescriptor => {
  const sourceAxis = index + 1
  const id = index === 0 ? 'x' : index === 1 ? 'y' : `axis-${sourceAxis}`
  const fallbackName = index === 0 ? 'X' : index === 1 ? 'Y' : `Axis ${sourceAxis}`
  const name = cardString(hdu, `CTYPE${sourceAxis}`) ?? fallbackName
  const unit = cardString(hdu, `CUNIT${sourceAxis}`)
  const reference = cardNumber(hdu, `CRVAL${sourceAxis}`)
  const referencePixel = cardNumber(hdu, `CRPIX${sourceAxis}`)
  const step = cardNumber(hdu, `CDELT${sourceAxis}`)
  const coordinates =
    reference !== undefined && referencePixel !== undefined && step !== undefined && step !== 0
      ? Object.freeze({
          type: 'linear' as const,
          origin: reference + (1 - referencePixel) * step,
          step,
        })
      : Object.freeze({ type: 'index' as const })
  return Object.freeze({
    id,
    name,
    kind: fitsAxisKind(name, index),
    length,
    coordinates,
    ...(unit === undefined ? {} : { unit }),
  })
}

class FitsRankedDataset implements ScientificDataset {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly #document: FitsDocument
  readonly #hdu: FitsHdu
  readonly #higherAxisIds: readonly string[]

  private constructor(
    document: FitsDocument,
    hdu: FitsHdu,
    descriptor: NormalizedScientificDatasetDescriptor,
  ) {
    this.#document = document
    this.#hdu = hdu
    this.descriptor = descriptor
    this.#higherAxisIds = Object.freeze(
      hdu.dimensions.slice(2).map((_, index) => `axis-${index + 3}`),
    )
  }

  static async create(document: FitsDocument, hdu: FitsHdu): Promise<FitsRankedDataset> {
    const zeros = Object.freeze(hdu.dimensions.slice(2).map(() => 0))
    const slice = toScientificDataset(await document.openImageSlice(hdu.index, zeros))
    const axes = hdu.dimensions.map((length, index) => fitsAxis(hdu, index, length))
    if (axes.length === 1) axes.push(fitsAxis(hdu, 1, 1))
    const metadata = normalizeScientificMetadataObject({
      ...(slice.descriptor.metadata ?? {}),
      'purejsimage:fits': hduMetadata(hdu),
    })
    const descriptor = normalizeScientificDatasetDescriptor({
      schemaVersion: 2,
      axes,
      sampleType: slice.descriptor.sampleType,
      components: slice.descriptor.components,
      ...(slice.descriptor.noDataValue === undefined
        ? {}
        : { noDataValue: slice.descriptor.noDataValue }),
      metadata,
      capabilities: {
        regionReads: true,
        resolutionLevels: false,
        planeReads: { kind: 'ordered-axis-pairs', pairs: [['x', 'y']] },
      },
    })
    return new FitsRankedDataset(document, hdu, descriptor)
  }

  async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncIterable<RasterBlock> {
    const normalized = normalizeScientificPlaneReadRequest(this.descriptor, request)
    if (normalized.displayAxes[0] !== 'x' || normalized.displayAxes[1] !== 'y') {
      throw unsupportedOperation('FITS scientific datasets currently display the first two axes')
    }
    const higherIndices = this.#higherAxisIds.map(
      (axisId) => normalized.fixedIndices.find((entry) => entry.axisId === axisId)?.index ?? 0,
    )
    const slice = toScientificDataset(
      await this.#document.openImageSlice(this.#hdu.index, higherIndices),
    )
    for await (const block of slice.readPlane({
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      resolutionLevel: 0,
      x: normalized.x,
      y: normalized.y,
      width: normalized.width,
      height: normalized.height,
      ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
    })) {
      yield block
    }
  }
}

export const fitsReader: ScientificReader = Object.freeze({
  descriptor: fitsReaderDescriptor,
  async probe(context: Readonly<ScientificOpenContext>) {
    throwIfAborted(context.signal)
    const card = await context.primary.source.read(0, fitsCardBytes, {
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    })
    if (!hasFitsSignature(card)) {
      return Object.freeze({ confidence: 0, reason: 'FITS SIMPLE card is absent' })
    }
    const hinted = resourceHasHint(
      context.primary,
      fitsReaderDescriptor.extensions,
      fitsReaderDescriptor.mediaTypes,
    )
    return Object.freeze({
      confidence: hinted ? 1 : 0.99,
      reason: hinted ? 'FITS signature and resource hint match' : 'FITS signature matches',
    })
  },
  async open(context: Readonly<ScientificOpenContext>): Promise<ScientificDocument> {
    throwIfAborted(context.signal)
    const fits = await openFits(context.primary.source)
    const supported = fits.hdus.filter(({ canOpenScientificRaster }) => canOpenScientificRaster)
    const entries = await Promise.all(
      supported.map(async (hdu) => {
        const id = `hdu-${hdu.index}`
        const identity = await createScientificDatasetIdentity({
          reader: fitsReaderDescriptor,
          datasetId: id,
          resources: [context.primary],
        })
        const dataset = identifyScientificDataset(
          await FitsRankedDataset.create(fits, hdu),
          identity,
        )
        return Object.freeze({
          id,
          name:
            cardString(hdu, 'EXTNAME') ??
            (hdu.primary ? 'Primary image' : `Image HDU ${hdu.index}`),
          dataset,
          identity,
        })
      }),
    )
    throwIfAborted(context.signal)
    return Object.freeze({
      reader: Object.freeze({ id: fitsReaderDescriptor.id, version: fitsReaderDescriptor.version }),
      format: fitsReaderDescriptor.format,
      metadata: Object.freeze({ hduCount: fits.hdus.length }),
      datasets: Object.freeze(
        entries.map(({ id, name, dataset, identity }) =>
          Object.freeze({ id, name, descriptor: dataset.descriptor, identity }),
        ),
      ),
      async openDataset(id: string, options?: Readonly<AbortOptions>) {
        throwIfAborted(options?.signal ?? context.signal)
        const entry = entries.find((candidate) => candidate.id === id)
        if (entry === undefined) throw invalidInput(`Unknown FITS dataset ${id}`)
        return entry.dataset
      },
    })
  },
})
