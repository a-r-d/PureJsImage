# Operation provider authoring

Providers are trusted, explicitly registered executable implementations of versioned operation
semantics. They are not descriptors, plugins discovered from package imports, or a sandbox.

## Author checklist

- Use a dotted lowercase namespace. Each segment begins with `a-z`; later characters are lowercase
  ASCII, digits, or hyphens. IDs are bounded and validated by the shared linear parser.
- Match the exact operation ID and version. Decline at plan time unless every valid tile/shape
  covered by the planned node is supported.
- `supportsPlan()` and `estimatePlan()` may inspect only JSON-safe descriptors, normalized
  parameters, and `inputCharacteristics`. They never receive values or placeholder objects.
- Use `validateExecution()` for actual typed-array, sample, component, layout, stride, device, or
  handle requirements before compute.
- Preserve the reference operation's no-data, calibration, boundary, cancellation, result, and
  numerical-tolerance semantics. Acceleration does not authorize a semantic shortcut.
- Return exclusively owned outputs. Reuse one `ownershipIdentity` object for wrappers/views that
  alias the same allocation, WASM memory range, GPU buffer, or remote handle. Never claim input
  storage as an output.
- Make output and provider cleanup idempotent. Prepared providers release in reverse preparation
  order after active result leases drain; cleanup may be asynchronous.
- Check `AbortSignal` before setup, between bounded chunks, and before publishing output. Release
  partial outputs when aborted.
- Report setup, transfer, compute, readback, retained, output, peak-working, and transfer bytes with
  a measured confidence. Include output in peak working. Report WASM growth and WebGPU staging,
  upload, device, and readback separately where the contract exposes them.
- Change `implementationVersion` or `buildFingerprint` for implementation changes. Change the
  operation version when semantics change.
- Differentially test the strict TypeScript reference. Bit-exact providers need exact canonical
  vectors; tolerance-based providers need boundary, invalid/no-data, layout, cancellation, and
  tolerance vectors.
- Keep the public entry browser-portable. Node built-ins stay behind Node-only adapters.
- Assume a future Worker RPC host: descriptors and characteristics must remain JSON-safe; values and
  ownership need explicit transfer handles. The current in-process API grants full application
  authority and is not isolation.

## One operation, two implementations

The example below registers one semantic operation and two providers. The accelerator is
deliberately WASM-shaped—it requires `Float32Array`, accounts transfer, and owns a mock memory
handle—but performs no hidden WASM loading. This proves selection and ownership without claiming an
accelerator exists.

```ts
import {
  createOperationDefinition,
  createOperationProvider,
} from 'purejsimage/operations'
import type { OperationJsonValue } from 'purejsimage/operations'

const float32Input = (value: unknown): Float32Array => {
  if (!(value instanceof Float32Array)) throw new TypeError('Expected Float32Array')
  return value
}

const factorParameter = (value: OperationJsonValue): number => {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !('factor' in value)) {
    throw new TypeError('Expected normalized factor parameter')
  }
  const factor = value.factor
  if (typeof factor !== 'number' || !Number.isFinite(factor)) throw new TypeError('Invalid factor')
  return factor
}

const operation = createOperationDefinition({
  descriptor: {
    id: 'example.analysis.scale-vector',
    version: 1,
    title: 'Scale vector',
    category: 'example',
    tags: ['vector'],
    inputs: [{ name: 'values', valueType: { id: 'example.data.float-vector', version: 1 } }],
    outputs: [{ name: 'values', valueType: { id: 'example.data.float-vector', version: 1 } }],
    parameters: {
      type: 'object',
      properties: { factor: { type: 'number', finiteOnly: true, default: 1 } },
      closed: true,
    },
    execution: 'tile-local',
    reproducibility: { class: 'tolerance-based', absolute: 1e-6, relative: 1e-6 },
  },
})

const reference = createOperationProvider({
  descriptor: {
    id: 'example.provider.typescript-reference', version: 1, kind: 'reference',
    buildFingerprint: 'typescript-reference-1',
  },
  prepare: async () => [{
    descriptor: {
      operationId: operation.descriptor.id, operationVersion: 1, implementationVersion: '1.0.0',
    },
    supportsPlan: () => true,
    estimatePlan: () => ({
      setupMilliseconds: 0, transferMilliseconds: 0, computeMilliseconds: 1,
      readbackMilliseconds: 0, retainedBytes: 4096, peakWorkingBytes: 4096,
      transferBytes: 0, outputBytes: 4096, confidence: 0.8,
    }),
    validateExecution: ({ inputs }) => { float32Input(inputs[0]) },
    execute: async ({ inputs, parameters, signal }) => {
      signal.throwIfAborted()
      const input = float32Input(inputs[0])
      const factor = factorParameter(parameters)
      const output = new Float32Array(input.length)
      for (let i = 0; i < input.length; i += 1) output[i] = input[i] * factor
      return [{ value: output, ownershipIdentity: output.buffer, release() {} }]
    },
  }],
})

const wasmShapedMock = createOperationProvider({
  descriptor: {
    id: 'example.provider.wasm-mock', version: 1, kind: 'wasm',
    buildFingerprint: 'wasm-mock-1',
  },
  prepare: async () => {
    const mockInstance = Object.freeze({ kind: 'mock-wasm-instance' })
    let disposed = false
    return {
      implementations: [{
        descriptor: {
          operationId: operation.descriptor.id, operationVersion: 1,
          implementationVersion: 'mock-1.0.0',
        },
        supportsPlan: ({ inputCharacteristics }) => {
          const input = inputCharacteristics[0]
          return input !== null && typeof input === 'object' && !Array.isArray(input) &&
            input.sampleType === 'float32' && input.layout === 'contiguous'
        },
        estimatePlan: () => ({
          setupMilliseconds: 0.2, transferMilliseconds: 0.1, computeMilliseconds: 0.2,
          readbackMilliseconds: 0.1, retainedBytes: 4096, peakWorkingBytes: 8192,
          transferBytes: 8192, outputBytes: 4096, confidence: 0.6,
        }),
        validateExecution: ({ inputs }) => {
          if (disposed) throw new Error('Mock instance is disposed')
          float32Input(inputs[0])
        },
        execute: async ({ inputs, parameters, signal }) => {
          signal.throwIfAborted()
          const input = float32Input(inputs[0])
          const factor = factorParameter(parameters)
          const output = new Float32Array(input.length)
          for (let i = 0; i < input.length; i += 1) output[i] = input[i] * factor
          const allocation = Object.freeze({ instance: mockInstance, buffer: output.buffer })
          return [{ value: output, ownershipIdentity: allocation, release() {} }]
        },
      }],
      async dispose() { disposed = true },
    }
  },
})
```

The application registers both explicitly. Automatic policy chooses from measured compatible
candidates; it does not rank `wasm` above `reference`. A pinned mock that declines fails rather than
switching. Real WASM must define memory growth/range ownership and copy/transfer accounting; real
WebGPU must additionally define device-loss, buffer mapping, staging, and readback ownership.

See the executable strict TypeScript dataset example in
[`examples/analysis-trusted-extension/index.ts`](../../examples/analysis-trusted-extension/index.ts).
