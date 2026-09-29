import { readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { hash, root } from './io.ts'

// Preserve exact manifest bytes referenced by completed reports before formatting JSON.
for (const name of ['subjects', 'fixtures']) {
  const bytes = await readFile(`${root}/${name}.json`)
  await writeFile(`${root}/results/${name}-${hash(bytes)}.json.gz`, gzipSync(bytes))
}
for (const name of await readdir(`${root}/results`)) {
  if (!/^subjects-[a-f0-9]{64}\.json$/.test(name)) continue
  const path = `${root}/results/${name}`,
    bytes = await readFile(path)
  await writeFile(`${path}.gz`, gzipSync(bytes))
  await unlink(path)
}
