import { number, object, string } from './model.ts'

export interface OriginalMatrixAttempt {
  readonly setting: number
  readonly report: string
  readonly status: 'attempted' | 'verified' | 'failed'
}

export interface OriginalMatrixLedgerIdentity {
  readonly implementationSourceSha256: string
  readonly fixture: string
  readonly inputSha256: string
  readonly minimumSetting: number
  readonly maximumSetting: number
}

/** Failed and unfinished measurements still consume the unchanged search budget. */
export const originalMatrixAttempts = (
  input: unknown,
  identity: OriginalMatrixLedgerIdentity,
): readonly OriginalMatrixAttempt[] => {
  const ledger = object(input)
  if (
    ledger.implementationSourceSha256 !== identity.implementationSourceSha256 ||
    ledger.fixture !== identity.fixture ||
    ledger.inputSha256 !== identity.inputSha256 ||
    ledger.maximumAttempts !== 24 ||
    !Array.isArray(ledger.attempts) ||
    ledger.attempts.length > 24
  )
    throw new Error('Original matrix ledger identity or attempt budget differs')
  const settings = new Set<number>()
  return ledger.attempts.map((input): OriginalMatrixAttempt => {
    const attempt = object(input),
      setting = number(attempt.setting),
      report = string(attempt.report)
    if (
      !Number.isFinite(setting) ||
      setting < identity.minimumSetting ||
      setting > identity.maximumSetting ||
      settings.has(setting) ||
      report.length === 0 ||
      (attempt.status !== 'attempted' &&
        attempt.status !== 'verified' &&
        attempt.status !== 'failed')
    )
      throw new Error('Invalid or repeated original matrix attempt')
    settings.add(setting)
    return { setting, report, status: attempt.status }
  })
}
