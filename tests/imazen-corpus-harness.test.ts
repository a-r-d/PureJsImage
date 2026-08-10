import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { afterEach, describe, expect, it } from 'vitest'

import {
  buildImazenReport,
  discoverImazenCorpus,
  type ImazenCommandSettings,
  type ImazenCorpusEntry,
  type ImazenFormat,
  type ImazenResultRecord,
  pngFeatureGroup,
  renderImazenMarkdown,
  runIsolatedFile,
  serializeImazenJson,
  writeImazenReports,
} from '../scripts/validate-imazen-corpus.ts'

const temporaryDirectories: string[] = []
const controlWorker = fileURLToPath(new URL('./fixtures/imazen-worker-control.ts', import.meta.url))

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'purejsimage-imazen-'))
  temporaryDirectories.push(directory)
  return directory
}

const corpusEntry = (
  root: string,
  filename: string,
  expectation: ImazenCorpusEntry['expectation'],
  format: ImazenFormat = 'jpeg',
): ImazenCorpusEntry => ({
  format,
  absolutePath: join(root, filename),
  relativeFilename: `${format === 'jpeg' ? 'jpeg-conformance/valid' : 'pngsuite'}/${filename}`,
  expectedCategory: expectation === 'flexible' ? 'non-conformant' : expectation,
  expectation,
  corpusCategory: expectation,
  testGroup: expectation,
  features: [],
  upstreamExpectation: null,
})

const settings: ImazenCommandSettings = {
  corpus: '../codec-corpus',
  format: 'all',
  output: 'benchmark/results',
  timeoutMs: 30_000,
  memoryMb: 512,
  concurrency: 2,
  limit: null,
  filter: null,
}

const environment = {
  pureJsImageVersion: '0.7.0',
  pureJsImageGitCommit: 'pure-commit',
  codecCorpusGitCommit: 'corpus-commit',
  nodeVersion: 'v24.0.0',
  platform: 'linux-x64',
  generatedAt: '2026-08-09T00:00:00.000Z',
}

const resultRecord = (
  format: ImazenFormat,
  outcome: ImazenResultRecord['actualOutcome'],
): ImazenResultRecord => ({
  format,
  relativeFilename: format === 'jpeg' ? 'jpeg-conformance/valid/a.jpg' : 'pngsuite/basn0g08.png',
  expectedCategory: 'valid',
  corpusCategory: 'valid',
  testGroup: 'valid',
  features: [],
  upstreamExpectation: null,
  actualOutcome: outcome,
  lastCompletedStage: 'verify-output',
  structuredErrorCode: null,
  sanitizedErrorMessage: null,
  elapsedMs: 12,
  childExitCode: 0,
  childSignal: null,
})

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('Imazen corpus isolation and classification', () => {
  it('completes a real valid-image decode and PNG round trip', async () => {
    const root = await temporaryDirectory()
    const image = new PNG({ width: 2, height: 1 })
    image.data.set([255, 0, 0, 255, 0, 255, 0, 255])
    const path = join(root, 'valid.png')
    await writeFile(path, PNG.sync.write(image))

    const result = await runIsolatedFile(corpusEntry(root, 'valid.png', 'valid', 'png'), {
      timeoutMs: 5_000,
      memoryMb: 128,
      corpusRoot: root,
    })

    expect(result).toMatchObject({
      actualOutcome: 'pass',
      lastCompletedStage: 'verify-output',
      childExitCode: 0,
      childSignal: null,
    })
  })

  it('classifies a structured unsupported error without counting it as a pass', async () => {
    const root = await temporaryDirectory()
    const result = await runIsolatedFile(corpusEntry(root, 'unsupported', 'valid'), {
      timeoutMs: 2_000,
      memoryMb: 128,
      corpusRoot: root,
      workerPath: controlWorker,
    })
    expect(result).toMatchObject({
      actualOutcome: 'unsupported',
      structuredErrorCode: 'UNSUPPORTED_OPERATION',
    })
  })

  it('classifies a structured invalid-input error as a safe rejection', async () => {
    const root = await temporaryDirectory()
    const result = await runIsolatedFile(corpusEntry(root, 'invalid', 'invalid'), {
      timeoutMs: 2_000,
      memoryMb: 128,
      corpusRoot: root,
      workerPath: controlWorker,
    })
    expect(result).toMatchObject({
      actualOutcome: 'rejected-safely',
      structuredErrorCode: 'INVALID_INPUT',
    })
  })

  it('records an unexpectedly accepted invalid input', async () => {
    const root = await temporaryDirectory()
    const result = await runIsolatedFile(corpusEntry(root, 'accepted', 'invalid'), {
      timeoutMs: 2_000,
      memoryMb: 128,
      corpusRoot: root,
      workerPath: controlWorker,
    })
    expect(result.actualOutcome).toBe('accepted')
  })

  it('preserves a raw exception as a distinct outcome', async () => {
    const root = await temporaryDirectory()
    const result = await runIsolatedFile(corpusEntry(root, 'raw', 'valid'), {
      timeoutMs: 2_000,
      memoryMb: 128,
      corpusRoot: root,
      workerPath: controlWorker,
    })
    expect(result).toMatchObject({ actualOutcome: 'raw-exception', structuredErrorCode: null })
  })

  it('kills and classifies a timed-out worker', async () => {
    const root = await temporaryDirectory()
    const result = await runIsolatedFile(corpusEntry(root, 'hang', 'valid'), {
      timeoutMs: 100,
      memoryMb: 128,
      corpusRoot: root,
      workerPath: controlWorker,
    })
    expect(result).toMatchObject({
      actualOutcome: 'timeout',
      childSignal: 'SIGKILL',
      lastCompletedStage: 'metadata',
    })
  })

  it('classifies an abnormal child exit as a process crash', async () => {
    const root = await temporaryDirectory()
    const result = await runIsolatedFile(corpusEntry(root, 'crash', 'valid'), {
      timeoutMs: 2_000,
      memoryMb: 128,
      corpusRoot: root,
      workerPath: controlWorker,
    })
    expect(result).toMatchObject({
      actualOutcome: 'process-crash',
      childExitCode: 17,
      lastCompletedStage: 'open',
    })
  })
})

describe('Imazen corpus discovery and reports', () => {
  it('detects format, upstream category, and PNGSuite feature groups', async () => {
    const root = await temporaryDirectory()
    await Promise.all([
      mkdir(join(root, 'jpeg-conformance', 'valid'), { recursive: true }),
      mkdir(join(root, 'jpeg-conformance', 'invalid'), { recursive: true }),
      mkdir(join(root, 'jpeg-conformance', 'non-conformant', 'truncated'), { recursive: true }),
      mkdir(join(root, 'jpeg-conformance', 'crash-repro', 'zune-jpeg'), { recursive: true }),
      mkdir(join(root, 'pngsuite'), { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(root, 'jpeg-conformance', 'valid', 'valid.jpg'), ''),
      writeFile(join(root, 'jpeg-conformance', 'invalid', 'invalid.jpeg'), ''),
      writeFile(join(root, 'jpeg-conformance', 'non-conformant', 'truncated', 'short.jpg'), ''),
      writeFile(join(root, 'jpeg-conformance', 'crash-repro', 'zune-jpeg', 'repro.jpg'), ''),
      writeFile(join(root, 'pngsuite', 'f00n0g08.png'), ''),
      writeFile(join(root, 'pngsuite', 'xcsn0g01.png'), ''),
      writeFile(
        join(root, 'expected_errors.json'),
        JSON.stringify({
          pngsuite: {
            error_files: {
              'xcsn0g01.png': { corruption: 'checksum_error', details: 'Incorrect IDAT checksum' },
            },
          },
        }),
      ),
    ])

    const entries = await discoverImazenCorpus(root, 'all')
    expect(entries.map(({ format, corpusCategory }) => [format, corpusCategory])).toEqual([
      ['jpeg', 'crash-repro/zune-jpeg'],
      ['jpeg', 'invalid'],
      ['jpeg', 'non-conformant/truncated'],
      ['jpeg', 'valid'],
      ['png', 'valid/filtering'],
      ['png', 'invalid/checksum_error'],
    ])
    expect(pngFeatureGroup('basi6a16.png')).toBe('interlacing')
    expect(pngFeatureGroup('cdfn2c08.png')).toBe('physical-dimensions')
    expect(pngFeatureGroup('bgwn6a08.png')).toBe('background-information')
  })

  it('writes separate JPEG and PNG JSON and Markdown reports', async () => {
    const root = await temporaryDirectory()
    const jpeg = buildImazenReport('jpeg', [resultRecord('jpeg', 'pass')], settings, environment)
    const png = buildImazenReport('png', [resultRecord('png', 'pass')], settings, environment)

    await writeImazenReports(root, [png, jpeg])

    expect((await readdir(root)).sort()).toEqual([
      'imazen-jpeg-conformance.json',
      'imazen-jpeg-conformance.md',
      'imazen-png-conformance.json',
      'imazen-png-conformance.md',
    ])
    expect(
      JSON.parse(await readFile(join(root, 'imazen-jpeg-conformance.json'), 'utf8')),
    ).toMatchObject({
      format: 'jpeg',
    })
    expect(
      JSON.parse(await readFile(join(root, 'imazen-png-conformance.json'), 'utf8')),
    ).toMatchObject({
      format: 'png',
    })
  })

  it('renders deterministic JSON and Markdown from a fixed result set', () => {
    const first = resultRecord('jpeg', 'decode-failure')
    const second: ImazenResultRecord = {
      ...resultRecord('jpeg', 'pass'),
      relativeFilename: 'jpeg-conformance/valid/z.jpg',
    }
    const forward = buildImazenReport('jpeg', [first, second], settings, environment)
    const reversed = buildImazenReport('jpeg', [second, first], settings, environment)

    expect(serializeImazenJson(forward)).toBe(serializeImazenJson(reversed))
    expect(renderImazenMarkdown(forward)).toBe(renderImazenMarkdown(reversed))
    expect(forward.records.map((record) => record.relativeFilename)).toEqual([
      'jpeg-conformance/valid/a.jpg',
      'jpeg-conformance/valid/z.jpg',
    ])
  })
})
