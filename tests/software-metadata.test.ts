import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import codeMeta from '../codemeta.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }

const citation = readFileSync('CITATION.cff', 'utf8')
const changelog = readFileSync('CHANGELOG.md', 'utf8')

const cffValue = (key: string): string | undefined => {
  const match = citation.match(new RegExp(`^${key}: ["']?([^"'\\n]+)["']?$`, 'm'))
  return match?.[1]
}

describe('software citation metadata', () => {
  it('keeps CFF and CodeMeta on the current released package version', () => {
    const release = changelog.match(
      new RegExp(
        `^## \\[${packageJson.version.replaceAll('.', '\\.')}\\] - (\\d{4}-\\d{2}-\\d{2})$`,
        'm',
      ),
    )

    expect(release?.[1]).toBeDefined()
    expect(cffValue('cff-version')).toBe('1.2.0')
    expect(cffValue('title')).toBe('PureJsImage')
    expect(cffValue('type')).toBe('software')
    expect(cffValue('version')).toBe(packageJson.version)
    expect(cffValue('date-released')).toBe(release?.[1])
    expect(cffValue('doi')).toBe('10.5281/zenodo.22071815')
    expect(cffValue('license')).toBe(packageJson.license)
    expect(cffValue('repository-code')).toBe('https://github.com/a-r-d/PureJsImage')
    expect(cffValue('repository-artifact')).toBe(
      `https://www.npmjs.com/package/purejsimage/v/${packageJson.version}`,
    )
    expect(citation).toContain('family-names: "Decker"')
    expect(citation).toContain('given-names: "Aaron"')

    expect(codeMeta['@context']).toBe('https://w3id.org/codemeta/3.1')
    expect(codeMeta.type).toBe('SoftwareSourceCode')
    expect(codeMeta.name).toBe('PureJsImage')
    expect(codeMeta.version).toBe(packageJson.version)
    expect(codeMeta.datePublished).toBe(release?.[1])
    expect(codeMeta.license).toBe('https://spdx.org/licenses/MIT.html')
    expect(codeMeta.codeRepository).toBe('https://github.com/a-r-d/PureJsImage')
    expect(codeMeta.identifier).toBe('https://doi.org/10.5281/zenodo.22071815')
    expect(codeMeta.sameAs).toBe('https://doi.org/10.5281/zenodo.22071814')
    expect(codeMeta.citation).toBe('https://github.com/a-r-d/PureJsImage/blob/main/CITATION.cff')
    expect(codeMeta.downloadUrl).toBe(
      `https://registry.npmjs.org/purejsimage/-/purejsimage-${packageJson.version}.tgz`,
    )
    expect(codeMeta.keywords).toEqual(packageJson.keywords)
  })

  it('publishes the CodeMeta fields as SoftwareSourceCode JSON-LD', () => {
    const homePage = readFileSync('docs-astro/src/pages/index.astro', 'utf8')
    const footer = readFileSync('docs-astro/src/components/SiteFooter.astro', 'utf8')
    const readme = readFileSync('README.md', 'utf8')

    expect(homePage).toContain("import codeMeta from '../../../codemeta.json'")
    expect(homePage).toContain("'@type': codeMeta.type")
    expect(homePage).toContain('codeRepository: codeMeta.codeRepository')
    expect(homePage).toContain('identifier: codeMeta.identifier')
    expect(homePage).toContain('sameAs: codeMeta.sameAs')
    expect(homePage).not.toContain('downloadUrl: codeMeta.downloadUrl')
    expect(homePage).toContain('citation: codeMeta.citation')
    expect(homePage).toContain('keywords: codeMeta.keywords')
    expect(homePage).toContain('set:html={softwareSourceCode}')
    expect(footer).toContain('PureJsImage/blob/main/CITATION.cff')
    expect(footer).toContain('https://doi.org/10.5281/zenodo.22071814')
    expect(readme).toContain('## Citation')
    expect(readme).toContain('[`CITATION.cff`](CITATION.cff)')
    expect(readme).toContain('10.5281/zenodo.22071815')
    expect(readme).toContain('10.5281/zenodo.22071814')
  })

  it('renders visible homepage answers from the FAQPage JSON-LD source', () => {
    const homePage = readFileSync('docs-astro/src/pages/index.astro', 'utf8')

    expect(homePage).toContain("'@type': 'FAQPage'")
    expect(homePage).toContain("'@id': 'https://purejsimage.com/#faq'")
    expect(homePage).toContain("'@type': 'Question'")
    expect(homePage).toContain("'@type': 'Answer'")
    expect(homePage).toContain('mainEntity: homepageFaq.map')
    expect(homePage).toContain('{homepageFaq.map')
    expect(homePage).toContain('id="faq"')
    expect(homePage).toContain('set:html={faqPage}')
  })
})
