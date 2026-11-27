import { onBeforeUnmount, onMounted } from 'vue'

/** 最后一次滚动后，滚动条继续可见的时长。 */
const IDLE_MS = 900

/**
 * 为滚动事件的目标短暂添加 data-scrolling，与 reset.css 的滑块显色规则配合；
 * 这里只管理标记，不控制滚动条宽度或布局。卸载时清除监听、计时器和标记。
 */
export function useAutoHideScrollbars() {
  const timers = new Map<Element, ReturnType<typeof setTimeout>>()

  function onScroll(event: Event) {
    // 文档滚动标记根元素；独立滚动栏则标记事件目标，各自续期而不互相覆盖。
    const target = event.target instanceof Element ? event.target : document.documentElement
    const pending = timers.get(target)
    if (pending) clearTimeout(pending)
    else target.setAttribute('data-scrolling', '')
    timers.set(target, setTimeout(() => {
      target.removeAttribute('data-scrolling')
      timers.delete(target)
    }, IDLE_MS))
  }

  // 元素 scroll 不冒泡，用捕获监听同时覆盖工作区、双栏及日期滚轮。
  onMounted(() => document.addEventListener('scroll', onScroll, { capture: true, passive: true }))

  onBeforeUnmount(() => {
    document.removeEventListener('scroll', onScroll, { capture: true })
    for (const [target, timer] of timers) {
      clearTimeout(timer)
      target.removeAttribute('data-scrolling')
    }
    timers.clear()
  })
}
