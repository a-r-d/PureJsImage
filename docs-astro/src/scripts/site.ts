const compactNavQuery = () => window.matchMedia('(max-width: 1140px)')

const setMenuOpen = (
  navigation: HTMLElement | null,
  menuButton: HTMLButtonElement | null,
  open: boolean,
) => {
  navigation?.classList.toggle('open', open)
  menuButton?.setAttribute('aria-expanded', String(open))
  menuButton?.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation')
}

const closeDisclosures = (navigation: HTMLElement | null) => {
  for (const disclosure of navigation?.querySelectorAll<HTMLDetailsElement>(
    '[data-nav-disclosure]',
  ) ?? []) {
    disclosure.open = false
  }
}

export const initializeSite = () => {
  const menuButton = document.querySelector<HTMLButtonElement>('[data-menu-toggle]')
  const navigation = document.querySelector<HTMLElement>('[data-nav]')
  const disclosures = [...document.querySelectorAll<HTMLDetailsElement>('[data-nav-disclosure]')]

  for (const disclosure of disclosures) {
    disclosure.addEventListener('toggle', () => {
      if (!disclosure.open || compactNavQuery().matches) return
      for (const other of disclosures) {
        if (other !== disclosure) other.open = false
      }
    })
  }

  const closeMobileMenu = () => setMenuOpen(navigation, menuButton, false)

  menuButton?.addEventListener('click', () => {
    const open = !navigation?.classList.contains('open')
    setMenuOpen(navigation, menuButton, open)
    if (open) {
      for (const disclosure of disclosures) disclosure.open = true
    }
  })

  navigation?.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || event.target.closest('a') === null) return
    closeMobileMenu()
    closeDisclosures(navigation)
  })

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    if (navigation?.classList.contains('open')) {
      closeMobileMenu()
      menuButton?.focus()
      return
    }
    const openDisclosure = disclosures.find((disclosure) => disclosure.open)
    if (!openDisclosure) return
    openDisclosure.open = false
    openDisclosure.querySelector('summary')?.focus()
  })

  document.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof Node)) return
    if (menuButton?.contains(event.target) || navigation?.contains(event.target)) return
    closeMobileMenu()
    closeDisclosures(navigation)
  })

  compactNavQuery().addEventListener('change', () => {
    closeMobileMenu()
    closeDisclosures(navigation)
  })

  const header = document.querySelector<HTMLElement>('.site-header')
  const updateHeader = () => header?.classList.toggle('scrolled', window.scrollY > 6)
  updateHeader()
  window.addEventListener('scroll', updateHeader, { passive: true })

  const syncChartViewports = () => {
    document.querySelectorAll<HTMLElement>('[data-chart-viewport]').forEach((viewport) => {
      const panel = viewport.closest('.benchmark-chart-panel')
      if (!(panel instanceof HTMLElement) || getComputedStyle(panel).display === 'none') return
      const overflow = viewport.scrollWidth > viewport.clientWidth + 1
      viewport.classList.toggle('is-scrollable', overflow)
      const cue = panel.querySelector<HTMLElement>('[data-chart-scroll-cue]')
      if (cue) cue.hidden = !overflow
    })
  }
  document.querySelectorAll<HTMLElement>('[data-benchmark-gallery]').forEach((gallery) => {
    gallery.addEventListener('change', () => {
      window.requestAnimationFrame(syncChartViewports)
    })
  })
  document.querySelectorAll<HTMLImageElement>('[data-chart-viewport] img').forEach((image) => {
    if (image.complete) return
    image.addEventListener('load', syncChartViewports, { once: true })
  })
  window.addEventListener('resize', syncChartViewports)
  syncChartViewports()

  document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const targetId = button.getAttribute('data-copy')
      const target = targetId ? document.getElementById(targetId) : null
      const text = target?.textContent?.trim()
      if (!text) return
      try {
        await navigator.clipboard.writeText(text)
        const previous = button.textContent
        button.textContent = 'Copied'
        window.setTimeout(() => {
          button.textContent = previous
        }, 1400)
      } catch {
        const selection = window.getSelection()
        if (selection && target) {
          const range = document.createRange()
          range.selectNodeContents(target)
          selection.removeAllRanges()
          selection.addRange(range)
        }
      }
    })
  })

  const search = document.querySelector<HTMLInputElement>('[data-doc-search]')
  const searchableItems = [...document.querySelectorAll<HTMLElement>('[data-search-item]')]
  const empty = document.querySelector<HTMLElement>('[data-search-empty]')
  search?.addEventListener('input', () => {
    const query = search.value.toLowerCase().trim()
    let visible = 0
    searchableItems.forEach((item) => {
      const matches = !query || (item.textContent ?? '').toLowerCase().includes(query)
      item.hidden = !matches
      if (matches) visible += 1
    })
    empty?.classList.toggle('visible', visible === 0)
  })

  const headings = [...document.querySelectorAll<HTMLElement>('.content section[id]')]
  const tocLinks = [...document.querySelectorAll<HTMLAnchorElement>('.toc a')]
  if (headings.length > 0 && tocLinks.length > 0) {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0]
        if (!visible) return
        tocLinks.forEach((link) => {
          link.classList.toggle('active', link.getAttribute('href') === `#${visible.target.id}`)
        })
      },
      { rootMargin: '-18% 0px -70% 0px', threshold: 0 },
    )
    headings.forEach((heading) => {
      observer.observe(heading)
    })
  }

  document.querySelectorAll<HTMLElement>('[data-year]').forEach((node) => {
    node.textContent = String(new Date().getFullYear())
  })
}
