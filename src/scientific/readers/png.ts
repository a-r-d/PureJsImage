import { pngCodec } from '../../codecs/png.ts'
import type { ScientificReaderDescriptor } from '../reader.ts'
import { createImageCodecScientificReader } from '../image-codec-reader.ts'

export const pngReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/png',
  version: '1.0.0',
  format: 'PNG',
  extensions: Object.freeze(['png']),
  mediaTypes: Object.freeze(['image/png']),
  capabilities: Object.freeze({
    resources: 'single',
    datasets: 'single',
    axes: 'xy',
    sampleType: 'uint8',
    fallback: 'image-codec',
  }),
})

export const pngReader = createImageCodecScientificReader({
  descriptor: pngReaderDescriptor,
  codec: pngCodec,
})
