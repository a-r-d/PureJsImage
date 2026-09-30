import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { hashM8Sources } from '../m8-output-digest.ts'
import { type Fixture, object, type Pixels, parseFixture } from './model.ts'
export const root = 'benchmark/jpegxl/comparison'
export const work = '.tmp/jpegxl-comparison-v1'
export const oracle = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools'
export const metrics = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-m7-metrics/tools'
export async function implementationIdentity() {
  return {
    implementationRevision: run('git', ['rev-parse', 'HEAD']).trim(),
    implementationSourceSha256: await hashM8Sources(),
    implementationDirty:
      run('git', [
        'status',
        '--porcelain',
        '--untracked-files=all',
        '--',
        'src',
        'package.json',
        'package-lock.json',
      ]).trim().length > 0,
  }
}
export const hash = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex')
export async function json(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}
export async function fixtures(): Promise<Fixture[]> {
  const v: unknown = JSON.parse(await readFile(`${root}/fixtures.json`, 'utf8'))
  const list = object(v).fixtures
  if (!Array.isArray(list)) throw new Error('Missing fixtures')
  return list.map(parseFixture)
}
export function run(program: string, args: string[]): string {
  return execFileSync(program, args, {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}
export function pnm(bytes: Uint8Array): Pixels {
  let offset = 0
  const token = () => {
    while ((bytes[offset] ?? 255) <= 32) offset++
    if (bytes[offset] === 35) {
      while (bytes[offset] !== 10 && offset < bytes.length) offset++
      return token()
    }
    const begin = offset
    while ((bytes[offset] ?? 0) > 32) offset++
    return new TextDecoder().decode(bytes.subarray(begin, offset))
  }
  const magic = token(),
    width = Number(token()),
    height = Number(token()),
    maximum = Number(token())
  offset++
  if (
    (magic !== 'P6' && magic !== 'P5') ||
    !width ||
    !height ||
    (maximum !== 255 && maximum !== 65535)
  )
    throw new Error('Unsupported PNM')
  const channels = magic === 'P6' ? 3 : 1,
    size = width * height * channels,
    payload = bytes.subarray(offset)
  if (payload.length !== size * (maximum === 255 ? 1 : 2)) throw new Error('PNM length mismatch')
  if (maximum === 255)
    return { width, height, channels, data: payload.slice(), interpretation: 'srgb' }
  const data = new Uint16Array(size),
    view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  for (let i = 0; i < size; i++) data[i] = view.getUint16(i * 2)
  return { width, height, channels, data, interpretation: 'srgb16' }
}
export async function raw(f: Fixture): Promise<Pixels> {
  const data = new Uint8Array(await readFile(f.raw))
  if (hash(data) !== f.rawSha256) throw new Error(`Fixture raw hash mismatch: ${f.id}`)
  return {
    width: f.width,
    height: f.height,
    channels: f.channels,
    data:
      f.sampleType === 'uint16'
        ? new Uint16Array(data.buffer)
        : f.sampleType === 'float32'
          ? new Float32Array(data.buffer)
          : data,
    interpretation:
      f.sampleType === 'uint16' ? 'srgb16' : f.sampleType === 'float32' ? 'linear' : 'srgb',
  }
}
