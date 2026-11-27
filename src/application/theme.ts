import type { UiTheme } from '../storage/types'

/**
 * 通过 <html data-theme> 应用主题。SQLite 的 task_settings 表中 ui_theme 设置是持久化来源，
 * 随 .todou.json 导出；localStorage 仅作镜像，让数据库打开前的首屏也能使用所选主题。
 */
const CACHE_KEY = 'todou.uiTheme'
const THEME_COLORS: Record<Exclude<UiTheme, 'system'>, string> = { dark: '#000000', light: '#f7f6f1' }

export function applyTheme(theme: UiTheme) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.dataset.theme = theme
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const media = meta.dataset.media ?? meta.media
    meta.dataset.media = media
    if (theme === 'system') {
      meta.media = media
      meta.content = media.includes('light') ? THEME_COLORS.light : THEME_COLORS.dark
    } else {
      meta.removeAttribute('media')
      meta.content = THEME_COLORS[theme]
    }
  }
}

export function readCachedTheme(): UiTheme {
  try {
    const value = localStorage.getItem(CACHE_KEY)
    return value === 'dark' || value === 'light' ? value : 'system'
  } catch {
    return 'system'
  }
}

export function cacheTheme(theme: UiTheme) {
  try {
    localStorage.setItem(CACHE_KEY, theme)
  } catch {
    // 隐私模式或站点存储限制可能使缓存不可用，但不影响数据库中的主题值。
  }
}
