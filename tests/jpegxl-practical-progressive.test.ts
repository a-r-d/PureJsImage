import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { openJpegXlSession } from '../src/jpegxl.ts'

const root = new URL('./fixtures/jpegxl/practical-progressive/', import.meta.url)
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const encoded = async (name: string, hash: string): Promise<Uint8Array> => {
  const bytes = new Uint8Array(await readFile(new URL(`${name}.jxl`, root)))
  expect(sha256(bytes)).toBe(hash)
  return bytes
}
const reference = async (name: string): Promise<Uint8Array> =>
  new Uint8Array(gunzipSync(await readFile(new URL(name, root))))

const npySamples = (bytes: Uint8Array): DataView => {
  const source = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (source.getUint8(0) !== 0x93 || source.getUint8(1) !== 0x4e)
    throw new Error('Independent NPY reference has an invalid header')
  const offset = 10 + source.getUint16(8, true)
  return new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset)
}

const pfmSamples = (
  bytes: Uint8Array,
  channels: 1 | 3,
  width: number,
  height: number,
): DataView => {
  let offset = 0
  const line = (): string => {
    const end = bytes.indexOf(10, offset)
    if (end < 0) throw new Error('Truncated independent PFM reference')
    const value = new TextDecoder().decode(bytes.subarray(offset, end))
    offset = end + 1
    return value
  }
  expect(line()).toBe(channels === 1 ? 'Pf' : 'PF')
  expect(line()).toBe(`${width} ${height}`)
  expect(line()).toBe('1.0')
  expect(bytes.byteLength - offset).toBe(width * height * channels * 4)
  return new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset)
}

const readStage = async (
  bytes: Uint8Array,
  options: Readonly<{
    until?: 'dc' | 'final'
    region?: { x: number; y: number; width: number; height: number }
  }> = {},
): Promise<
  Readonly<{
    stages: readonly {
      kind: string
      passes: number
      format: string
      width: number
      height: number
      data: Uint8Array
    }[]
    sectionBytes: number
    peakBytes: number | null
    liveBytes: number
  }>
> => {
  const session = await openJpegXlSession(bytes, { maxCachedBytes: 0 })
  const stages: {
    kind: string
    passes: number
    format: string
    width: number
    height: number
    data: Uint8Array
  }[] = []
  let current: (typeof stages)[number] | undefined
  try {
    for await (const event of session.progressive(options)) {
      if (event.type === 'stage-start') {
        current = {
          kind: event.stage.kind,
          passes: event.stage.completedPasses,
          format: '',
          width: event.stage.width,
          height: event.stage.height,
          data: new Uint8Array(),
        }
        stages.push(current)
      } else if (event.type === 'block') {
        if (!current) throw new Error('Block arrived before stage start')
        current.format = event.block.format
        if (current.data.length === 0)
          current.data = new Uint8Array(current.height * event.block.stride)
        current.data.set(event.block.data, event.block.y * event.block.stride)
      }
    }
    return {
      stages,
      sectionBytes: session.sourceSectionBytes,
      peakBytes: session.managedPeakBytes,
      liveBytes: session.managedLiveBytes,
    }
  } finally {
    await session.close()
    expect(session.managedLiveBytes).toBe(0)
  }
}

const errorAgainstFloat = (
  stage: Readonly<{ width: number; height: number; format: string; data: Uint8Array }>,
  referenceSamples: DataView,
  multiplier: number,
): Readonly<{ mean: number; maximum: number }> => {
  const count = stage.width * stage.height * 3
  const actual = new DataView(stage.data.buffer, stage.data.byteOffset, stage.data.byteLength)
  expect(referenceSamples.byteLength).toBe(count * 4)
  let total = 0
  let maximum = 0
  for (let index = 0; index < count; index++) {
    const value =
      stage.format === 'rgbf32'
        ? actual.getFloat32(index * 4, false)
        : actual.getUint16(index * 2, false) / 65_535
    const expected = referenceSamples.getFloat32(index * 4, true) * multiplier
    const error = Math.abs(value - expected)
    if (!Number.isFinite(error)) throw new Error('Non-finite independent pixel error')
    total += error
    maximum = Math.max(maximum, error)
  }
  return { mean: total / count, maximum }
}

describe('JPEG XL selective high-depth color sessions', () => {
  it('matches pinned libjxl 0.12.0 DC and pass flushes for SDR16 across four groups', async () => {
    const bytes = await encoded(
      'sdr-rgb16',
      '076263bc88009ae0dcdaad1d9de9f7afbcc33253e635fc7f1fa8a69d1f8dacdf',
    )
    const dcReference = await reference('sdr-rgb16-stage-0.bin.gz')
    const passReference = await reference('sdr-rgb16-stage-1.bin.gz')
    expect(sha256(dcReference)).toBe(
      'a30f608b6e8f7a58c4ac27fe586be50e854a81f0ed12e15b2d519c16a6b75c6f',
    )
    expect(sha256(passReference)).toBe(
      '7b1790cfbfce6196351d4acee681f99b3702415bfbe5de8a67862b9a41ed7019',
    )
    const result = await readStage(bytes)
    expect(result.stages.map(({ kind, passes }) => [kind, passes])).toEqual([
      ['dc', 0],
      ['pass', 1],
      ['pass', 2],
      ['final', 3],
    ])
    for (const stage of result.stages) {
      expect(stage.format).toBe('rgb16')
      const oracle = stage.passes === 0 ? dcReference : passReference
      expect(stage.data.length).toBe(oracle.length)
      const actual = new DataView(stage.data.buffer, stage.data.byteOffset, stage.data.byteLength)
      const expected = new DataView(oracle.buffer, oracle.byteOffset, oracle.byteLength)
      let maximum = 0
      for (let index = 0; index < oracle.length / 2; index++)
        maximum = Math.max(
          maximum,
          Math.abs(actual.getUint16(index * 2, false) - expected.getUint16(index * 2, false)),
        )
      expect(maximum).toBeLessThanOrEqual(1)
    }
    expect(result.liveBytes).toBe(0)
    expect(result.peakBytes).toBeGreaterThan(0)
  })

  it.each([
    [
      'linear-rgb16',
      '1e50a1427822457a7250eab06c69afc1a2496f3a7191615f8404afc208abe324',
      1,
      0.000002,
    ],
    [
      'pq-rgb16',
      'bea56be690bf53d06851cb9b5137867d200089c6953eb424dff17fcba23ee0c2',
      10_000 / 203,
      0.0001,
    ],
  ] as const)(
    'matches pinned libjxl DC and final linear pixels for %s',
    async (name, hash, multiplier, limit) => {
      const bytes = await encoded(name, hash)
      const dc = npySamples(await reference(`${name}-dc.npy.gz`))
      const final = npySamples(await reference(`${name}-final.npy.gz`))
      const result = await readStage(bytes)
      expect(result.stages.map((stage) => stage.kind)).toEqual(['dc', 'pass', 'pass', 'final'])
      const first = result.stages[0]
      const last = result.stages[3]
      if (!first || !last) throw new Error('Missing encoded stage')
      expect(first.format).toBe('rgbf32')
      expect(last.format).toBe('rgbf32')
      expect(errorAgainstFloat(first, dc, multiplier).maximum).toBeLessThan(limit)
      expect(errorAgainstFloat(last, final, multiplier).maximum).toBeLessThan(limit)
      for (const stage of result.stages) {
        const values = new DataView(stage.data.buffer, stage.data.byteOffset, stage.data.byteLength)
        let nonfinite = 0
        for (let index = 0; index < stage.data.byteLength; index += 4)
          if (!Number.isFinite(values.getFloat32(index, false))) nonfinite++
        expect(nonfinite).toBe(0)
      }
      const early = await readStage(bytes, { until: 'dc' })
      expect(early.stages).toHaveLength(1)
      expect(early.sectionBytes).toBeLessThan(bytes.byteLength)
      expect(early.sectionBytes).toBeLessThan(result.sectionBytes)
    },
  )

  it('emits early SDR RGBA stages and matches pinned libjxl final pixels', async () => {
    const bytes = await encoded(
      'sdr-rgba8',
      '15c9b57e7ee045c258d4447c9208d42f6035ca9af50c911b0e4812c552f34752',
    )
    const result = await readStage(bytes)
    expect(result.stages.map(({ kind, format }) => [kind, format])).toEqual([
      ['dc', 'rgba8'],
      ['pass', 'rgba8'],
      ['pass', 'rgba8'],
      ['final', 'rgba8'],
    ])
    for (const stage of result.stages) {
      let mismatchedAlpha = 0
      for (let index = 3; index < stage.data.length; index += 4)
        if (stage.data[index] !== 127) mismatchedAlpha++
      expect(mismatchedAlpha).toBe(0)
    }
    const final = result.stages[3]
    if (!final) throw new Error('Missing SDR alpha final stage')
    const oracle = await reference('sdr-rgba8-final.bin.gz')
    expect(sha256(oracle)).toBe('d317cf24a3c731c4a99e99f286d6de1c2cd7ff28f9ee2f095281a97036bd1f51')
    let maximum = 0
    for (let index = 0; index < oracle.length; index++)
      maximum = Math.max(maximum, Math.abs((final.data[index] ?? 0) - (oracle[index] ?? 0)))
    expect(maximum).toBeLessThanOrEqual(1)
    const early = await readStage(bytes, { until: 'dc' })
    expect(early.sectionBytes).toBeLessThan(bytes.length)
    expect(early.sectionBytes).toBeLessThan(result.sectionBytes)
  })

  it('selects linear RGBA16 stages before final payload and matches pinned libjxl pixels', async () => {
    const bytes = await encoded(
      'linear-rgba16-small',
      '1b69f4b7535b826672b973bad21cad23ff7ad92daac529fe1f5bc626f5d431b2',
    )
    const width = 200
    const height = 180
    const colorBytes = await reference('linear-rgba16-small-color.pfm.gz')
    const alphaBytes = await reference('linear-rgba16-small-alpha.pfm.gz')
    expect(sha256(colorBytes)).toBe(
      'aceb6ffdde614423bd64875a36f5fd0b0cf516d30957f66c3f1d616c46c101e1',
    )
    expect(sha256(alphaBytes)).toBe(
      'cf333753390492f359f9f9534e43278a0a3225aa9f9dee5cdb045cc7e8a93413',
    )
    const color = pfmSamples(colorBytes, 3, width, height)
    const alpha = pfmSamples(alphaBytes, 1, width, height)
    const result = await readStage(bytes)
    expect(result.stages.map(({ kind, format }) => [kind, format])).toEqual([
      ['dc', 'rgbaf32'],
      ['pass', 'rgbaf32'],
      ['pass', 'rgbaf32'],
      ['final', 'rgbaf32'],
    ])
    const final = result.stages[3]
    if (!final) throw new Error('Missing linear alpha final stage')
    const actual = new DataView(final.data.buffer, final.data.byteOffset, final.data.byteLength)
    let maximumColorError = 0
    let maximumAlphaError = 0
    for (let y = 0; y < height; y++) {
      const sourceY = height - 1 - y // PFM stores the bottom row first.
      for (let x = 0; x < width; x++) {
        const actualPixel = (y * width + x) * 4
        const referencePixel = sourceY * width + x
        for (let channel = 0; channel < 3; channel++)
          maximumColorError = Math.max(
            maximumColorError,
            Math.abs(
              actual.getFloat32((actualPixel + channel) * 4, false) -
                color.getFloat32((referencePixel * 3 + channel) * 4, false),
            ),
          )
        maximumAlphaError = Math.max(
          maximumAlphaError,
          Math.abs(
            actual.getFloat32((actualPixel + 3) * 4, false) -
              alpha.getFloat32(referencePixel * 4, false),
          ),
        )
      }
    }
    expect(maximumColorError).toBeLessThan(0.000005)
    expect(maximumAlphaError).toBeLessThan(0.000003)
    for (const stage of result.stages) {
      const values = new DataView(stage.data.buffer, stage.data.byteOffset, stage.data.byteLength)
      let stageAlphaError = 0
      for (let pixel = 0; pixel < width * height; pixel++)
        stageAlphaError = Math.max(
          stageAlphaError,
          Math.abs(values.getFloat32((pixel * 4 + 3) * 4, false) - 0.5000076),
        )
      expect(stageAlphaError).toBeLessThan(0.00001)
    }
    const early = await readStage(bytes, { until: 'dc' })
    expect(early.stages).toHaveLength(1)
    expect(early.sectionBytes).toBeLessThan(bytes.byteLength)
    expect(early.sectionBytes).toBeLessThan(result.sectionBytes)
  })

  it('emits early PQ16 RGBA stages and matches pinned libjxl final pixels', async () => {
    const bytes = await encoded(
      'pq-rgba16-small',
      '4e742a809928c3194b5b5247ee4aa25f2e8fd0a0697dcaa5cfe808bc7ff227d8',
    )
    const result = await readStage(bytes)
    expect(result.stages.map(({ kind, format }) => [kind, format])).toEqual([
      ['dc', 'rgbaf32'],
      ['pass', 'rgbaf32'],
      ['pass', 'rgbaf32'],
      ['final', 'rgbaf32'],
    ])
    const final = result.stages[3]
    if (!final) throw new Error('Missing HDR alpha final stage')
    const oracle = npySamples(await reference('pq-rgba16-small-final.npy.gz'))
    const actual = new DataView(final.data.buffer, final.data.byteOffset, final.data.byteLength)
    let maximum = 0
    for (let index = 0; index < final.data.byteLength / 4; index++) {
      const scale = index % 4 === 3 ? 1 : 10_000 / 203
      maximum = Math.max(
        maximum,
        Math.abs(actual.getFloat32(index * 4, false) - oracle.getFloat32(index * 4, true) * scale),
      )
    }
    expect(maximum).toBeLessThan(0.0001)
    const early = await readStage(bytes, { until: 'dc' })
    expect(early.sectionBytes).toBeLessThan(bytes.length)
    expect(early.sectionBytes).toBeLessThan(result.sectionBytes)
  })

  it('keeps associated shifted SDR alpha through each early stage', async () => {
    const bytes = await encoded(
      'sdr-rgba8-associated-shift2',
      'c40847c5a6bd03a568a88c122f2963883a5792c7d259b1d93cd7724801c2cb90',
    )
    const session = await openJpegXlSession(bytes, { maxCachedBytes: 0 })
    try {
      expect(
        session.stages.filter(({ kind }) => kind !== 'embedded-preview').map(({ kind }) => kind),
      ).toEqual(['dc', 'pass', 'pass', 'final'])
      for await (const event of session.progressive({ until: 'dc' })) {
        if (event.type === 'stage-start')
          expect(event.stage.colorSemantics.alpha).toBe('premultiplied')
      }
      expect(session.sourceSectionBytes).toBeLessThan(bytes.byteLength)
    } finally {
      await session.close()
    }
    const result = await readStage(bytes)
    expect(result.stages.map(({ kind, format }) => [kind, format])).toEqual([
      ['dc', 'rgba8'],
      ['pass', 'rgba8'],
      ['pass', 'rgba8'],
      ['final', 'rgba8'],
    ])
    const final = result.stages[3]
    if (!final) throw new Error('Missing associated SDR alpha final stage')
    const oracle = await reference('sdr-rgba8-final.bin.gz')
    let maximum = 0
    for (let index = 0; index < oracle.length; index++)
      maximum = Math.max(maximum, Math.abs((final.data[index] ?? 0) - (oracle[index] ?? 0)))
    expect(maximum).toBeLessThanOrEqual(1)
  })

  it('selects associated shifted PQ alpha across color groups before final payload', async () => {
    const bytes = await encoded(
      'pq-rgba16-associated-shift2',
      'ffc832e936dc5e0c261786b76dd638e83f024a43a4dfff823385c4ae79700bd8',
    )
    const session = await openJpegXlSession(bytes, { maxCachedBytes: 0 })
    const region = { x: 270, y: 241, width: 17, height: 19 }
    try {
      expect(session.plan({ region, until: 'dc' }).groupIds).toEqual([1, 3])
      expect(
        session.stages.filter(({ kind }) => kind !== 'embedded-preview').map(({ kind }) => kind),
      ).toEqual(['dc', 'pass', 'pass', 'final'])
      for await (const event of session.progressive({ until: 'dc' })) {
        if (event.type === 'stage-start')
          expect(event.stage.colorSemantics.alpha).toBe('premultiplied')
      }
      expect(session.sourceSectionBytes).toBeLessThan(bytes.byteLength)
    } finally {
      await session.close()
    }
    const result = await readStage(bytes)
    expect(result.stages.map(({ kind, format }) => [kind, format])).toEqual([
      ['dc', 'rgbaf32'],
      ['pass', 'rgbaf32'],
      ['pass', 'rgbaf32'],
      ['final', 'rgbaf32'],
    ])
    const final = result.stages[3]
    if (!final) throw new Error('Missing associated PQ alpha final stage')
    const oracle = npySamples(await reference('pq-rgba16-associated-shift2-final.npy.gz'))
    const actual = new DataView(final.data.buffer, final.data.byteOffset, final.data.byteLength)
    let maximum = 0
    for (let index = 0; index < final.data.byteLength / 4; index++) {
      const scale = index % 4 === 3 ? 1 : 10_000 / 203
      maximum = Math.max(
        maximum,
        Math.abs(actual.getFloat32(index * 4, false) - oracle.getFloat32(index * 4, true) * scale),
      )
    }
    expect(maximum).toBeLessThan(0.00011)
    const viewport = await readStage(bytes, { region, until: 'dc' })
    expect(viewport.stages).toHaveLength(1)
    expect(viewport.stages[0]?.format).toBe('rgbaf32')
    expect(viewport.sectionBytes).toBeLessThan(bytes.byteLength)
    expect(result.liveBytes).toBe(0)
  })

  it('keeps grouped alpha stages behind the declared static fallback', async () => {
    const bytes = await encoded(
      'pq-rgba16-grouped',
      '53a18d6184cad7bab485cc68607ed7cfa937af006204faf842c23f9c60410bbf',
    )
    const session = await openJpegXlSession(bytes)
    try {
      expect(session.stages.find((stage) => stage.kind === 'dc')?.status).toBe('unavailable')
      expect(() => session.plan({ until: 'dc', fallback: 'reject' })).toThrow(
        'selective decode rejected',
      )
    } finally {
      await session.close()
    }
  })

  it('selects a high-depth viewport and releases its state after cancellation', async () => {
    const bytes = await encoded(
      'linear-rgb16',
      '1e50a1427822457a7250eab06c69afc1a2496f3a7191615f8404afc208abe324',
    )
    const session = await openJpegXlSession(bytes, { maxCachedBytes: 0 })
    const region = { x: 270, y: 241, width: 17, height: 19 }
    expect(session.plan({ region, until: 'dc' }).groupIds).toEqual([1, 3])
    expect(session.plan({ region, until: 1 }).workingMemoryClass).toBe(
      'full-output-and-working-planes',
    )
    const iterator = session.progressive({ region, until: 'dc' })
    try {
      let found = false
      for await (const event of iterator) {
        if (event.type === 'block') {
          expect(event.block.format).toBe('rgbf32')
          expect(event.block.width).toBe(17)
          found = true
          break
        }
      }
      expect(found).toBe(true)
      expect(session.sourceSectionBytes).toBeLessThan(bytes.byteLength)
    } finally {
      await iterator.return(undefined)
      await session.close()
    }
    expect(session.managedLiveBytes).toBe(0)
  })
})
