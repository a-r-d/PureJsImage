// Keep the WebP reader's single-file bundle limited to the RGB ICC operations it uses.
export { ColorManagedDecoder, parseRgbIccTransform } from './icc.ts'
