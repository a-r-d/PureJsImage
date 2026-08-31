import { expect, test } from '@playwright/test'

test.skip(
  process.env.PUREJSIMAGE_WRITE_HDR_OG !== '1',
  'Set PUREJSIMAGE_WRITE_HDR_OG=1 to refresh the checked HDR Surgery social image',
)

test.use({ viewport: { width: 1_200, height: 630 } })

test('captures the dedicated HDR Surgery Open Graph image', async ({ page }) => {
  await page.goto('/hdr-surgery/')
  await expect(page.locator('#hdr-status')).toContainText('software preview rendered')
  await page.addStyleTag({
    content: `
      body { overflow: hidden !important; background: #eef5f2 !important; }
      body > header, body > footer, .hdr-shell > :not(.hdr-hero):not(#interactive-workbench) { display: none !important; }
      .hdr-shell { width: 1200px !important; height: 630px !important; padding: 24px !important; margin: 0 !important; box-sizing: border-box !important; }
      .hdr-hero { margin: 0 0 18px !important; align-items: start !important; }
      .hdr-hero h1 { font-size: 46px !important; line-height: 1 !important; max-width: 19ch !important; margin: 4px 0 0 !important; }
      .hdr-lede, .hdr-local, #interactive-workbench > :not(.hdr-result) { display: none !important; }
      .hdr-result { grid-template-columns: repeat(3, 1fr) !important; gap: 14px !important; margin: 0 !important; }
      .hdr-result .hdr-view:nth-child(2) { display: none !important; }
      .hdr-view { box-shadow: 0 14px 35px rgba(18, 52, 47, .12); }
      .hdr-view-heading { min-height: 50px; box-sizing: border-box; }
      .hdr-view canvas { aspect-ratio: 16 / 9 !important; }
      #hdr-probe { display: none !important; }
    `,
  })
  await page.screenshot({
    path: 'docs-astro/public/assets/hdr-surgery-og.png',
    fullPage: false,
  })
})
