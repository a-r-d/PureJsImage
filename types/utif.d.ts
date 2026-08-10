declare module 'utif' {
  export interface Ifd {
    width?: number
    height?: number
    data?: Uint8Array
    readonly [tag: `t${number}`]: unknown
  }
  export interface Api {
    decode(input: ArrayBuffer): Ifd[]
    decodeImage(input: ArrayBuffer, ifd: Ifd): void
    toRGBA8(ifd: Ifd): Uint8Array
  }

  const api: Api
  export default api
}
