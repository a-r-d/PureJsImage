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

  const isHorizontallyScrollable = (element: HTMLElement): boolean =>
    element.scrollWidth > element.clientWidth + 1

  const syncScrollState = (element: HTMLElement, cue: HTMLElement | null) => {
    const overflow = isHorizontallyScrollable(element)
    element.classList.toggle('is-scrollable', overflow)
    const atEnd = element.scrollLeft + element.clientWidth >= element.scrollWidth - 2
    element.classList.toggle('is-at-end', overflow && atEnd)
    if (cue) cue.hidden = !overflow
  }

  const ensureTableScroller = (wrap: HTMLElement): HTMLElement => {
    const existing = wrap.querySelector<HTMLElement>(':scope > .table-wrap-scroller')
    if (existing) {
      existing.dataset.scrollRegion = existing.dataset.scrollRegion ?? 'table'
      return existing
    }
    const scroller = document.createElement('div')
    scroller.className = 'table-wrap-scroller'
    scroller.dataset.scrollRegion = 'table'
    const moving: ChildNode[] = []
    for (const child of [...wrap.childNodes]) {
      if (child instanceof HTMLElement && child.matches('[data-scroll-cue], .table-scroll-cue')) {
        continue
      }
      moving.push(child)
    }
    for (const child of moving) scroller.append(child)
    wrap.append(scroller)
    return scroller
  }

  const ensureScrollCue = (host: HTMLElement, label: string): HTMLElement => {
    const existing = host.querySelector<HTMLElement>(
      ':scope > [data-scroll-cue], :scope > .table-scroll-cue',
    )
    if (existing) return existing
    const cue = document.createElement('p')
    cue.className = 'table-scroll-cue'
    cue.dataset.scrollCue = ''
    cue.hidden = true
    cue.textContent = label
    host.prepend(cue)
    return cue
  }

  const syncChartViewports = () => {
    document.querySelectorAll<HTMLElement>('[data-chart-viewport]').forEach((viewport) => {
      const panel = viewport.closest('.benchmark-chart-panel')
      if (!(panel instanceof HTMLElement) || getComputedStyle(panel).display === 'none') return
      viewport.dataset.scrollRegion = 'chart'
      const cue = panel.querySelector<HTMLElement>('[data-chart-scroll-cue]')
      syncScrollState(viewport, cue)
    })
  }

  const syncTableRegions = () => {
    document
      .querySelectorAll<HTMLElement>('.table-wrap, .comparison-table-wrap, .wsi-table-wrap')
      .forEach((wrap) => {
        wrap.dataset.tableWrap = ''
        const cue = ensureScrollCue(wrap, 'Scroll table horizontally')
        const scroller = ensureTableScroller(wrap)
        syncScrollState(scroller, cue)
      })
  }

  const syncCodeRegions = () => {
    document.querySelectorAll<HTMLElement>('.container pre, .code-window pre').forEach((block) => {
      block.dataset.scrollRegion = 'code'
      const windowHost = block.closest('.code-window')
      const cueHost = windowHost instanceof HTMLElement ? windowHost : block
      let cue = cueHost.querySelector<HTMLElement>(':scope > [data-scroll-cue]')
      if (!cue) {
        cue = document.createElement('p')
        cue.className = 'table-scroll-cue'
        cue.dataset.scrollCue = ''
        cue.hidden = true
        cue.textContent = 'Scroll code horizontally'
        block.before(cue)
      }
      syncScrollState(block, cue)
    })
  }

  const syncChipNavs = () => {
    document.querySelectorAll<HTMLElement>('.docs-layout .side-nav').forEach((nav) => {
      nav.dataset.scrollRegion = 'chips'
      syncScrollState(nav, null)
    })
  }

  const syncTabRows = () => {
    document
      .querySelectorAll<HTMLElement>('.scientific-mode-tabs, .benchmark-chart-tabs')
      .forEach((row) => {
        row.dataset.scrollRegion = 'tabs'
        syncScrollState(row, null)
      })
  }

  const syncContainedRegions = () => {
    syncChartViewports()
    syncTableRegions()
    syncCodeRegions()
    syncChipNavs()
    syncTabRows()
  }

  document.querySelectorAll<HTMLElement>('[data-benchmark-gallery]').forEach((gallery) => {
    gallery.addEventListener('change', () => {
      window.requestAnimationFrame(syncContainedRegions)
    })
  })
  document.querySelectorAll<HTMLImageElement>('[data-chart-viewport] img').forEach((image) => {
    if (image.complete) return
    image.addEventListener('load', syncContainedRegions, { once: true })
  })
  document
    .querySelectorAll<HTMLElement>(
      '.table-wrap-scroller, .table-wrap, .comparison-table-wrap, .wsi-table-wrap, .side-nav, .scientific-mode-tabs, .benchmark-chart-tabs, .container pre, .code-window pre, [data-chart-viewport]',
    )
    .forEach((region) => {
      region.addEventListener('scroll', () => syncContainedRegions(), { passive: true })
    })
  window.addEventListener('resize', syncContainedRegions)
  syncContainedRegions()

  const desktopMatrixQuery = window.matchMedia('(min-width: 821px)')
  const syncComparisonMatrix = () => {
    document
      .querySelectorAll<HTMLDetailsElement>('.comparison-matrix-disclosure')
      .forEach((panel) => {
        if (desktopMatrixQuery.matches) panel.open = true
        else if (panel.dataset.userToggled !== 'true') panel.open = false
      })
  }
  document
    .querySelectorAll<HTMLDetailsElement>('.comparison-matrix-disclosure')
    .forEach((panel) => {
      panel.addEventListener('toggle', () => {
        if (desktopMatrixQuery.matches) return
        panel.dataset.userToggled = 'true'
      })
    })
  desktopMatrixQuery.addEventListener('change', syncComparisonMatrix)
  syncComparisonMatrix()

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
