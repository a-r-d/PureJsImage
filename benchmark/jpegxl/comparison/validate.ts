import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { hash, oracle, raw, run } from './io.ts'
import {
  type Fixture,
  lossyOutputStatus,
  number,
  object,
  type Pixels,
  type Subject,
  string,
  validatePixels,
} from './model.ts'
export async function pngPixels(path: string, native = false, channels = 4): Promise<Pixels> {
  if (native) {
    const { data, info } = await sharp(path)
      .toColourspace(channels === 1 ? 'grey16' : 'rgb16')
      .raw({ depth: 'ushort' })
      .toBuffer({ resolveWithObject: true })
    return {
      width: info.width,
      height: info.height,
      channels: info.channels,
      data: new Uint16Array(new Uint8Array(data).buffer),
      interpretation: 'srgb16',
    }
  }
  const { data, info } = await sharp(path)
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return {
    width: info.width,
    height: info.height,
    channels: 4,
    data: new Uint8Array(data),
    interpretation: 'srgb',
  }
}
export async function validate(
  prefix: string,
  fixture: Fixture,
  operation: string,
  lossless: boolean,
  subject: Subject,
) {
  const measurement = object(JSON.parse(await readFile(`${prefix}.json`, 'utf8')))
  if (measurement.status !== 'verified') return measurement
  const output = object(measurement.output),
    kind = string(output.kind),
    bytes = new Uint8Array(await readFile(`${prefix}.bin`))
  if (hash(bytes) !== output.sha256) throw new Error('Output artifact hash mismatch')
  let actual: Pixels
  if (kind === 'pixels')
    actual = {
      width: number(output.width),
      height: number(output.height),
      channels: number(output.channels),
      interpretation: string(output.interpretation),
      data:
        output.sampleType === 'uint16'
          ? new Uint16Array(bytes.buffer)
          : output.sampleType === 'float32'
            ? new Float32Array(bytes.buffer)
            : bytes,
    }
  else {
    const path = kind === 'jxl' ? `${prefix}.decoded.png` : `${prefix}.bin`
    if (kind === 'jxl')
      run(`${oracle}/djxl`, [
        `${prefix}.bin`,
        path,
        '--num_threads=1',
        `--bits_per_sample=${fixture.sampleType === 'uint16' ? 16 : 8}`,
      ])
    actual = await pngPixels(path, fixture.sampleType === 'uint16', fixture.channels)
  }
  let expected = await raw(fixture),
    tolerance = 0
  if (operation === 'decode-lossy') {
    const path = `${prefix}.reference.png`
    run(`${oracle}/djxl`, [
      fixture.lossy ?? fixture.lossless,
      path,
      '--num_threads=1',
      '--bits_per_sample=8',
    ])
    expected = await pngPixels(path)
    tolerance = 2
  }
  if ((operation === 'encode' || operation === 'roundtrip') && !lossless) {
    // Successful independent decode does not establish perceptual quality. Metrics live separately.
    const shape =
      actual.width === expected.width &&
      actual.height === expected.height &&
      actual.channels === expected.channels
    let alphaMaximumError = 0
    if (shape && expected.channels === 4)
      for (let i = 3; i < actual.data.length; i += 4)
        alphaMaximumError = Math.max(
          alphaMaximumError,
          Math.abs((actual.data[i] ?? 0) - (expected.data[i] ?? 0)),
        )
    return {
      ...measurement,
      status: lossyOutputStatus(shape, alphaMaximumError, subject === 'purejsimage'),
      detail: `Independent libjxl decode: shape ${shape}; alpha maximum error ${alphaMaximumError}; exact alpha required ${subject === 'purejsimage'}. Color quality not inferred from successful decode.`,
      validation: {
        decoderSha256: hash(await readFile(`${oracle}/djxl`)),
        alphaMaximumError,
        exactAlphaRequired: subject === 'purejsimage',
        quality: 'not measured in timing row',
      },
    }
  }
  const validation = validatePixels(actual, expected, tolerance)
  return {
    ...measurement,
    ...validation,
    validation: {
      ...validation,
      expectedSha256: hash(
        new Uint8Array(expected.data.buffer, expected.data.byteOffset, expected.data.byteLength),
      ),
      oracle:
        kind === 'jxl' || operation === 'decode-lossy'
          ? 'pinned native libjxl v0.12.0'
          : 'prepared source / sharp PNG reader',
    },
  }
}
