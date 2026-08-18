import type { ScientificReader } from '../../src/scientific/reader.ts'
import {
  aperioSvsReader,
  blockfileReader,
  bmpReader,
  cbfReader,
  dicomReader,
  digitalMicrographReader,
  digitalSurfReader,
  ebsdTextReader,
  emsaReader,
  enviReader,
  fitsReader,
  gsfReader,
  igorBinaryWaveReader,
  jp2Reader,
  jpegReader,
  metaImageReader,
  mibReader,
  nanonisSxmReader,
  ncemEmdReader,
  niftiReader,
  npyReader,
  nrrdReader,
  omeTiffReader,
  omeZarrReader,
  pngReader,
  rplReader,
  tiaEmiReader,
  tiaSerReader,
  veloxEmdReader,
  webpReader,
  x3pReader,
} from '../../src/scientific/readers/all.ts'
import { createMrcReader } from '../../src/scientific/readers/mrc.ts'
import { createTiffReader } from '../../src/scientific/readers/tiff.ts'

const scalingLimits = Object.freeze({
  maxInputBytes: 1024 * 1024 * 1024,
  maxDecodedBytes: 1024 * 1024 * 1024,
  maxPixels: 300_000_000,
  maxWidth: 32_768,
  maxHeight: 32_768,
})

const benchmarkMrcReader = createMrcReader({ limits: scalingLimits })
const benchmarkTiffReader = createTiffReader({ limits: scalingLimits })

/** The complete public reader set used for late-registry detection measurements. */
export const allScientificReaders: readonly ScientificReader[] = Object.freeze([
  gsfReader,
  nanonisSxmReader,
  igorBinaryWaveReader,
  digitalSurfReader,
  x3pReader,
  enviReader,
  fitsReader,
  benchmarkMrcReader,
  cbfReader,
  dicomReader,
  pngReader,
  jpegReader,
  webpReader,
  bmpReader,
  jp2Reader,
  benchmarkTiffReader,
  omeTiffReader,
  omeZarrReader,
  aperioSvsReader,
  digitalMicrographReader,
  tiaSerReader,
  tiaEmiReader,
  ncemEmdReader,
  veloxEmdReader,
  rplReader,
  emsaReader,
  nrrdReader,
  metaImageReader,
  niftiReader,
  npyReader,
  blockfileReader,
  mibReader,
  ebsdTextReader,
])

export const scientificEngine = Object.freeze({
  id: 'purejsimage-scientific',
  version: '0.10.0',
})
