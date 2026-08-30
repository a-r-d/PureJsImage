import { describe, expect, it } from 'vitest'

import { isXrayRequest } from '../docs-astro/src/scripts/xray-types.ts'

describe('Raster X-Ray worker request validation', () => {
  it('accepts only the closed request protocol', () => {
    expect(isXrayRequest({ type: 'cancel' })).toBe(true)
    expect(isXrayRequest({ type: 'open-remote', url: 'https://example.test/image.png' })).toBe(true)
    expect(isXrayRequest({ type: 'open-ome-zarr', url: 'https://example.test/image.zarr' })).toBe(
      true,
    )

    expect(isXrayRequest({ type: 'cancel', url: 'https://example.test' })).toBe(false)
    expect(isXrayRequest({ type: 'open-remote', url: '' })).toBe(false)
    expect(isXrayRequest({ type: 'open-remote', url: 'https://example.test', extra: true })).toBe(
      false,
    )
    expect(isXrayRequest({ type: 'unknown' })).toBe(false)
    expect(isXrayRequest(null)).toBe(false)
  })

  it('requires a real File for local-open requests', () => {
    expect(isXrayRequest({ type: 'open-local', file: new File(['png'], 'image.png') })).toBe(true)
    expect(isXrayRequest({ type: 'open-local', file: new Blob(['png']) })).toBe(false)
  })
})
