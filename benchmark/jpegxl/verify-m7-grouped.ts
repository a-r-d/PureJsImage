import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createJpegXlModularEncoder } from '../../src/codecs/jpegxl-modular-encode.ts'
import { Uint8ArraySink } from '../../src/sink.ts'

const runId = process.argv[2] ?? 'baseline'
if (!/^[a-z0-9-]+$/u.test(runId)) throw new Error('Invalid grouped verification identifier')
const directory = `.tmp/jpegxl-m7/grouped-${runId}-oracle`
await mkdir(directory, { recursive: true })
const results: object[] = []
for (const depth of [8, 10, 12, 16])
  for (const width of [1023, 1024, 1025, 8193])
    for (const effort of [3, 5, 7]) {
      const height = 7
      const channels = depth === 8 ? 3 : 4
      const sampleBytes = depth === 8 ? 1 : 2
      const format = depth === 8 ? 'rgb8' : 'rgba16'
      const maximum = 2 ** depth - 1
      const pixels = new Uint8Array(width * height * channels * sampleBytes)
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          for (let c = 0; c < channels; c++) {
            const sample = c === 3 ? (x % 3 === 0 ? 0 : maximum) : (x + y * (c + 1)) & maximum
            const offset = ((y * width + x) * channels + c) * sampleBytes
            if (sampleBytes === 2) pixels[offset] = sample >>> 8
            pixels[offset + sampleBytes - 1] = sample
          }
      const sink = new Uint8ArraySink()
      const encoder = await createJpegXlModularEncoder(sink, {
        width,
        height,
        pixelFormat: format,
        colorSemantics: {
          family: 'rgb',
          primaries: 'srgb',
          transfer: { kind: 'srgb' },
          matrix: 'identity',
          range: 'full',
          alpha: channels === 4 ? 'straight' : 'none',
          provenance: 'assumed-default',
          renderingIntent: 'relative',
        },
        options: { effort, sampleBitDepth: depth },
      })
      await encoder.write({
        x: 0,
        y: 0,
        width,
        height,
        stride: width * channels * sampleBytes,
        format,
        data: pixels,
      })
      await encoder.finish()
      const path = `${directory}/${width}-${depth}bit-e${effort}`
      await writeFile(`${path}.jxl`, sink.toUint8Array())
      const nativePath = `${path}.${channels === 4 ? 'pam' : 'ppm'}`
      const decoded = spawnSync(
        '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools/djxl',
        [`${path}.jxl`, nativePath, '--bits_per_sample=0', '--num_threads=1'],
        { encoding: 'utf8' },
      )
      if (decoded.status !== 0) throw new Error(decoded.stderr)
      const output = await readFile(nativePath)
      const text = output.subarray(0, 1024).toString('ascii')
      let headerBytes = 0
      let nativeMaximum = 0
      if (channels === 4) {
        const end = text.indexOf('ENDHDR\n')
        if (
          !text.startsWith('P7\n') ||
          end < 0 ||
          Number(/^WIDTH (\d+)$/mu.exec(text)?.[1]) !== width ||
          Number(/^HEIGHT (\d+)$/mu.exec(text)?.[1]) !== height ||
          Number(/^DEPTH (\d+)$/mu.exec(text)?.[1]) !== channels
        )
          throw new Error('Invalid native PAM geometry')
        headerBytes = end + 7
        nativeMaximum = Number(/^MAXVAL (\d+)$/mu.exec(text)?.[1])
      } else {
        const header = /^P6\s+(\d+)\s+(\d+)\s+(\d+)\s/u.exec(text)
        if (!header || Number(header[1]) !== width || Number(header[2]) !== height)
          throw new Error('Invalid native PPM geometry')
        headerBytes = header[0].length
        nativeMaximum = Number(header[3])
      }
      if (!Number.isInteger(nativeMaximum) || nativeMaximum < 1 || nativeMaximum > 65535)
        throw new Error('Invalid native sample range')
      const nativeSampleBytes = nativeMaximum > 255 ? 2 : 1
      const expected = new Uint8Array(width * height * channels * nativeSampleBytes)
      for (let index = 0; index < width * height * channels; index++) {
        const sample =
          sampleBytes === 1
            ? (pixels[index] ?? 0)
            : (pixels[index * 2] ?? 0) * 256 + (pixels[index * 2 + 1] ?? 0)
        const expanded = Math.round((sample * nativeMaximum) / maximum)
        if (nativeSampleBytes === 2) expected[index * 2] = expanded >>> 8
        expected[index * nativeSampleBytes + nativeSampleBytes - 1] = expanded
      }
      const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
      if (hash(output.subarray(headerBytes)) !== hash(expected))
        throw new Error('Native samples differ')
      const independent: object[] = []
      for (const oracle of ['jxl-rs', 'jxl-oxide']) {
        const numpyPath = `${path}.${oracle}.npy`
        const rust = spawnSync(
          oracle === 'jxl-rs'
            ? '.tmp/jpegxl-oracles/jxl-rs-07ab48f/target/release/jxl_cli'
            : '.tmp/jpegxl-oracles/jxl-oxide-c0cc4c7/target/release/jxl-oxide',
          oracle === 'jxl-rs'
            ? [`${path}.jxl`, numpyPath, '--num-threads', '1', '--data-type', 'f32']
            : [`${path}.jxl`, '-o', numpyPath, '-f', 'npy', '-j', '1', '--force-wide-buffers'],
          { encoding: 'utf8' },
        )
        if (rust.status !== 0) {
          independent.push({ oracle, status: 'decode-failed', error: rust.stderr })
          if (oracle === 'jxl-rs') throw new Error(`${oracle}: ${rust.stderr}`)
          continue
        }
        const numpy = await readFile(numpyPath)
        if (
          numpy.length < 10 ||
          numpy[0] !== 0x93 ||
          numpy.subarray(1, 6).toString() !== 'NUMPY' ||
          numpy[6] !== 1 ||
          numpy[7] !== 0
        )
          throw new Error(`${oracle}: expected a version-1 NumPy buffer`)
        const start = 10 + numpy.readUInt16LE(8)
        const numpyHeader = numpy.subarray(10, start).toString('ascii')
        const shape = /'shape':\s*\(([^)]*)\)/u
          .exec(numpyHeader)?.[1]
          ?.split(',')
          .map((dimension) => dimension.trim())
          .filter(Boolean)
          .map(Number)
        if (
          !/'descr':\s*'<f4'/u.test(numpyHeader) ||
          !/'fortran_order':\s*False/u.test(numpyHeader) ||
          JSON.stringify(shape) !== JSON.stringify([1, height, width, channels]) ||
          numpy.length !== start + width * height * channels * 4
        )
          throw new Error(`${oracle}: unexpected native float layout`)
        let maximumError = 0
        let mismatch: Readonly<{ index: number; expected: number; actual: number }> | undefined
        for (let index = 0; index < width * height * channels; index++) {
          const sample =
            sampleBytes === 1
              ? (pixels[index] ?? 0)
              : (pixels[index * 2] ?? 0) * 256 + (pixels[index * 2 + 1] ?? 0)
          // The pinned oxide CLI does not align its NumPy payload. Read bytes directly.
          const value = numpy.readFloatLE(start + index * 4)
          if (!Number.isFinite(value) || Math.round(value * maximum) !== sample) {
            mismatch = { index, expected: sample, actual: value * maximum }
            break
          }
          maximumError = Math.max(maximumError, Math.abs(value - sample / maximum))
        }
        if (mismatch) {
          independent.push({ oracle, status: 'sample-mismatch', ...mismatch })
          if (oracle === 'jxl-rs') throw new Error(`${oracle}: native samples differ`)
        } else {
          independent.push({
            oracle,
            status: 'exact-native-samples',
            maximumFloatNormalizationError: maximumError,
          })
        }
      }
      results.push({
        width,
        height,
        effort,
        depth,
        nativeMaximum,
        channels,
        bytes: sink.toUint8Array().length,
        pixelSha256: hash(pixels),
        exact: true,
        independent,
        groupSearchEvidence: 'groupSearchEvidence' in encoder ? encoder.groupSearchEvidence : null,
      })
      console.log(width, depth, effort, 'native exact')
    }
await writeFile(`${directory}/report.json`, JSON.stringify({ results }, null, 2) + '\n')
