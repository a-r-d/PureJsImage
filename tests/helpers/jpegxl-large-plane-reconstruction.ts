import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

const checksum = (bytes: Uint8Array): number => {
  let value = 0x811c9dc5
  for (let p = 0; p < bytes.length; p++) value = Math.imul(value ^ (bytes[p] ?? 0), 0x01000193)
  return value >>> 0
}

/** Nonconstant complete large windows, including gradients, edges and texture. */
export async function verifyJpegXlLargePlaneReconstruction() {
  const width = 96,
    height = 64,
    pixels = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 3
      pixels[at] = (x * 3 + y * 2 + ((x * y) >>> 4)) & 255
      pixels[at + 1] = (x * 2 + y * 5 + ((x * y) >>> 5)) & 255
      pixels[at + 2] = (x + y * 3 + (((x >>> 3) ^ (y >>> 3)) & 1) * 7) & 255
    }
  const inputChecksum = checksum(pixels),
    cases: { distance: number; bytes: number; encodedChecksum: number; decodedChecksum: number }[] =
      []
  for (const distance of [2, 7]) {
    const sink = new Uint8ArraySink(),
      encoder = await jpegxlCodec.createEncoder?.(sink, {
        width,
        height,
        pixelFormat: 'rgb8',
        limits: defaultImageLimits,
        options: { mode: 'lossy', effort: 7, distance },
        colorSemantics: {
          family: 'rgb',
          primaries: 'srgb',
          transfer: { kind: 'srgb' },
          matrix: 'identity',
          range: 'full',
          alpha: 'none',
          provenance: 'container-signaled',
          renderingIntent: 'relative',
        },
      })
    if (!encoder) throw new Error('JPEG XL encoder unavailable')
    await encoder.write({
      x: 0,
      y: 0,
      width,
      height,
      stride: width * 3,
      format: 'rgb8',
      data: pixels,
    })
    await encoder.finish()
    if (checksum(pixels) !== inputChecksum) throw new Error('JPEG XL encoding changed input')
    if (
      !('managedLiveBytes' in encoder) ||
      encoder.managedLiveBytes !== 0 ||
      !('managedLiveAllocations' in encoder) ||
      encoder.managedLiveAllocations !== 0
    )
      throw new Error('JPEG XL encoding retained scratch')
    const bytes = sink.toUint8Array(),
      decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
    if (
      !decoder ||
      decoder.width !== width ||
      decoder.height !== height ||
      (decoder.pixelFormat !== 'rgb8' && decoder.pixelFormat !== 'rgba8')
    )
      throw new Error('JPEG XL reconstruction changed geometry or format')
    const output = new Uint8Array(width * height * 3),
      channels = decoder.pixelFormat === 'rgb8' ? 3 : 4
    let rows = 0
    for await (const block of decoder.decode()) {
      try {
        if (block.x !== 0 || block.y !== rows || block.width !== width)
          throw new Error('JPEG XL reconstruction changed row geometry')
        for (let y = 0; y < block.height; y++)
          for (let x = 0; x < width; x++) {
            const source = y * block.stride + x * channels,
              target = ((rows + y) * width + x) * 3
            for (let c = 0; c < 3; c++) output[target + c] = block.data[source + c] ?? 0
            if (channels === 4 && block.data[source + 3] !== 255)
              throw new Error('JPEG XL reconstruction changed opaque alpha')
          }
        rows += block.height
      } finally {
        block.release?.()
      }
    }
    if (rows !== height) throw new Error('JPEG XL reconstruction missed rows')
    cases.push({
      distance,
      bytes: bytes.length,
      encodedChecksum: checksum(bytes),
      decodedChecksum: checksum(output),
    })
  }
  return { width, height, inputChecksum, cases }
}
