import { describe, expect, it } from 'vitest'
import { originalMatrixAttempts } from '../benchmark/jpegxl/comparison/original-matrix-ledger.ts'

const identity = {
  implementationSourceSha256: 'frozen-source',
  fixture: 'pinned-original',
  inputSha256: 'exact-rgba',
  minimumSetting: 0.25,
  maximumSetting: 25,
}
const ledger = (attempts: readonly unknown[]) => ({
  implementationSourceSha256: identity.implementationSourceSha256,
  fixture: identity.fixture,
  inputSha256: identity.inputSha256,
  maximumAttempts: 24,
  attempts,
})

describe('original JPEG XL comparison attempt ledger', () => {
  it('retains failed and interrupted attempts alongside verified points', () => {
    const attempts = [
      { setting: 0.5, report: 'first.json', status: 'verified' },
      { setting: 1, report: 'crash.json', status: 'failed' },
      { setting: 2, report: 'interrupted.json', status: 'attempted' },
    ]
    expect(originalMatrixAttempts(ledger(attempts), identity)).toEqual(attempts)
  })

  it('counts failed attempts toward the 24-attempt maximum', () => {
    const attempts = Array.from({ length: 24 }, (_, index) => ({
      setting: index + 1,
      report: `point-${index}.json`,
      status: 'failed',
    }))
    expect(originalMatrixAttempts(ledger(attempts), identity)).toHaveLength(24)
    expect(() =>
      originalMatrixAttempts(
        ledger([...attempts, { setting: 25, report: 'extra.json', status: 'verified' }]),
        identity,
      ),
    ).toThrow('attempt budget')
  })

  it('rejects a repeated setting after a failed or unfinished attempt', () => {
    for (const status of ['failed', 'attempted'])
      expect(() =>
        originalMatrixAttempts(
          ledger([
            { setting: 1, report: 'previous.json', status },
            { setting: 1, report: 'retry.json', status: 'verified' },
          ]),
          identity,
        ),
      ).toThrow('repeated')
  })

  it.each(['implementationSourceSha256', 'fixture', 'inputSha256', 'maximumAttempts'])(
    'rejects a ledger with a different %s',
    (key) => {
      expect(() => originalMatrixAttempts({ ...ledger([]), [key]: 'different' }, identity)).toThrow(
        'identity',
      )
    },
  )

  it('rejects nonfinite, out-of-domain or malformed attempts', () => {
    for (const setting of [Number.NaN, Infinity, 0.24, 25.01])
      expect(() =>
        originalMatrixAttempts(
          ledger([{ setting, report: 'point.json', status: 'verified' }]),
          identity,
        ),
      ).toThrow()
    for (const attempt of [
      { setting: 1, report: '', status: 'verified' },
      { setting: 1, report: 'point.json', status: 'unknown' },
      null,
    ])
      expect(() => originalMatrixAttempts(ledger([attempt]), identity)).toThrow()
  })
})
