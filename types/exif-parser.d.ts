declare module 'exif-parser' {
  interface ExifResult {
    tags: {
      Orientation?: number
      [name: string]: unknown
    }
  }

  interface ExifParserInstance {
    parse(): ExifResult
  }

  const ExifParser: {
    create(buffer: Buffer | Uint8Array): ExifParserInstance
  }

  export default ExifParser
}
