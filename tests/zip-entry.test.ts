import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { extractPinnedZipEntry } from '../benchmark/lib/zip-entry.ts'

const zip = (name: string, value: Uint8Array, method: 0 | 8): Uint8Array<ArrayBuffer> => {
  const nameBytes = new TextEncoder().encode(name)
  const compressed = method === 0 ? value : Uint8Array.from(deflateRawSync(value))
  const localBytes = 30 + nameBytes.byteLength + compressed.byteLength
  const centralBytes = 46 + nameBytes.byteLength
  const bytes = new Uint8Array(localBytes + centralBytes + 22)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x0403_4b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(8, method, true)
  view.setUint32(18, compressed.byteLength, true)
  view.setUint32(22, value.byteLength, true)
  view.setUint16(26, nameBytes.byteLength, true)
  bytes.set(nameBytes, 30)
  bytes.set(compressed, 30 + nameBytes.byteLength)

  const central = localBytes
  view.setUint32(central, 0x0201_4b50, true)
  view.setUint16(central + 4, 20, true)
  view.setUint16(central + 6, 20, true)
  view.setUint16(central + 10, method, true)
  view.setUint32(central + 20, compressed.byteLength, true)
  view.setUint32(central + 24, value.byteLength, true)
  view.setUint16(central + 28, nameBytes.byteLength, true)
  bytes.set(nameBytes, central + 46)

  const end = central + centralBytes
  view.setUint32(end, 0x0605_4b50, true)
  view.setUint16(end + 8, 1, true)
  view.setUint16(end + 10, 1, true)
  view.setUint32(end + 12, centralBytes, true)
  view.setUint32(end + 16, central, true)
  return bytes
}

describe('pinned ZIP fixture extraction', () => {
  it.each([0, 8] as const)('extracts one exact method-%i entry', (method) => {
    const value = new TextEncoder().encode('independently pinned Velox fixture')
    expect(extractPinnedZipEntry(zip('fixture.emd', value, method), 'fixture.emd', 1_024)).toEqual(
      value,
    )
  })

  it('rejects missing, path-like, oversized, and corrupt entries', () => {
    const archive = zip('fixture.emd', new Uint8Array(32), 8)
    expect(() => extractPinnedZipEntry(archive, 'missing.emd', 1_024)).toThrow('missing')
    expect(() => extractPinnedZipEntry(archive, '../fixture.emd', 1_024)).toThrow('plain filename')
    expect(() => extractPinnedZipEntry(archive, 'fixture.emd', 16)).toThrow('exceeds')
    const corrupt = archive.slice()
    corrupt[0] = 0
    expect(() => extractPinnedZipEntry(corrupt, 'fixture.emd', 1_024)).toThrow(
      'local-file signature',
    )
  })
})
