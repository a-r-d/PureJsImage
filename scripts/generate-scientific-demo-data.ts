import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { encodeGsf } from '../src/scientific/formats/gsf.ts'

const outputDirectory = resolve('docs-astro/public/demo-data/scientific')
await mkdir(outputDirectory, { recursive: true })

const surfaceWidth = 128
const surfaceHeight = 96
const surface = new Float32Array(surfaceWidth * surfaceHeight)
for (let y = 0; y < surfaceHeight; y += 1) {
  for (let x = 0; x < surfaceWidth; x += 1) {
    const dx = (x - surfaceWidth * 0.47) / surfaceWidth
    const dy = (y - surfaceHeight * 0.52) / surfaceHeight
    const mound = Math.exp(-(dx * dx + dy * dy) * 52) * 68e-9
    const terraces = Math.sin(x * 0.24 + Math.sin(y * 0.08) * 2.5) * 4.5e-9
    const scanDrift = (y / surfaceHeight - 0.5) * 8e-9
    surface[y * surfaceWidth + x] = mound + terraces + scanDrift
  }
}
const gsf = encodeGsf({
  width: surfaceWidth,
  height: surfaceHeight,
  values: surface,
  xReal: 12.8e-6,
  yReal: 9.6e-6,
  xyUnit: 'm',
  valueUnit: 'm',
  title: 'Synthetic AFM calibration surface',
  metadata: {
    Comment: 'Deterministic specification-derived PureJsImage browser demonstration',
    Direction: 'Forward',
  },
})
await writeFile(resolve(outputDirectory, 'synthetic-afm.gsf'), gsf)

const cubeWidth = 96
const cubeHeight = 64
const cubeBands = 16
const wavelengths = [450, 472, 501, 533, 568, 604, 641, 681, 722, 765, 809, 846, 871, 889, 901, 910]
const cube = new Uint8Array(cubeWidth * cubeHeight * cubeBands * 2)
const cubeView = new DataView(cube.buffer)
for (let y = 0; y < cubeHeight; y += 1) {
  for (let band = 0; band < cubeBands; band += 1) {
    const wavelength = wavelengths[band] ?? 0
    for (let x = 0; x < cubeWidth; x += 1) {
      const material = x < cubeWidth / 3 ? 0 : x < (cubeWidth * 2) / 3 ? 1 : 2
      const spatial = 1 + 0.12 * Math.sin(x * 0.17) + 0.08 * Math.cos(y * 0.21)
      const absorptionCenter = material === 0 ? 540 : material === 1 ? 660 : 810
      const absorption = Math.exp(-((wavelength - absorptionCenter) ** 2) / 4_500)
      const edge = Math.hypot(x - cubeWidth * 0.52, y - cubeHeight * 0.48) < 15 ? 0.72 : 1
      const value = Math.max(
        0,
        Math.min(65_535, Math.round((42_000 - absorption * 24_000) * spatial * edge)),
      )
      const sample = (y * cubeBands * cubeWidth + band * cubeWidth + x) * 2
      cubeView.setUint16(sample, value, true)
    }
  }
}
const enviHeader = `ENVI
description = {
  Deterministic specification-derived PureJsImage hyperspectral demonstration }
samples = ${cubeWidth}
lines = ${cubeHeight}
bands = ${cubeBands}
header offset = 0
file type = ENVI Standard
data type = 12
interleave = bil
sensor type = Synthetic Pushbroom
byte order = 0
wavelength units = Nanometers
wavelength = { ${wavelengths.join(', ')} }
fwhm = { ${wavelengths.map(() => 18).join(', ')} }
band names = { ${wavelengths.map((value) => `${value} nm`).join(', ')} }
default bands = { 8, 5, 2 }
data ignore value = 0
`
await Promise.all([
  writeFile(resolve(outputDirectory, 'synthetic-hyperspectral.hdr'), enviHeader),
  writeFile(resolve(outputDirectory, 'synthetic-hyperspectral.bin'), cube),
])

const classificationWidth = 160
const classificationHeight = 120
const classification = new Uint8Array(classificationWidth * classificationHeight)
for (let y = 0; y < classificationHeight; y += 1) {
  for (let x = 0; x < classificationWidth; x += 1) {
    const basin = Math.hypot(x - 82, y - 62)
    const ridge = Math.abs(y - (28 + Math.sin(x * 0.09) * 12))
    classification[y * classificationWidth + x] =
      basin < 24 ? 3 : ridge < 7 ? 2 : (Math.floor(x / 20) + Math.floor(y / 15)) % 3 === 0 ? 1 : 0
  }
}
const classificationHeader = `ENVI
description = {
  Deterministic specification-derived PureJsImage classification demonstration }
samples = ${classificationWidth}
lines = ${classificationHeight}
bands = 1
header offset = 0
file type = ENVI Classification
data type = 1
interleave = bsq
byte order = 0
classes = 4
class names = { Unclassified, Clay-bearing, Carbonate-bearing, Mixed mineral }
class lookup = { 18, 24, 31, 214, 123, 57, 52, 157, 213, 224, 202, 85 }
`
await Promise.all([
  writeFile(resolve(outputDirectory, 'synthetic-classification.hdr'), classificationHeader),
  writeFile(resolve(outputDirectory, 'synthetic-classification.dat'), classification),
])

const fitsCard = (keyword: string, value?: string | number | boolean, comment?: string): string => {
  const prefix = keyword.padEnd(8, ' ')
  if (value === undefined) return `${prefix}${comment ?? ''}`.padEnd(80, ' ')
  const raw =
    typeof value === 'string'
      ? `'${value}'`
      : typeof value === 'boolean'
        ? value
          ? 'T'
          : 'F'
        : String(value)
  const field = typeof value === 'string' ? raw.padEnd(20, ' ') : raw.padStart(20, ' ')
  return `${prefix}= ${field}${comment ? ` / ${comment}` : ''}`.padEnd(80, ' ').slice(0, 80)
}

const fitsWidth = 128
const fitsHeight = 96
const fitsDepth = 3
const fitsCards = [
  fitsCard('SIMPLE', true, 'conforms to FITS standard'),
  fitsCard('BITPIX', 16, 'signed 16-bit stored samples'),
  fitsCard('NAXIS', 3),
  fitsCard('NAXIS1', fitsWidth),
  fitsCard('NAXIS2', fitsHeight),
  fitsCard('NAXIS3', fitsDepth),
  fitsCard('BSCALE', 0.25),
  fitsCard('BZERO', 100),
  fitsCard('BUNIT', 'synthetic units'),
  fitsCard('OBJECT', 'Synthetic data cube'),
  fitsCard('COMMENT', undefined, ' Generated locally by PureJsImage.'),
  fitsCard('END'),
]
const fitsHeaderBytes = Math.ceil((fitsCards.length * 80) / 2_880) * 2_880
const fitsDataBytes = fitsWidth * fitsHeight * fitsDepth * 2
const fitsLength = fitsHeaderBytes + Math.ceil(fitsDataBytes / 2_880) * 2_880
const fits = new Uint8Array(fitsLength)
fits.fill(0x20, 0, fitsHeaderBytes)
fits.set(new TextEncoder().encode(fitsCards.join('')))
const fitsView = new DataView(fits.buffer)
for (let z = 0; z < fitsDepth; z += 1) {
  for (let y = 0; y < fitsHeight; y += 1) {
    for (let x = 0; x < fitsWidth; x += 1) {
      const radial = Math.hypot(x - fitsWidth / 2, y - fitsHeight / 2)
      const stored = Math.round(
        Math.sin(x * 0.12 + z) * 250 + Math.cos(y * 0.17) * 180 + radial * (z + 1),
      )
      const sample = (z * fitsWidth * fitsHeight + y * fitsWidth + x) * 2
      fitsView.setInt16(fitsHeaderBytes + sample, stored, false)
    }
  }
}
await writeFile(resolve(outputDirectory, 'synthetic-cube.fits'), fits)

console.log(
  `Generated ${gsf.byteLength} byte GSF, ${cube.byteLength} byte ENVI cube, ${classification.byteLength} byte ENVI classification, and ${fits.byteLength} byte FITS cube.`,
)
