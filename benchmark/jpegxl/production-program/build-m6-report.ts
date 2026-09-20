import { readFile, writeFile } from 'node:fs/promises'
import sources from './m6-native-sources.json' with { type: 'json' }
import functional from './m6-functional-cases.json' with { type: 'json' }
import { record, validateM6Report } from './validate-m6-report.ts'
const directory = process.argv[2] ?? '.tmp/jpegxl-m6-m10'
const output = process.argv[3] ?? 'benchmark/jpegxl/production-program/m6-report.json'
const read = async (name: string): Promise<unknown> =>
  JSON.parse(await readFile(`${directory}/${name}`, 'utf8'))
const correctness = record(await read('m6-native-correctness.json'))
const report = {
  schemaVersion: 1,
  revision: correctness.revision,
  selectionFrozenAt: sources.frozenAt,
  scope:
    'M6 only. Thirty pinned functional regression cases plus ten original-resolution photographs. The functional fixtures are not an unseen holdout.',
  functionalCases: functional.cases,
  byteMeasurement:
    'Exact ImageSource.read payload requests, including structural reads, with automatic read-ahead disabled. No HTTP headers are counted. The browser additionally exercises a real local HTTP Range server with explicit 4 KiB blocks. Every native photo remains eligible.',
  oracle: {
    revision: 'a7a9c787341cf703dede03c2009fa460cae5e5df',
    librarySha256: '29eea9f83a05f1851e18fc5f414916ca6c28e278f68622969bea68d7516ecdc5',
    method:
      'libjxl 0.12.0 progressive C API flush at completed DC/pass boundaries, intended downsampling and encoded orientation; RGB8 FROM_CODESTREAM. Compare original full-size native stage sample centers, maximum error 1 and RMSE 0.55.',
  },
  limitations: [
    'Pass/final rendering retains full output storage; internal DC dependencies may retain full working planes. Plans declare this storage and strict selection rejects it.',
    'Other sample and dependency classes use explicit static fallbacks. Managed memory is null when the fallback cannot measure it.',
    'Official conformance retains 25 expected unsupported cases and the known delta_palette failure. No broad conformance or release claim.',
    'Absolute warm RSS includes warmup; GC is forced twice before the measured run. Managed memory reduction does not imply the same RSS reduction.',
  ],
  exploration: {
    automaticReadAhead: {
      status: 'rejected',
      reason:
        'Automatic 256 KiB read-ahead defeated selective payload reads: preview median 23.98%, viewport median 90.42%. Session opening now preserves exact reads. These were uncommitted exploratory measurements, not source-pinned acceptance evidence.',
    },
    dcKernel: {
      oldFaithfulColdMilliseconds: { before: 19009.7, after: 5135.7 },
      oldFaithfulWarmMilliseconds: { before: 23106.6, after: 5304.2 },
      outputSha256: '9cdb1bb8d48915f98a74e2d38457fa3c9c54c9377ade7eb526716571a3707405',
      addedManagedScratchBytes: 300,
      provenance:
        'Exploratory pre-commit snapshots. Identical output hashes, 300 added scratch bytes; no RSS improvement claim. Final source-pinned results below determine acceptance.',
    },
  },
  regressions: {
    officialConformance: await read('m6-final-conformance.json'),
    m4Conformance: await read('m6-final-m4-conformance.json'),
    vardctMemory: await read('m6-final-vardct-memory.json'),
    staticPipelines: await read('m6-final-m5-pipelines.json'),
  },
  correctness,
  measurements: await read('m6-native-measurements.json'),
}
const gates = validateM6Report(report)
await writeFile(output, JSON.stringify({ ...report, gates }, null, 2) + '\n')
console.log(JSON.stringify(gates, null, 2))
