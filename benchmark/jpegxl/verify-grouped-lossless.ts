import { readFile } from 'node:fs/promises'
import { initialize } from './comparison/adapters.ts'
import { fixtures, hash, json, raw } from './comparison/io.ts'
import { rgba8, type Status, validatePixels } from './comparison/model.ts'

// Recheck the original pinned inputs without replacing dated comparison rows or timings.
const adapter = await initialize('purejsimage', async () => {
  throw new Error('Pure JavaScript verification must not load WASM assets')
})
const rows: {
  fixture: string
  operation: 'decode-lossless' | 'roundtrip'
  encodedSha256: string
  rawSha256: string
  status: Status
  maximumError: number | null
  detail: string
}[] = []
try {
  for (const fixture of await fixtures()) {
    const bytes = new Uint8Array(await readFile(fixture.lossless))
    if (hash(bytes) !== fixture.losslessSha256)
      throw new Error(`Encoded hash mismatch: ${fixture.id}`)
    const expected = await raw(fixture)
    const actual = await adapter.decode(bytes, fixture.sampleType !== 'uint8')
    if (actual.kind !== 'pixels') throw new Error(`Expected native pixels: ${fixture.id}`)
    const result = validatePixels(
      fixture.sampleType === 'uint8' ? rgba8(actual.pixels) : actual.pixels,
      expected,
      0,
    )
    rows.push({
      fixture: fixture.id,
      operation: 'decode-lossless',
      encodedSha256: fixture.losslessSha256,
      rawSha256: fixture.rawSha256,
      ...result,
    })
    console.log(`${fixture.id}: ${result.status}; ${result.detail}`)
    if (result.status !== 'verified') throw new Error(`Lossless regression: ${fixture.id}`)
    if (fixture.id === 'im26-1030-diagnostic') {
      const encoded = await adapter.encode?.(rgba8(actual.pixels), {
        lossless: true,
        effort: 1,
        value: 1,
      })
      if (encoded?.kind !== 'jxl') throw new Error('Missing lossless encoder')
      const reopened = await adapter.decode(encoded.bytes)
      if (reopened.kind !== 'pixels') throw new Error('Missing roundtrip pixels')
      const roundtrip = validatePixels(rgba8(reopened.pixels), expected, 0)
      rows.push({
        fixture: fixture.id,
        operation: 'roundtrip',
        encodedSha256: hash(encoded.bytes),
        rawSha256: fixture.rawSha256,
        ...roundtrip,
      })
      console.log(`${fixture.id} roundtrip: ${roundtrip.status}; ${roundtrip.detail}`)
      if (roundtrip.status !== 'verified') throw new Error('Lossless roundtrip regression')
    }
  }
} finally {
  adapter.close()
}
await json(process.argv[2] ?? '.tmp/jpegxl-grouped-lossless-verification.json', {
  scope:
    'Exact samples for all 16 original pinned public comparison lossless inputs and the formerly rejected roundtrip; no timing claims',
  implementationSourceSha256: hash(await readFile('src/codecs/jpegxl-decode.ts')),
  fixtureManifestSha256: hash(await readFile('benchmark/jpegxl/comparison/fixtures.json')),
  rows,
})
