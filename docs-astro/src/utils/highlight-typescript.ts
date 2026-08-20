const escapeCode = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const typescriptToken =
  /(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(?<string>'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)|(?<keyword>\b(?:as|async|await|break|case|catch|class|const|constructor|continue|default|do|else|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|of|private|protected|public|readonly|return|set|static|switch|throw|try|type|typeof|undefined|while|yield)\b)|(?<number>\b\d[\d_]*(?:\.\d+)?\b)|(?<method>\b[A-Za-z_$][\w$]*(?=\s*\())/gu

export const highlightTypeScript = (source: string): string => {
  let highlighted = ''
  let offset = 0
  for (const match of source.matchAll(typescriptToken)) {
    const index = match.index
    highlighted += escapeCode(source.slice(offset, index))
    const className =
      match.groups?.comment !== undefined
        ? 'tok-comment'
        : match.groups?.string !== undefined
          ? 'tok-string'
          : match.groups?.number !== undefined
            ? 'tok-number'
            : match.groups?.method !== undefined
              ? 'tok-method'
              : 'tok-key'
    highlighted += `<span class="${className}">${escapeCode(match[0])}</span>`
    offset = index + match[0].length
  }
  return highlighted + escapeCode(source.slice(offset))
}
