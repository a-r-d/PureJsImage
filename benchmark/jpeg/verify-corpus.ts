import { join } from 'node:path'
import { PNG } from 'pngjs'

import { allCodecs } from '../../src/codec-entries/all.ts'
import { createImageLibrary } from '../../src/index.ts'
import { corpusFilesDirectory } from '../lib/corpus.ts'
import { jpegCompatibilityFixtureIds } from './corpus.ts'

interface PixelSample {
  readonly x: number
  readonly y: number
  readonly red: number
  readonly green: number
  readonly blue: number
  readonly tolerance: number
}

interface JpegCompatibilityExpectation {
  readonly file: string
  readonly width: number
  readonly height: number
  readonly frames: number
  readonly colorSpace: 'rgb' | 'ycbcr'
  readonly chromaSubsampling: '420' | '444'
  readonly samples: readonly PixelSample[]
}

const expectations: Record<
  (typeof jpegCompatibilityFixtureIds)[number],
  JpegCompatibilityExpectation
> = {
  'libultrahdr-apple-gainmap-new': {
    file: 'libultrahdr-apple-gainmap-new.jpg',
    width: 384,
    height: 512,
    frames: 2,
    colorSpace: 'ycbcr',
    chromaSubsampling: '420',
    samples: [
      { x: 0, y: 0, red: 70, green: 57, blue: 41, tolerance: 10 },
      { x: 192, y: 256, red: 223, green: 195, blue: 145, tolerance: 10 },
      { x: 383, y: 511, red: 8, green: 7, blue: 5, tolerance: 10 },
      { x: 96, y: 128, red: 160, green: 166, blue: 166, tolerance: 10 },
    ],
  },
  'libultrahdr-minnie-yuv-icc': {
    file: 'libultrahdr-minnie-yuv-icc.jpg',
    width: 320,
    height: 240,
    frames: 1,
    colorSpace: 'ycbcr',
    chromaSubsampling: '420',
    samples: [
      { x: 0, y: 0, red: 233, green: 204, blue: 220, tolerance: 4 },
      { x: 160, y: 120, red: 22, green: 27, blue: 34, tolerance: 4 },
      { x: 319, y: 239, red: 51, green: 39, blue: 41, tolerance: 4 },
      { x: 80, y: 60, red: 160, green: 153, blue: 164, tolerance: 4 },
    ],
  },
  'libultrahdr-minnie-rgb': {
    file: 'libultrahdr-minnie-rgb.jpg',
    width: 320,
    height: 240,
    frames: 1,
    colorSpace: 'ycbcr',
    chromaSubsampling: '420',
    samples: [
      { x: 0, y: 0, red: 233, green: 205, blue: 220, tolerance: 4 },
      { x: 160, y: 120, red: 23, green: 28, blue: 34, tolerance: 4 },
      { x: 319, y: 239, red: 51, green: 39, blue: 41, tolerance: 4 },
      { x: 80, y: 60, red: 160, green: 154, blue: 164, tolerance: 4 },
    ],
  },
  'wpt-webcodecs-mozjpeg-rgb': {
    file: 'wpt-webcodecs-mozjpeg-rgb.jpg',
    width: 320,
    height: 240,
    frames: 1,
    colorSpace: 'rgb',
    chromaSubsampling: '444',
    samples: [
      { x: 40, y: 40, red: 255, green: 255, blue: 0, tolerance: 1 },
      { x: 200, y: 40, red: 255, green: 0, blue: 0, tolerance: 1 },
      { x: 40, y: 180, red: 0, green: 0, blue: 255, tolerance: 1 },
      { x: 200, y: 180, red: 0, green: 255, blue: 0, tolerance: 1 },
    ],
  },
  'wpt-webcodecs-mozjpeg-yuv420': {
    file: 'wpt-webcodecs-mozjpeg-yuv420.jpg',
    width: 320,
    height: 240,
    frames: 1,
    colorSpace: 'ycbcr',
    chromaSubsampling: '420',
    samples: [
      { x: 40, y: 40, red: 255, green: 255, blue: 0, tolerance: 1 },
      { x: 200, y: 40, red: 254, green: 0, blue: 0, tolerance: 1 },
      { x: 40, y: 180, red: 0, green: 0, blue: 254, tolerance: 1 },
      { x: 200, y: 180, red: 0, green: 255, blue: 1, tolerance: 1 },
    ],
  },
}

const Image = createImageLibrary(allCodecs)

const close = (actual: number, expected: number, tolerance: number): boolean =>
  Math.abs(actual - expected) <= tolerance

for (const id of jpegCompatibilityFixtureIds) {
  const expectation = expectations[id]
  const path = join(corpusFilesDirectory, expectation.file)
  const image = await Image.open(path)
  const metadata = await image.metadata()
  if (
    metadata.width !== expectation.width ||
    metadata.height !== expectation.height ||
    metadata.frames !== expectation.frames ||
    metadata.colorSpace !== expectation.colorSpace ||
    metadata.chromaSubsampling !== expectation.chromaSubsampling
  ) {
    throw new Error(`${id}: unexpected JPEG metadata ${JSON.stringify(metadata)}`)
  }
  const decoded = PNG.sync.read(await image.png().toBuffer())
  for (const sample of expectation.samples) {
    const offset = (sample.y * decoded.width + sample.x) * 4
    const red = decoded.data[offset] ?? 0
    const green = decoded.data[offset + 1] ?? 0
    const blue = decoded.data[offset + 2] ?? 0
    if (
      !close(red, sample.red, sample.tolerance) ||
      !close(green, sample.green, sample.tolerance) ||
      !close(blue, sample.blue, sample.tolerance)
    ) {
      throw new Error(
        `${id}: pixel ${sample.x},${sample.y} expected ${sample.red},${sample.green},${sample.blue} ±${sample.tolerance}, got ${red},${green},${blue}`,
      )
    }
  }
  console.log(`ok ${id} ${metadata.width}x${metadata.height} frames=${metadata.frames}`)
}
