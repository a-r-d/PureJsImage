export interface JpegXlCorpusEntry {
  readonly id: string
  readonly source: string
  readonly license: string
  readonly sha256: string
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly bitDepth: number
  readonly colorEncoding: string
  readonly alpha: 'none' | 'straight' | 'premultiplied' | 'unknown'
  readonly coding: 'modular' | 'vardct' | 'jpeg-derived' | 'unknown'
  readonly level: 5 | 10 | 'unknown'
  readonly encoder: Readonly<{
    readonly id: string
    readonly revision: string
    readonly options: readonly string[]
  }>
  readonly container: 'raw' | 'jxlc' | 'jxlp'
  readonly preview: boolean | 'unknown'
  readonly progressive: boolean | 'unknown'
  readonly patches: boolean | 'unknown'
  readonly splines: boolean | 'unknown'
  readonly noise: boolean | 'unknown'
  readonly restorationFilters: readonly string[] | 'unknown'
  readonly extraChannels: readonly string[]
  readonly jpegReconstruction: boolean | 'unknown'
  readonly expectedPureJsImageBehavior: 'exact-decode' | 'lossy-decode' | 'unsupported'
  readonly oracleOutput: Readonly<{
    readonly oracle: string
    readonly kind: 'native-samples-sha256' | 'tolerance' | 'unsupported'
    readonly value: string
  }>
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
    bitDepth: 8,
    colorEncoding: 'embedded ICC, exact profile classification pending',
    alpha: 'none',
    coding: 'vardct',
    level: 'unknown',
    encoder: Object.freeze({
      id: 'libjxl-conformance',
      revision: conformanceCommit,
      options: Object.freeze(['source encoder options not recorded by the conformance case']),
    }),
    container: 'raw',
    preview: 'unknown',
    progressive: 'unknown',
    patches: 'unknown',
    splines: 'unknown',
    noise: 'unknown',
    restorationFilters: 'unknown',
    extraChannels: Object.freeze([]),
    jpegReconstruction: false,
    expectedPureJsImageBehavior: 'unsupported',
    oracleOutput: Object.freeze({
      oracle: 'libjxl-conformance',
      kind: 'unsupported',
      value: 'VarDCT and embedded ICC are outside the starting decoder subset',
    }),
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
    bitDepth: 12,
    colorEncoding: 'sRGB',
    alpha: 'straight',
    coding: 'modular',
    level: 'unknown',
    encoder: Object.freeze({
      id: 'libjxl-conformance',
      revision: conformanceCommit,
      options: Object.freeze(['source encoder options not recorded by the conformance case']),
    }),
    container: 'raw',
    preview: false,
    progressive: false,
    patches: false,
    splines: false,
    noise: false,
    restorationFilters: Object.freeze([]),
    extraChannels: Object.freeze(['alpha']),
    jpegReconstruction: false,
    expectedPureJsImageBehavior: 'exact-decode',
    oracleOutput: Object.freeze({
      oracle: 'official ref.png converted to native 12-bit samples',
      kind: 'native-samples-sha256',
      value: 'dcad2498d282253d5a0cc6228a557663f83e5547e196d4da472c2658a89b26b9',
    }),
    features: Object.freeze([
      'raw codestream',
      'still image',
      'possibly lossless',
      '12-bit RGB',
      'unassociated alpha',
    ]),
  }),
  Object.freeze({
    id: 'conformance-alpha-triangles',
    source: `${conformanceRaw}/testcases/alpha_triangles/input.jxl`,
    license: 'CC0, as recorded by the pinned conformance testcases README',
    sha256: '19ac7752a23ad2b22814064cb6b62a581b48be18ed73b5ccc2340888c114d2c9',
    bytes: 61,
    width: 1_024,
    height: 1_024,
    bitDepth: 9,
    colorEncoding: 'sRGB',
    alpha: 'straight',
    coding: 'modular',
    level: 'unknown',
    encoder: Object.freeze({
      id: 'libjxl-conformance',
      revision: conformanceCommit,
      options: Object.freeze(['source encoder options not recorded by the conformance case']),
    }),
    container: 'raw',
    preview: false,
    progressive: false,
    patches: false,
    splines: false,
    noise: false,
    restorationFilters: Object.freeze([]),
    extraChannels: Object.freeze(['alpha']),
    jpegReconstruction: false,
    expectedPureJsImageBehavior: 'exact-decode',
    oracleOutput: Object.freeze({
      oracle: 'official 16-bit ref.png at the declared tolerance',
      kind: 'native-samples-sha256',
      value: 'f9eee8a5b5f1e9209a1a82e590fcab10518ad4feb4cd550d4394dcc53cb35422',
    }),
    features: Object.freeze([
      'raw codestream',
      'still image',
      'lossless Modular',
      '9-bit RGB',
      'unassociated alpha',
      'adaptive MA tree',
      'nonzero residuals',
    ]),
  }),
])
