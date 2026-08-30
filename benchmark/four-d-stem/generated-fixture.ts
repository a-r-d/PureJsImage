const encoder = new TextEncoder()

export interface GeneratedFourDStemFixtureManifest {
  readonly schemaVersion: 1
  readonly id: 'purejsimage-generated-4d-stem-mib-v1'
  readonly license: 'CC0-1.0'
  readonly format: 'Quantum Detectors Merlin MIB with HDR sidecar'
  readonly sampleType: 'uint16'
  readonly scanShape: readonly [scanX: number, scanY: number]
  readonly detectorShape: readonly [detectorX: number, detectorY: number]
  readonly structure: readonly string[]
}

export interface GeneratedFourDStemFixture {
  readonly mib: Uint8Array<ArrayBuffer>
  readonly hdr: Uint8Array<ArrayBuffer>
  readonly manifest: GeneratedFourDStemFixtureManifest
  valueAt(scanX: number, scanY: number, detectorX: number, detectorY: number): number
}

const scanWidth = 7
const scanHeight = 5
const detectorWidth = 17
const detectorHeight = 15
const headerBytes = 384
const sampleBytes = 2

const squared = (value: number): number => value * value

/** Deterministic counts with a central beam, two displaced disks, and an annular specimen signal. */
export const generatedFourDStemValueAt = (
  scanX: number,
  scanY: number,
  detectorX: number,
  detectorY: number,
): number => {
  const centerX = 8 + (scanX >= 4 ? 1 : 0)
  const centerY = 7 + (scanY >= 3 ? -1 : 0)
  const radiusSquared = squared(detectorX - centerX) + squared(detectorY - centerY)
  const region = scanX >= 4 ? 2 : 1
  const centralBeam = radiusSquared <= 1 ? 4_000 + scanX * 37 + scanY * 53 : 0
  const brightDisk =
    squared(detectorX - (4 + region)) + squared(detectorY - (4 + (scanY & 1))) <= 2
      ? 700 * region
      : 0
  const oppositeDisk =
    squared(detectorX - (12 - region)) + squared(detectorY - (10 - (scanY & 1))) <= 2
      ? 450 * (3 - region)
      : 0
  const annulus = radiusSquared >= 16 && radiusSquared <= 30 ? 45 * region + scanY * 9 : 0
  return 3 + centralBeam + brightDisk + oppositeDisk + annulus
}

const frameHeader = (frame: number): Uint8Array<ArrayBuffer> => {
  const text = `MQ1,${frame + 1},384,1,${detectorWidth},${detectorHeight},U16,1x1,2026-01-01T00:00:00Z,100ns,0,0`
  const output = new Uint8Array(headerBytes)
  output.fill(0x20)
  output.set(encoder.encode(text))
  return output
}

export const createGeneratedFourDStemFixture = (): GeneratedFourDStemFixture => {
  const framePixels = detectorWidth * detectorHeight
  const recordBytes = headerBytes + framePixels * sampleBytes
  const frameCount = scanWidth * scanHeight
  const mib = new Uint8Array(recordBytes * frameCount)
  const view = new DataView(mib.buffer)
  for (let scanY = 0; scanY < scanHeight; scanY += 1) {
    for (let scanX = 0; scanX < scanWidth; scanX += 1) {
      const frame = scanY * scanWidth + scanX
      const recordOffset = frame * recordBytes
      mib.set(frameHeader(frame), recordOffset)
      for (let detectorY = 0; detectorY < detectorHeight; detectorY += 1) {
        const storedY = detectorHeight - 1 - detectorY
        for (let detectorX = 0; detectorX < detectorWidth; detectorX += 1) {
          const value = generatedFourDStemValueAt(scanX, scanY, detectorX, detectorY)
          view.setUint16(
            recordOffset + headerBytes + (storedY * detectorWidth + detectorX) * sampleBytes,
            value,
            false,
          )
        }
      }
    }
  }
  const hdr = encoder.encode(
    `HDR\nFrames per Trigger (Number):\t${scanWidth}\nFrames in Acquisition (Number):\t${frameCount}\nEnd\t\n`,
  )
  const manifest: GeneratedFourDStemFixtureManifest = Object.freeze({
    schemaVersion: 1,
    id: 'purejsimage-generated-4d-stem-mib-v1',
    license: 'CC0-1.0',
    format: 'Quantum Detectors Merlin MIB with HDR sidecar',
    sampleType: 'uint16',
    scanShape: Object.freeze([scanWidth, scanHeight] as const),
    detectorShape: Object.freeze([detectorWidth, detectorHeight] as const),
    structure: Object.freeze([
      'bright central beam',
      'scan-dependent beam displacement',
      'two specimen regions',
      'opposed diffraction disks',
      'nontrivial annular signal',
    ]),
  })
  return Object.freeze({ mib, hdr, manifest, valueAt: generatedFourDStemValueAt })
}
