import { readonly, shallowRef } from 'vue'
import core from './core'
import tasks from './tasks'
import sync from './sync'
import reminders from './reminders'
import { createFeedbackTranslator } from './feedback'

export type UiLocale = 'zh-CN' | 'en'
const preferenceKey = 'todou.ui.locale'
const messages: Readonly<Record<string, string | readonly string[]>> = { ...tasks, ...sync, ...reminders, ...core }

function readPreference(): UiLocale {
  try {
    const saved = globalThis.localStorage?.getItem(preferenceKey)
    if (saved === 'en' || saved === 'zh-CN') return saved
  } catch { /* Use the browser language when storage is unavailable. */ }
  const browser = globalThis.window?.navigator
  const languages = browser?.languages?.length ? browser.languages : [browser?.language ?? '']
  for (const tag of languages) {
    const language = tag.split('-')[0]?.toLowerCase()
    if (language === 'en') return 'en'
    if (language === 'zh') return 'zh-CN'
  }
  return 'zh-CN'
}

const current = shallowRef<UiLocale>(readPreference())
export const locale = readonly(current)
export const getLocale = (): UiLocale => current.value
export const feedbackText = createFeedbackTranslator(messages, getLocale)
export const languageOptions: ReadonlyArray<{ value: UiLocale; label: string }> = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en', label: 'English' },
]

/** Only call with an application message. Interpolated titles, names and notes remain verbatim. */
export function t(source: string, ...values: unknown[]): string {
  const entry = Object.hasOwn(messages, source) ? messages[source] : undefined
  const pattern = typeof entry === 'string' ? (current.value === 'en' ? entry : source)
    : entry?.[current.value === 'en' ? 1 : 0] ?? source
  return values.length ? pattern.replace(/\{(\d+)\}/g, (match, index: string) =>
    Number(index) < values.length ? String(values[Number(index)] ?? '') : match) : pattern
}

/** Capture substitutions now and resolve the interface language when the notice is displayed. */
export const notice = (source: string, ...values: unknown[]) => () => t(source, ...values)

function applyDocumentLocale() {
  document.documentElement.lang = getLocale()
  document.title = t('ToDou · 本地任务台')
  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
  if (manifest) manifest.href = getLocale() === 'en' ? '/manifest.en.webmanifest' : '/manifest.webmanifest'
}

export function initializeLocale() {
  applyDocumentLocale()
  window.addEventListener('storage', event => {
    if (event.key === preferenceKey || event.key === null) {
      updateLocale(readPreference())
    }
  })
}

function updateLocale(value: UiLocale) {
  if (value === current.value) return
  current.value = value
  if (typeof document !== 'undefined') applyDocumentLocale()
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('todou:localechange', { detail: value }))
  }
}

export function setLocale(value: UiLocale) {
  if (value !== 'zh-CN' && value !== 'en') return
  try { globalThis.localStorage?.setItem(preferenceKey, value) } catch { /* The choice still applies to this session. */ }
  updateLocale(value)
}
