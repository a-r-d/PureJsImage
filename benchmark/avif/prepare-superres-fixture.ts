import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseAv1FrameObus } from '../../src/codecs/av1-frame.ts'
import { av1ObuType, inspectAv1Bitstream } from '../../src/codecs/av1.ts'
import { avifSuperresFixtureDirectory, avifSuperresFixtures } from './superres-fixture.ts'

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const disableLibaomLoopFilterDeltas = async (path: string): Promise<void> => {
  const source = new Uint8Array(await readFile(path))
  const inspected = inspectAv1Bitstream(source)
  const frameObu = inspected.obus.find((obu) => obu.type === av1ObuType.frame)
  if (!frameObu) throw new Error('super-resolution fixture has no frame OBU')
  const frame = parseAv1FrameObus(inspected.sequence, inspected.obus)
  if (
    !frame.header.loopFilterDeltaEnabled ||
    frame.header.loopFilterLevels.some((level) => level !== 0)
  ) {
    throw new Error('libaom filter-free super-resolution loop-filter syntax changed')
  }

  // --loopfilter-control=0 leaves the default intra-reference delta enabled. Clear that
  // flag and remove its zero update bit while preserving every later header field and the
  // entropy-coded tile payload. Depending on alignment, the frame header shrinks by one byte
  // or consumes one more padding bit in the existing final byte.
  const headerBits = Array.from(frameObu.payload.subarray(0, frame.header.headerBytes)).flatMap(
    (byte) => Array.from({ length: 8 }, (_, bit) => (byte >> (7 - bit)) & 1),
  )
  const expectedHeader = JSON.stringify({
    ...frame.header,
    headerBytes: 0,
    loopFilterDeltaEnabled: false,
  })
  const payloadOffset = frameObu.offset + frameObu.headerBytes
  let patchedSource: Uint8Array | undefined
  let patchedHeaderBytes = 0
  for (let position = 0; position + 1 < headerBits.length; position += 1) {
    if (headerBits[position] !== 1 || headerBits[position + 1] !== 0) continue
    const candidateBits = [
      ...headerBits.slice(0, position),
      0,
      ...headerBits.slice(position + 2),
      0,
    ]
    const candidate = source.slice()
    for (let byte = 0; byte < frame.header.headerBytes; byte += 1) {
      let value = 0
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value << 1) | (candidateBits[byte * 8 + bit] ?? 0)
      }
      candidate[payloadOffset + byte] = value
    }
    try {
      const candidateInspection = inspectAv1Bitstream(candidate)
      const candidateFrame = parseAv1FrameObus(
        candidateInspection.sequence,
        candidateInspection.obus,
      )
      const candidateHeader = JSON.stringify({
        ...candidateFrame.header,
        headerBytes: 0,
      })
      if (
        candidateHeader !== expectedHeader ||
        candidateFrame.header.headerBytes < frame.header.headerBytes - 1 ||
        candidateFrame.header.headerBytes > frame.header.headerBytes
      ) {
        continue
      }
      if (patchedSource) throw new Error('filter-free header patch is ambiguous')
      patchedSource = candidate
      patchedHeaderBytes = candidateFrame.header.headerBytes
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'filter-free header patch is ambiguous') {
        throw error
      }
    }
  }
  if (!patchedSource) throw new Error('libaom filter-free super-resolution header changed')

  const removedBytes = frame.header.headerBytes - patchedHeaderBytes
  const output =
    removedBytes === 0
      ? patchedSource
      : (() => {
          const removedOffset = payloadOffset + patchedHeaderBytes
          const compact = new Uint8Array(patchedSource.byteLength - 1)
          compact.set(patchedSource.subarray(0, removedOffset))
          compact.set(patchedSource.subarray(removedOffset + 1), removedOffset)
          return compact
        })()
  if (removedBytes === 1) {
    const obuHeaderBytes = (source[frameObu.offset] ?? 0) & 4 ? 2 : 1
    const sizeOffset = frameObu.offset + obuHeaderBytes
    const sizeBytes = frameObu.headerBytes - obuHeaderBytes
    let remainingSize = frameObu.payload.byteLength - 1
    for (let index = 0; index < sizeBytes; index += 1) {
      output[sizeOffset + index] = (remainingSize & 0x7f) | (index + 1 < sizeBytes ? 0x80 : 0)
      remainingSize >>>= 7
    }
    if (remainingSize !== 0) throw new Error('super-resolution fixture OBU size overflowed')
  }

  const patchedInspection = inspectAv1Bitstream(output)
  const patchedFrame = parseAv1FrameObus(patchedInspection.sequence, patchedInspection.obus)
  if (
    patchedFrame.header.loopFilterDeltaEnabled ||
    sha256(patchedFrame.tiles[0]?.data ?? new Uint8Array()) !==
      sha256(frame.tiles[0]?.data ?? new Uint8Array())
  ) {
    throw new Error('filter-free super-resolution header patch is invalid')
  }
  await writeFile(path, output)
}
const directory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-superres-'))
try {
  for (const fixture of avifSuperresFixtures) {
    const stem = fixture.file.slice(0, -'.avif'.length)
    const sourcePath = join(directory, `${stem}.y4m`)
    const obuPath = join(directory, `${stem}.obu`)
    const chromaWidth = fixture.chromaSubsampling === '444' ? fixture.width : fixture.width >> 1
    const chromaHeight = fixture.chromaSubsampling === '444' ? fixture.height : fixture.height >> 1
    const chromaHeader =
      fixture.chromaSubsampling === '444' ? 'C444 XYSCSS=444' : 'C420jpeg XYSCSS=420JPEG'
    const header = Buffer.from(
      `YUV4MPEG2 W${fixture.width} H${fixture.height} F1:1 Ip A1:1 ${chromaHeader} XCOLORRANGE=FULL\nFRAME\n`,
    )
    const luma = Buffer.alloc(fixture.width * fixture.height)
    const u = Buffer.alloc(chromaWidth * chromaHeight)
    const v = Buffer.alloc(chromaWidth * chromaHeight)
    for (let y = 0; y < fixture.height; y += 1) {
      for (let x = 0; x < fixture.width; x += 1) {
        const detail =
          fixture.sourcePattern === 'detail' ? (((x >> 3) ^ (y >> 3)) & 1) * 71 + ((x * y) >> 4) : 0
        luma[y * fixture.width + x] = (x * 5 + y * 3 + detail) & 0xff
      }
    }
    for (let y = 0; y < chromaHeight; y += 1) {
      for (let x = 0; x < chromaWidth; x += 1) {
        if (fixture.sourcePattern === 'detail') {
          u[y * chromaWidth + x] = (x * 11 + y * 7 + (((x >> 2) ^ (y >> 2)) & 1) * 53) & 0xff
          v[y * chromaWidth + x] = (x * 3 + y * 13 + ((x * y) >> 3)) & 0xff
        } else {
          u[y * chromaWidth + x] = (x * 7 + y) & 0xff
          v[y * chromaWidth + x] = (x + y * 11) & 0xff
        }
      }
    }
    const source = Buffer.concat([header, luma, u, v])
    if (sha256(source) !== fixture.sourceY4mSha256) {
      throw new Error(`${fixture.file} source checksum changed`)
    }
    await writeFile(sourcePath, source)

    const encoded = spawnSync(
      'aomenc',
      [
        '--debug',
        '--obu',
        '--allintra',
        '--passes=1',
        `--cpu-used=${fixture.cpuUsed}`,
        '--end-usage=q',
        `--cq-level=${fixture.cqLevel}`,
        '--superres-mode=1',
        `--superres-denominator=${fixture.superresDenominator}`,
        `--superres-kf-denominator=${fixture.superresDenominator}`,
        '--loopfilter-control=0',
        `--enable-cdef=${Number(fixture.filters.includes('cdef'))}`,
        `--enable-restoration=${Number(fixture.filters.includes('restoration'))}`,
        '--limit=1',
        `--i${fixture.chromaSubsampling}`,
        '--color-primaries=bt709',
        '--transfer-characteristics=srgb',
        `--matrix-coefficients=${fixture.chromaSubsampling === '444' ? 'identity' : 'bt709'}`,
        '-o',
        obuPath,
        sourcePath,
      ],
      { encoding: 'utf8' },
    )
    if (encoded.error) throw encoded.error
    if (encoded.status !== 0) throw new Error(`aomenc failed: ${encoded.stderr.trim()}`)
    if (fixture.filters.length === 0) await disableLibaomLoopFilterDeltas(obuPath)
    const fixturePath = join(avifSuperresFixtureDirectory, fixture.file)
    const muxed = spawnSync(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', obuPath, '-c', 'copy', fixturePath],
      { encoding: 'utf8' },
    )
    if (muxed.error) throw muxed.error
    if (muxed.status !== 0) throw new Error(`ffmpeg failed: ${muxed.stderr.trim()}`)
    const encodedFixture = await readFile(fixturePath)
    const checksum = sha256(encodedFixture)
    if (checksum !== fixture.fileSha256) {
      throw new Error(`${fixture.file} checksum changed: ${checksum}`)
    }
    console.log(`generated ${fixture.file}`)
  }
} finally {
  await rm(directory, { recursive: true, force: true })
}
