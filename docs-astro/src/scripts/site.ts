export const initializeSite = () => {
  const menuButton = document.querySelector<HTMLButtonElement>('[data-menu-toggle]')
  const navigation = document.querySelector<HTMLElement>('[data-nav]')

  menuButton?.addEventListener('click', () => {
    const open = navigation?.classList.toggle('open') ?? false
    menuButton.setAttribute('aria-expanded', String(open))
  })

  navigation?.addEventListener('click', (event) => {
    if (event.target instanceof HTMLAnchorElement) {
      navigation.classList.remove('open')
      menuButton?.setAttribute('aria-expanded', 'false')
    }
  })

  const header = document.querySelector<HTMLElement>('.site-header')
  const updateHeader = () => header?.classList.toggle('scrolled', window.scrollY > 6)
  updateHeader()
  window.addEventListener('scroll', updateHeader, { passive: true })

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
