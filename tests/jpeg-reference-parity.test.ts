import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { jpegCodec } from '../src/codecs/jpeg.ts'
import { resolveLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'
import {
  observeJpegReferenceVector,
  type JpegReferenceProvider,
} from '../benchmark/jpeg/reference-parity.ts'
import { jpegReferenceVectors } from '../benchmark/jpeg/reference-vectors.ts'

const provider: JpegReferenceProvider = {
  metadata: (input, limits) => jpegCodec.metadata(new MemorySource(input), resolveLimits(limits)),
  decode: async function* (input, request, limits) {
    const decoder = await jpegCodec.createDecoder?.(new MemorySource(input), resolveLimits(limits))
    if (!decoder) throw new Error('JPEG reference decoder is unavailable')
    yield* decoder.decode(request)
  },
}

describe('JPEG provider-neutral reference vectors', () => {
  it.each(jpegReferenceVectors)('matches $id', async (vector) => {
    const input = await readFile(
      join('benchmark', 'corpus', 'files', 'jpeg-reference', vector.file),
    )
    const observation = await observeJpegReferenceVector(provider, vector, input)

    if (vector.expectedError) {
      expect(observation.error).toBe(vector.expectedError)
      expect(observation.pixels).toBeUndefined()
      return
    }
    expect(observation.error).toBeUndefined()
    if (vector.metadata) expect(observation.metadata).toMatchObject(vector.metadata)
    if (vector.pixels?.kind === 'exact') expect(observation.sha256).toBe(vector.pixels.sha256)
    else if (vector.pixels) expect(observation.sha256).toBe(vector.pixels.referenceSha256)
  })
})
