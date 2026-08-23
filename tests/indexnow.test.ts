import { describe, expect, it } from 'vitest'
import {
  createIndexNowPayload,
  extractSitemapLocations,
  validateIndexNowKey,
} from '../scripts/indexnow.ts'

describe('IndexNow deployment support', () => {
  it('accepts protocol-compatible keys and rejects invalid keys', () => {
    expect(validateIndexNowKey('Abc-1234')).toBe('Abc-1234')
    expect(() => validateIndexNowKey('short')).toThrow(/8 to 128/u)
    expect(() => validateIndexNowKey('invalid_key')).toThrow(/letters, numbers, or dashes/u)
    expect(() => validateIndexNowKey('a'.repeat(129))).toThrow(/8 to 128/u)
  })

  it('extracts and decodes locations from generated sitemaps', () => {
    expect(
      extractSitemapLocations(`
        <urlset>
          <url><loc>https://purejsimage.com/</loc></url>
          <url><loc>https://purejsimage.com/guides/?a=1&amp;b=2</loc></url>
        </urlset>
      `),
    ).toEqual(['https://purejsimage.com/', 'https://purejsimage.com/guides/?a=1&b=2'])
  })

  it('builds a deduplicated same-host batch with a root key file', () => {
    expect(
      createIndexNowPayload('Abc-1234', [
        'https://purejsimage.com/',
        'https://purejsimage.com/guides/',
        'https://purejsimage.com/guides/',
      ]),
    ).toEqual({
      host: 'purejsimage.com',
      key: 'Abc-1234',
      keyLocation: 'https://purejsimage.com/Abc-1234.txt',
      urlList: ['https://purejsimage.com/', 'https://purejsimage.com/guides/'],
    })
    expect(() => createIndexNowPayload('Abc-1234', ['https://example.com/'])).toThrow(
      /must use https:\/\/purejsimage\.com/u,
    )
  })
})
