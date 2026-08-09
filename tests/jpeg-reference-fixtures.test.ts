import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { PNG } from 'pngjs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { Image } from './image-library.ts'

interface FixtureExpectation {
  readonly file: string
  readonly sha256: string
  readonly colorSpace: 'rgb' | 'ycbcr'
  readonly chromaSubsampling: '411' | '420' | '440' | '444'
  readonly frameMarker: number
  readonly scans: number
  readonly maximumMeanAbsoluteError: number
  readonly maximumChannelError: number
  readonly width?: number
  readonly height?: number
}

const fixtures: readonly FixtureExpectation[] = [
  {
    file: 'generated-yuv440.jpg',
    sha256: '2199caf17e3536fee1a95df125fb3e7f9cb8caee1d085e0f10081d725a86aa1c',
    colorSpace: 'ycbcr',
    chromaSubsampling: '440',
    frameMarker: 0xc0,
    scans: 1,
    maximumMeanAbsoluteError: 1,
    maximumChannelError: 4,
  },
  {
    file: 'generated-yuv411.jpg',
    sha256: '0c9bea1f1bfa2fb952fbd2aa4705f2a288b52a08b7c105bae2f13dfcbd24fb64',
    colorSpace: 'ycbcr',
    chromaSubsampling: '411',
    frameMarker: 0xc0,
    scans: 1,
    maximumMeanAbsoluteError: 9,
    maximumChannelError: 80,
  },
  {
    file: 'generated-sof1-8bit.jpg',
    sha256: '09048d46b313702386605da3eddd6ad0ebbfb104f891901ec17603a00bb25104',
    colorSpace: 'ycbcr',
    chromaSubsampling: '420',
    frameMarker: 0xc1,
    scans: 1,
    maximumMeanAbsoluteError: 1,
    maximumChannelError: 3,
  },
  {
    file: 'generated-sequential-multiscan.jpg',
    sha256: 'c916cbd242f3a1fc2a41870fb536f2e30f609055cd75165ab9d1df2285f21279',
    colorSpace: 'ycbcr',
    chromaSubsampling: '420',
    frameMarker: 0xc0,
    scans: 3,
    maximumMeanAbsoluteError: 1,
    maximumChannelError: 3,
  },
  {
    file: 'generated-progressive.jpg',
    sha256: 'ef15e5eafc4eb4d98e012f03ea2b8b1a400c7dff29fb0303e6c7c98ade0981ee',
    colorSpace: 'ycbcr',
    chromaSubsampling: '420',
    frameMarker: 0xc2,
    scans: 6,
    maximumMeanAbsoluteError: 1,
    maximumChannelError: 3,
  },
  {
    file: 'generated-progressive-zrl.jpg',
    sha256: '4b7f5882755add89103be3895efdc0eea0c41d3096d015ac22f847650d68beda',
    colorSpace: 'ycbcr',
    chromaSubsampling: '420',
    frameMarker: 0xc2,
    scans: 10,
    maximumMeanAbsoluteError: 1,
    maximumChannelError: 3,
    width: 240,
    height: 160,
  },
  {
    file: 'generated-adobe-rgb.jpg',
    sha256: 'd075ab672879c684eeacb84e88d2a7a9c9b300e65eed97eab31a46399dfdedc4',
    colorSpace: 'rgb',
    chromaSubsampling: '444',
    frameMarker: 0xc0,
    scans: 1,
    maximumMeanAbsoluteError: 1,
    maximumChannelError: 1,
  },
]

const fixtureDirectory = join('benchmark', 'corpus', 'files', 'jpeg-reference')

const markerCount = (input: Uint8Array, marker: number): number => {
  let count = 0
  for (let offset = 0; offset + 1 < input.byteLength; offset += 1) {
    if (input[offset] === 0xff && input[offset + 1] === marker) count += 1
  }
  return count
}

describe('JPEG reference compatibility fixtures', () => {
  it.each(fixtures)('decodes $file against independent libjpeg output', async (fixture) => {
    const path = join(fixtureDirectory, fixture.file)
    const input = await readFile(path)
    expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.sha256)
    expect(markerCount(input, fixture.frameMarker)).toBe(1)
    expect(markerCount(input, 0xda)).toBe(fixture.scans)

    const image = await Image.open(input)
    await expect(image.metadata()).resolves.toMatchObject({
      width: fixture.width ?? 37,
      height: fixture.height ?? 23,
      bitDepth: 8,
      colorSpace: fixture.colorSpace,
      chromaSubsampling: fixture.chromaSubsampling,
    })
    const actual = PNG.sync.read(await image.png().toBuffer())
    const reference = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    expect({ width: actual.width, height: actual.height }).toEqual({
      width: reference.info.width,
      height: reference.info.height,
    })

    let errorTotal = 0
    let maximumError = 0
    for (let pixel = 0; pixel < actual.width * actual.height; pixel += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        const error = Math.abs(
          (actual.data[pixel * 4 + channel] ?? 0) - (reference.data[pixel * 3 + channel] ?? 0),
        )
        errorTotal += error
        maximumError = Math.max(maximumError, error)
      }
    }
    const meanAbsoluteError = errorTotal / (actual.width * actual.height * 3)
    expect(meanAbsoluteError).toBeLessThanOrEqual(fixture.maximumMeanAbsoluteError)
    expect(maximumError).toBeLessThanOrEqual(fixture.maximumChannelError)
  })

  it('converts a progressive ZRL refinement image through resize to WebP', async () => {
    const input = await readFile(join(fixtureDirectory, 'generated-progressive-zrl.jpg'))
    const output = await (await Image.open(input))
      .resize({ width: 200 })
      .webp({ quality: 80 })
      .toBuffer()
    expect(String.fromCharCode(...output.subarray(0, 4))).toBe('RIFF')
    await expect(sharp(output).metadata()).resolves.toMatchObject({
      format: 'webp',
      width: 200,
      height: 133,
    })
  })

  it('matches libjpeg at odd crop edges without full-frame chroma materialization', async () => {
    const input = await readFile(join(fixtureDirectory, 'generated-yuv440.jpg'))
    const crop = { x: 3, y: 2, width: 29, height: 17 }
    const actual = PNG.sync.read(await (await Image.open(input)).crop(crop).png().toBuffer())
    const reference = await sharp(input)
      .extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height })
      .removeAlpha()
      .raw()
      .toBuffer()
    let maximumError = 0
    for (let pixel = 0; pixel < crop.width * crop.height; pixel += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        maximumError = Math.max(
          maximumError,
          Math.abs((actual.data[pixel * 4 + channel] ?? 0) - (reference[pixel * 3 + channel] ?? 0)),
        )
      }
    }
    expect(maximumError).toBeLessThanOrEqual(3)
  })
})
