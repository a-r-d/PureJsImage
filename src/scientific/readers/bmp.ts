import { bmpCodec } from '../../codecs/bmp.ts'
import { createImageCodecScientificReader } from '../image-codec-reader.ts'
import type { ScientificReaderDescriptor } from '../reader.ts'

export const bmpReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/bmp',
  version: '1.0.0',
  format: 'BMP',
  extensions: Object.freeze(['bmp', 'dib']),
  mediaTypes: Object.freeze(['image/bmp', 'image/x-ms-bmp']),
  capabilities: Object.freeze({
    resources: 'single',
    datasets: 'single',
    axes: 'xy',
    sampleType: 'uint8',
    fallback: 'image-codec',
  }),
})

export const bmpReader = createImageCodecScientificReader({
  descriptor: bmpReaderDescriptor,
  codec: bmpCodec,
})
