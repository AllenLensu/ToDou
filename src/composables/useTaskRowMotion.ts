import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { createUnderdampedSpring } from '../domain/underdampedSpring'
import type { Task } from '../storage/types'

type ListHost = Readonly<Ref<HTMLElement | null>>
type ListView = 'tasks' | 'trash'
type TaskLists = Record<ListView, readonly Task[]> & { view: ListView }

const stepSpring = createUnderdampedSpring(400, 24)
const enterOffset = 16
const exitOffset = -20

/** 列表只在任务实际进出当前数据集时播放动效，筛选和虚拟窗口换行保持即时。 */
export function useTaskRowMotion(
  lists: () => TaskLists,
  scope: () => string,
  loading: () => boolean,
  hosts: readonly { host: ListHost; hasRows: () => boolean }[],
) {
  const leavingRows = ref(0)
  const active = new Map<Element, { animation: Animation; finish: () => void }>()
  let preference: MediaQueryList | undefined
  let added = new Set<string>()
  let exitPositions = new Map<HTMLElement, { top: number; keepSpace: boolean }>()
  const arrivals = { tasks: new Set<string>(), trash: new Set<string>() }

  function stopAnimations() {
    for (const { finish } of active.values()) finish()
  }

  function updatePreference() {
    if (!preference?.matches) return
    stopAnimations()
    arrivals.tasks.clear()
    arrivals.trash.clear()
  }

  onMounted(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    preference.addEventListener('change', updatePreference)
  })
  onBeforeUnmount(() => {
    preference?.removeEventListener('change', updatePreference)
    stopAnimations()
  })

  watch([lists, scope, loading], ([current, currentScope, isLoading], [previous, previousScope, wasLoading]) => {
    if (currentScope !== previousScope) stopAnimations()
    if (isLoading || wasLoading || !preference || preference.matches) return

    const { view } = current
    const hiddenView = view === 'tasks' ? 'trash' : 'tasks'
    const previousIds = new Set(previous[view].map(task => task.id))
    const currentIds = new Set(current[view].map(task => task.id))
    if (current[hiddenView] !== previous[hiddenView]) {
      // 移入另一视图的任务，在用户打开目标列表时只播放一次入场。
      const hiddenIds = new Set(current[hiddenView].map(task => task.id))
      for (const id of arrivals[hiddenView]) if (!hiddenIds.has(id)) arrivals[hiddenView].delete(id)
      for (const id of hiddenIds) {
        if (previousIds.has(id) && !currentIds.has(id)) arrivals[hiddenView].add(id)
      }
    }

    const sameScope = currentScope === previousScope
    if (view !== previous.view) {
      added = new Set(arrivals[view])
      arrivals[view].clear()
    } else if (sameScope) {
      added = new Set([...currentIds].filter(id => !previousIds.has(id)))
    }
    if (sameScope && previous[view].some(task => !currentIds.has(task.id))) {
      // 在 Vue 改动文档流之前量好所有离场行，多行同时删除时仍从原位开始。
      for (const { host, hasRows } of hosts) {
        const keepSpace = !hasRows()
        for (const element of host.value?.children ?? []) {
          if (!(element instanceof HTMLElement)) continue
          const id = element.dataset.motionTaskId
          if (id && !currentIds.has(id) && !element.inert && element.offsetWidth > 0) {
            exitPositions.set(element, { top: element.offsetTop, keepSpace })
          }
        }
      }
    }
    void nextTick(() => { added.clear(); exitPositions.clear() })
  })

  function animate(element: HTMLElement, frames: Keyframe[], duration: number, done: () => void) {
    const animation = element.animate(frames, { duration, fill: 'both' })
    function finish() {
      if (active.get(element)?.animation !== animation) return
      active.delete(element)
      animation.cancel()
      done()
    }
    active.set(element, { animation, finish })
    void animation.finished.then(finish, finish)
  }

  function enter(element: Element, done: () => void) {
    if (!(element instanceof HTMLElement) || !added.has(element.dataset.motionTaskId ?? '') || preference?.matches) return done()
    const frames = Array.from({ length: 28 }, (_, index) => {
      const y = index === 27 ? 0 : stepSpring(enterOffset, 0, 0, index * 0.44 / 27).position
      return { translate: `0 ${y}px`, opacity: Math.min(1, 1 - y / enterOffset) }
    })
    animate(element, frames, 440, done)
  }

  function leave(element: Element, done: () => void) {
    if (!(element instanceof HTMLElement)) return done()
    const position = exitPositions.get(element)
    const previous = active.get(element)
    const style = previous && getComputedStyle(element)
    const startY = style ? Number.parseFloat(style.translate.split(' ')[1] ?? '0') || 0 : 0
    const startOpacity = style ? Number(style.opacity) : 1
    previous?.finish()
    if (!position || preference?.matches) return done()

    element.inert = true
    element.classList.add('task-motion-leaving')
    if (!position.keepSpace) {
      element.style.position = 'absolute'
      element.style.insetInline = '0'
      element.style.top = `${position.top}px`
    }
    leavingRows.value++
    const frames = Array.from({ length: 20 }, (_, index) => {
      const progress = index / 19
      const y = stepSpring(startY, 110, exitOffset, progress * 0.3).position
      return { translate: `0 ${y}px`, opacity: startOpacity * (1 - progress) }
    })
    animate(element, frames, 300, () => {
      leavingRows.value--
      done()
    })
  }

  const moveClass = () => added.size || exitPositions.size ? 'task-motion-move' : 'task-motion-static'
  return { enter, leave, leavingRows, moveClass }
}
