#!/usr/bin/env node

import { open } from 'node:fs/promises'
import { join } from 'node:path'

import { validateOmeZarr05Attributes } from '../src/scientific/formats/ome-zarr.ts'
import { createScientificPathContext } from '../src/scientific/node.ts'
import { createOmeZarrReader } from '../src/scientific/readers/ome-zarr.ts'

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const writeOutput = async (value: unknown): Promise<void> =>
  new Promise((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(value)}\n`, (error) => {
      if (error === null || error === undefined) resolve()
      else reject(error)
    })
  })

const input = process.argv.at(-1)
if (input === undefined || input === process.argv[1]) {
  await writeOutput({ valid: false, message: 'Missing conformance input path' })
} else {
  try {
    const handle = await open(input, 'r')
    let handleClosed = false
    try {
      const metadata = await handle.stat()
      if (metadata.isDirectory()) {
        await handle.close()
        handleClosed = true
        const context = await createScientificPathContext(join(input, 'zarr.json'))
        const document = await createOmeZarrReader({ metadataValidation: 'strict' }).open(context)
        if (document.datasets.length === 0)
          throw new Error('OME-Zarr hierarchy contains no datasets')
      } else {
        const parsed: unknown = JSON.parse(await handle.readFile('utf8'))
        if (!isRecord(parsed)) throw new Error('OME-Zarr attributes must be an object')
        const { _conformance: _ignored, ...attributes } = parsed
        validateOmeZarr05Attributes(attributes, 'strict')
      }
    } finally {
      if (!handleClosed) await handle.close()
    }
    await writeOutput({ valid: true })
  } catch (cause) {
    await writeOutput({
      valid: false,
      message: cause instanceof Error ? cause.message : String(cause),
    })
  }
}
