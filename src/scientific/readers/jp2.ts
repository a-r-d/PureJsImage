import { jpeg2000Codec } from '../../codecs/jpeg2000.ts'
import { createImageCodecScientificReader } from '../image-codec-reader.ts'
import type { ScientificReaderDescriptor } from '../reader.ts'

export const jp2ReaderDescriptor: ScientificReaderDescriptor = Object.freeze({
  id: 'purejsimage/jp2',
  version: '1.0.0',
  format: 'JPEG 2000 / JP2',
  extensions: Object.freeze(['jp2']),
  mediaTypes: Object.freeze(['image/jp2']),
  capabilities: Object.freeze({
    resources: 'single',
    datasets: 'single',
    axes: 'xy',
    sampleType: 'uint8',
    fallback: 'image-codec',
  }),
})

export const jp2Reader = createImageCodecScientificReader({
  descriptor: jp2ReaderDescriptor,
  codec: jpeg2000Codec,
})
