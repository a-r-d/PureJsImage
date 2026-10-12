import { JpegXlEncoderMemory } from '../../src/codecs/jpegxl-encoder-memory.ts'
import {
  encodeVarDctCoefficientSections,
  estimateJpegXlForwardAcModel,
  varDctCodestreamParts,
} from '../../src/codecs/jpegxl-jpeg-encode.ts'
import { createDct16OrderGeometry, decodeDct16OrderFixture } from './jpegxl-dct16-orders.ts'

export async function verifyAcModelReuse(familyContexts: boolean, progressive: boolean) {
  const memory = new JpegXlEncoderMemory(32_000_000)
  let files: Uint8Array[]
  try {
    files = memory.run(() => {
      const geometry = { ...createDct16OrderGeometry(memory), familyContexts, progressive }
      const estimation = estimateJpegXlForwardAcModel(geometry)
      let next = estimation.next()
      while (!next.done) next = estimation.next()
      const encoded: Uint8Array[] = []
      for (const acModelRefinement of [false, true]) {
        const selected = { ...geometry, acModelRefinement, baselineAcModel: next.value }
        const parts = varDctCodestreamParts(
          { width: 512, height: 128 },
          selected,
          encodeVarDctCoefficientSections(selected),
        )
        const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0))
        let offset = 0
        for (const part of parts) {
          bytes.set(part, offset)
          offset += part.byteLength
        }
        encoded.push(bytes)
      }
      return encoded
    })
    if (memory.liveBytes !== 0 || memory.liveAllocations !== 0)
      throw new Error('AC model fixture retained owned storage')
  } finally {
    memory.close()
  }
  const ordinary = files[0],
    refined = files[1]
  if (!ordinary || !refined) throw new Error('Missing AC model fixture')
  const ordinaryPixels = await decodeDct16OrderFixture(ordinary)
  const refinedPixels = await decodeDct16OrderFixture(refined)
  if (ordinaryPixels.length !== refinedPixels.length)
    throw new Error('AC model changed decoded dimensions')
  let checksum = 2166136261
  for (let index = 0; index < ordinaryPixels.length; index++) {
    const value = ordinaryPixels[index] ?? 0
    if (value !== refinedPixels[index]) throw new Error('AC model changed decoded samples')
    checksum = Math.imul(checksum ^ value, 16777619) >>> 0
  }
  return {
    familyContexts,
    progressive,
    ordinaryBytes: ordinary.length,
    refinedBytes: refined.length,
    samples: ordinaryPixels.length,
    checksum,
  }
}

export async function verifyAcModelReuseBrowser() {
  const results = []
  for (const familyContexts of [false, true])
    for (const progressive of [false, true])
      results.push(await verifyAcModelReuse(familyContexts, progressive))
  return results
}
