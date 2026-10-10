import { ImageError, invalidInput } from '../errors.ts'
export const invalidJpegXlInput = (suffix: string) => invalidInput('JPEG XL ' + suffix)
export const isJpegXlLimitExceeded = (error: unknown): error is ImageError =>
  error instanceof ImageError && error.code === 'LIMIT_EXCEEDED'

export const rethrowJpegXlNonLimitError = (error: unknown): void => {
  if (!isJpegXlLimitExceeded(error)) throw error
}
