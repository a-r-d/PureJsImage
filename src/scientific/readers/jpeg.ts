import { jpegCodec } from '../../codecs/jpeg.ts'
import type { ScientificReaderDescriptor } from '../reader.ts'
import { createImageCodecScientificReader } from '../image-codec-reader.ts'

export const jpegReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/jpeg',
  version: '1.0.0',
  format: 'JPEG',
  extensions: Object.freeze(['jpg', 'jpeg', 'jpe']),
  mediaTypes: Object.freeze(['image/jpeg']),
  capabilities: Object.freeze({
    resources: 'single',
    datasets: 'single',
    axes: 'xy',
    sampleType: 'uint8',
    fallback: 'image-codec',
  }),
})

export const jpegReader = createImageCodecScientificReader({
  descriptor: jpegReaderDescriptor,
  codec: jpegCodec,
})
