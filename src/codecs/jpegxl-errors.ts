import { invalidInput } from '../errors.ts'
export const invalidJpegXlInput = (suffix: string) => invalidInput('JPEG XL ' + suffix)
