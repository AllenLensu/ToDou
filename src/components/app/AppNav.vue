<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import { locale, t } from '../../i18n'

import AppIcon from '../ui/AppIcon.vue'
import SpringValue from '../ui/SpringValue.vue'
import { stepSegmentSpring } from '../../domain/segmentSpring'
import { createUnderdampedSpring } from '../../domain/underdampedSpring'
// 导航通过显式事件请求切换视图；上层工作区执行草稿离开保护并回传实际当前视图。
import { appViews, type AppView } from '../../domain/taskUi'

const { currentView, trashCount } = defineProps<{
  currentView: AppView
  trashCount: number
}>()

const emit = defineEmits<{
  selectView: [view: AppView]
}>()

const viewNames = computed<Record<AppView, string>>(() => ({
  tasks: t('任务'),
  trash: t('回收站'),
  settings: t('设置'),
}))

const navElement = useTemplateRef<HTMLElement>('nav')
const indicatorElement = useTemplateRef<HTMLElement>('indicator')
const visibleTrashCount = computed<string | null>(() => trashCount > 0 ? (trashCount > 99 ? '99+' : String(trashCount)) : null)
const stepCountSpring = createUnderdampedSpring(400, 24)
let navIndicator: ReturnType<typeof attachNavIndicator> | undefined

onMounted(() => {
  if (navElement.value && indicatorElement.value) {
    navIndicator = attachNavIndicator(navElement.value, indicatorElement.value, visibleTrashCount.value !== null)
  }
})
watch(() => currentView, () => navIndicator?.syncSelection(), { flush: 'post' })
watch(locale, () => navIndicator?.syncSelection(true), { flush: 'post' })
watch(visibleTrashCount, count => navIndicator?.syncCount(count !== null), { flush: 'post' })
onBeforeUnmount(() => navIndicator?.destroy())

function iconVisualBounds(svg: SVGSVGElement): { left: number; right: number } {
  const svgRect = svg.getBoundingClientRect()
  const path = svg.querySelector<SVGGraphicsElement>('path')
  if (!path || typeof path.getBBox !== 'function' || svgRect.width <= 0) {
    return { left: svgRect.left, right: svgRect.right }
  }
  try {
    const box = path.getBBox()
    if (box.width <= 0) return { left: svgRect.left, right: svgRect.right }
    const viewBoxWidth = svg.viewBox?.baseVal?.width || 24
    const stroke = Number.parseFloat(svg.getAttribute('stroke-width') ?? '0') || 0
    const halfStroke = stroke / 2
    const scale = svgRect.width / viewBoxWidth
    return {
      left: svgRect.left + Math.max(0, box.x - halfStroke) * scale,
      right: svgRect.left + Math.min(viewBoxWidth, box.x + box.width + halfStroke) * scale,
    }
  } catch {
    return { left: svgRect.left, right: svgRect.right }
  }
}

function contentVisualBounds(content: HTMLElement): { left: number; width: number } {
  const svg = content.querySelector<SVGSVGElement>('svg')
  const label = content.querySelector<HTMLElement>('.app-nav-label')
  if (!svg || !label) {
    const rect = content.getBoundingClientRect()
    return { left: rect.left, width: rect.width }
  }
  const icon = iconVisualBounds(svg)
  const text = label.getBoundingClientRect()
  const tracking = Math.max(0, Number.parseFloat(getComputedStyle(label).letterSpacing) || 0)
  const textRight = Math.max(text.left, text.right - tracking)
  const left = Math.min(icon.left, text.left)
  const right = Math.max(icon.right, textRight)
  return { left, width: Math.max(0, right - left) }
}

function attachNavIndicator(nav: HTMLElement, indicator: HTMLElement, countVisible: boolean) {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const axes = ['x', 'width'] as const
  const rest = { x: 0, width: 0 }
  let target = { ...rest }
  let position = { ...rest }
  let velocity = { ...rest }
  let frame = 0
  let lastTime = 0
  let isCountVisible = countVisible
  let countElement: HTMLElement | null = null
  let countSpace = { position: 0, velocity: 0 }
  let countTarget = 0
  let countFrame = 0
  let countTime = 0
  let alive = true

  function paint() {
    indicator.style.width = `${Math.max(0, position.width)}px`
    indicator.style.transform = `translateX(${position.x}px)`
  }

  function snap() {
    cancelAnimationFrame(frame)
    frame = 0
    position = { ...target }
    velocity = { ...rest }
    paint()
  }

  function tick(time: number) {
    const seconds = (time - lastTime) / 1000
    lastTime = time
    for (const axis of axes) {
      const next = stepSegmentSpring(position[axis], velocity[axis], target[axis], seconds)
      position[axis] = next.position
      velocity[axis] = next.velocity
    }
    if (axes.every(axis => Math.abs(position[axis] - target[axis]) < 0.1 && Math.abs(velocity[axis]) < 1)) {
      snap()
      return
    }
    paint()
    frame = requestAnimationFrame(tick)
  }

  function syncSelection(immediate = false) {
    const content = nav.querySelector<HTMLElement>('[aria-current="page"] .app-nav-content')
    if (!content) return
    const bounds = contentVisualBounds(content)
    const border = getComputedStyle(nav)
    // 浏览器缩放可能把 1px 边框绘制成小数宽度，按实际宽度居中。
    const thickness = Math.max(Number.parseFloat(border.borderTopWidth), Number.parseFloat(border.borderBottomWidth))
    indicator.style.setProperty('--app-nav-half-divider', `${thickness / 2}px`)
    const next = {
      x: bounds.left - nav.getBoundingClientRect().left - (Number.parseFloat(border.borderLeftWidth) || 0),
      width: bounds.width,
    }
    if (axes.every(axis => next[axis] === target[axis])) return
    target = next
    if (immediate || motion.matches) snap()
    else if (!frame) {
      lastTime = performance.now()
      frame = requestAnimationFrame(tick)
    }
  }

  function onMotionChange() {
    if (!motion.matches) return
    snapCount()
    snap()
  }

  function paintCountSpace() {
    nav.style.setProperty('--app-nav-count-space', `${Math.max(0, countSpace.position)}px`)
    // 设置选中时，下划线与正在移动的按钮共用当帧位置。
    syncSelection(frame === 0)
  }

  function snapCount() {
    cancelAnimationFrame(countFrame)
    countFrame = 0
    countSpace = { position: countTarget, velocity: 0 }
    paintCountSpace()
  }

  function tickCount(time: number) {
    countSpace = stepCountSpring(countSpace.position, countSpace.velocity, countTarget, (time - countTime) / 1000)
    countTime = time
    if (Math.abs(countSpace.position - countTarget) < 0.05 && Math.abs(countSpace.velocity) < 0.5) {
      snapCount()
      return
    }
    paintCountSpace()
    countFrame = requestAnimationFrame(tickCount)
  }

  function syncCount(visible: boolean, immediate = false) {
    isCountVisible = visible
    const badge = visible ? nav.querySelector<HTMLElement>('.app-nav-count') : null
    if (badge !== countElement) {
      if (countElement) observer.unobserve(countElement)
      countElement = badge
      if (badge) observer.observe(badge)
    }
    // 使用未变换的排版宽度，计数弹出时的缩放不会改变设置项的目标位置。
    const width = badge ? Number.parseFloat(getComputedStyle(badge).width) : 0
    const gap = Number.parseFloat(getComputedStyle(nav).getPropertyValue('--space-2xs'))
    const next = width > 0 ? width + gap : 0
    if (next === countTarget) return
    countTarget = next
    if (immediate || motion.matches) snapCount()
    else if (!countFrame) {
      countTime = performance.now()
      countFrame = requestAnimationFrame(tickCount)
    }
  }

  function onFontsLoaded() {
    if (!alive) return
    syncCount(isCountVisible, countFrame === 0)
    syncSelection(frame === 0)
  }

  const observer = new ResizeObserver(entries => {
    if (countElement && entries.some(entry => entry.target === countElement)) syncCount(true)
    syncSelection(frame === 0)
  })
  observer.observe(nav)
  const items = nav.querySelector<HTMLElement>('.app-nav-items')
  if (items) observer.observe(items)
  nav.querySelectorAll('.app-nav-item, .app-nav-content, .app-nav-label').forEach(el => observer.observe(el))
  motion.addEventListener('change', onMotionChange)
  const fontSet = typeof document !== 'undefined' ? document.fonts : undefined
  fontSet?.addEventListener?.('loadingdone', onFontsLoaded)
  void fontSet?.ready?.then(onFontsLoaded)
  syncCount(countVisible, true)
  syncSelection(true)

  return {
    syncSelection,
    syncCount,
    destroy() {
      alive = false
      cancelAnimationFrame(frame)
      cancelAnimationFrame(countFrame)
      observer.disconnect()
      motion.removeEventListener('change', onMotionChange)
      fontSet?.removeEventListener?.('loadingdone', onFontsLoaded)
    },
  }
}
</script>

<template>
  <nav ref="nav" class="app-nav" :aria-label="t('视图')">
    <span ref="indicator" class="app-nav-indicator" aria-hidden="true" />
    <div class="app-nav-items">
      <button
        v-for="item in appViews"
        :key="item.value"
        class="app-nav-item touch-target"
        :class="{ active: currentView === item.value }"
        type="button"
        :aria-current="currentView === item.value ? 'page' : undefined"
        :title="viewNames[item.value]"
        :aria-label="item.value === 'trash' && trashCount > 0 ? t('回收站，{0} 条任务', trashCount) : viewNames[item.value]"
        :data-app-view="item.value"
        @click="emit('selectView', item.value)"
      >
        <span class="app-nav-content">
          <AppIcon :name="item.value" />
          <span class="app-nav-label-wrap">
            <span class="app-nav-label">{{ item.label }}</span>
            <Transition name="app-nav-count" appear>
              <span v-if="item.value === 'trash' && visibleTrashCount" class="app-nav-count" :title="String(visibleTrashCount)">
                <SpringValue :value="visibleTrashCount" />
              </span>
            </Transition>
          </span>
        </span>
      </button>
    </div>
  </nav>
</template>
