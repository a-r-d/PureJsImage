import react from '@astrojs/react'
import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://purejsimage.com',
  integrations: [react()],
  output: 'static',
  outDir: '../benchmark/.tmp/docs-site',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
})
