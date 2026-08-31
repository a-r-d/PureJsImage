import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseJpegCoefficientImage } from '../src/codecs/jpeg-coefficients.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'

const coefficientDigest = (
  components: readonly { readonly coefficients: Int16Array }[],
): string => {
  const hash = createHash('sha256')
  for (const { coefficients } of components) {
    hash.update(
      new Uint8Array(coefficients.buffer, coefficients.byteOffset, coefficients.byteLength),
    )
  }
  return hash.digest('hex')
}

const parseFixture = async (name: string) =>
  parseJpegCoefficientImage(
    new MemorySource(
      new Uint8Array(readFileSync(`benchmark/corpus/files/jpeg-reference/${name}.jpg`)),
    ),
    defaultImageLimits,
    16 * 1_024 * 1_024,
  )

describe('format-neutral JPEG coefficient model', () => {
  it('retains sequential coefficients, sampling, quantization, and scan selectors', async () => {
    const jpeg = await parseFixture('generated-sof1-8bit')
    expect(jpeg).toMatchObject({
      width: 37,
      height: 23,
      progressive: false,
      colorTransform: 'ycbcr',
      restartInterval: 0,
      coefficientBytes: 4_608,
      components: [
        { id: 1, horizontalSampling: 2, verticalSampling: 2, quantizationTable: 0 },
        { id: 2, horizontalSampling: 1, verticalSampling: 1, quantizationTable: 1 },
        { id: 3, horizontalSampling: 1, verticalSampling: 1, quantizationTable: 1 },
      ],
      scans: [
        {
          components: [
            { component: 0, id: 1, dcTable: 0, acTable: 0 },
            { component: 1, id: 2, dcTable: 1, acTable: 1 },
            { component: 2, id: 3, dcTable: 1, acTable: 1 },
          ],
          spectralStart: 0,
          spectralEnd: 63,
          successiveHigh: 0,
          successiveLow: 0,
        },
      ],
    })
    if (!jpeg) throw new Error('Sequential JPEG coefficient fixture was rejected')
    expect(coefficientDigest(jpeg.components)).toBe(
      'dee20e887dc359a196249129bfd7e2057adc35ebaa3cd3a5849c970d260430db',
    )
  })

  it('accumulates a progressive scan script to the same final quantized coefficients', async () => {
    const jpeg = await parseFixture('generated-progressive')
    if (!jpeg) throw new Error('Progressive JPEG coefficient fixture was rejected')

    expect(jpeg.progressive).toBe(true)
    expect(
      jpeg.scans.map(({ spectralStart, spectralEnd, successiveHigh, successiveLow }) => [
        spectralStart,
        spectralEnd,
        successiveHigh,
        successiveLow,
      ]),
    ).toEqual([
      [0, 0, 0, 1],
      [0, 0, 1, 0],
      [1, 63, 0, 1],
      [1, 63, 0, 0],
      [1, 63, 0, 0],
      [1, 63, 1, 0],
    ])
    expect(coefficientDigest(jpeg.components)).toBe(
      'dee20e887dc359a196249129bfd7e2057adc35ebaa3cd3a5849c970d260430db',
    )
  })

  it('fails before coefficient allocation exceeds its explicit budget', async () => {
    await expect(
      parseJpegCoefficientImage(
        new MemorySource(
          new Uint8Array(
            readFileSync('benchmark/corpus/files/jpeg-reference/generated-progressive.jpg'),
          ),
        ),
        defaultImageLimits,
        4_607,
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })
})
