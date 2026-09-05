import alphaManifest from '../tests/fixtures/jpegxl/m4-color/alpha-manifest.json' with {
  type: 'json',
}
import manifest from '../tests/fixtures/jpegxl/m4-color/manifest.json' with { type: 'json' }
import vardctManifest from '../tests/fixtures/jpegxl/m4-color/vardct-manifest.json' with {
  type: 'json',
}
import vardctAlphaManifest from '../tests/fixtures/jpegxl/m4-color/vardct-alpha-manifest.json' with {
  type: 'json',
}
import { createImageLibrary } from '../src/browser.ts'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { pngCodec } from '../src/codecs/png.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { MemorySource } from '../src/source.ts'
import { pixelStorage } from '../src/pixel.ts'

const bytes = async (name: string): Promise<Uint8Array> => {
  const response = await fetch(`/fixtures/jpegxl-m4-${name}`)
  if (!response.ok) throw new Error(`Missing JPEG XL fixture ${name}`)
  return new Uint8Array(await response.arrayBuffer())
}
const equal = (actual: Uint8Array, expected: Uint8Array): void => {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error('JPEG XL native samples differ from the independently verified fixture')
  }
}
export const verifyColors = async (): Promise<number> => {
  for (const definition of [...manifest.cases, ...alphaManifest.cases]) {
    const decoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(await bytes(`${definition.id}.jxl`)),
      defaultImageLimits,
      { colorOutput: 'preserve' },
    )
    if (!decoder) throw new Error('JPEG XL decoder unavailable')
    const expected = await bytes(`${definition.id}.bin`)
    let offset = 0
    for await (const block of decoder.decode()) {
      try {
        equal(block.data, expected.subarray(offset, offset + block.data.length))
        offset += block.data.length
      } finally {
        block.release?.()
      }
    }
    if (offset !== expected.length) throw new Error('JPEG XL row count differs')
    if (JSON.stringify(decoder.colorSemantics) !== JSON.stringify(definition.colorSemantics))
      throw new Error('JPEG XL color semantics differ')
  }
  for (const definition of [...vardctManifest.cases, ...vardctAlphaManifest.cases]) {
    const decoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(await bytes(`${definition.id}.jxl`)),
      defaultImageLimits,
      { colorOutput: 'preserve' },
    )
    if (!decoder) throw new Error('Decoder unavailable')
    const reference = await bytes(`${definition.id}.bin`)
    const expected = new DataView(reference.buffer, reference.byteOffset, reference.byteLength)
    let sample = 0
    let squared = 0
    for await (const block of decoder.decode()) {
      try {
        const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
        const storage = pixelStorage(block.format)
        for (let offset = 0; offset < block.data.length; offset += storage.bytesPerSample) {
          const actual = block.format.endsWith('f32')
            ? view.getFloat32(offset, false)
            : view.getUint16(offset, false) / (2 ** definition.depth - 1)
          let target = expected.getFloat32(sample++ * 4, false)
          if (definition.clipReference) target = Math.max(0, Math.min(1, target))
          const error = Math.abs(actual - target) / definition.sourcePeak
          if (!Number.isFinite(error) || error > 1 / 255)
            throw new Error(`${definition.id}: sample differs from djxl`)
          squared += error * error
        }
      } finally {
        block.release?.()
      }
    }
    if (sample * 4 !== reference.length || Math.sqrt(squared / sample) > 0.55 / 255)
      throw new Error(`${definition.id}: pixel comparison failed`)
  }
  const multiple = new MemorySource(await bytes('multiple-alpha.jxl'))
  for (const alphaChannel of [0, 1]) {
    const decoder = await jpegxlCodec.createDecoder?.(multiple, defaultImageLimits, {
      alphaChannel,
    })
    if (!decoder) throw new Error('Decoder unavailable')
    for await (const block of decoder.decode()) {
      try {
        equal(
          block.data,
          Uint8Array.of(
            10,
            30,
            50,
            alphaChannel === 0 ? 70 : 90,
            20,
            40,
            60,
            alphaChannel === 0 ? 80 : 100,
          ),
        )
      } finally {
        block.release?.()
      }
    }
  }
  return (
    manifest.cases.length +
    alphaManifest.cases.length +
    vardctManifest.cases.length +
    vardctAlphaManifest.cases.length +
    2
  )
}

export const verifyOrientations = async (): Promise<number> => {
  const Image = createImageLibrary({ codecs: [jpegxlCodec, pngCodec] })
  const pixels = Uint8Array.of(
    10,
    11,
    12,
    20,
    21,
    22,
    30,
    31,
    32,
    40,
    41,
    42,
    50,
    51,
    52,
    60,
    61,
    62,
  )
  const orders = [
    [0, 1, 2, 3, 4, 5],
    [2, 1, 0, 5, 4, 3],
    [5, 4, 3, 2, 1, 0],
    [3, 4, 5, 0, 1, 2],
    [0, 3, 1, 4, 2, 5],
    [3, 0, 4, 1, 5, 2],
    [5, 2, 4, 1, 3, 0],
    [2, 5, 1, 4, 0, 3],
  ]
  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
    const sink = new Uint8ArraySink()
    const encoder = await jpegxlCodec.createEncoder?.(sink, {
      width: 3,
      height: 2,
      pixelFormat: 'rgb8',
      colorSemantics: {
        family: 'rgb',
        primaries: 'srgb',
        transfer: { kind: 'srgb' },
        matrix: 'identity',
        range: 'full',
        alpha: 'none',
        provenance: 'assumed-default',
        renderingIntent: 'relative',
      },
      options: { mode: 'lossless', orientation },
      limits: defaultImageLimits,
    })
    if (!encoder) throw new Error('JPEG XL encoder unavailable')
    await encoder.write({
      x: 0,
      y: 0,
      width: 3,
      height: 2,
      stride: 9,
      format: 'rgb8',
      data: pixels,
    })
    await encoder.finish()
    const png = await (await Image.open(sink.toUint8Array())).autoOrient().png().toBuffer()
    const decoder = await pngCodec.createDecoder?.(new MemorySource(png), defaultImageLimits)
    if (
      !decoder ||
      decoder.width !== (orientation >= 5 ? 2 : 3) ||
      decoder.height !== (orientation >= 5 ? 3 : 2)
    )
      throw new Error('Oriented dimensions differ')
    let index = 0
    for await (const block of decoder.decode()) {
      try {
        const channels = block.format === 'rgba8' ? 4 : 3
        for (let y = 0; y < block.height; y += 1)
          for (let x = 0; x < block.width; x += 1) {
            const sourcePixel = orders[orientation - 1]?.[index++]
            if (sourcePixel === undefined)
              throw new Error('Orientation output exceeds expected size')
            const start = y * block.stride + x * channels
            equal(
              block.data.subarray(start, start + 3),
              pixels.subarray(sourcePixel * 3, sourcePixel * 3 + 3),
            )
          }
      } finally {
        block.release?.()
      }
    }
    if (index !== 6) throw new Error('Oriented output is incomplete')
    const cropped = await (await Image.open(sink.toUint8Array()))
      .autoOrient()
      .crop({ x: 1, y: 1, width: 1, height: 1 })
      .resize({ width: 2, height: 2, fit: 'fill' })
      .png()
      .toBuffer()
    const croppedDecoder = await pngCodec.createDecoder?.(
      new MemorySource(cropped),
      defaultImageLimits,
    )
    const selected = orders[orientation - 1]?.[(orientation >= 5 ? 2 : 3) + 1]
    if (
      !croppedDecoder ||
      selected === undefined ||
      croppedDecoder.width !== 2 ||
      croppedDecoder.height !== 2
    )
      throw new Error('Oriented crop geometry differs')
    for await (const block of croppedDecoder.decode()) {
      try {
        const channels = block.format === 'rgba8' ? 4 : 3
        for (let row = 0; row < block.height; row++)
          for (let x = 0; x < block.width; x++)
            equal(
              block.data.subarray(
                row * block.stride + x * channels,
                row * block.stride + x * channels + 3,
              ),
              pixels.subarray(selected * 3, selected * 3 + 3),
            )
      } finally {
        block.release?.()
      }
    }
  }
  return 8
}
