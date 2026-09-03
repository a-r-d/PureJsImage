import { deflateSync } from 'node:zlib'
import { expect, test } from '@playwright/test'
import { crc32 } from '../src/codecs/crc32.ts'

const pngChunk = (type: string, payload: Uint8Array): Buffer => {
  const encodedType = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(payload.byteLength)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(encodedType, payload))
  return Buffer.concat([length, encodedType, payload, checksum])
}

const oversizedPng = (): Buffer => {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(16_000, 0)
  header.writeUInt32BE(16_000, 4)
  header.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(new Uint8Array())),
    pngChunk('IEND', new Uint8Array()),
  ])
}

test('JPEG XL workbench transcodes and reconstructs the pinned JPEG locally', async ({ page }) => {
  await page.goto('/jpeg-xl/')

  await expect(
    page.getByRole('heading', {
      name: 'Decode JPEG XL and verify exact JPEG transcoding in JavaScript',
    }),
  ).toBeVisible()
  await expect(page.locator('#jxl-status')).toContainText('inspected and decoded locally')
  await expect(page.locator('#jxl-summary')).toContainText('Eligible')
  await expect(page.locator('#jxl-preview')).toHaveAttribute('width', '320')
  await expect(page.locator('#jxl-preview')).toHaveAttribute('height', '240')

  await page.locator('#jxl-transcode').click()
  await expect(page.locator('#jxl-status')).toContainText(
    'Exact JPEG coefficient transcode verified locally',
  )
  await expect(page.locator('#jxl-summary')).toContainText('exact-jpeg')
  await expect(page.locator('#jxl-summary')).toContainText('Verified')
  await expect(page.locator('#jxl-summary')).toContainText('Source JPEG')
  await expect(page.locator('#jxl-summary')).toContainText('JPEG XL output')
  await expect(page.locator('#jxl-summary')).toContainText('Signed savings')
  await expect(page.locator('#jxl-summary')).toContainText('Pinned libjxl reference')
  await expect(page.locator('#jxl-summary')).toContainText('1,081 bytes')
  await expect(page.locator('#jxl-summary')).toContainText('Time')
  await expect(page.locator('#jxl-summary')).toContainText('Output/source ratio')
  await expect(page.locator('#jxl-summary')).toContainText(
    '944 bytes larger (+93.84% versus source)',
  )
  await expect(page.locator('#jxl-summary')).toContainText('Smaller than source')
  await expect(page.locator('#jxl-summary')).toContainText('Experimental')
  await expect(page.locator('#jxl-summary')).toContainText('Off')
  await expect(page.locator('#jxl-details')).toContainText('jpegxl-jpeg-transcode')
  const jxlDownload = page.waitForEvent('download')
  await page.locator('#jxl-download').click()
  expect((await jxlDownload).suggestedFilename()).toBe('jpegxl-progressive-yuv420.jxl')

  await page.locator('#jxl-reconstruct').click()
  await expect(page.locator('#jxl-status')).toContainText(
    'Original JPEG bytes reconstructed locally',
  )
  const jpegDownload = page.waitForEvent('download')
  await page.locator('#jxl-download').click()
  expect((await jpegDownload).suggestedFilename()).toBe(
    'jpegxl-progressive-yuv420-reconstructed.jpg',
  )
})

test('JPEG XL workbench opens a reconstruction file and enables exact output', async ({ page }) => {
  await page.goto('/jpeg-xl/')
  await expect(page.locator('#jxl-status')).toContainText('inspected and decoded locally')

  await page.locator('#jxl-open-jxl').click()
  await expect(page.locator('#jxl-status')).toContainText(
    'jpegxl-progressive-yuv420.jxl inspected and decoded locally',
  )
  await expect(page.locator('#jxl-summary')).toContainText('Metadata present')
  await expect(page.locator('#jxl-reconstruct')).toBeEnabled()
})

test('JPEG XL workbench converts linear samples and honors lower-depth display ranges', async ({
  page,
}) => {
  await page.goto('/jpeg-xl/')
  await expect(page.locator('#jxl-status')).toContainText('inspected and decoded locally')

  await page
    .locator('#jxl-file')
    .setInputFiles('benchmark/fixtures/jpegxl/generated-lossless-v0.12.0/rgb8-linear.jxl')
  await expect(page.locator('#jxl-status')).toContainText(
    'rgb8-linear.jxl inspected and decoded locally',
  )
  const firstPixel = await page.locator('#jxl-preview').evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Preview is not a canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D is unavailable')
    return Array.from(context.getImageData(0, 0, 1, 1).data)
  })
  expect(firstPixel).toEqual([0, 136, 187, 255])

  await page
    .locator('#jxl-file')
    .setInputFiles('benchmark/fixtures/jpegxl/generated-lossless-v0.12.0/gray8-linear.jxl')
  await expect(page.locator('#jxl-status')).toContainText(
    'gray8-linear.jxl inspected and decoded locally',
  )
  const grayPixel = await page.locator('#jxl-preview').evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Preview is not a canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D is unavailable')
    return Array.from(context.getImageData(1, 0, 1, 1).data)
  })
  expect(grayPixel).toEqual([98, 98, 98, 255])

  await page
    .locator('#jxl-file')
    .setInputFiles('benchmark/fixtures/jpegxl/generated-lossless-v0.12.0/rgb10-linear.jxl')
  await expect(page.locator('#jxl-status')).toContainText(
    'rgb10-linear.jxl inspected and decoded locally',
  )
  const lowerDepthPixel = await page.locator('#jxl-preview').evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Preview is not a canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D is unavailable')
    return Array.from(context.getImageData(0, 0, 1, 1).data)
  })
  expect(lowerDepthPixel).toEqual([0, 137, 187, 255])
  expect(lowerDepthPixel).not.toEqual([0, 13, 22, 255])
})

test('JPEG XL workbench pixel-losslessly encodes and reopens the checked PNG', async ({ page }) => {
  await page.goto('/jpeg-xl/')
  await expect(page.locator('#jxl-status')).toContainText('inspected and decoded locally')

  await page.locator('#jxl-open-png').click()
  await expect(page.locator('#jxl-status')).toContainText(
    'jpegxl-pixel-lossless.png inspected and decoded locally',
  )
  await expect(page.locator('#jxl-summary')).toContainText('rgba8')
  await expect(page.locator('#jxl-summary')).toContainText('Experimental')
  await expect(page.locator('#jxl-encode')).toBeEnabled()

  await page.locator('#jxl-encode').click()
  await expect(page.locator('#jxl-status')).toContainText(
    'Pixel-lossless JPEG XL byte-exact local round trip verified',
  )
  await expect(page.locator('#jxl-summary')).toContainText('byte-exact local round trip')
  await expect(page.locator('#jxl-summary')).toContainText('Compression comparison')
  const download = page.waitForEvent('download')
  await page.locator('#jxl-download').click()
  expect((await download).suggestedFilename()).toBe('jpegxl-pixel-lossless.jxl')

  await page.locator('#jxl-reopen').click()
  await expect(page.locator('#jxl-status')).toContainText(
    'jpegxl-pixel-lossless.jxl inspected and decoded locally',
  )
  await expect(page.locator('#jxl-summary')).toContainText('JPEG XL')
})

test('JPEG XL workbench scales a 12 MP preview without changing logical dimensions', async ({
  page,
}) => {
  await page.goto('/jpeg-xl/')
  await expect(page.locator('#jxl-status')).toContainText('inspected and decoded locally')

  await page.locator('#jxl-file').setInputFiles('benchmark/corpus/files/tundra-4000x3000.jpg')
  await expect(page.locator('#jxl-summary')).toContainText('tundra-4000x3000.jpg', {
    timeout: 30_000,
  })
  await expect(page.locator('#jxl-status')).toContainText(
    'tundra-4000x3000.jpg inspected and decoded locally',
  )
  await expect(page.locator('#jxl-summary')).toContainText('4000 × 3000')
  await expect(page.locator('#jxl-summary')).toContainText('2364 × 1773 scaled locally')
  await expect(page.locator('#jxl-preview')).toHaveAttribute('width', '2364')
  await expect(page.locator('#jxl-preview')).toHaveAttribute('height', '1773')
})

test('JPEG XL workbench rejects native pixel materialization before allocation and cleans state', async ({
  page,
}) => {
  await page.goto('/jpeg-xl/')
  await expect(page.locator('#jxl-status')).toContainText('inspected and decoded locally')

  await page.locator('#jxl-file').setInputFiles({
    name: 'oversized.png',
    mimeType: 'image/png',
    buffer: oversizedPng(),
  })
  await expect(page.locator('#jxl-status')).toContainText('before pixel allocation')
  await expect(page.locator('#jxl-encode')).toBeDisabled()
  await expect(page.locator('#jxl-transcode')).toBeDisabled()
  await expect(page.locator('#jxl-reconstruct')).toBeDisabled()
  await expect(page.locator('#jxl-download')).toBeDisabled()

  await page.locator('#jxl-open-jpeg').click()
  await expect(page.locator('#jxl-status')).toContainText('inspected and decoded locally')
  await expect(page.locator('#jxl-transcode')).toBeEnabled()
})
