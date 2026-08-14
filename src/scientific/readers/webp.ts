import { webpCodec } from '../../codecs/webp.ts'
import { createImageCodecScientificReader } from '../image-codec-reader.ts'
import type { ScientificReaderDescriptor } from '../reader.ts'

export const webpReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/webp',
  version: '1.0.0',
  format: 'WebP',
  extensions: Object.freeze(['webp']),
  mediaTypes: Object.freeze(['image/webp']),
  capabilities: Object.freeze({
    resources: 'single',
    datasets: 'single',
    axes: 'xy',
    sampleType: 'uint8',
    fallback: 'image-codec',
  }),
})

export const webpReader = createImageCodecScientificReader({
  descriptor: webpReaderDescriptor,
  codec: webpCodec,
})
