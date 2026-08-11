import { useEffect, useState } from 'react'

type Theme = 'dark' | 'light'

const currentTheme = (): Theme =>
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'

export const ThemeToggle = () => {
  const [theme, setTheme] = useState<Theme | null>(null)

  useEffect(() => {
    setTheme(currentTheme())
  }, [])

  const toggleTheme = () => {
    const nextTheme = currentTheme() === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = nextTheme
    localStorage.setItem('purejsimage-theme', nextTheme)
    setTheme(nextTheme)
  }

  return (
    <button
      className="icon-button"
      type="button"
      data-theme-toggle=""
      aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}
      onClick={toggleTheme}
    >
      {theme === 'dark' ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
        </svg>
      ) : theme === 'light' ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8a8.5 8.5 0 1 0 11.3 11.3Z"
            fill="none"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      ) : null}
    </button>
  )
}
