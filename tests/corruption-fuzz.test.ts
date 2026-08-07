import { beforeAll, describe, expect, it } from 'vitest'

import { ImageError } from '../src/index.ts'
import { createCodecFixtures, type CodecFixture } from './codec-fixtures.ts'
import { Image } from './image-library.ts'

const truncationStep = 1_024
const bitFlipCases = 16

const exercise = async (
  input: Uint8Array,
  label: string,
  failureRequired: boolean,
): Promise<void> => {
  let failure: unknown
  let threw = false
  try {
    const image = await Image.open(input)
    const metadata = await image.metadata()
    await image
      .crop({
        x: 0,
        y: 0,
        width: Math.min(8, metadata.width),
        height: Math.min(8, metadata.height),
      })
      .png()
      .toBuffer()
  } catch (error) {
    threw = true
    failure = error
  }

  if (failureRequired) expect(threw, `${label} unexpectedly decoded`).toBe(true)
  if (threw) expect(failure, label).toBeInstanceOf(ImageError)
}

const seedFor = (format: string): number => {
  let seed = 0x811c_9dc5
  for (const character of format) {
    seed = Math.imul(seed ^ character.charCodeAt(0), 16_777_619) >>> 0
  }
  return seed
}

const bitFlips = function* (fixture: CodecFixture): Generator<Uint8Array> {
  let state = seedFor(fixture.format)
  for (let index = 0; index < bitFlipCases; index += 1) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    const byteOffset = state % fixture.input.byteLength
    const bit = 1 << ((state >>> 29) & 7)
    const corrupted = fixture.input.slice()
    corrupted[byteOffset] = (corrupted[byteOffset] ?? 0) ^ bit
    yield corrupted
  }
}

describe('deterministic corruption fuzz', () => {
  let fixtures: readonly CodecFixture[] = []

  beforeAll(async () => {
    fixtures = await createCodecFixtures()
  })

  it('turns every 1 KiB and final-byte truncation into an ImageError', async () => {
    for (const fixture of fixtures) {
      for (
        let length = truncationStep;
        length < fixture.input.byteLength;
        length += truncationStep
      ) {
        await exercise(
          fixture.input.subarray(0, length),
          `${fixture.format} truncated at ${length}`,
          true,
        )
      }
      const finalByte = fixture.input.byteLength - 1
      if (finalByte % truncationStep !== 0) {
        await exercise(
          fixture.input.subarray(0, finalByte),
          `${fixture.format} truncated at ${finalByte}`,
          true,
        )
      }
    }
  }, 30_000)

  it('never leaks raw exceptions after deterministic bit flips', async () => {
    for (const fixture of fixtures) {
      let index = 0
      for (const corrupted of bitFlips(fixture)) {
        await exercise(corrupted, `${fixture.format} bit flip ${index}`, false)
        index += 1
      }
    }
  }, 30_000)
})
