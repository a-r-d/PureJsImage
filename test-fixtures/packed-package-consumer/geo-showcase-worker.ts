import { runGeoConsumerProof } from './geo-showcase.js'

self.addEventListener('message', () => {
  void runGeoConsumerProof().then(
    (report) => self.postMessage({ kind: 'complete', report }),
    (error: unknown) =>
      self.postMessage({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      }),
  )
})
