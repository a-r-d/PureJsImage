import { createImageLibrary } from '../../../src/browser.ts'
import { allCodecs } from '../../../src/codec-entries/all.ts'
import {
  createEvidenceSession,
  explainImage,
  instrumentImageSource,
} from '../../../src/evidence.ts'
import { BlobSource, drainSourceEvidenceDependencies } from '../../../src/source.ts'
import { HttpRangeSource } from '../../../src/sources/http-range.ts'
import { createOmeZarrHttpContext } from '../../../src/scientific/ome-zarr-http.ts'
import { omeZarrReader } from '../../../src/scientific/readers/ome-zarr.ts'
import { ScientificReaderRegistry } from '../../../src/scientific/reader.ts'
import type { XrayRequest, XrayResponse } from './xray-types.ts'

const images = createImageLibrary(allCodecs)
const post = (message: XrayResponse): void => self.postMessage(message)
let activeAbort: AbortController | undefined

self.addEventListener('message', (event: MessageEvent<XrayRequest>) => {
  const request = event.data
  if (request.type === 'cancel') {
    activeAbort?.abort(new DOMException('Raster inspection cancelled', 'AbortError'))
    return
  }
  activeAbort?.abort(new DOMException('Superseded by a newer inspection', 'AbortError'))
  const abort = new AbortController()
  activeAbort = abort
  void (async () => {
    const session = createEvidenceSession({
      mode: 'trace',
      limits: { maxEvents: 2_000, maxSerializedBytes: 512 * 1_024, maxSourceRanges: 1_000 },
    })
    const unsubscribe = session.subscribe((evidenceEvent) => {
      post({ type: 'event', event: evidenceEvent })
    })
    try {
      if (request.type === 'open-ome-zarr') {
        const context = await createOmeZarrHttpContext(request.url, {
          evidence: session.context.child('ome-zarr-store'),
          signal: abort.signal,
        })
        try {
          const document = await new ScientificReaderRegistry([omeZarrReader]).open(context)
          const summary = document.datasets[0]
          if (summary === undefined) throw new Error('OME-Zarr store contains no image dataset')
          const dataset = await document.openDataset(summary.id, { signal: abort.signal })
          const horizontal = dataset.descriptor.axes.find((axis) => axis.id === 'x')
          const vertical = dataset.descriptor.axes.find((axis) => axis.id === 'y')
          if (horizontal === undefined || vertical === undefined) {
            throw new Error('OME-Zarr dataset does not expose x and y display axes')
          }
          const fixedIndices = dataset.descriptor.axes
            .filter((axis) => axis.id !== horizontal.id && axis.id !== vertical.id)
            .map((axis) => Object.freeze({ axisId: axis.id, index: 0 }))
          const width = Math.min(horizontal.length, 128)
          const height = Math.min(vertical.length, 128)
          for await (const block of dataset.readPlane({
            displayAxes: [horizontal.id, vertical.id],
            fixedIndices,
            resolutionLevel: 0,
            x: 0,
            y: 0,
            width,
            height,
            signal: abort.signal,
          })) {
            block.release?.()
            break
          }
          await document.close?.()
          context.store.close()
          unsubscribe()
          const report = session.finalize()
          post({
            type: 'report',
            source: { kind: 'remote', size: context.primary.source.size },
            metadata: {
              format: document.format,
              width: horizontal.length,
              height: vertical.length,
            },
            plan: Object.freeze({
              kind: 'scientific-tile',
              reader: `${document.reader.id}@${document.reader.version}`,
              datasetId: summary.id,
              displayAxes: Object.freeze([horizontal.id, vertical.id] as const),
              fixedIndices: Object.freeze(fixedIndices),
              resolutionLevel: 0,
              requestedRegion: Object.freeze({ x: 0, y: 0, width, height }),
              precision: 'native',
              workingMemory: 'bounded-blocks-and-chunks',
            }),
            report,
            decodedPreviewTile: true,
          })
          return
        } finally {
          context.store.close()
        }
      }
      const source =
        request.type === 'open-local'
          ? new BlobSource(request.file)
          : await HttpRangeSource.open(request.url, {
              evidence: session.context,
              openSignal: abort.signal,
              lifetimeSignal: abort.signal,
            })
      const instrumented = instrumentImageSource(source, session.context.child('source'))
      const image = await images.open(instrumented, { signal: abort.signal })
      const metadata = await image.metadata({ signal: abort.signal })
      const metadataDependencies = instrumented[drainSourceEvidenceDependencies]?.() ?? []
      session.context.dependency({
        outputId: 'metadata-block:0',
        inputIds: metadataDependencies,
        granularity: 'block',
      })
      const plan = await explainImage(image.png(), { signal: abort.signal })
      const planDependencies = instrumented[drainSourceEvidenceDependencies]?.() ?? []
      session.context.dependency({
        outputId: 'plan-block:0',
        inputIds: Object.freeze(['metadata-block:0', ...planDependencies]),
        granularity: 'block',
      })
      if (source instanceof HttpRangeSource) source.clearCache()
      unsubscribe()
      const report = session.finalize()
      post({
        type: 'report',
        source: { kind: request.type === 'open-local' ? 'local' : 'remote', size: source.size },
        metadata: {
          format: metadata.format,
          width: metadata.width,
          height: metadata.height,
          ...(metadata.bitDepth === undefined ? {} : { bitDepth: metadata.bitDepth }),
        },
        plan,
        report,
        decodedPreviewTile: false,
      })
    } catch (cause) {
      unsubscribe()
      try {
        session.finalize(
          cause instanceof DOMException && cause.name === 'AbortError' ? 'cancelled' : 'failed',
        )
      } catch {
        /* Keep the original error. */
      }
      post({ type: 'error', message: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      if (activeAbort === abort) activeAbort = undefined
    }
  })()
})
