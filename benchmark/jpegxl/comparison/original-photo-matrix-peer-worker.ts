import { readFile, writeFile } from 'node:fs/promises'
import { initialize } from './adapters.ts'
import { hash, work } from './io.ts'

const [subject, value, output, fixtureId] = process.argv.slice(2)
const setting = Number(value)
if (
  (subject !== 'jsquash' && subject !== 'vips') ||
  !output ||
  !fixtureId ||
  !Number.isFinite(setting) ||
  (subject === 'jsquash' ? setting < 2 || setting > 101 : setting < 0.1 || setting > 25)
)
  throw new Error('Specify one public peer, original-domain setting and unique output')
if (!('ImageData' in globalThis))
  Object.defineProperty(globalThis, 'ImageData', {
    value: class {
      data: Uint8ClampedArray
      width: number
      height: number
      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data
        this.width = width
        this.height = height
      }
    },
  })
const { object, number, string } = await import('./model.ts')
const plan = object(
  JSON.parse(await readFile('benchmark/jpegxl/comparison/original-photo-matrix-plan.json', 'utf8')),
)
if (!Array.isArray(plan.fixtures)) throw new Error('Predeclared fixtures missing')
const planned = plan.fixtures.map(object).find((entry) => entry.id === fixtureId)
const manifest = object(JSON.parse(await readFile(string(plan.fixtureManifest), 'utf8')))
if (manifest.completed !== true || !Array.isArray(manifest.fixtures))
  throw new Error('Prepared originals missing')
const row = manifest.fixtures.map(object).find((entry) => entry.id === fixtureId)
if (
  !row ||
  !planned ||
  row.scope !== 'original' ||
  row.sampleType !== 'uint8' ||
  row.channels !== 4 ||
  row.width !== planned.width ||
  row.height !== planned.height ||
  row.rawSha256 !== planned.rawSha256
)
  throw new Error('Pinned original differs')
const fixture = {
  width: number(row.width),
  height: number(row.height),
  rawSha256: string(row.rawSha256),
}
const data = new Uint8Array(await readFile(string(row.raw)))
if (data.length !== fixture.width * fixture.height * 4 || hash(data) !== fixture.rawSha256)
  throw new Error('Original samples differ')
for (let at = 3; at < data.length; at += 4)
  if (data[at] !== 255) throw new Error('Original alpha differs')
const pixels = {
  width: fixture.width,
  height: fixture.height,
  channels: 4,
  data,
  interpretation: 'srgb',
}
const adapter = await initialize(
  subject,
  async (name) => new Uint8Array(await readFile(`${work}/assets/${name}`)).buffer,
)
try {
  if (!adapter.encode) throw new Error('Public encoder API missing')
  const encoded = await adapter.encode(pixels, {
    lossless: false,
    effort: 7,
    value: subject === 'jsquash' ? 101 - setting : setting,
  })
  if (encoded.kind !== 'jxl' || hash(pixels.data) !== fixture.rawSha256)
    throw new Error('Output type or caller samples changed')
  await writeFile(output, encoded.bytes, { flag: 'wx' })
  console.log(
    JSON.stringify({
      subject,
      setting,
      bytes: encoded.bytes.length,
      encodedSha256: hash(encoded.bytes),
    }),
  )
} finally {
  adapter.close()
}
