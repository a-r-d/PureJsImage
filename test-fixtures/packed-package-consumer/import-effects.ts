let fetchCalls = 0
let workerConstructions = 0
let intervalCalls = 0

const originalFetch = globalThis.fetch
const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
const originalSetInterval = globalThis.setInterval
const globalsBefore = new Set(Reflect.ownKeys(globalThis))

Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  value: async (): Promise<Response> => {
    fetchCalls += 1
    throw new Error('Package import attempted network activity')
  },
})
Object.defineProperty(globalThis, 'Worker', {
  configurable: true,
  value: class ImportActivityWorker {
    constructor() {
      workerConstructions += 1
      throw new Error('Package import attempted to construct a Worker')
    }
  },
})
Object.defineProperty(globalThis, 'setInterval', {
  configurable: true,
  value: (...arguments_: Parameters<typeof setInterval>): ReturnType<typeof setInterval> => {
    intervalCalls += 1
    return originalSetInterval(...arguments_)
  },
})

await Promise.all([
  import('purejsimage'),
  import('purejsimage/browser'),
  import('purejsimage/scientific'),
  import('purejsimage/scientific/node'),
  import('purejsimage/operations'),
  import('purejsimage/analysis'),
  import('purejsimage/extensions'),
  import('purejsimage/sources/http-range'),
])

if (fetchCalls !== 0) throw new Error(`Package imports made ${fetchCalls} fetch calls`)
if (workerConstructions !== 0) {
  throw new Error(`Package imports constructed ${workerConstructions} Workers`)
}
if (intervalCalls !== 0) throw new Error(`Package imports started ${intervalCalls} intervals`)

const addedGlobals = Reflect.ownKeys(globalThis).filter(
  (key) => !globalsBefore.has(key) && typeof key === 'string' && /purejsimage/iu.test(key),
)
if (addedGlobals.length !== 0) {
  throw new Error(`Package imports installed globals: ${addedGlobals.join(', ')}`)
}

Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch })
if (originalWorker === undefined) Reflect.deleteProperty(globalThis, 'Worker')
else Object.defineProperty(globalThis, 'Worker', originalWorker)
Object.defineProperty(globalThis, 'setInterval', {
  configurable: true,
  value: originalSetInterval,
})

console.log('Packed imports are inert')
