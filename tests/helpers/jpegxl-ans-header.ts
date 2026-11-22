import { JpegXlEncoderMemory } from '../../src/codecs/jpegxl-encoder-memory.ts'
import {
  JpegXlBitWriter,
  writeAnsCode,
  writeAnsPackedValues,
} from '../../src/codecs/jpegxl-modular-encode.ts'

export function verifyAnsHeaderModels() {
  const rows = []
  for (const [contexts, histograms] of [
    [1, 1],
    [17, 3],
    [257, 16],
    [5000, 16],
  ]) {
    if (contexts === undefined || histograms === undefined) throw new Error('Missing ANS shape')
    for (const shape of ['single', 'sparse', 'broad']) {
      const contextMap = Uint8Array.from({ length: contexts }, (_, index) => index % histograms)
      const frequencies = Array.from({ length: histograms }, (_, histogram) => {
        const counts = new Uint32Array(512)
        for (let symbol = 0; symbol < 256; symbol++) {
          const occupied =
            shape === 'single'
              ? symbol === histogram
              : shape === 'sparse'
                ? symbol % 17 === histogram % 17
                : true
          if (occupied) counts[symbol] = 1 + ((symbol * 19 + histogram * 13) % 311)
        }
        return counts
      })
      const config = { splitExponent: 4, msbInToken: 2, lsbInToken: 0 }
      const configs = Array.from({ length: histograms }, (_, index) =>
        index % 2 ? config : { splitExponent: 3, msbInToken: 1, lsbInToken: 1 },
      )
      const results = []
      const peaks = []
      for (const preparePayload of [true, false]) {
        const memory = new JpegXlEncoderMemory(16 * 1024 * 1024)
        try {
          results.push(
            memory.run(() => {
              const writer = new JpegXlBitWriter(memory)
              const encoding = writeAnsCode(
                writer,
                contextMap,
                frequencies,
                config,
                contexts > 1,
                configs,
                preparePayload,
              )
              const bits = writer.bitPosition
              const bytes = Array.from(writer.finish())
              const normalized = encoding.histograms.map((histogram) =>
                Array.from(histogram.frequencies),
              )
              if (!preparePayload) {
                let rejected = false
                try {
                  writeAnsPackedValues(
                    new JpegXlBitWriter(memory),
                    Uint32Array.of(0),
                    Uint16Array.of(0),
                    1,
                    encoding,
                  )
                } catch (error) {
                  if (
                    !(error instanceof Error) ||
                    !error.message.includes('ANS payload tables were not prepared')
                  )
                    throw error
                  rejected = true
                }
                if (!rejected) throw new Error('Header-only model accepted a payload')
              }
              return { bits, bytes, normalized }
            }),
          )
          if (memory.liveBytes !== 0 || memory.liveAllocations !== 0)
            throw new Error('ANS header storage leaked')
          peaks.push(memory.peakBytes)
        } finally {
          memory.close()
        }
      }
      const exact = JSON.stringify(results[0]) === JSON.stringify(results[1])
      if (!exact) throw new Error('ANS header or normalized frequency changed')
      rows.push({ contexts, histograms, shape, bits: results[0]?.bits, exact, peaks })
    }
  }
  return rows
}
