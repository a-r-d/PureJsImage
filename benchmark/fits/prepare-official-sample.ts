import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { openFits } from '../../src/scientific/formats/fits.ts'

const url = 'https://fits.gsfc.nasa.gov/nrao_data/samples/image/swp05569slg.fits'
const expectedSha256 = '89d4634939080e2a10358132d211272f438014b57fa38408ba21e3045e3dcecd'
const response = await fetch(url)
if (!response.ok) throw new Error(`NASA FITS sample returned HTTP ${response.status}`)
const bytes = new Uint8Array(await response.arrayBuffer())
const sha256 = createHash('sha256').update(bytes).digest('hex')
if (sha256 !== expectedSha256) {
  throw new Error(
    `NASA FITS sample checksum changed: expected ${expectedSha256}, received ${sha256}`,
  )
}

const document = await openFits(bytes, { maxInputBytes: bytes.byteLength })
if (document.hdus.length !== 2 || document.hdus.some((hdu) => !hdu.canOpenRaster)) {
  throw new Error('NASA FITS sample no longer contains the expected two image HDUs')
}
const primary = await document.openImage(0)
if (primary.sizeX !== 831 || primary.sizeY !== 110 || primary.bitpix !== 16) {
  throw new Error('NASA FITS sample primary image metadata changed')
}

const outputDirectory = resolve('benchmark/corpus/fits/official')
await mkdir(outputDirectory, { recursive: true })
await writeFile(resolve(outputDirectory, 'swp05569slg.fits'), bytes)
console.log(`Prepared ${bytes.byteLength} byte NASA FITS sample with SHA-256 ${sha256}`)
