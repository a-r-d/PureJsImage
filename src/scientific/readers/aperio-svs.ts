import { throwIfAborted } from '../../abort.ts'
import { openTiffDocument } from '../../codecs/tiff.ts'
import { isAperioSvs, openAperioSvs } from '../../pathology/aperio-svs.ts'
import type {
  ScientificOpenContext,
  ScientificReader,
  ScientificReaderDescriptor,
} from '../reader.ts'
import { createWholeSlideScientificDocument } from '../whole-slide-bridge.ts'
import { resourceHasHint } from './shared.ts'

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

export const aperioSvsReader: ScientificReader = Object.freeze({
  descriptor: aperioSvsReaderDescriptor,
  async probe(context: Readonly<ScientificOpenContext>) {
    throwIfAborted(context.signal)
    try {
      const document = await openTiffDocument(context.primary.source, {
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
    } catch {
      return Object.freeze({ confidence: 0, reason: 'Aperio SVS metadata is unavailable' })
    }
  },
  async open(context: Readonly<ScientificOpenContext>) {
    throwIfAborted(context.signal)
    const document = await openTiffDocument(context.primary.source, {
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    })
    const slide = await openAperioSvs(document, context)
    throwIfAborted(context.signal)
    return createWholeSlideScientificDocument({
      context,
      reader: aperioSvsReaderDescriptor,
      slide,
      metadata: { aperio: slide.properties },
    })
  },
})
