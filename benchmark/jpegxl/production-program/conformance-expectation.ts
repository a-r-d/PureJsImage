export type JpegXlConformanceClassification =
  | 'pass'
  | 'expected-unsupported'
  | 'malformed-safely-rejected'
  | 'incorrect-output'
  | 'unexpected-failure'

export const matchesCurrentConformanceExpectation = (
  actualClassification: JpegXlConformanceClassification,
  actualOutputSha256: string | undefined,
  expectedOutputSha256: string | undefined,
  matchesHistoricalBaseline: boolean,
): boolean =>
  expectedOutputSha256 === undefined
    ? matchesHistoricalBaseline
    : actualClassification === 'pass' && actualOutputSha256 === expectedOutputSha256
