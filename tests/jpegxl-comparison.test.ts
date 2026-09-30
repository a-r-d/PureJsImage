import { describe, expect, it } from 'vitest'
import {
  classifyError,
  counts,
  lossyOutputStatus,
  type Pixels,
  parseFixture,
  rgba8,
  summarize,
  validatePixels,
  validateImplementationIdentity,
} from '../benchmark/jpegxl/comparison/model.ts'
import { nextRecoverySetting, recoveryBracket } from '../benchmark/jpegxl/m7-recovery-curves.ts'

const p: Pixels = {
  width: 1,
  height: 1,
  channels: 4,
  data: Uint8Array.of(123, 45, 67, 0),
  interpretation: 'srgb',
}
describe('JPEG XL public-wrapper comparison', () => {
  it('rejects comparison reports from different revisions or codec sources', () => {
    const identity = {
      implementationRevision: 'revision',
      implementationSourceSha256: 'source',
      implementationDirty: true,
    }
    expect(() => validateImplementationIdentity(identity, identity)).not.toThrow()
    expect(() =>
      validateImplementationIdentity(
        { ...identity, implementationSourceSha256: 'older-source' },
        identity,
      ),
    ).toThrow('implementationSourceSha256')
    expect(() =>
      validateImplementationIdentity(
        { ...identity, implementationRevision: 'older-revision' },
        identity,
      ),
    ).toThrow('implementationRevision')
    expect(() =>
      validateImplementationIdentity({ ...identity, implementationDirty: false }, identity),
    ).toThrow('implementationDirty')
    expect(() => validateImplementationIdentity({}, identity)).toThrow('mismatch')
    expect(() => validateImplementationIdentity({}, {})).toThrow('Missing')
  })
  it('checks hidden color exactly for lossless alpha', () => {
    expect(validatePixels({ ...p, data: Uint8Array.of(0, 0, 0, 0) }, p, 0).status).toBe(
      'incorrect output',
    )
  })
  it('rejects precision loss despite equivalent dimensions', () => {
    expect(validatePixels(p, { ...p, data: Uint16Array.of(123, 45, 67, 0) }, 0).status).toBe(
      'incorrect output',
    )
  })
  it('rejects wrong channel and color contracts', () => {
    expect(validatePixels({ ...p, channels: 3 }, p, 0).status).toBe('incorrect output')
    expect(validatePixels({ ...p, interpretation: 'linear' }, p, 0).status).toBe('incorrect output')
  })
  it('uses declared lossy tolerance without relaxing exact cases', () => {
    const actual = { ...p, data: Uint8Array.of(124, 45, 67, 0) }
    expect(validatePixels(actual, p, 0).status).toBe('incorrect output')
    expect(validatePixels(actual, p, 2).status).toBe('verified')
  })
  it('rejects nonfinite samples', () => {
    const f = { ...p, data: Float32Array.of(1, 0, 0, 1) }
    expect(validatePixels({ ...f, data: Float32Array.of(NaN, 0, 0, 1) }, f, 0).status).toBe(
      'incorrect output',
    )
  })
  it('expands opaque gray without synthesizing high precision', () => {
    expect(
      Array.from(
        rgba8({ width: 1, height: 1, channels: 1, data: Uint8Array.of(47), interpretation: 'srgb' })
          .data,
      ),
    ).toEqual([47, 47, 47, 255])
    expect(() => rgba8({ ...p, data: Uint16Array.of(1, 2, 3, 4) })).toThrow('precision')
  })
  it('keeps missing measurements null and reports actual spread', () => {
    expect(summarize([])).toBeNull()
    expect(summarize([7, 1, 3, 5])).toEqual({ median: 4, minimum: 1, maximum: 7, count: 4 })
    expect(() => summarize([NaN])).toThrow()
  })
  it('keeps absent APIs, unsupported inputs and failures distinct', () => {
    const c = counts([
      { status: 'verified' },
      { status: 'API not exposed' },
      { status: 'unsupported input' },
      { status: 'execution failure' },
      { status: 'not tested' },
    ])
    expect(c.verified).toBe(1)
    expect(c['API not exposed']).toBe(1)
    expect(c['incorrect output']).toBe(0)
    expect(
      classifyError(Object.assign(new Error('input'), { code: 'UNSUPPORTED_OPERATION' })).status,
    ).toBe('unsupported input')
    expect(classifyError(new Error('WASM initialization failed')).status).toBe('execution failure')
  })
  it('does not invent a bracket or interpolate outside sampled quality', () => {
    const points = [
      { setting: 1, score: 60, bytes: 100 },
      { setting: 2, score: 40, bytes: 50 },
    ]
    expect(recoveryBracket(points, 80)).toBeUndefined()
    expect(nextRecoverySetting(points, 80, 0.25, 25, 2)).toBe(0.5)
  })
  it('enforces exact-alpha promises without inventing them for other lossy defaults', () => {
    expect(lossyOutputStatus(true, 4, true)).toBe('incorrect output')
    expect(lossyOutputStatus(true, 4, false)).toBe('verified')
    expect(lossyOutputStatus(false, 0, false)).toBe('incorrect output')
    expect(() => lossyOutputStatus(true, NaN, false)).toThrow()
  })
  it('rejects untyped external fixture data', () => {
    expect(() => parseFixture({ scope: 'unseen', sampleType: 'uint8' })).toThrow()
    expect(() => parseFixture(null)).toThrow()
  })
})
