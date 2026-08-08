;(() => {
  const root = document.documentElement
  const themeButton = document.querySelector('[data-theme-toggle]')
  const menuButton = document.querySelector('[data-menu-toggle]')
  const nav = document.querySelector('[data-nav]')
  const savedTheme = localStorage.getItem('purejsimage-theme')
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches

  const setTheme = (theme) => {
    root.dataset.theme = theme
    if (themeButton) {
      themeButton.setAttribute('aria-label', `Use ${theme === 'dark' ? 'light' : 'dark'} theme`)
      themeButton.innerHTML =
        theme === 'dark'
          ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/></svg>'
          : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8a8.5 8.5 0 1 0 11.3 11.3Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.8"/></svg>'
    }
  }

  setTheme(savedTheme || (systemDark ? 'dark' : 'light'))

  themeButton?.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem('purejsimage-theme', next)
    setTheme(next)
  })

  menuButton?.addEventListener('click', () => {
    const open = nav?.classList.toggle('open') ?? false
    menuButton.setAttribute('aria-expanded', String(open))
  })

  nav?.addEventListener('click', (event) => {
    if (event.target instanceof HTMLAnchorElement) {
      nav.classList.remove('open')
      menuButton?.setAttribute('aria-expanded', 'false')
    }
  })

  const header = document.querySelector('.site-header')
  const updateHeader = () => header?.classList.toggle('scrolled', window.scrollY > 6)
  updateHeader()
  window.addEventListener('scroll', updateHeader, { passive: true })

  document.querySelectorAll('[data-copy]').forEach((button) => {
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

  const search = document.querySelector('[data-doc-search]')
  const searchableItems = [...document.querySelectorAll('[data-search-item]')]
  const empty = document.querySelector('[data-search-empty]')
  search?.addEventListener('input', () => {
    const query = search.value.toLowerCase().trim()
    let visible = 0
    searchableItems.forEach((item) => {
      const matches = !query || item.textContent.toLowerCase().includes(query)
      item.hidden = !matches
      if (matches) visible += 1
    })
    empty?.classList.toggle('visible', visible === 0)
  })

  const headings = [...document.querySelectorAll('.content section[id]')]
  const tocLinks = [...document.querySelectorAll('.toc a')]
  if (headings.length > 0 && tocLinks.length > 0) {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
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

  document.querySelectorAll('[data-year]').forEach((node) => {
    node.textContent = String(new Date().getFullYear())
  })
})()
