import { describe, expect, it } from 'vitest'
import { walkJpegMarkers } from '../src/codecs/jpeg-marker-walk.ts'

const concatenate = (...parts: readonly Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

const segment = (marker: number, payload = new Uint8Array()): Uint8Array => {
  const output = new Uint8Array(payload.byteLength + 4)
  output.set([0xff, marker, 0, payload.byteLength + 2])
  output.set(payload, 4)
  return output
}

const walk = (jpeg: Uint8Array, maximumMarkerCount = 32, signal?: AbortSignal) => [
  ...walkJpegMarkers(jpeg, { maximumMarkerCount, ...(signal ? { signal } : {}) }),
]

describe('complete JPEG marker walk', () => {
  it('walks markers before, between, and after scans through EOI', () => {
    const jpeg = concatenate(
      Uint8Array.of(0xff, 0xd8),
      segment(0xe0, Uint8Array.of(1)),
      segment(0xda),
      Uint8Array.of(0x11, 0xff, 0x00, 0x22, 0xff, 0xd0, 0x33),
      segment(0xe1, Uint8Array.of(2)),
      segment(0xda),
      Uint8Array.of(0x44, 0xff, 0x00, 0x55),
      segment(0xe2, Uint8Array.of(3)),
      Uint8Array.of(0xff, 0xd9),
    )

    expect(walk(jpeg).map(({ marker, scanIndex }) => [marker, scanIndex])).toEqual([
      [0xe0, 0],
      [0xda, 0],
      [0xe1, 1],
      [0xda, 1],
      [0xe2, 2],
      [0xd9, 2],
    ])
  })

  it('rejects malformed lengths, truncated entropy, and unsupported fill bytes', () => {
    expect(() => walk(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 1, 0xff, 0xd9))).toThrow(
      'length is malformed',
    )
    expect(() =>
      walk(concatenate(Uint8Array.of(0xff, 0xd8), segment(0xda), Uint8Array.of(1, 0xff))),
    ).toThrow('entropy data is truncated')
    expect(() => walk(Uint8Array.of(0xff, 0xd8, 0xff, 0xff, 0xd9))).toThrow(
      'fill bytes between markers',
    )
    expect(() =>
      walk(
        concatenate(Uint8Array.of(0xff, 0xd8), segment(0xda), Uint8Array.of(1, 0xff, 0xff, 0xd9)),
      ),
    ).toThrow('fill bytes between entropy data')
  })

  it('enforces the marker cap and cancellation', () => {
    const jpeg = concatenate(
      Uint8Array.of(0xff, 0xd8),
      segment(0xe0),
      segment(0xe1),
      Uint8Array.of(0xff, 0xd9),
    )
    expect(() => walk(jpeg, 2)).toThrow('more than 2 markers')

    const controller = new AbortController()
    controller.abort(new Error('marker walk cancelled'))
    expect(() => walk(jpeg, 32, controller.signal)).toThrow('marker walk cancelled')
  })
})
