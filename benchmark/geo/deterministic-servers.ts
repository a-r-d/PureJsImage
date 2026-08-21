export interface SparseSegment {
  readonly offset: number
  readonly bytes: Uint8Array
}

export interface DeterministicAsset {
  readonly size: number
  readonly segments: readonly SparseSegment[]
}

export interface DeterministicServerStats {
  readonly requests: number
  readonly transferredBytes: number
  readonly uniqueBytes: number
  readonly requestedObjects: readonly string[]
}

const intervalUnion = (intervals: readonly (readonly [number, number])[]): number => {
  if (intervals.length === 0) return 0
  const sorted = [...intervals].sort((left, right) => left[0] - right[0] || left[1] - right[1])
  let start = sorted[0]?.[0] ?? 0
  let end = sorted[0]?.[1] ?? 0
  let total = 0
  for (let index = 1; index < sorted.length; index += 1) {
    const interval = sorted[index]
    if (interval === undefined) continue
    if (interval[0] > end) {
      total += end - start
      start = interval[0]
      end = interval[1]
    } else end = Math.max(end, interval[1])
  }
  return total + end - start
}

const materialize = (
  asset: DeterministicAsset,
  start: number,
  end: number,
): Uint8Array<ArrayBuffer> => {
  const output = new Uint8Array(end - start + 1)
  for (const segment of asset.segments) {
    const overlapStart = Math.max(start, segment.offset)
    const overlapEnd = Math.min(end + 1, segment.offset + segment.bytes.byteLength)
    if (overlapStart >= overlapEnd) continue
    output.set(
      segment.bytes.subarray(overlapStart - segment.offset, overlapEnd - segment.offset),
      overlapStart - start,
    )
  }
  return output
}

export const byteAsset = (
  bytes: Uint8Array,
  logicalSize = bytes.byteLength,
): DeterministicAsset => {
  if (!Number.isSafeInteger(logicalSize) || logicalSize < bytes.byteLength) {
    throw new Error('Deterministic asset size must contain its bytes')
  }
  return Object.freeze({ size: logicalSize, segments: Object.freeze([{ offset: 0, bytes }]) })
}

/** In-process exact-range server used by required CI. It performs no network I/O. */
export class DeterministicRangeServer {
  readonly #assets: ReadonlyMap<string, DeterministicAsset>
  readonly #intervals = new Map<string, (readonly [number, number])[]>()
  readonly #objects: string[] = []
  #requests = 0
  #transferredBytes = 0

  constructor(assets: Readonly<Record<string, DeterministicAsset>>) {
    this.#assets = new Map(Object.entries(assets))
  }

  readonly fetch: typeof fetch = async (input, init) => {
    init?.signal?.throwIfAborted()
    const key = new URL(String(input)).pathname.replace(/^\//u, '')
    const asset = this.#assets.get(key)
    this.#objects.push(key)
    if (asset === undefined) return new Response(null, { status: 404 })
    if (init?.method === 'HEAD') {
      this.#requests += 1
      return new Response(null, { status: 200, headers: { 'content-length': String(asset.size) } })
    }
    const match = new Headers(init?.headers).get('range')?.match(/^bytes=(\d+)-(\d+)$/u)
    if (match === undefined || match === null) return new Response(null, { status: 400 })
    const start = Number(match[1])
    const requestedEnd = Number(match[2])
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(requestedEnd) ||
      start >= asset.size
    ) {
      return new Response(null, { status: 416 })
    }
    const end = Math.min(requestedEnd, asset.size - 1)
    const body = materialize(asset, start, end)
    this.#requests += 1
    this.#transferredBytes += body.byteLength
    const intervals = this.#intervals.get(key) ?? []
    intervals.push(Object.freeze([start, end + 1]))
    this.#intervals.set(key, intervals)
    return new Response(Uint8Array.from(body), {
      status: 206,
      headers: {
        'accept-ranges': 'bytes',
        'content-length': String(body.byteLength),
        'content-range': `bytes ${start}-${end}/${asset.size}`,
        etag: `"geo-benchmark-${key}"`,
      },
    })
  }

  get stats(): DeterministicServerStats {
    return Object.freeze({
      requests: this.#requests,
      transferredBytes: this.#transferredBytes,
      uniqueBytes: [...this.#intervals.values()].reduce(
        (total, values) => total + intervalUnion(values),
        0,
      ),
      requestedObjects: Object.freeze([...this.#objects]),
    })
  }
}

/** Multi-object form used for Zarr metadata, chunk, and shard paths in required CI. */
export class DeterministicObjectStoreServer extends DeterministicRangeServer {}
