import { createHash } from 'node:crypto'
import { writeFile, readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { MemorySource } from '../../src/source.ts'
import { defaultImageLimits } from '../../src/limits.ts'
const width = 17,
  height = 13,
  pixels = Buffer.alloc(width * height * 8)
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 8
    pixels.writeUInt16BE(Math.round((x / 16) * 65535), i)
    pixels.writeUInt16BE(Math.round((y / 12) * 65535), i + 2)
    pixels.writeUInt16BE(32768, i + 4)
    pixels.writeUInt16BE(Math.round((x / 16) * 65535), i + 6)
  }
await writeFile(
  '.tmp/jpegxl-m4-color/vardct-alpha.pam',
  Buffer.concat([
    Buffer.from(
      `P7\nWIDTH ${width}\nHEIGHT ${height}\nDEPTH 4\nMAXVAL 65535\nTUPLTYPE RGB_ALPHA\nENDHDR\n`,
    ),
    pixels,
  ]),
)
const cases = []
for (const association of [0, 1])
  for (const scale of [1, 2, 4, 8]) {
    const id = `vardct-alpha-${association}-${scale}`
    const path = `tests/fixtures/jpegxl/m4-color/${id}.jxl`
    const tools = '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/'
    for (const [tool, args] of [
      [
        'cjxl',
        [
          '.tmp/jpegxl-m4-color/vardct-alpha.pam',
          path,
          '-d',
          '1',
          '-e',
          '1',
          '--num_threads=1',
          `--ec_resampling=${scale}`,
          `--premultiply=${association}`,
        ],
      ],
      ['djxl', [path, `.tmp/jpegxl-m4-color/${id}.npy`, '--num_threads=1']],
    ] as const) {
      const result = spawnSync(tools + tool, args)
      if (result.status !== 0) throw Error(result.stderr.toString())
    }
    try {
      const d = await jpegxlCodec.createDecoder?.(
        new MemorySource(await readFile(path)),
        defaultImageLimits,
      )
      if (!d) throw Error('no decoder')
      const npy = await readFile(`.tmp/jpegxl-m4-color/${id}.npy`),
        start = 10 + npy.readUInt16LE(8)
      let max = 0,
        sq = 0,
        n = 0
      for await (const b of d.decode()) {
        const v = new DataView(b.data.buffer, b.data.byteOffset, b.data.byteLength)
        for (let i = 0; i < b.width * 4; i++) {
          const a = v.getUint16(i * 2, false) / 65535,
            e = npy.readFloatLE(start + (b.y * b.width * 4 + i) * 4),
            diff = a - Math.max(0, Math.min(1, e))
          max = Math.max(max, Math.abs(diff))
          sq += diff * diff
          n++
        }
      }
      const rmse = Math.sqrt(sq / n)
      if (max > 1 / 255 || rmse > 0.55 / 255) throw Error(`${id}: oracle comparison failed`)
      const reference = new Uint8Array(width * height * 4 * 4)
      const referenceView = new DataView(reference.buffer)
      for (let i = 0; i < width * height * 4; i++)
        referenceView.setFloat32(i * 4, npy.readFloatLE(start + i * 4), false)
      await writeFile(`tests/fixtures/jpegxl/m4-color/${id}.bin`, reference)
      cases.push({
        id,
        depth: 16,
        width,
        height,
        format: d.pixelFormat,
        colorSemantics: d.colorSemantics,
        sourcePeak: 1,
        clipReference: true,
        sha256: createHash('sha256')
          .update(await readFile(path))
          .digest('hex'),
        pixelsSha256: createHash('sha256').update(reference).digest('hex'),
        maximumNormalizedError: max,
        normalizedRmse: rmse,
      })
    } catch (e) {
      throw new Error(id, { cause: e })
    }
  }

await writeFile(
  'tests/fixtures/jpegxl/m4-color/vardct-alpha-manifest.json',
  `${JSON.stringify({ schemaVersion: 1, libjxlRevision: 'a7a9c787341cf703dede03c2009fa460cae5e5df', cases }, null, 2)}\n`,
)
console.log(`${cases.length} independently upsampled VarDCT alpha fixtures match djxl`)
