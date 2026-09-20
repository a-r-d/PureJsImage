import downloads from './production-program/m7-expansion-downloads.json' with { type: 'json' }

export function m7ExpansionSplit(value: unknown): 'development' | 'holdout' {
  if (value === undefined) return 'development'
  if (value !== 'development' && value !== 'holdout') throw new Error('Invalid M7 expansion split')
  return value
}

export function m7ExpansionCases(split: 'development' | 'holdout', format: 'hdr' | 'png') {
  return downloads.cases.filter((entry) => entry.split === split && entry.format === format)
}
