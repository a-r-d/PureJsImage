import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import packageJson from '../package.json' with { type: 'json' }
import { avifCorpusRevision, avifFixtures } from '../benchmark/avif/corpus.ts'
import { workflows, workflowsForProfile } from '../benchmark/workflows.ts'

describe('package contract', () => {
  it('has no production dependencies', () => {
    expect('dependencies' in packageJson).toBe(false)
    expect('optionalDependencies' in packageJson).toBe(false)
  })

  it('keeps source, benchmark, scripts, and test code in TypeScript', () => {
    const javascriptSources = globSync([
      'benchmark/**/*.{cjs,js,jsx,mjs}',
      'scripts/**/*.{cjs,js,jsx,mjs}',
      'src/**/*.{cjs,js,jsx,mjs}',
      'tests/**/*.{cjs,js,jsx,mjs}',
    ])

    expect(javascriptSources).toEqual([])
  })

  it('does not import third-party packages from production source', () => {
    const imports = globSync('src/**/*.ts')
      .flatMap((path) => [
        ...readFileSync(path, 'utf8').matchAll(/(?:from\s+|import\()\s*['"]([^'"]+)['"]/g),
      ])
      .map((match) => match[1])
      .filter((specifier): specifier is string => specifier !== undefined)
      .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('node:'))

    expect(imports).toEqual([])
  })
})

describe('benchmark contract', () => {
  it('pins a diverse AVIF starter corpus to one upstream revision', () => {
    expect(avifCorpusRevision).toMatch(/^[a-f0-9]{40}$/)
    expect(avifFixtures).toHaveLength(25)
    expect(new Set(avifFixtures.map(({ id }) => id)).size).toBe(avifFixtures.length)
    expect(new Set(avifFixtures.map(({ expected }) => expected.bitDepth))).toEqual(
      new Set([8, 10, 12]),
    )
    expect(new Set(avifFixtures.map(({ expected }) => expected.chromaSubsampling))).toEqual(
      new Set(['400', '420', '422', '444']),
    )
    expect(avifFixtures.some(({ expected }) => expected.hasAlpha)).toBe(true)
  })

  it('keeps workflow identifiers unique', () => {
    const ids = workflows.map(({ id }) => id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps every profile populated and ordered by scope', () => {
    const smoke = workflowsForProfile('smoke')
    const standard = workflowsForProfile('standard')
    const full = workflowsForProfile('full')
    const phase4 = workflowsForProfile('phase4')
    const phase5 = workflowsForProfile('phase5')
    const bmp = workflowsForProfile('bmp')
    const webp = workflowsForProfile('webp')

    expect(smoke.length).toBeGreaterThan(0)
    expect(phase4.length).toBe(12)
    expect(phase5.length).toBe(5)
    expect(bmp.length).toBe(16)
    expect(webp.length).toBe(9)
    expect(standard.length).toBeGreaterThan(smoke.length)
    expect(full.length).toBeGreaterThan(standard.length)
    expect(full).toEqual(
      workflows.filter((workflow) => workflow.tier !== 'bmp' && workflow.tier !== 'webp'),
    )
    expect(bmp).toEqual(workflows.filter((workflow) => workflow.tier === 'bmp'))
    expect(webp).toEqual(workflows.filter((workflow) => workflow.tier === 'webp'))
  })

  it('rejects unknown profiles', () => {
    expect(() => workflowsForProfile('quick-ish')).toThrow('Unknown profile: quick-ish')
  })
})
