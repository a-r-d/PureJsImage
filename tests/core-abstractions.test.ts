import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { BufferPool, BufferSink, FileSink, MemorySource } from '../src/index.ts'
import { SourceReader } from '../src/source.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('core abstractions', () => {
  it('performs bounded memory-source reads without copying', async () => {
    const input = Uint8Array.from([1, 2, 3, 4])
    const source = new MemorySource(input)
    const output = await source.read(1, 2)

    expect([...output]).toEqual([2, 3])
    input[1] = 9
    expect(output[0]).toBe(9)
  })

  it('buffers sequential reads across source block boundaries', async () => {
    const reader = new SourceReader(new MemorySource(Uint8Array.from([1, 2, 3, 4, 5])), 0, 2)

    expect(await reader.readByte()).toBe(1)
    expect([...(await reader.read(3))]).toEqual([2, 3, 4])
    expect(await reader.readByte()).toBe(5)
  })

  it('reuses only configured buffer size classes', () => {
    const pool = new BufferPool({ sizeClasses: [16], maxPerClass: 1 })
    const first = pool.acquire(10)
    pool.release(first)

    expect(pool.acquire(10)).toBe(first)
    expect(pool.acquire(17).byteLength).toBe(17)
  })

  it('collects buffer chunks and prevents writes after close', async () => {
    const sink = new BufferSink()
    await sink.write(Uint8Array.of(1, 2))
    await sink.write(Uint8Array.of(3))
    await sink.close()

    expect([...sink.toBuffer()]).toEqual([1, 2, 3])
    await expect(sink.write(Uint8Array.of(4))).rejects.toThrow('closed sink')
  })

  it('writes file sink chunks and removes aborted output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'purejsimage-sink-'))
    temporaryDirectories.push(directory)
    const path = join(directory, 'output.bin')
    const sink = new FileSink(path)
    await sink.write(Uint8Array.of(1, 2))
    await sink.write(Uint8Array.of(3))
    await sink.close()
    expect([...(await readFile(path))]).toEqual([1, 2, 3])

    const aborted = new FileSink(path)
    await aborted.write(Uint8Array.of(4))
    await aborted.abort()
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
