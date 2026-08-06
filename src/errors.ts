export type ImageErrorCode =
  | 'INVALID_INPUT'
  | 'LIMIT_EXCEEDED'
  | 'TRUNCATED_INPUT'
  | 'UNSUPPORTED_FORMAT'
  | 'UNSUPPORTED_OPERATION'

export class ImageError extends Error {
  readonly code: ImageErrorCode

  constructor(code: ImageErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ImageError'
    this.code = code
  }
}

export const invalidInput = (message: string): ImageError =>
  new ImageError('INVALID_INPUT', message)

export const limitExceeded = (message: string): ImageError =>
  new ImageError('LIMIT_EXCEEDED', message)

export const truncatedInput = (message: string): ImageError =>
  new ImageError('TRUNCATED_INPUT', message)

export const unsupportedFormat = (message: string): ImageError =>
  new ImageError('UNSUPPORTED_FORMAT', message)

export const unsupportedOperation = (message: string): ImageError =>
  new ImageError('UNSUPPORTED_OPERATION', message)
