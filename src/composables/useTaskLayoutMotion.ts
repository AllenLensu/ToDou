import { watch, type Ref } from 'vue'
import { createUnderdampedSpring } from '../domain/underdampedSpring'

type PanelRef = Readonly<Ref<HTMLElement | null>>
type PanelBounds = { x: number; y: number; width: number }
type LayoutMode = 'detail' | 'stacked' | 'side-by-side'
type SpringAxis = { position: number; velocity: number }
type Panel = {
  element: HTMLElement
  axes: Record<keyof PanelBounds, SpringAxis>
  translateX: number
  translateY: number
}

const dimensions = ['x', 'y', 'width'] as const
const stepLayoutSpring = createUnderdampedSpring(420, 35)

/** 在布局换挡时，让录入区和列表以连续的位置及速度移向新网格。 */
export function useTaskLayoutMotion(layoutRef: PanelRef, captureRef: PanelRef, resultsRef: PanelRef) {
  if (typeof ResizeObserver !== 'function') return

  watch([layoutRef, captureRef, resultsRef], ([layout, capture, results], _, onCleanup) => {
    if (!layout || !capture || !results) return
    const workspace = layout.closest('.workspace')
    if (!workspace) return

    const panels: Panel[] = [capture, results].map(element => ({
      element,
      axes: {
        x: { position: 0, velocity: 0 },
        y: { position: 0, velocity: 0 },
        width: { position: 0, velocity: 0 },
      },
      translateX: 0,
      translateY: 0,
    }))
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let previous: { mode: LayoutMode; width: number; bounds: PanelBounds[] } | undefined
    let frame = 0
    let lastTime = 0

    function clearStyles() {
      for (const panel of panels) {
        panel.element.style.removeProperty('width')
        panel.element.style.removeProperty('transform')
        panel.translateX = 0
        panel.translateY = 0
      }
    }

    function stop() {
      cancelAnimationFrame(frame)
      frame = 0
      clearStyles()
    }

    function paint() {
      for (const panel of panels) {
        panel.element.style.width = `${Math.max(0, panel.axes.width.position)}px`
      }
      // 宽度改变时录入区可能换行。先批量设置宽度，再按当前网格位置补偿位移。
      const origin = layout!.getBoundingClientRect()
      const offsets = panels.map(panel => {
        const rect = panel.element.getBoundingClientRect()
        return {
          x: panel.axes.x.position - (rect.x - origin.x - panel.translateX),
          y: panel.axes.y.position - (rect.y - origin.y - panel.translateY),
        }
      })
      panels.forEach((panel, index) => {
        const { x, y } = offsets[index]!
        panel.translateX = x
        panel.translateY = y
        panel.element.style.transform = `translate(${x}px, ${y}px)`
      })
    }

    function tick(time: number) {
      const seconds = (time - lastTime) / 1000
      lastTime = time
      let settled = true
      panels.forEach((panel, index) => {
        const target = previous!.bounds[index]!
        for (const dimension of dimensions) {
          const { position, velocity } = panel.axes[dimension]
          const next = stepLayoutSpring(position, velocity, target[dimension], seconds)
          panel.axes[dimension] = next
          if (Math.abs(next.position - target[dimension]) > 0.5 || Math.abs(next.velocity) > 5) settled = false
        }
      })
      if (settled) {
        stop()
        updateLayout()
        return
      }
      paint()
      frame = requestAnimationFrame(tick)
    }

    const updateLayout = () => {
      const width = layout.clientWidth
      if (width === 0) {
        stop()
        previous = undefined
        return
      }

      const detailOpen = !workspace.classList.contains('workspace-list-only')
        || workspace.querySelector(':scope > .task-detail-exiting')
      const mode = detailOpen ? 'detail' : capture.offsetTop === results.offsetTop ? 'side-by-side' : 'stacked'
      const changed = previous && (mode !== previous.mode || (frame !== 0 && width !== previous.width))
      if (!changed && frame) return

      const from = previous?.bounds
      clearStyles()
      const origin = layout.getBoundingClientRect()
      const bounds = panels.map(panel => {
        const rect = panel.element.getBoundingClientRect()
        return { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width }
      })
      previous = { mode, width, bounds }
      if (!from || !changed || reducedMotion.matches) return

      if (!frame) {
        panels.forEach((panel, index) => {
          for (const dimension of dimensions) {
            panel.axes[dimension] = { position: from[index]![dimension], velocity: 0 }
          }
        })
        lastTime = performance.now()
        frame = requestAnimationFrame(tick)
      }
      paint()
    }

    function updateMotionPreference() {
      if (reducedMotion.matches) stop()
      updateLayout()
    }

    const observer = new ResizeObserver(updateLayout)
    observer.observe(layout)
    observer.observe(capture)
    reducedMotion.addEventListener('change', updateMotionPreference)
    onCleanup(() => {
      observer.disconnect()
      reducedMotion.removeEventListener('change', updateMotionPreference)
      stop()
    })
  }, { flush: 'post' })
}
