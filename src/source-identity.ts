import { throwIfAborted } from './abort.ts'
import { invalidInput } from './errors.ts'
import type { ImageSource } from './source.ts'
import type {
  ContentSourceIdentity,
  LocalFileSourceIdentity,
  RemoteSourceIdentity,
  SessionSourceIdentity,
  SourceIdentity,
} from './source-identity-contract.ts'
import {
  createSourceSessionIdentity,
  inheritImageSourceIdentity,
} from './source-identity-contract.ts'
export type {
  ContentSourceIdentity,
  IdentifiedImageSource,
  LocalFileSourceIdentity,
  RemoteSourceIdentity,
  SessionSourceIdentity,
  SourceIdentity,
} from './source-identity-contract.ts'
export { imageSourceIdentity } from './source-identity-contract.ts'

const validSize = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

export function normalizeSourceIdentity(
  identity: ContentSourceIdentity,
  expectedSize?: number,
): ContentSourceIdentity
export function normalizeSourceIdentity(
  identity: RemoteSourceIdentity,
  expectedSize?: number,
): RemoteSourceIdentity
export function normalizeSourceIdentity(
  identity: LocalFileSourceIdentity,
  expectedSize?: number,
): LocalFileSourceIdentity
export function normalizeSourceIdentity(
  identity: SessionSourceIdentity,
  expectedSize?: number,
): SessionSourceIdentity
export function normalizeSourceIdentity(
  identity: SourceIdentity,
  expectedSize?: number,
): SourceIdentity
export function normalizeSourceIdentity(
  identity: SourceIdentity,
  expectedSize?: number,
): SourceIdentity {
  if (!validSize(identity.size) || (expectedSize !== undefined && identity.size !== expectedSize)) {
    throw invalidInput('Source identity size is invalid')
  }
  if (identity.kind === 'content') {
    if (
      identity.algorithm !== 'sha256' ||
      !/^[0-9a-f]{64}$/u.test(identity.digest) ||
      identity.strength !== 'strong' ||
      identity.stability !== 'content-addressed'
    ) {
      throw invalidInput('Content source identity is invalid')
    }
    return Object.freeze({ ...identity })
  }
  if (identity.kind === 'remote') {
    let url: string
    try {
      url = new URL(identity.url).href
    } catch {
      throw invalidInput('Remote source identity URL is invalid')
    }
    const validator = identity.validator
    if (
      (validator !== undefined && !nonEmpty(validator.value)) ||
      (validator !== undefined &&
        validator.kind !== 'etag' &&
        validator.kind !== 'version-id' &&
        validator.kind !== 'last-modified')
    ) {
      throw invalidInput('Remote source identity validator is invalid')
    }
    const strong = validator?.kind === 'etag' || validator?.kind === 'version-id'
    if (
      identity.strength !== (strong ? 'strong' : 'weak') ||
      identity.stability !== (strong ? 'versioned' : 'best-effort')
    ) {
      throw invalidInput('Remote source identity overstates its validator strength')
    }
    return Object.freeze({
      kind: 'remote',
      strength: identity.strength,
      stability: identity.stability,
      url,
      size: identity.size,
      ...(validator === undefined
        ? {}
        : { validator: Object.freeze({ kind: validator.kind, value: validator.value }) }),
    })
  }
  if (identity.kind === 'local-file') {
    if (
      identity.strength !== 'weak' ||
      identity.stability !== 'metadata' ||
      !nonEmpty(identity.nameOrPath) ||
      !Number.isFinite(identity.lastModified) ||
      identity.lastModified < 0
    ) {
      throw invalidInput('Local file source identity is invalid')
    }
    return Object.freeze({ ...identity })
  }
  if (
    identity.kind !== 'session' ||
    identity.strength !== 'session' ||
    identity.stability !== 'instance' ||
    !nonEmpty(identity.id)
  ) {
    throw invalidInput('Session source identity is invalid')
  }
  return Object.freeze({ ...identity })
}

export const createSessionSourceIdentity = (size: number): SessionSourceIdentity =>
  normalizeSourceIdentity(createSourceSessionIdentity(size))

export const getImageSourceIdentity = async (source: ImageSource): Promise<SourceIdentity> => {
  return normalizeSourceIdentity(await inheritImageSourceIdentity(source), source.size)
}

const initialHash = Uint32Array.of(
  0x6a09e667,
  0xbb67ae85,
  0x3c6ef372,
  0xa54ff53a,
  0x510e527f,
  0x9b05688c,
  0x1f83d9ab,
  0x5be0cd19,
)

const roundConstants = Uint32Array.of(
  0x428a2f98,
  0x71374491,
  0xb5c0fbcf,
  0xe9b5dba5,
  0x3956c25b,
  0x59f111f1,
  0x923f82a4,
  0xab1c5ed5,
  0xd807aa98,
  0x12835b01,
  0x243185be,
  0x550c7dc3,
  0x72be5d74,
  0x80deb1fe,
  0x9bdc06a7,
  0xc19bf174,
  0xe49b69c1,
  0xefbe4786,
  0x0fc19dc6,
  0x240ca1cc,
  0x2de92c6f,
  0x4a7484aa,
  0x5cb0a9dc,
  0x76f988da,
  0x983e5152,
  0xa831c66d,
  0xb00327c8,
  0xbf597fc7,
  0xc6e00bf3,
  0xd5a79147,
  0x06ca6351,
  0x14292967,
  0x27b70a85,
  0x2e1b2138,
  0x4d2c6dfc,
  0x53380d13,
  0x650a7354,
  0x766a0abb,
  0x81c2c92e,
  0x92722c85,
  0xa2bfe8a1,
  0xa81a664b,
  0xc24b8b70,
  0xc76c51a3,
  0xd192e819,
  0xd6990624,
  0xf40e3585,
  0x106aa070,
  0x19a4c116,
  0x1e376c08,
  0x2748774c,
  0x34b0bcb5,
  0x391c0cb3,
  0x4ed8aa4a,
  0x5b9cca4f,
  0x682e6ff3,
  0x748f82ee,
  0x78a5636f,
  0x84c87814,
  0x8cc70208,
  0x90befffa,
  0xa4506ceb,
  0xbef9a3f7,
  0xc67178f2,
)

const rotateRight = (value: number, bits: number): number =>
  (value >>> bits) | (value << (32 - bits))

class IncrementalSha256 {
  readonly #state = Uint32Array.from(initialHash)
  readonly #words = new Uint32Array(64)
  readonly #tail = new Uint8Array(64)
  #tailBytes = 0
  #totalBytes = 0

  update(data: Uint8Array): void {
    this.#totalBytes += data.byteLength
    let offset = 0
    if (this.#tailBytes > 0) {
      const amount = Math.min(64 - this.#tailBytes, data.byteLength)
      this.#tail.set(data.subarray(0, amount), this.#tailBytes)
      this.#tailBytes += amount
      offset += amount
      if (this.#tailBytes === 64) {
        this.#compress(this.#tail, 0)
        this.#tailBytes = 0
      }
    }
    while (offset + 64 <= data.byteLength) {
      this.#compress(data, offset)
      offset += 64
    }
    if (offset < data.byteLength) {
      this.#tail.set(data.subarray(offset), 0)
      this.#tailBytes = data.byteLength - offset
    }
  }

  digest(): string {
    const final = new Uint8Array(128)
    final.set(this.#tail.subarray(0, this.#tailBytes))
    final[this.#tailBytes] = 0x80
    const finalBytes = this.#tailBytes < 56 ? 64 : 128
    const bitLength = BigInt(this.#totalBytes) * 8n
    const view = new DataView(final.buffer)
    view.setUint32(finalBytes - 8, Number((bitLength >> 32n) & 0xffff_ffffn), false)
    view.setUint32(finalBytes - 4, Number(bitLength & 0xffff_ffffn), false)
    this.#compress(final, 0)
    if (finalBytes === 128) this.#compress(final, 64)
    let output = ''
    for (const word of this.#state) output += word.toString(16).padStart(8, '0')
    return output
  }

  #compress(bytes: Uint8Array, offset: number): void {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 64)
    for (let index = 0; index < 16; index += 1)
      this.#words[index] = view.getUint32(index * 4, false)
    for (let index = 16; index < 64; index += 1) {
      const earlier = this.#words[index - 15] ?? 0
      const recent = this.#words[index - 2] ?? 0
      const sigma0 = rotateRight(earlier, 7) ^ rotateRight(earlier, 18) ^ (earlier >>> 3)
      const sigma1 = rotateRight(recent, 17) ^ rotateRight(recent, 19) ^ (recent >>> 10)
      this.#words[index] =
        ((this.#words[index - 16] ?? 0) + sigma0 + (this.#words[index - 7] ?? 0) + sigma1) >>> 0
    }
    let a = this.#state[0] ?? 0
    let b = this.#state[1] ?? 0
    let c = this.#state[2] ?? 0
    let d = this.#state[3] ?? 0
    let e = this.#state[4] ?? 0
    let f = this.#state[5] ?? 0
    let g = this.#state[6] ?? 0
    let h = this.#state[7] ?? 0
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const choose = (e & f) ^ (~e & g)
      const temporary1 =
        (h + sum1 + choose + (roundConstants[index] ?? 0) + (this.#words[index] ?? 0)) >>> 0
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temporary2 = (sum0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = (d + temporary1) >>> 0
      d = c
      c = b
      b = a
      a = (temporary1 + temporary2) >>> 0
    }
    this.#state[0] = ((this.#state[0] ?? 0) + a) >>> 0
    this.#state[1] = ((this.#state[1] ?? 0) + b) >>> 0
    this.#state[2] = ((this.#state[2] ?? 0) + c) >>> 0
    this.#state[3] = ((this.#state[3] ?? 0) + d) >>> 0
    this.#state[4] = ((this.#state[4] ?? 0) + e) >>> 0
    this.#state[5] = ((this.#state[5] ?? 0) + f) >>> 0
    this.#state[6] = ((this.#state[6] ?? 0) + g) >>> 0
    this.#state[7] = ((this.#state[7] ?? 0) + h) >>> 0
  }
}

export interface SourceHashProgress {
  readonly bytesRead: number
  readonly totalBytes: number
}

export interface HashImageSourceOptions {
  readonly chunkBytes?: number
  readonly maxBytes?: number
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: Readonly<SourceHashProgress>) => void
}

export const hashImageSource = async (
  source: ImageSource,
  options: Readonly<HashImageSourceOptions> = {},
): Promise<ContentSourceIdentity> => {
  if (!validSize(source.size))
    throw invalidInput('ImageSource size must be a non-negative safe integer')
  const chunkBytes = options.chunkBytes ?? 1_048_576
  const maxBytes = options.maxBytes ?? Number.MAX_SAFE_INTEGER
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 8 * 1_024 * 1_024) {
    throw invalidInput('chunkBytes must be a safe integer from 1 through 8388608')
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || source.size > maxBytes) {
    throw invalidInput('ImageSource exceeds the configured hash byte limit')
  }
  const hash = new IncrementalSha256()
  let bytesRead = 0
  options.onProgress?.(Object.freeze({ bytesRead, totalBytes: source.size }))
  while (bytesRead < source.size) {
    throwIfAborted(options.signal)
    const amount = Math.min(chunkBytes, source.size - bytesRead)
    const data = await source.read(
      bytesRead,
      amount,
      options.signal === undefined ? {} : { signal: options.signal },
    )
    throwIfAborted(options.signal)
    if (data.byteLength !== amount)
      throw invalidInput('ImageSource changed or returned a short read while hashing')
    hash.update(data)
    bytesRead += amount
    options.onProgress?.(Object.freeze({ bytesRead, totalBytes: source.size }))
  }
  return normalizeSourceIdentity({
    kind: 'content',
    strength: 'strong',
    stability: 'content-addressed',
    algorithm: 'sha256',
    digest: hash.digest(),
    size: source.size,
  })
}
