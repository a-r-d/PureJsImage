import type { ImageResizeAccelerator } from '../../accelerator.ts'
import type { ResizeBoxSession, ResizeFilterRequest, ResizeFilterSession } from '../../resize.ts'

export interface WasmResizeAcceleratorOptions {
  readonly variant?: 'scalar' | 'simd' | 'auto'
}

type Variant = 'scalar' | 'simd'
type ModuleLoader = (variant: Variant) => Promise<WebAssembly.Module>

const numeric = (exports: WebAssembly.Exports, name: string) => {
  const call = exports[name]
  if (typeof call !== 'function') throw new Error(`Missing resize WASM export ${name}`)
  return (...args: number[]): number => {
    const result: unknown = call(...args)
    if (typeof result !== 'number') throw new Error(`Invalid resize WASM result from ${name}`)
    return result
  }
}

const succeeded = (status: number): void => {
  if (status !== 1) throw new Error('WASM resize declined row')
}

const createFilter = (
  instance: WebAssembly.Instance,
  request: ResizeFilterRequest,
  configured: boolean,
): ResizeFilterSession | undefined => {
  const exports = instance.exports
  const memory = exports.memory
  if (!(memory instanceof WebAssembly.Memory)) return undefined
  const { horizontal: axis, sourceWidth, capacity, format, opaque, outputChannels } = request
  const width = axis.offsets.length - 1
  const channels = format === 'rgb8' ? 3 : 4
  const filtered = opaque ? 3 : channels
  const prepare = numeric(exports, 'prepare')
  if (
    !configured &&
    prepare(
      sourceWidth,
      width,
      channels,
      filtered,
      outputChannels,
      capacity,
      axis.indices.length,
    ) !== 1
  )
    return undefined
  const buffer = numeric(exports, 'buffer')
  new Uint32Array(memory.buffer, buffer(1), axis.offsets.length).set(axis.offsets)
  new Uint32Array(memory.buffer, buffer(2), axis.indices.length).set(axis.indices)
  new Float64Array(memory.buffer, buffer(3), axis.weights.length).set(axis.weights)
  // Configuring the group scratch can grow memory. Create persistent views afterwards.
  if (filtered === 4 && numeric(exports, 'configure_rgba')() !== 1) return undefined
  const heap = memory.buffer
  const source = new Uint8Array(heap, buffer(0), sourceWidth * channels)
  const ring = new Float32Array(heap, buffer(4), width * filtered * capacity)
  const indices = new Uint32Array(heap, buffer(5), capacity)
  const weights = new Float64Array(heap, buffer(6), capacity)
  const bytes = new Uint8Array(heap, buffer(7), width * outputChannels)
  const horizontal = numeric(exports, 'horizontal')
  const vertical = numeric(exports, 'vertical')
  return {
    rows: Array.from({ length: capacity }, (_, slot) =>
      ring.subarray(slot * width * filtered, (slot + 1) * width * filtered),
    ),
    horizontal(row, slot) {
      source.set(row)
      succeeded(horizontal(slot))
    },
    vertical(axis, first, last, output, offset) {
      indices.set(axis.indices.subarray(first, last))
      weights.set(axis.weights.subarray(first, last))
      succeeded(vertical(last - first))
      output.set(bytes, offset)
    },
  }
}

export const createWasmResizeAcceleratorWithLoader = (
  load: ModuleLoader,
  options: WasmResizeAcceleratorOptions = {},
): ImageResizeAccelerator => {
  const preferred = options.variant ?? 'auto'
  const compile = async (variant: Variant) => ({ module: await load(variant), variant })
  let compiled: ReturnType<typeof compile> | undefined
  let idle: { key: string; instance: WebAssembly.Instance } | undefined
  const acquire = async (key: string) => {
    const reusable = idle?.key === key ? idle.instance : undefined
    idle = undefined
    let instance = reusable
    if (!instance) {
      compiled ??=
        preferred === 'auto' ? compile('simd').catch(() => compile('scalar')) : compile(preferred)
      const { module, variant } = await compiled
      instance = await WebAssembly.instantiate(module)
      if (
        numeric(instance.exports, 'abi_version')() !== 2 ||
        numeric(instance.exports, 'simd')() !== Number(variant === 'simd')
      )
        throw new Error('Unsupported resize WASM module')
    }
    const owned = instance
    let released = false
    return {
      instance,
      configured: reusable !== undefined,
      release() {
        if (released) return
        released = true
        // Keep only one idle workspace. Different geometries start with fresh bounded memory.
        idle = { key, instance: owned }
      },
    }
  }
  return {
    transform: 'resize',
    id: 'wasm-resize',
    kind: 'wasm',
    async createBox(width, format, factor): Promise<ResizeBoxSession | undefined> {
      if (
        (format !== 'rgb8' && format !== 'rgba8') ||
        !Number.isSafeInteger(width) ||
        width <= 0 ||
        !Number.isSafeInteger(factor) ||
        factor <= 0 ||
        width % factor !== 0
      )
        return undefined
      try {
        const lease = await acquire(`box:${width}:${format}:${factor}`)
        const { exports } = lease.instance
        const channels = format === 'rgb8' ? 3 : 4
        if (
          !(exports.memory instanceof WebAssembly.Memory) ||
          (!lease.configured && numeric(exports, 'box_prepare')(width, channels, factor) !== 1)
        )
          return undefined
        const heap = exports.memory.buffer
        const buffer = numeric(exports, 'box_buffer')
        const stride = (width / factor) * channels
        const source = new Uint8Array(heap, buffer(0), width * channels)
        const a = new Float64Array(heap, buffer(1), stride)
        const b = new Float64Array(heap, buffer(2), stride)
        const bytes = new Uint8Array(heap, buffer(3), stride)
        const add = numeric(exports, 'box_add')
        const write = numeric(exports, 'box_write')
        let committed = 0
        return {
          release: lease.release,
          get sums() {
            return committed === 0 ? a : b
          },
          add(row, first) {
            source.set(row)
            succeeded(add(committed, Number(first)))
            committed ^= 1
          },
          write(rows, output, offset) {
            succeeded(write(committed, rows))
            output.set(bytes, offset)
          },
        }
      } catch {
        return undefined
      }
    },
    async createFilter(request) {
      try {
        // Each live transform has independent storage, including its fallback ring views.
        if (
          (request.format !== 'rgb8' && request.format !== 'rgba8') ||
          !Number.isSafeInteger(request.sourceWidth) ||
          request.sourceWidth <= 0 ||
          !Number.isSafeInteger(request.capacity) ||
          request.capacity <= 0 ||
          request.capacity > 256 ||
          request.horizontal.indices.length !== request.horizontal.weights.length
        )
          return undefined
        const { sourceWidth, format, outputChannels, opaque, horizontal, capacity } = request
        const key = [
          sourceWidth,
          format,
          outputChannels,
          opaque,
          horizontal.offsets.length,
          horizontal.indices.length,
          capacity,
        ].join(':')
        const lease = await acquire(key)
        const session = createFilter(lease.instance, request, lease.configured)
        return session && { ...session, release: lease.release }
      } catch {
        return undefined
      }
    },
  }
}
