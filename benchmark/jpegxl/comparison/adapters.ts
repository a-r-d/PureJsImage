import type { Adapter, Subject } from './model.ts'

// Only published entry points. Library loading and asset compilation belong to cold initialization.
export async function initialize(
  subject: Subject,
  asset: (path: string) => Promise<ArrayBuffer>,
  vipsLocation?: string,
): Promise<Adapter> {
  if (subject === 'purejsimage') {
    const { MemorySource, Uint8ArraySink, defaultImageLimits } = await import('purejsimage/browser')
    const { jpegxlCodec } = await import('purejsimage/codecs/jpegxl')
    return {
      async decode(bytes) {
        const decoder = await jpegxlCodec.createDecoder?.(
          new MemorySource(bytes),
          defaultImageLimits,
        )
        if (!decoder) throw new Error('Missing public decoder')
        const format = decoder.pixelFormat,
          channels = format.startsWith('rgba') ? 4 : format.startsWith('rgb') ? 3 : 1
        const data = format.endsWith('16')
          ? new Uint16Array(decoder.width * decoder.height * channels)
          : format.endsWith('f32')
            ? new Float32Array(decoder.width * decoder.height * channels)
            : new Uint8Array(decoder.width * decoder.height * channels)
        for await (const block of decoder.decode()) {
          try {
            const view = new DataView(
                block.data.buffer,
                block.data.byteOffset,
                block.data.byteLength,
              ),
              size = data.BYTES_PER_ELEMENT
            for (let y = 0; y < block.height; y++)
              for (let x = 0; x < block.width * channels; x++) {
                const offset = y * block.stride + x * size
                data[((block.y + y) * decoder.width + block.x) * channels + x] =
                  data instanceof Uint16Array
                    ? view.getUint16(offset)
                    : data instanceof Float32Array
                      ? view.getFloat32(offset)
                      : (block.data[offset] ?? 0)
              }
          } finally {
            block.release?.()
          }
        }
        return {
          kind: 'pixels',
          pixels: {
            width: decoder.width,
            height: decoder.height,
            channels,
            data,
            interpretation:
              data instanceof Float32Array
                ? 'linear'
                : data instanceof Uint16Array
                  ? 'srgb16'
                  : 'srgb',
          },
        }
      },
      async encode(p, s) {
        const format =
          p.data instanceof Uint16Array
            ? p.channels === 4
              ? 'rgba16'
              : p.channels === 3
                ? 'rgb16'
                : 'gray16'
            : p.channels === 4
              ? 'rgba8'
              : p.channels === 3
                ? 'rgb8'
                : 'gray8'
        if (p.data instanceof Float32Array)
          throw new Error('Use native float API probe; no implicit conversion')
        const sink = new Uint8ArraySink(),
          encoder = await jpegxlCodec.createEncoder?.(sink, {
            width: p.width,
            height: p.height,
            pixelFormat: format,
            limits: defaultImageLimits,
            options: {
              mode: s.lossless ? 'lossless' : 'lossy',
              effort: s.effort,
              ...(s.lossless ? {} : { distance: s.value }),
            },
            colorSemantics: {
              family: p.channels === 1 ? 'gray' : 'rgb',
              primaries: 'srgb',
              transfer: { kind: 'srgb' },
              matrix: 'identity',
              range: 'full',
              alpha: p.channels === 4 ? 'straight' : 'none',
              provenance: 'container-signaled',
              renderingIntent: 'relative',
            },
          })
        if (!encoder) throw new Error('Missing public encoder')
        const bytes = new Uint8Array(p.data.byteLength)
        if (p.data instanceof Uint16Array) {
          const view = new DataView(bytes.buffer)
          for (let i = 0; i < p.data.length; i++) view.setUint16(i * 2, p.data[i] ?? 0)
        } else bytes.set(p.data)
        await encoder.write({
          x: 0,
          y: 0,
          width: p.width,
          height: p.height,
          stride: p.width * p.channels * p.data.BYTES_PER_ELEMENT,
          format,
          data: bytes,
        })
        await encoder.finish()
        return { kind: 'jxl', bytes: sink.toUint8Array() }
      },
      close() {},
    }
  }
  if (subject === 'jsquash') {
    const decoder = await import('@jsquash/jxl/decode.js'),
      encoder = await import('@jsquash/jxl/encode.js')
    await decoder.init({ wasmBinary: await asset('jsquash-dec.wasm') })
    await encoder.init({ wasmBinary: await asset('jsquash-enc.wasm') })
    return {
      async decode(bytes) {
        const p = await decoder.default(new Uint8Array(bytes).buffer)
        return {
          kind: 'pixels',
          pixels: {
            width: p.width,
            height: p.height,
            channels: 4,
            data: new Uint8Array(p.data),
            interpretation: 'srgb',
          },
        }
      },
      async encode(p, s) {
        if (!(p.data instanceof Uint8Array) || p.channels !== 4)
          throw new Error('jSquash public input requires RGBA8 ImageData')
        const image = new ImageData(new Uint8ClampedArray(p.data), p.width, p.height)
        return {
          kind: 'jxl',
          bytes: new Uint8Array(
            await encoder.default(image, {
              lossless: s.lossless,
              quality: s.lossless ? 100 : s.value,
              effort: s.effort,
            }),
          ),
        }
      },
      close() {},
    }
  }
  if (subject === 'oxide') {
    const { default: init, JxlImage } = await import('jxl-oxide-wasm')
    await init({ module_or_path: await asset('oxide.wasm') })
    return {
      async decode(bytes, nativePrecision = false) {
        const image = new JxlImage()
        try {
          image.forceSrgb = !nativePrecision
          image.feedBytes(bytes)
          if (!image.tryInit()) throw new Error('Incomplete image header')
          const frame = image.render(0)
          // encodeToPng consumes the RenderResult in this published wasm-bindgen binding.
          return { kind: 'png', bytes: frame.encodeToPng() }
        } finally {
          image.free()
        }
      },
      close() {},
    }
  }
  const { default: Vips } = await import('wasm-vips')
  const vips = await Vips({
    dynamicLibraries: ['vips-jxl.wasm'],
    ...(vipsLocation
      ? {
          locateFile: (name: string) => `${vipsLocation}/${name}`,
          mainScriptUrlOrBlob: `${vipsLocation}/vips-es6.js`,
        }
      : {}),
  })
  vips.concurrency(1)
  vips.Cache.max(0) // Warm means new decode/encode work, never libvips' operation-result cache.
  return {
    async decode(bytes) {
      const image = vips.Image.jxlloadBuffer(bytes)
      try {
        const memory = image.writeToMemory()
        const data =
          memory instanceof Uint8Array ||
          memory instanceof Uint16Array ||
          memory instanceof Float32Array
            ? memory.slice()
            : undefined
        if (!data) throw new Error(`Unmapped native sample type ${memory.constructor.name}`)
        return {
          kind: 'pixels',
          pixels: {
            width: image.width,
            height: image.height,
            channels: image.bands,
            data,
            interpretation:
              image.interpretation === 'rgb16' || image.interpretation === 'grey16'
                ? 'srgb16'
                : image.interpretation === 'scrgb'
                  ? 'linear'
                  : 'srgb',
          },
        }
      } finally {
        image.delete()
      }
    },
    async encode(p, s) {
      const image = vips.Image.newFromMemory(
        p.data,
        p.width,
        p.height,
        p.channels,
        p.data instanceof Uint16Array
          ? vips.BandFormat.ushort
          : p.data instanceof Float32Array
            ? vips.BandFormat.float
            : vips.BandFormat.uchar,
      )
      const tagged = image.copy({
        interpretation:
          p.data instanceof Uint16Array
            ? p.channels === 1
              ? 'grey16'
              : 'rgb16'
            : p.data instanceof Float32Array
              ? 'scrgb'
              : 'srgb',
      })
      try {
        return {
          kind: 'jxl',
          bytes: tagged
            .jxlsaveBuffer({ lossless: s.lossless, distance: s.value, effort: s.effort })
            .slice(),
        }
      } finally {
        tagged.delete()
        image.delete()
      }
    },
    close() {
      vips.shutdown()
    },
  }
}
