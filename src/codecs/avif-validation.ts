import { invalidInput, limitExceeded } from '../errors.ts'
import type { Av1Frame } from './av1-frame.ts'
import type { AvifCodedImageInspection } from './avif-metadata.ts'
export const MAX_BOUNDED_AVIF_WORKING_BYTES = 64 * 1_024 * 1_024

export const validateAvifWorkingBytes = (workingBytes: number): void => {
  if (!Number.isSafeInteger(workingBytes) || workingBytes > MAX_BOUNDED_AVIF_WORKING_BYTES) {
    throw limitExceeded(
      `AVIF decoder working set ${workingBytes} exceeds ${MAX_BOUNDED_AVIF_WORKING_BYTES} bytes`,
    )
  }
}
export const validateAvifFrameDimensions = (
  coded: Pick<AvifCodedImageInspection, 'height' | 'itemId' | 'width'>,
  frame: Av1Frame,
): void => {
  if (frame.header.upscaledWidth !== coded.width || frame.header.frameHeight !== coded.height) {
    throw invalidInput(`AVIF item ${coded.itemId} dimensions do not match its AV1 frame`)
  }
}
