import { readonly, shallowRef } from 'vue'

/** 单字符快捷键（/、N、X）的本机偏好键，满足 WCAG 2.1.4 允许关闭字符键快捷键的要求。 */
export const SINGLE_KEY_SHORTCUTS_STORAGE_KEY = 'todou.ui.singleKeyShortcuts'

function readPreference(): boolean {
  try {
    return globalThis.localStorage?.getItem(SINGLE_KEY_SHORTCUTS_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

const enabled = shallowRef<boolean>(readPreference())

export const singleKeyShortcutsEnabled = readonly(enabled)

export function getSingleKeyShortcutsEnabled(): boolean {
  return enabled.value
}

export function setSingleKeyShortcutsEnabled(value: boolean): void {
  enabled.value = value
  try {
    globalThis.localStorage?.setItem(SINGLE_KEY_SHORTCUTS_STORAGE_KEY, value ? 'on' : 'off')
  } catch {
    /* 当前会话仍立即生效。 */
  }
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.key === SINGLE_KEY_SHORTCUTS_STORAGE_KEY || event.key === null) {
      enabled.value = readPreference()
    }
  })
}
