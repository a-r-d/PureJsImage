import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileSource } from '../src/node-source.ts'
import { getImageSourceIdentity, hashImageSource } from '../src/source-identity.ts'
import { BlobSource, BufferedSource, MemorySource } from '../src/source.ts'
import { HttpRangeSource } from '../src/sources/http-range.ts'

describe('source identity ladder', () => {
  it('uses per-instance memory sessions and propagates explicit identities through wrappers', async () => {
    const first = new MemorySource(Uint8Array.of(1, 2, 3))
    const second = new MemorySource(Uint8Array.of(1, 2, 3))
    expect(await getImageSourceIdentity(first)).toMatchObject({
      kind: 'session',
      strength: 'session',
      stability: 'instance',
      size: 3,
    })
    const firstIdentity = await getImageSourceIdentity(first)
    const secondIdentity = await getImageSourceIdentity(second)
    if (firstIdentity.kind !== 'session' || secondIdentity.kind !== 'session') {
      throw new Error('Expected session identities')
    }
    expect(firstIdentity.id).not.toBe(secondIdentity.id)
    const content = {
      kind: 'content' as const,
      strength: 'strong' as const,
      stability: 'content-addressed' as const,
      algorithm: 'sha256' as const,
      digest: '00'.repeat(32),
      size: 3,
    }
    const explicit = new MemorySource(Uint8Array.of(1, 2, 3), { identity: content })
    expect(await getImageSourceIdentity(new BufferedSource(explicit, 2))).toEqual(content)
  })

  it('recognizes File metadata without requiring a browser global check', async () => {
    const file = new File([Uint8Array.of(1, 2)], 'sample.bin', { lastModified: 1234 })
    expect(await getImageSourceIdentity(new BlobSource(file))).toEqual({
      kind: 'local-file',
      strength: 'weak',
      stability: 'metadata',
      nameOrPath: 'sample.bin',
      size: 2,
      lastModified: 1234,
    })
    expect(await getImageSourceIdentity(new BlobSource(new Blob(['x'])))).toMatchObject({
      kind: 'session',
    })
  })

  it('uses existing FileSource stat metadata without reading content', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'purejsimage-identity-'))
    const path = join(directory, 'sample.bin')
    try {
      await writeFile(path, Uint8Array.of(1, 2, 3, 4))
      const source = await FileSource.open(path)
      expect(await getImageSourceIdentity(source)).toMatchObject({
        kind: 'local-file',
        strength: 'weak',
        stability: 'metadata',
        nameOrPath: path,
        size: 4,
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('exposes strong and weak immutable HTTP validators without weakening change checks', async () => {
    const bytes = Uint8Array.from({ length: 8 }, (_value, index) => index)
    const ranged =
      (headers: Record<string, string>): typeof fetch =>
      async (_input, init) => {
        const match = new Headers(init?.headers).get('range')?.match(/^bytes=(\d+)-(\d+)$/)
        if (!match) return new Response(null, { status: 416 })
        const start = Number(match[1])
        const end = Number(match[2])
        return new Response(bytes.slice(start, end + 1), {
          status: 206,
          headers: { ...headers, 'content-range': `bytes ${start}-${end}/${bytes.length}` },
        })
      }
    const strong = await HttpRangeSource.open('https://EXAMPLE.test:443/data.bin', {
      blockBytes: 2,
      fetch: ranged({ etag: '"v1"' }),
    })
    expect(strong.validator).toEqual({ header: 'etag', value: '"v1"' })
    expect(await getImageSourceIdentity(strong)).toEqual({
      kind: 'remote',
      strength: 'strong',
      stability: 'versioned',
      url: 'https://example.test/data.bin',
      size: 8,
      validator: { kind: 'etag', value: '"v1"' },
    })
    const weak = await HttpRangeSource.open('https://example.test/weak.bin', {
      fetch: ranged({ 'last-modified': 'Wed, 12 Aug 2026 12:00:00 GMT' }),
    })
    expect(await getImageSourceIdentity(weak)).toMatchObject({
      kind: 'remote',
      strength: 'weak',
      stability: 'best-effort',
      validator: { kind: 'last-modified' },
    })
  })

  it('uses and enforces remote version ids ahead of weaker validators', async () => {
    let requests = 0
    const fetcher: typeof fetch = async (_input, init) => {
      requests += 1
      const match = new Headers(init?.headers).get('range')?.match(/^bytes=(\d+)-(\d+)$/)
      if (!match) return new Response(null, { status: 416 })
      const start = Number(match[1])
      const end = Number(match[2])
      return new Response(Uint8Array.of(...Array.from({ length: end - start + 1 }, () => 0)), {
        status: 206,
        headers: {
          'content-range': `bytes ${start}-${end}/4`,
          etag: '"same-etag"',
          'x-amz-version-id': requests === 1 ? 'version-one' : 'version-two',
        },
      })
    }
    const source = await HttpRangeSource.open('https://example.test/versioned.bin', {
      blockBytes: 2,
      fetch: fetcher,
    })
    expect(source.validator).toEqual({ header: 'x-amz-version-id', value: 'version-one' })
    expect(await getImageSourceIdentity(source)).toMatchObject({
      strength: 'strong',
      stability: 'versioned',
      validator: { kind: 'version-id', value: 'version-one' },
    })
    await expect(source.read(1, 1)).rejects.toThrow('x-amz-version-id changed')
  })

  it('hashes with bounded reads, progress, size limits, and cancellation', async () => {
    const bytes = new TextEncoder().encode('abc')
    const reads: number[] = []
    const source = {
      size: bytes.length,
      async read(offset: number, length: number): Promise<Uint8Array> {
        reads.push(length)
        return bytes.slice(offset, offset + length)
      },
    }
    const progress: number[] = []
    await expect(
      hashImageSource(source, {
        chunkBytes: 2,
        onProgress: (event) => progress.push(event.bytesRead),
      }),
    ).resolves.toEqual({
      kind: 'content',
      strength: 'strong',
      stability: 'content-addressed',
      algorithm: 'sha256',
      digest: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      size: 3,
    })
    expect(reads).toEqual([2, 1])
    expect(progress).toEqual([0, 2, 3])
    await expect(hashImageSource(source, { maxBytes: 2 })).rejects.toThrow('byte limit')
    const controller = new AbortController()
    controller.abort(new Error('stop'))
    await expect(hashImageSource(source, { signal: controller.signal })).rejects.toThrow('stop')
  })
})
