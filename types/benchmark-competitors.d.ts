declare module 'jsfive' {
  export class Dataset {
    readonly dtype: string
    readonly shape: number[] | null
    readonly value: unknown
  }

  export class File {
    readonly keys: readonly string[]
    constructor(data: ArrayBuffer, filename?: string)
    get(path: string): Dataset | null
  }
}

declare module 'utif2' {
  interface UtifImageFileDirectory {
    readonly width?: number
    readonly height?: number
    readonly data?: Uint8Array | Uint16Array | Uint32Array | Int8Array | Int16Array | Int32Array
  }

  interface UtifApi {
    decode(data: ArrayBuffer): UtifImageFileDirectory[]
    decodeImage(data: ArrayBuffer, ifd: UtifImageFileDirectory): void
    toRGBA8(ifd: UtifImageFileDirectory): Uint8Array
  }

  const api: UtifApi
  export default api
}
