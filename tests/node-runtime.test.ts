import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PNG } from 'pngjs'
import { afterEach, describe, expect, it } from 'vitest'

import { pngCodec } from '../src/codec-entries/png.ts'
import { createNodeImageLibrary } from '../src/node-image.ts'
import { createNodeRuntime, NodeTemporaryStore } from '../src/node-runtime.ts'

const roots: string[] = []
const originalTemporaryDirectory = process.env.TMPDIR

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'purejsimage-node-runtime-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  if (originalTemporaryDirectory === undefined) delete process.env.TMPDIR
  else process.env.TMPDIR = originalTemporaryDirectory
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe.sequential('Node temporary storage', () => {
  it('uses memory by default without touching the filesystem', async () => {
    const root = await temporaryRoot()
    process.env.TMPDIR = root
    const store = await createNodeRuntime().createTemporaryStore({
      expectedBytes: 4,
      prefix: 'default-memory-',
    })
    await store.write(0, Uint8Array.of(1, 2, 3, 4))
    const result = new Uint8Array(4)
    await store.read(0, result)

    expect([...result]).toEqual([1, 2, 3, 4])
    expect(await readdir(root)).toEqual([])
    await store.close()
  })

  it('probes a temporary file when filesystem storage is explicitly enabled', async () => {
    const root = await temporaryRoot()
    process.env.TMPDIR = root
    const store = await createNodeRuntime({ temporaryFiles: true }).createTemporaryStore({
      expectedBytes: 4,
      prefix: 'probe-',
    })

    expect(await readdir(root)).toHaveLength(1)
    await store.write(0, Uint8Array.of(1, 2, 3, 4))
    const result = new Uint8Array(4)
    await store.read(0, result)
    expect([...result]).toEqual([1, 2, 3, 4])

    await store.close()
    expect(await readdir(root)).toEqual([])
  })

  it('retries handle cleanup when closing an opt-in temporary file fails', async () => {
    const root = await temporaryRoot()
    const directory = join(root, 'close-retry')
    await mkdir(directory)
    let closeCalls = 0
    const file = {
      async close(): Promise<void> {
        closeCalls += 1
        if (closeCalls === 1) throw new Error('simulated close failure')
      },
      async read(): Promise<{ readonly bytesRead: number }> {
        return { bytesRead: 0 }
      },
      async truncate(): Promise<void> {},
      async write(): Promise<{ readonly bytesWritten: number }> {
        return { bytesWritten: 0 }
      },
    }
    const store = new NodeTemporaryStore(directory, file, 4)

    await expect(store.close()).rejects.toThrow('simulated close failure')
    await expect(store.close()).resolves.toBeUndefined()
    expect(closeCalls).toBe(2)
    expect(await readdir(root)).toEqual([])
  })

  it('falls back to memory when opt-in temporary files are unavailable', async () => {
    const root = await temporaryRoot()
    const unavailable = join(root, 'not-a-directory')
    await writeFile(unavailable, 'blocked')
    process.env.TMPDIR = unavailable

    const expectedBytes = 64 * 1024 * 1024 + 1
    const store = await createNodeRuntime({ temporaryFiles: true }).createTemporaryStore({
      expectedBytes,
      prefix: 'fallback-',
    })
    await store.write(expectedBytes - 4, Uint8Array.of(5, 6, 7, 8))
    const result = new Uint8Array(4)
    await store.read(expectedBytes - 4, result)

    expect([...result]).toEqual([5, 6, 7, 8])
    await store.close()
  })

  it('finishes an opt-in public transform when temporary-file setup fails', async () => {
    const root = await temporaryRoot()
    const unavailable = join(root, 'not-a-directory')
    await writeFile(unavailable, 'blocked')
    process.env.TMPDIR = unavailable
    const images = createNodeImageLibrary([pngCodec], { temporaryFiles: true })
    const input = PNG.sync.write(new PNG({ width: 3, height: 2 }))

    const output = await (await images.open(input)).rotate(90).png().toBuffer()

    expect(PNG.sync.read(output)).toMatchObject({ width: 2, height: 3 })
  })

  it('keeps the public image pipeline off the filesystem by default', async () => {
    const root = await temporaryRoot()
    process.env.TMPDIR = root
    const images = createNodeImageLibrary([pngCodec])
    const input = PNG.sync.write(new PNG({ width: 3, height: 2 }))

    const output = await (await images.open(input)).rotate(90).png().toBuffer()

    expect(PNG.sync.read(output)).toMatchObject({ width: 2, height: 3 })
    expect(await readdir(root)).toEqual([])
  })

  it('rejects an invalid temporary-files configuration', () => {
    expect(() => createNodeImageLibrary([pngCodec], { temporaryFiles: 'yes' as never })).toThrow(
      'temporaryFiles must be a boolean',
    )
  })
})
