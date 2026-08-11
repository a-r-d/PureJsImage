export interface JpegXlCorpusEntry {
  readonly id: string
  readonly source: string
  readonly license: string
  readonly sha256: string
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly features: readonly string[]
}

const conformanceCommit = '4bf053529c7cefd2951be453475bb3dccc7e7be8'
const conformanceRaw = `https://raw.githubusercontent.com/libjxl/conformance/${conformanceCommit}`

export const jpegXlConformanceCommit = conformanceCommit

export const jpegXlCorpus: readonly JpegXlCorpusEntry[] = Object.freeze([
  Object.freeze({
    id: 'conformance-grayscale',
    source: `${conformanceRaw}/testcases/grayscale/input.jxl`,
    license: 'CC0, as recorded by the pinned conformance testcases README',
    sha256: '78fbbba852e99946d187dcf0bcbd7fb0e7c22be2f0852523aaae6ed91e7e3c39',
    bytes: 1_069,
    width: 200,
    height: 200,
    features: Object.freeze(['raw codestream', 'still image', 'lossy', '8-bit grayscale', 'ICC']),
  }),
  Object.freeze({
    id: 'conformance-alpha-nonpremultiplied',
    source: `${conformanceRaw}/testcases/alpha_nonpremultiplied/input.jxl`,
    license: 'CC0, as recorded by the pinned conformance testcases README',
    sha256: '15acbe3edbfd5a75c7609726ae60526ffc812642b5dd6be8475f0b990ce9b1db',
    bytes: 30,
    width: 1_024,
    height: 1_024,
    features: Object.freeze([
      'raw codestream',
      'still image',
      'possibly lossless',
      '12-bit RGB',
      'unassociated alpha',
    ]),
  }),
])
