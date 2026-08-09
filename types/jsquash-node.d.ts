declare module '@jsquash/jpeg/decode.js' {
  export function init(module: WebAssembly.Module): Promise<void>
  export default function decode(
    buffer: ArrayBuffer,
    options?: { readonly preserveOrientation?: boolean },
  ): Promise<ImageData>
}

declare module '@jsquash/jpeg/encode.js' {
  export function init(module: WebAssembly.Module): Promise<void>
  export default function encode(
    data: ImageData,
    options?: { readonly quality?: number },
  ): Promise<ArrayBuffer>
}

declare module '@jsquash/webp/decode.js' {
  export function init(module: WebAssembly.Module): Promise<void>
  export default function decode(buffer: ArrayBuffer): Promise<ImageData>
}
