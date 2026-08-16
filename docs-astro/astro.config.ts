import react from '@astrojs/react'
import sitemap from '@astrojs/sitemap'
import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://purejsimage.com',
  integrations: [react(), sitemap()],
  output: 'static',
  outDir: '../benchmark/.tmp/docs-site',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
})
