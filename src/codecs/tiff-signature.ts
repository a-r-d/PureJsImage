export const isTiff = (header: Uint8Array): boolean =>
  (header[0] === 0x49 &&
    header[1] === 0x49 &&
    ((header[2] === 0x2a && header[3] === 0) || (header[2] === 0x2b && header[3] === 0))) ||
  (header[0] === 0x4d &&
    header[1] === 0x4d &&
    ((header[2] === 0 && header[3] === 0x2a) || (header[2] === 0 && header[3] === 0x2b)))
