/** Browser substitute for the two Node URL helpers used by vtk.js XML support. */
export const domainToASCII = (domain: string): string => {
  try {
    return new URL(`http://${domain}`).hostname
  } catch {
    return domain
  }
}

export const domainToUnicode = (domain: string): string => domain

export default Object.freeze({ domainToASCII, domainToUnicode })
