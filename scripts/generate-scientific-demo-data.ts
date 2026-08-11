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
const wavelengths = Array.from({ length: cubeBands }, (_, index) => 450 + index * 30)
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

console.log(`Generated ${gsf.byteLength} byte GSF and ${cube.byteLength} byte ENVI cube.`)
