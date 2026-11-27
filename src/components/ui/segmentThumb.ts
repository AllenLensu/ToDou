import { PointerVelocity, stepSegmentSpring } from '../../domain/segmentSpring'

/** 滑块与反色文字共用轨道坐标，模型在点击或松手时切换。 */
export function attachSegmentThumb(group: HTMLElement, track: HTMLElement, select: (index: number) => void) {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const listeners = new AbortController()
  const { signal } = listeners
  const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
  let segments: { left: number; width: number }[] = []
  let left = { position: 0, velocity: 0 }
  let width = { position: 0, velocity: 0 }
  let target = { left: 0, width: 0 }
  let frame = 0
  let lastTime = 0
  let gesture: {
    id: number
    startX: number
    grabOffset: number
    dragging: boolean
    speed: PointerVelocity
  } | null = null

  function boundedLeft(x: number) {
    const first = segments[0]!
    const last = segments[segments.length - 1]!
    return Math.max(first.left, Math.min(last.left + last.width - width.position, x))
  }

  function paint() {
    // 模拟保留释放速度，绘制受轨道两端约束，快速向外甩动时滑块仍完整可见。
    group.style.setProperty('--thumb-x', `${boundedLeft(left.position)}px`)
    group.style.setProperty('--thumb-width', `${width.position}px`)
  }

  function stop() {
    cancelAnimationFrame(frame)
    frame = 0
  }

  function snap() {
    stop()
    left = { position: target.left, velocity: 0 }
    width = { position: target.width, velocity: 0 }
    paint()
  }

  function tick(time: number) {
    const seconds = Math.max(0, time - lastTime) / 1000
    lastTime = time
    left = stepSegmentSpring(left.position, left.velocity, target.left, seconds)
    width = stepSegmentSpring(width.position, width.velocity, target.width, seconds)
    if (Math.abs(left.position - target.left) < 0.1 && Math.abs(width.position - target.width) < 0.1
      && Math.abs(left.velocity) < 1 && Math.abs(width.velocity) < 1) {
      snap()
      return
    }
    paint()
    frame = requestAnimationFrame(tick)
  }

  function settle(index: number, immediate = false) {
    const segment = segments[index]
    if (!segment) return
    target = segment
    if (immediate || motion.matches) snap()
    else if (!frame) {
      lastTime = performance.now()
      frame = requestAnimationFrame(tick)
    }
  }

  function syncSelection(immediate = false) {
    settle(buttons.findIndex(button => button.getAttribute('aria-checked') === 'true'), immediate)
  }

  function measure() {
    const start = track.getBoundingClientRect().left
    segments = buttons.map(button => {
      const rect = button.getBoundingClientRect()
      const left = rect.left - start
      button.style.setProperty('--option-x', `${left}px`)
      return { left, width: rect.width }
    })
    syncSelection(true)
  }

  function down(event: PointerEvent) {
    if (!event.isPrimary || event.button !== 0 || gesture || !(event.target instanceof HTMLButtonElement)) return
    if (event.target.matches(':disabled')) return
    const offset = event.clientX - track.getBoundingClientRect().left - boundedLeft(left.position)
    const speed = new PointerVelocity()
    speed.sample(event.clientX, event.timeStamp)
    gesture = {
      id: event.pointerId, startX: event.clientX, dragging: false, speed,
      grabOffset: offset >= 0 && offset <= width.position ? offset : width.position / 2,
    }
  }

  function move(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.id) return
    const velocity = gesture.speed.sample(event.clientX, event.timeStamp)
    if (!gesture.dragging) {
      if (Math.abs(event.clientX - gesture.startX) < 4) return
      gesture.dragging = true
      stop()
      width.velocity = 0
      group.setPointerCapture(event.pointerId)
    }
    const x = event.clientX - track.getBoundingClientRect().left - gesture.grabOffset
    left = { position: boundedLeft(x), velocity }
    paint()
  }

  function up(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.id) return
    if (gesture.dragging) {
      if (buttons[0]?.matches(':disabled')) {
        cancel(event)
        return
      }
      move(event)
      const x = event.clientX - track.getBoundingClientRect().left
      // 按松手位置选择；两项之间的空隙按中点平分。
      const index = segments.findIndex((segment, i) => {
        const next = segments[i + 1]
        return !next || x < (segment.left + segment.width + next.left) / 2
      })
      select(index)
      buttons[index]?.focus({ preventScroll: true })
      settle(index)
    }
    gesture = null
  }

  function cancel(event: PointerEvent) {
    if (event.pointerId !== gesture?.id) return
    const dragging = gesture.dragging
    gesture = null
    if (dragging) {
      left.velocity = 0
      syncSelection()
    }
  }

  group.addEventListener('pointerdown', down, { signal })
  group.addEventListener('pointermove', move, { signal })
  group.addEventListener('pointerup', up, { signal })
  group.addEventListener('pointercancel', cancel, { signal })
  group.addEventListener('lostpointercapture', event => {
    // 触摸拖动时，捕获由原按钮移交给整条轨道。
    if (event.target === group) cancel(event)
  }, { signal })
  group.addEventListener('pointerleave', event => {
    if (!gesture?.dragging) cancel(event)
  }, { signal })
  motion.addEventListener('change', () => { if (motion.matches) syncSelection(true) }, { signal })
  const observer = new ResizeObserver(measure)
  observer.observe(group)
  buttons.forEach(button => observer.observe(button))
  measure()
  return {
    syncSelection,
    destroy() {
      stop()
      observer.disconnect()
      listeners.abort()
    },
  }
}
