import { basename } from 'node:path'

const fileIndex = process.argv.indexOf('--file')
const file = fileIndex < 0 ? undefined : process.argv[fileIndex + 1]
if (!file) throw new Error('Missing --file')

const behavior = basename(file)
if (behavior === 'hang') {
  process.stderr.write('PUREJSIMAGE_IMAZEN_STAGE metadata\n')
  setInterval(() => {}, 60_000)
} else if (behavior === 'crash') {
  process.stderr.write('PUREJSIMAGE_IMAZEN_STAGE open\n')
  process.exit(17)
} else if (behavior === 'unsupported') {
  process.stdout.write(
    `${JSON.stringify({
      status: 'failure',
      failureKind: 'structured-error',
      lastCompletedStage: 'metadata',
      errorCode: 'UNSUPPORTED_OPERATION',
      errorMessage: 'Deliberately unsupported fixture',
    })}\n`,
  )
} else if (behavior === 'invalid') {
  process.stdout.write(
    `${JSON.stringify({
      status: 'failure',
      failureKind: 'structured-error',
      lastCompletedStage: 'open',
      errorCode: 'INVALID_INPUT',
      errorMessage: 'Invalid fixture rejected',
    })}\n`,
  )
} else if (behavior === 'raw') {
  process.stdout.write(
    `${JSON.stringify({
      status: 'failure',
      failureKind: 'raw-exception',
      lastCompletedStage: 'metadata',
      errorCode: null,
      errorMessage: 'TypeError from fixture',
    })}\n`,
  )
} else {
  process.stdout.write(
    `${JSON.stringify({
      status: 'success',
      lastCompletedStage: 'verify-output',
      width: 1,
      height: 1,
    })}\n`,
  )
}
