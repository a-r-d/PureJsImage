import { throwIfAborted } from '../../abort.ts'
import { openTiffDocument } from '../../codecs/tiff.ts'
import { invalidInput } from '../../errors.ts'
import {
  isAperioSvs,
  openAperioSvs,
  resolveAperioSvsLimits,
  type AperioSvsLimits,
} from '../../pathology/aperio-svs.ts'
import type {
  ScientificOpenContext,
  ScientificReader,
  ScientificReaderDescriptor,
} from '../reader.ts'
import { createWholeSlideScientificDocument } from '../whole-slide-bridge.ts'
import { resourceHasHint } from './shared.ts'

export type { AperioSvsLimits } from '../../pathology/aperio-svs.ts'

export const aperioSvsReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/aperio-svs',
  version: '1.0.0',
  format: 'Aperio SVS',
  extensions: Object.freeze(['svs']),
  mediaTypes: Object.freeze(['image/tiff', 'image/x-tiff']),
  capabilities: Object.freeze({
    resources: 'single',
    datasets: 'pyramid-and-associated-images',
    axes: 'xy',
    rangeReads: true,
  }),
})

export interface AperioSvsReaderOptions {
  readonly limits?: Partial<AperioSvsLimits>
}

const tiffHeader = (header: Uint8Array): boolean =>
  (header[0] === 0x49 &&
    header[1] === 0x49 &&
    ((header[2] === 0x2a && header[3] === 0) || (header[2] === 0x2b && header[3] === 0))) ||
  (header[0] === 0x4d &&
    header[1] === 0x4d &&
    ((header[2] === 0 && header[3] === 0x2a) || (header[2] === 0 && header[3] === 0x2b)))

const tiffLimits = (limits: Readonly<AperioSvsLimits>) => {
  const pixels = BigInt(limits.maxWidth) * BigInt(limits.maxHeight)
  if (pixels > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw invalidInput('Aperio maxWidth times maxHeight exceeds safe integer limits')
  }
  return Object.freeze({
    maxInputBytes: limits.maxSourceBytes,
    maxWidth: limits.maxWidth,
    maxHeight: limits.maxHeight,
    maxPixels: Number(pixels),
    maxFrames: limits.maxDirectories,
    maxDecodedBytes: limits.maxRegionDecodedBytes,
  })
}

export const createAperioSvsReader = (
  options: Readonly<AperioSvsReaderOptions> = {},
): ScientificReader => {
  const limits = resolveAperioSvsLimits(options.limits)
  const documentLimits = tiffLimits(limits)
  return Object.freeze({
    descriptor: aperioSvsReaderDescriptor,
    async probe(context: Readonly<ScientificOpenContext>) {
      throwIfAborted(context.signal)
      const header = await context.primary.source.read(0, 4, {
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      })
      if (header.byteLength < 4 || !tiffHeader(header)) {
        return Object.freeze({ confidence: 0, reason: 'TIFF signature is absent' })
      }
      const document = await openTiffDocument(context.primary.source, {
        ...documentLimits,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      })
      if (!(await isAperioSvs(document, context))) {
        return Object.freeze({ confidence: 0, reason: 'Aperio SVS header is absent' })
      }
      return Object.freeze({
        confidence: resourceHasHint(
          context.primary,
          aperioSvsReaderDescriptor.extensions,
          aperioSvsReaderDescriptor.mediaTypes,
        )
          ? 1
          : 0.99,
        reason: 'Aperio TIFF ImageDescription matches',
      })
    },
    async open(context: Readonly<ScientificOpenContext>) {
      throwIfAborted(context.signal)
      const document = await openTiffDocument(context.primary.source, {
        ...documentLimits,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      })
      const slide = await openAperioSvs(document, {
        limits,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      })
      throwIfAborted(context.signal)
      return createWholeSlideScientificDocument({
        context,
        reader: aperioSvsReaderDescriptor,
        slide,
        metadata: { aperio: slide.properties },
      })
    },
  })
}

export const aperioSvsReader: ScientificReader = createAperioSvsReader()
