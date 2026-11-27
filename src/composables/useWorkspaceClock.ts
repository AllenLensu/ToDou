import { onBeforeUnmount, onMounted, readonly, shallowRef } from 'vue'

interface WorkspaceClockOptions {
  canResume: () => boolean
  onResume: () => Promise<void>
  onError: (error: unknown) => void
  hasUnsavedWork: () => boolean
}

/** 维护分钟级响应式时钟与窗口唤醒钩子，使 TODAY / UPCOMING / 逾期随时间与切回前台自动更新。 */
export function useWorkspaceClock(options: WorkspaceClockOptions) {
  const now = shallowRef(new Date())
  let clockTimer: ReturnType<typeof setInterval> | null = null
  let resumeFlight: Promise<void> | null = null

  function resume() {
    if (document.visibilityState === 'hidden' || !options.canResume()) return
    now.value = new Date()
    if (resumeFlight) return
    // 先补齐当前七天窗口，再让提醒调度器读取刷新后的期次；focus/pageshow/visibility 合并执行。
    resumeFlight = options.onResume().catch(options.onError).finally(() => { resumeFlight = null })
  }

  function warnUnsaved(event: BeforeUnloadEvent) {
    if (options.hasUnsavedWork()) {
      event.preventDefault()
      event.returnValue = ''
    }
  }

  onMounted(() => {
    clockTimer = setInterval(() => {
      const previousDay = now.value.toDateString()
      now.value = new Date()
      if (now.value.toDateString() !== previousDay) resume()
    }, 60_000)
    window.addEventListener('beforeunload', warnUnsaved)
    window.addEventListener('focus', resume)
    window.addEventListener('pageshow', resume)
    document.addEventListener('visibilitychange', resume)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', warnUnsaved)
    window.removeEventListener('focus', resume)
    window.removeEventListener('pageshow', resume)
    document.removeEventListener('visibilitychange', resume)
    if (clockTimer) clearInterval(clockTimer)
  })

  return {
    now: readonly(now),
  }
}
