import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, shallowRef, toRef, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { createVirtualLayout, restoreVirtualAnchor, revealVirtualIndex, virtualWindow } from '../domain/virtualList'

type Options<T> = {
  items: MaybeRefOrGetter<readonly T[]>
  key: (item: T) => string
  host: MaybeRefOrGetter<HTMLElement | null>
  selectedKey?: MaybeRefOrGetter<string | null>
  resetKey?: MaybeRefOrGetter<string>
  estimatedHeight?: MaybeRefOrGetter<number>
}

/** 在现有滚动容器内按实测行高虚拟化，兼容独立滚动的双栏，不另建滚动区域。 */
export function useMeasuredWindow<T>(options: Options<T>) {
  const measured = new Map<string, number>()
  const elements = new Map<string, HTMLElement>()
  const revision = shallowRef(0)
  const viewport = shallowRef({ top: 0, height: 800 })
  const hostRef = toRef(options.host)
  const keys = computed(() => toValue(options.items).map(options.key))
  const enabled = computed(() => keys.value.length > 120)
  const layout = computed(() => { void revision.value; return createVirtualLayout(keys.value, measured, toValue(options.estimatedHeight) ?? 88) })
  const range = computed(() => enabled.value ? virtualWindow(layout.value, viewport.value.top, viewport.value.height)
    : { start: 0, end: keys.value.length, before: 0, after: 0 })
  const rows = computed(() => toValue(options.items).slice(range.value.start, range.value.end).map((item, offset) => ({ item, index: range.value.start + offset })))
  const padding = computed(() => enabled.value ? { paddingTop: `${range.value.before}px`, paddingBottom: `${range.value.after}px` } : undefined)
  let scroller: HTMLElement | null = null
  let observer: ResizeObserver | null = null
  let frame = 0
  let width = 0
  let desiredTop: number | null = null
  let revealKey: string | null = null
  let resetScroll = false
  let mounted = false

  function setViewport(top: number, height = viewport.value.height) {
    if (Math.abs(top - viewport.value.top) > .25 || Math.abs(height - viewport.value.height) > .25) viewport.value = { top, height }
  }

  function schedule() {
    if (!mounted || frame) return
    frame = requestAnimationFrame(() => { frame = 0; syncViewport() })
  }

  function queueTop(top: number) {
    desiredTop = Math.max(0, top)
    setViewport(desiredTop)
    schedule()
  }

  function scrollParent(host: HTMLElement) {
    // 从列表外层找最近声明纵向滚动的祖先；双栏／单栏切换后重新查找，不固定为工作区。
    let parent = host.parentElement
    while (parent && parent !== document.body) {
      if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent
      parent = parent.parentElement
    }
    return document.documentElement
  }

  function syncViewport() {
    const host = hostRef.value
    // 窄屏详情会隐藏列表，待列表再次可见再应用待处理的选中项及滚动位置。
    if (!host || !host.getClientRects().length || host.getBoundingClientRect().width <= 0) return
    const parent = scrollParent(host)
    const changedParent = parent !== scroller
    if (changedParent) {
      scroller?.removeEventListener('scroll', schedule)
      scroller = parent
      scroller.addEventListener('scroll', schedule, { passive: true })
    }
    const actualWidth = host.getBoundingClientRect().width
    // 宽度变化会改变换行，旧行高不再可靠；清空缓存后仍按记录和行内偏移恢复锚点。
    if (width && Math.abs(actualWidth - width) > 1 && measured.size) {
      const previous = layout.value
      measured.clear()
      revision.value++
      if (viewport.value.top >= 0 && viewport.value.top < previous.totalHeight) {
        desiredTop = restoreVirtualAnchor(previous, layout.value, viewport.value.top)
      }
    }
    width = actualWidth
    // 虚拟布局的 top 相对列表 host，而非祖先 scrollTop，需扣除列表前方内容的位移。
    const parentTop = parent.getBoundingClientRect().top + parent.clientTop
    let localTop = parentTop - host.getBoundingClientRect().top
    const height = parent.clientHeight || window.innerHeight
    if (resetScroll) {
      parent.scrollTop = 0
      localTop = parentTop - host.getBoundingClientRect().top
      resetScroll = false
      desiredTop = null
    } else if (enabled.value && (desiredTop !== null || (changedParent && viewport.value.top > 0))) {
      const target = desiredTop ?? viewport.value.top
      parent.scrollTop += target - localTop
      localTop = parentTop - host.getBoundingClientRect().top
      desiredTop = null
    }
    if (enabled.value && revealKey !== null) {
      const index = layout.value.indices.get(revealKey)
      if (index !== undefined) {
        const target = revealVirtualIndex(layout.value, index, localTop, height)
        parent.scrollTop += target - localTop
        localTop = parentTop - host.getBoundingClientRect().top
      }
      revealKey = null
    }
    setViewport(localTop, height)
  }

  function measureRows(changes: ResizeObserverEntry[]) {
    if (!enabled.value) { schedule(); return }
    const previous = layout.value
    let changed = false
    for (const entry of changes) {
      const element = entry.target as HTMLElement
      const key = element.dataset.virtualKey
      if (!key) continue
      const height = element.getBoundingClientRect().height
      if (height > 0 && Math.abs(height - (measured.get(key) ?? 0)) > .5) {
        measured.set(key, height)
        changed = true
      }
    }
    if (changed) {
      revision.value++
      // 行高改变时保留首个可见记录及行内偏移，避免换行或测量导致视口跳动。
      if (viewport.value.top >= 0 && viewport.value.top < previous.totalHeight) {
        queueTop(restoreVirtualAnchor(previous, layout.value, viewport.value.top))
      }
    }
    schedule()
  }

  function observeRow(key: string, value: unknown) {
    const previous = elements.get(key)
    if (previous && previous !== value) { observer?.unobserve(previous); elements.delete(key) }
    if (value instanceof HTMLElement && previous !== value) {
      value.dataset.virtualKey = key
      elements.set(key, value)
      observer?.observe(value)
    }
  }

  watch(keys, (current, previous) => {
    const prior = createVirtualLayout(previous, measured, toValue(options.estimatedHeight) ?? 88)
    const remaining = new Set(current)
    const focused = document.activeElement?.closest<HTMLElement>('[data-task-id]')
    const focusedKey = focused && hostRef.value?.contains(focused) ? focused.dataset.taskId : undefined
    for (const key of measured.keys()) if (!remaining.has(key)) measured.delete(key)
    revision.value++
    if (enabled.value && viewport.value.top >= 0 && viewport.value.top < prior.totalHeight) {
      queueTop(restoreVirtualAnchor(prior, layout.value, viewport.value.top))
    }
    if (enabled.value && focusedKey) {
      // X 可能重排行；Delete 后则让同索引邻项先进入渲染窗口，供后续焦点恢复查询。
      const previousIndex = prior.indices.get(focusedKey) ?? 0
      const nextKey = remaining.has(focusedKey) ? focusedKey : current[Math.min(previousIndex, current.length - 1)]
      if (nextKey) {
        revealKey = nextKey
        queueTop(revealVirtualIndex(layout.value, layout.value.indices.get(nextKey)!, viewport.value.top, viewport.value.height))
      }
    }
    schedule()
  })
  if (options.resetKey !== undefined) watch(toRef(options.resetKey), () => {
    revealKey = null
    resetScroll = true
    desiredTop = null
    setViewport(0)
    schedule()
  })
  function reveal(key: string | null) {
    if (!key || !enabled.value) { schedule(); return }
    revealKey = key
    const index = layout.value.indices.get(key)
    // pre 阶段先更新窗口，让目标行在父层 nextTick 的键盘聚焦回调查询前挂载。
    if (index !== undefined) queueTop(revealVirtualIndex(layout.value, index, viewport.value.top, viewport.value.height))
    void nextTick(syncViewport)
  }
  if (options.selectedKey !== undefined) watch(toRef(options.selectedKey), reveal, { flush: 'pre' })

  onMounted(() => {
    mounted = true
    observer = new ResizeObserver(measureRows)
    if (hostRef.value) observer.observe(hostRef.value)
    for (const element of elements.values()) observer.observe(element)
    window.addEventListener('resize', schedule, { passive: true })
    schedule()
  })
  watch(hostRef, (host, previous) => {
    if (previous) observer?.unobserve(previous)
    if (host) observer?.observe(host)
    schedule()
  })
  onUpdated(schedule)
  onBeforeUnmount(() => {
    mounted = false
    if (frame) cancelAnimationFrame(frame)
    observer?.disconnect()
    scroller?.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
  })
  return { enabled, rows, padding, observeRow, reveal }
}
