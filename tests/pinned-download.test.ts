import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { allFixtures, fixturePath, readManifest } from '../benchmark/lib/corpus.ts'
import { downloadPinnedFile, type DownloadFetch } from '../benchmark/lib/pinned-download.ts'

const allowedHosts: ReadonlySet<string> = new Set(['fixtures.example'])
const temporaryDirectories: string[] = []
const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'purejsimage-download-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('pinned benchmark downloads', () => {
  it('follows only validated redirects and atomically installs checksum-pinned data', async () => {
    const directory = await temporaryDirectory()
    const destination = join(directory, 'fixture.bin')
    const data = Uint8Array.of(1, 2, 3, 4)
    await writeFile(destination, Uint8Array.of(9))
    const requestedUrls: string[] = []
    const fetch: DownloadFetch = async (url) => {
      requestedUrls.push(url.href)
      if (requestedUrls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: '/final.bin' },
        })
      }
      return new Response(data, { status: 200 })
    }

    await downloadPinnedFile({
      allowedDirectory: directory,
      allowedHosts,
      destination,
      expectedSha256: sha256(data),
      fetch,
      url: 'https://fixtures.example/start.bin',
    })

    expect(requestedUrls).toEqual([
      'https://fixtures.example/start.bin',
      'https://fixtures.example/final.bin',
    ])
    expect(new Uint8Array(await readFile(destination))).toEqual(data)
    await expect(readFile(`${destination}.download`)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves an existing destination and cleans temporary data on checksum failure', async () => {
    const directory = await temporaryDirectory()
    const destination = join(directory, 'fixture.bin')
    const original = Uint8Array.of(9, 8, 7)
    await writeFile(destination, original)

    await expect(
      downloadPinnedFile({
        allowedDirectory: directory,
        allowedHosts,
        destination,
        expectedSha256: sha256(Uint8Array.of(1, 2, 3)),
        fetch: async () => new Response(Uint8Array.of(3, 2, 1), { status: 200 }),
        url: 'https://fixtures.example/fixture.bin',
      }),
    ).rejects.toThrow('checksum mismatch')

    expect(new Uint8Array(await readFile(destination))).toEqual(original)
    await expect(readFile(`${destination}.download`)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects destinations outside the allowed direct-child boundary before fetching', async () => {
    const directory = await temporaryDirectory()
    let fetchCalls = 0

    await expect(
      downloadPinnedFile({
        allowedDirectory: directory,
        allowedHosts,
        destination: join(directory, '..', 'escape.bin'),
        expectedSha256: sha256(Uint8Array.of(1)),
        fetch: async () => {
          fetchCalls += 1
          return new Response(Uint8Array.of(1), { status: 200 })
        },
        url: 'https://fixtures.example/fixture.bin',
      }),
    ).rejects.toThrow('direct child')

    expect(fetchCalls).toBe(0)
  })

  it('rejects unsafe fixture manifest paths before file access', async () => {
    const fixture = allFixtures(await readManifest())[0]
    if (fixture === undefined) throw new Error('Expected at least one corpus fixture')

    expect(() => fixturePath({ ...fixture, file: '../escape.bin' })).toThrow('portable base name')
    expect(() => fixturePath({ ...fixture, file: '..\\escape.bin' })).toThrow('portable base name')
  })

  it('rejects non-HTTPS, credentialed, unapproved, and unsafe redirect URLs', async () => {
    const directory = await temporaryDirectory()
    const destination = join(directory, 'fixture.bin')
    const expectedSha256 = sha256(Uint8Array.of(1))
    const fetch: DownloadFetch = async () =>
      new Response(null, { status: 302, headers: { location: 'http://fixtures.example/final' } })

    for (const url of [
      'http://fixtures.example/fixture.bin',
      'https://user:password@fixtures.example/fixture.bin',
      'https://unapproved.example/fixture.bin',
    ]) {
      await expect(
        downloadPinnedFile({
          allowedDirectory: directory,
          allowedHosts,
          destination,
          expectedSha256,
          fetch,
          url,
        }),
      ).rejects.toThrow()
    }

    await expect(
      downloadPinnedFile({
        allowedDirectory: directory,
        allowedHosts,
        destination,
        expectedSha256,
        fetch,
        url: 'https://fixtures.example/fixture.bin',
      }),
    ).rejects.toThrow('must use HTTPS')
  })

  it('stops streaming responses that exceed the configured byte limit', async () => {
    const directory = await temporaryDirectory()
    const destination = join(directory, 'fixture.bin')
    const data = Uint8Array.of(1, 2, 3, 4, 5)

    await expect(
      downloadPinnedFile({
        allowedDirectory: directory,
        allowedHosts,
        destination,
        expectedSha256: sha256(data),
        fetch: async () => new Response(data, { status: 200 }),
        maximumBytes: 4,
        url: 'https://fixtures.example/fixture.bin',
      }),
    ).rejects.toThrow('exceeds 4 byte limit')

    await expect(readFile(destination)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(`${destination}.download`)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
