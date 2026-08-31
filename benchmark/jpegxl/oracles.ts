export type JpegXlOracleRole =
  | 'standard'
  | 'fixture-source'
  | 'inspect'
  | 'decode'
  | 'encode'
  | 'jpeg-transcode'
  | 'benchmark'
  | 'browser-fixture'

export interface JpegXlOracle {
  readonly id: string
  readonly source: string
  readonly revision: string
  readonly license: string
  readonly roles: readonly JpegXlOracleRole[]
  readonly commands: readonly string[]
}

const roles = Object.freeze({
  standard: Object.freeze(['standard'] satisfies JpegXlOracleRole[]),
  libjxl: Object.freeze([
    'inspect',
    'decode',
    'encode',
    'jpeg-transcode',
    'benchmark',
  ] satisfies JpegXlOracleRole[]),
  fixture: Object.freeze(['fixture-source'] satisfies JpegXlOracleRole[]),
  losslessEncoder: Object.freeze(['encode', 'fixture-source'] satisfies JpegXlOracleRole[]),
  decoder: Object.freeze(['decode'] satisfies JpegXlOracleRole[]),
  inspectDecoder: Object.freeze(['inspect', 'decode'] satisfies JpegXlOracleRole[]),
  transcode: Object.freeze(['jpeg-transcode'] satisfies JpegXlOracleRole[]),
  browser: Object.freeze(['browser-fixture'] satisfies JpegXlOracleRole[]),
})

export const jpegXlOracles: readonly JpegXlOracle[] = Object.freeze([
  Object.freeze({
    id: 'iso-18181-1',
    source: 'https://www.iso.org/standard/85066.html',
    revision: 'ISO/IEC 18181-1:2024',
    license: 'ISO standard; not redistributed by this repository',
    roles: roles.standard,
    commands: Object.freeze([]),
  }),
  Object.freeze({
    id: 'iso-18181-2',
    source: 'https://www.iso.org/standard/91379.html',
    revision: 'ISO/IEC 18181-2:2026',
    license: 'ISO standard; not redistributed by this repository',
    roles: roles.standard,
    commands: Object.freeze([]),
  }),
  Object.freeze({
    id: 'iso-18181-3',
    source: 'https://www.iso.org/standard/87633.html',
    revision: 'ISO/IEC 18181-3:2025',
    license: 'ISO standard; not redistributed by this repository',
    roles: roles.standard,
    commands: Object.freeze([]),
  }),
  Object.freeze({
    id: 'libjxl-0.12.0',
    source: 'https://github.com/libjxl/libjxl',
    revision: 'a7a9c787341cf703dede03c2009fa460cae5e5df',
    license: 'BSD-3-Clause',
    roles: roles.libjxl,
    commands: Object.freeze(['cjxl', 'djxl', 'jxlinfo', 'benchmark_xl']),
  }),
  Object.freeze({
    id: 'libjxl-conformance',
    source: 'https://github.com/libjxl/conformance',
    revision: '4bf053529c7cefd2951be453475bb3dccc7e7be8',
    license: 'Per-test license recorded by the pinned repository',
    roles: roles.fixture,
    commands: Object.freeze([]),
  }),
  Object.freeze({
    id: 'simple-lossless-encoder',
    source: 'https://github.com/libjxl/simple-lossless-encoder',
    revision: '7b9f14fd0ef1f4cb7e52e58ba5a222570937ddbf',
    license: 'BSD-3-Clause',
    roles: roles.losslessEncoder,
    commands: Object.freeze(['simple-lossless-encoder']),
  }),
  Object.freeze({
    id: 'jxl-rs',
    source: 'https://github.com/libjxl/jxl-rs',
    revision: '07ab48fcccde0a73c384b4011520fec67e5e09cd',
    license: 'MIT OR Apache-2.0',
    roles: roles.decoder,
    commands: Object.freeze(['jxl-dec']),
  }),
  Object.freeze({
    id: 'jxl-oxide',
    source: 'https://github.com/tirr-c/jxl-oxide',
    revision: 'c0cc4c7ea57c1207f38ff2970d94757470613be4',
    license: 'MIT OR Apache-2.0',
    roles: roles.inspectDecoder,
    commands: Object.freeze(['jxl-oxide']),
  }),
  Object.freeze({
    id: 'imazen-jxl-encoder-0.3.1',
    source: 'https://github.com/imazen/jxl-encoder',
    revision: 'd63e9d1a1aa84b2dbdfc90eeddccc33fef5eb48b',
    license: 'AGPL-3.0-or-later or commercial; development oracle only',
    roles: roles.losslessEncoder,
    commands: Object.freeze(['cjxl-rs']),
  }),
  Object.freeze({
    id: 'jxltran',
    source: 'https://github.com/libjxl/jxltran',
    revision: '5d7ae715e9e83014cbf88ab5c6f6985ece2715c1',
    license: 'BSD-3-Clause',
    roles: roles.transcode,
    commands: Object.freeze(['jxltran']),
  }),
  Object.freeze({
    id: 'web-platform-tests',
    source: 'https://github.com/web-platform-tests/wpt',
    revision: '7e755825e0b5c6f631cb862afd5fc451e6825441',
    license: 'WPT repository license and per-file licenses',
    roles: roles.browser,
    commands: Object.freeze([]),
  }),
])
