import { readFile } from 'node:fs/promises'
import { PNG } from 'pngjs'

import { allCodecs } from '../../src/codec-entries/all.ts'
import { createNodeImageLibrary } from '../../src/node-image.ts'
import { allFixtures, inspectFixture, readManifest, verifyInspection } from '../lib/corpus.ts'

type Rgba = readonly [red: number, green: number, blue: number, alpha: number]

interface IcoExpectation {
  readonly id: string
  readonly frames: number
  readonly samples: readonly {
    readonly x: number
    readonly y: number
    readonly rgba: Rgba
  }[]
}

const expectations: readonly IcoExpectation[] = [
  {
    id: 'ico-mixed-16-32-256',
    frames: 3,
    samples: [
      { x: 0, y: 0, rgba: [0, 0, 0, 0] },
      { x: 128, y: 128, rgba: [128, 128, 0, 128] },
      { x: 255, y: 255, rgba: [255, 255, 0, 254] },
    ],
  },
  {
    id: 'ico-dib32-alpha-128',
    frames: 1,
    samples: [
      { x: 0, y: 0, rgba: [0, 0, 0, 64] },
      { x: 64, y: 64, rgba: [192, 64, 128, 192] },
      { x: 127, y: 127, rgba: [125, 123, 254, 238] },
    ],
  },
  {
    id: 'ico-dib24-mask-96',
    frames: 1,
    samples: [
      { x: 0, y: 0, rgba: [0, 0, 0, 0] },
      { x: 48, y: 48, rgba: [129, 129, 192, 255] },
      { x: 95, y: 95, rgba: [255, 255, 108, 0] },
    ],
  },
]

const pixel = (image: PNG, x: number, y: number): Rgba => {
  const offset = (y * image.width + x) * 4
  return [
    image.data[offset] ?? -1,
    image.data[offset + 1] ?? -1,
    image.data[offset + 2] ?? -1,
    image.data[offset + 3] ?? -1,
  ]
}

const manifest = await readManifest()
const fixtures = new Map(allFixtures(manifest).map((fixture) => [fixture.id, fixture]))
const images = createNodeImageLibrary(allCodecs)

for (const expectation of expectations) {
  const fixture = fixtures.get(expectation.id)
  if (!fixture) throw new Error(`ICO fixture ${expectation.id} is missing from the manifest`)
  const inspectionErrors = verifyInspection(fixture, await inspectFixture(fixture))
  if (inspectionErrors.length > 0) {
    throw new Error(`${expectation.id}: ${inspectionErrors.join('; ')}`)
  }
  const input = await readFile(`benchmark/corpus/files/${fixture.file}`)
  const image = await images.open(input)
  const metadata = await image.metadata()
  if (
    metadata.format !== 'ico' ||
    metadata.width !== fixture.expected.width ||
    metadata.height !== fixture.expected.height ||
    metadata.frames !== expectation.frames
  ) {
    throw new Error(`${expectation.id}: decoded metadata does not match the manifest`)
  }
  const decoded = PNG.sync.read(await image.png().toBuffer())
  for (const sample of expectation.samples) {
    const actual = pixel(decoded, sample.x, sample.y)
    if (actual.some((value, channel) => value !== sample.rgba[channel])) {
      throw new Error(
        `${expectation.id}: pixel ${sample.x},${sample.y} expected ${sample.rgba.join(',')}, received ${actual.join(',')}`,
      )
    }
  }
  console.log(
    `PASS ${expectation.id.padEnd(25)} ${metadata.width}x${metadata.height} ${metadata.frames} image${metadata.frames === 1 ? '' : 's'}`,
  )
}
