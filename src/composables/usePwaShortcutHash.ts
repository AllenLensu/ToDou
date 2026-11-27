import { onBeforeUnmount, onMounted, toRef, watch, type MaybeRefOrGetter } from 'vue'

interface PwaShortcutHashOptions {
  ready: MaybeRefOrGetter<boolean>
  onShortcut: (target: 'today' | 'new-task') => void | Promise<void>
}

/** Fragment 快捷入口可在已打开的 PWA 窗口触发，不替换当前编辑器实例。 */
export function usePwaShortcutHash(options: PwaShortcutHashOptions) {
  const ready = toRef(options.ready)

  function handleShortcut() {
    if (!ready.value) return
    const hash = window.location.hash
    if (hash !== '#today' && hash !== '#new-task') return
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    void options.onShortcut(hash === '#today' ? 'today' : 'new-task')
  }

  watch(ready, handleShortcut, { flush: 'post' })
  onMounted(() => window.addEventListener('hashchange', handleShortcut))
  onBeforeUnmount(() => window.removeEventListener('hashchange', handleShortcut))
}
