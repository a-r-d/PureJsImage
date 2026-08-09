import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import jpeg from 'jpeg-js'
import { afterEach, describe, expect, it } from 'vitest'

import { exerciseCorpus } from '../scripts/exercise-corpus.ts'

const temporaryDirectories: string[] = []

const manifestRecord = (
  sha256: string,
  localRelativePath: string,
  sizeBytes: number,
  status = 'downloaded',
): string =>
  JSON.stringify({
    bucket: 'private-user-uploads',
    key: 'incoming/private-phone-number.jpeg',
    status,
    detectedFormat: status === 'downloaded' ? 'jpeg' : undefined,
    localRelativePath,
    sha256,
    sizeBytes,
  })

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('user corpus exercise', () => {
  it('transforms valid images, stages failures, and excludes source names from the report', async () => {
    const corpusDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-corpus-'))
    temporaryDirectories.push(corpusDirectory)
    await mkdir(join(corpusDirectory, 'objects'))

    const valid = jpeg.encode(
      {
        width: 3,
        height: 2,
        data: Uint8Array.of(
          255,
          0,
          0,
          255,
          0,
          255,
          0,
          255,
          0,
          0,
          255,
          255,
          255,
          255,
          0,
          255,
          0,
          255,
          255,
          255,
          255,
          0,
          255,
          255,
        ),
      },
      90,
    ).data
    const invalidSize = 4
    await Promise.all([
      writeFile(join(corpusDirectory, 'objects', 'valid.jpeg'), valid),
      writeFile(
        join(corpusDirectory, 'manifest.jsonl'),
        `${[
          manifestRecord('a'.repeat(64), 'objects/valid.jpeg', valid.byteLength),
          manifestRecord('b'.repeat(64), 'objects/private-missing.jpeg', invalidSize),
          manifestRecord('c'.repeat(64), 'excluded/non-image.txt', 12, 'downloaded-non-image'),
        ].join('\n')}\n`,
      ),
    ])

    const report = await exerciseCorpus({ corpusDirectory, concurrency: 2 })

    expect(report.summary).toMatchObject({
      recordsSeen: 3,
      selected: 2,
      skipped: 1,
      succeeded: 1,
      failed: 1,
      inputBytes: valid.byteLength + invalidSize,
    })
    expect(report.summary.outputBytes).toBeGreaterThan(0)
    expect(report.formats).toEqual([
      expect.objectContaining({ format: 'jpeg', selected: 2, succeeded: 1, failed: 1 }),
    ])
    expect(report.failures).toEqual([
      expect.objectContaining({
        id: 'b'.repeat(64),
        format: 'jpeg',
        sizeBytes: invalidSize,
        stage: 'open',
        code: 'ENOENT',
      }),
    ])
    expect(report.errors).toEqual([
      expect.objectContaining({ count: 1, uniqueFiles: 1, stage: 'open', code: 'ENOENT' }),
    ])
    expect(JSON.stringify(report)).not.toContain('private-phone-number')
    expect(JSON.stringify(report)).not.toContain(corpusDirectory)
    expect(JSON.stringify(report)).not.toContain('private-missing')
    expect(report.failures[0]?.message).toContain('<corpus-file>')

    const shardReport = await exerciseCorpus({
      corpusDirectory,
      shard: { index: 0, count: 2 },
    })
    expect(shardReport.options.shard).toEqual({ index: 0, count: 2 })
    expect(shardReport.summary).toMatchObject({
      recordsSeen: 3,
      selected: 1,
      skipped: 2,
      succeeded: 1,
      failed: 0,
    })
  })
})
