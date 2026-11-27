<script setup lang="ts">
import { getLocale, t } from '../../i18n'
import { weekdayNames } from '../../i18n/calendar'

// 日期／时间的本地钟面选择器；只输出表单字符串，UTC 往返转换由领域层负责。
import { computed, nextTick, shallowRef, useId, useTemplateRef, watch } from 'vue'

defineOptions({ inheritAttrs: false })

export type PickerType = 'date' | 'time' | 'datetime-local'

const {
  type,
  id,
  placeholder,
  ariaLabel,
  required = false,
  disabled = false,
  autofocus = false,
  invalid = false,
  describedBy,
} = defineProps<{
  type: PickerType
  id?: string
  placeholder?: string
  ariaLabel?: string
  required?: boolean
  disabled?: boolean
  autofocus?: boolean
  invalid?: boolean
  describedBy?: string
}>()

const model = defineModel<string | number>({ default: '' })

const emit = defineEmits<{
  change: [value: string]
  blur: [value: string]
}>()

/** 日期时间模式选日期时沿用已有时间，否则补 09:00；纯日期模式不会输出时间。 */
const DEFAULT_TIME = '09:00'
const weekdays = computed(() => weekdayNames(true))
const dayLabel = computed(() => new Intl.DateTimeFormat(getLocale(), { month: 'short', day: 'numeric', weekday: 'long' }))
const HOURS = Array.from({ length: 24 }, (_, index) => index)
const MINUTES = Array.from({ length: 60 }, (_, index) => index)

const panelId = `${useId()}-picker`
const rootRef = useTemplateRef<HTMLElement>('rootRef')
const triggerRef = useTemplateRef<HTMLButtonElement>('triggerRef')
const panelRef = useTemplateRef<HTMLElement>('panelRef')
const hourColumnRef = useTemplateRef<HTMLElement>('hourColumnRef')
const minuteColumnRef = useTemplateRef<HTMLElement>('minuteColumnRef')
const isOpen = shallowRef(false)
const alignEnd = shallowRef(false)
const openAbove = shallowRef(false)
const panelPosition = shallowRef<Record<string, string>>({})
const viewYear = shallowRef(0)
const viewMonth = shallowRef(0)
const focusDate = shallowRef('')
const slide = shallowRef<'next' | 'prev' | ''>('')

const hasDate = computed(() => type !== 'time')
const hasTime = computed(() => type !== 'date')

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function isoDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function fromIso(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function nowTime() {
  const now = new Date()
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`
}

const parsed = computed(() => {
  const raw = String(model.value ?? '').trim()
  if (!raw) return { date: '', time: '' }
  if (type === 'time') return { date: '', time: raw.slice(0, 5) }
  const [date = '', time = ''] = raw.split('T')
  return { date: date.slice(0, 10), time: time.slice(0, 5) }
})
const hasValue = computed(() => Boolean(parsed.value.date || parsed.value.time))
const selectedHour = computed(() => parsed.value.time ? Number(parsed.value.time.slice(0, 2)) : -1)
const selectedMinute = computed(() => parsed.value.time ? Number(parsed.value.time.slice(3, 5)) : -1)
const todayIso = shallowRef(isoDate(new Date()))

const triggerDate = computed(() => parsed.value.date)
const triggerWeekday = computed(() => parsed.value.date ? fromIso(parsed.value.date).toLocaleDateString(getLocale(), { weekday: 'short' }) : '')
const triggerTime = computed(() => hasTime.value ? parsed.value.time : '')

const monthDays = computed(() => {
  const first = new Date(viewYear.value, viewMonth.value, 1)
  const start = new Date(viewYear.value, viewMonth.value, 1 - ((first.getDay() + 6) % 7))
  // 从周一开始补齐相邻月份，固定六周，切换月份时日历区高度不变。
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
    return { iso: isoDate(date), day: date.getDate(), outside: date.getMonth() !== viewMonth.value }
  })
})

function commit(date: string, time: string) {
  const value = type === 'date' ? date : type === 'time' ? time : date && time ? `${date}T${time}` : ''
  model.value = value
  emit('change', value)
}

function showMonth(iso: string) {
  const date = fromIso(iso)
  const before = viewYear.value * 12 + viewMonth.value
  const after = date.getFullYear() * 12 + date.getMonth()
  if (after === before) return
  slide.value = after > before ? 'next' : 'prev'
  viewYear.value = date.getFullYear()
  viewMonth.value = date.getMonth()
}

function stepMonth(delta: number) {
  const target = new Date(viewYear.value, viewMonth.value + delta, 1)
  const focused = fromIso(focusDate.value || todayIso.value)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  focusDate.value = isoDate(new Date(target.getFullYear(), target.getMonth(), Math.min(focused.getDate(), lastDay)))
  showMonth(focusDate.value)
}

function selectDay(iso: string) {
  focusDate.value = iso
  showMonth(iso)
  commit(iso, parsed.value.time || DEFAULT_TIME)
  if (type === 'date') close(true)
}

function selectTime(hour: number, minute: number) {
  // 先选时间且尚无日期时补今天；与先选日期时补 09:00 的路径不同。
  commit(parsed.value.date || todayIso.value, `${pad(hour)}:${pad(minute)}`)
}

function selectNow() {
  const today = isoDate(new Date())
  todayIso.value = today
  focusDate.value = today
  showMonth(today)
  commit(today, nowTime())
  if (type === 'date') close(true)
}

function clear() {
  commit('', '')
  close(true)
}

function scrollColumn(column: HTMLElement | null, index: number, smooth: boolean) {
  // 时间列居中是滚动定位，不由滚动位置提交值；减弱动效模式不使用平滑滚动。
  const item = column?.children[index] as HTMLElement | undefined
  if (!column || !item) return
  const top = item.offsetTop - (column.clientHeight - item.offsetHeight) / 2
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  column.scrollTo({ top, behavior: smooth && !reduced ? 'smooth' : 'auto' })
}

function syncTimeColumns(smooth: boolean) {
  // 空值仅将小时列定位到当前小时、分钟列定位到 00，不据此选中或提交默认时间。
  scrollColumn(hourColumnRef.value, Math.max(selectedHour.value, hasValue.value ? 0 : new Date().getHours()), smooth)
  scrollColumn(minuteColumnRef.value, Math.max(selectedMinute.value, 0), smooth)
}

function placePanel() {
  // 桌面按触发器及可用高度定位；600px 及以下清空坐标，由 CSS 固定为底部面板。
  const panel = panelRef.value
  const trigger = triggerRef.value
  if (!panel || !trigger) return
  if (window.matchMedia('(max-width: 600px)').matches) {
    panelPosition.value = {}
    return
  }
  const triggerRect = trigger.getBoundingClientRect()
  const width = panel.offsetWidth
  const height = panel.offsetHeight
  const viewportMaxHeight = Math.max(120, window.innerHeight - 16)
  alignEnd.value = triggerRect.left + width > window.innerWidth - 8 && triggerRect.right - width >= 8
  const below = window.innerHeight - triggerRect.bottom - 16
  const above = triggerRect.top - 16
  const showAbove = height > below && above > below
  const fitsAnchorSide = Math.max(above, below) >= Math.min(height, viewportMaxHeight)
  const maximumHeight = fitsAnchorSide
    ? Math.min(viewportMaxHeight, Math.max(44, showAbove ? above : below))
    : viewportMaxHeight
  const renderedHeight = Math.min(height, maximumHeight)
  const preferredTop = fitsAnchorSide
    ? (showAbove ? triggerRect.top - renderedHeight - 8 : triggerRect.bottom + 8)
    : Math.round((window.innerHeight - renderedHeight) / 2)
  const top = Math.max(8, Math.min(preferredTop, window.innerHeight - renderedHeight - 8))
  panelPosition.value = {
    left: `${Math.max(8, Math.min(triggerRect.left, window.innerWidth - width - 8))}px`,
    top: `${top}px`,
    right: 'auto', bottom: 'auto', maxHeight: `${maximumHeight}px`, overflowY: 'auto',
  }
  openAbove.value = showAbove
}

function focusInitial() {
  const panel = panelRef.value
  if (!panel) return
  const target = hasDate.value
    ? panel.querySelector<HTMLElement>(`[data-date="${focusDate.value}"]`)
    : panel.querySelector<HTMLElement>('.nothing-picker-time-item[tabindex="0"]')
  target?.focus({ preventScroll: true })
}

function open() {
  if (disabled || isOpen.value) return
  todayIso.value = isoDate(new Date())
  focusDate.value = parsed.value.date || todayIso.value
  const shown = fromIso(focusDate.value)
  slide.value = ''
  viewYear.value = shown.getFullYear()
  viewMonth.value = shown.getMonth()
  alignEnd.value = false
  openAbove.value = false
  isOpen.value = true
  void nextTick(() => {
    panelRef.value?.showPopover?.()
    placePanel()
    syncTimeColumns(false)
    focusInitial()
  })
}

function close(restoreFocus = false) {
  // 完成、清除及 Escape 会回到触发器；外部点击或焦点移出不抢回焦点。
  if (!isOpen.value) return
  if (panelRef.value?.matches(':popover-open')) panelRef.value.hidePopover()
  isOpen.value = false
  if (restoreFocus) void nextTick(() => triggerRef.value?.focus())
  emit('blur', String(model.value ?? ''))
}

function focusDay(iso: string) {
  focusDate.value = iso
  showMonth(iso)
  void nextTick(() => panelRef.value?.querySelector<HTMLElement>(`[data-date="${iso}"]`)?.focus({ preventScroll: true }))
}

function dayKeydown(event: KeyboardEvent) {
  // 方向键按日／周移动焦点，Home／End 到周首尾；翻页按月，配合 Shift 则按年，不直接选值。
  const current = fromIso(focusDate.value)
  const shift = (days: number) => isoDate(new Date(current.getFullYear(), current.getMonth(), current.getDate() + days))
  const weekday = (current.getDay() + 6) % 7
  const moves: Record<string, () => string> = {
    ArrowLeft: () => shift(-1),
    ArrowRight: () => shift(1),
    ArrowUp: () => shift(-7),
    ArrowDown: () => shift(7),
    Home: () => shift(-weekday),
    End: () => shift(6 - weekday),
  }
  if (moves[event.key]) {
    event.preventDefault()
    focusDay(moves[event.key]())
  } else if (event.key === 'PageUp' || event.key === 'PageDown') {
    event.preventDefault()
    stepMonth((event.key === 'PageDown' ? 1 : -1) * (event.shiftKey ? 12 : 1))
    void nextTick(() => panelRef.value?.querySelector<HTMLElement>(`[data-date="${focusDate.value}"]`)?.focus({ preventScroll: true }))
  }
}

function timeKeydown(event: KeyboardEvent, unit: 'hour' | 'minute') {
  // 上下键循环提交当前单位，左右键换列；点击和键盘选值才会改变时间，滚动本身不会。
  const hour = Math.max(selectedHour.value, 0)
  const minute = Math.max(selectedMinute.value, 0)
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault()
    const delta = event.key === 'ArrowDown' ? 1 : -1
    if (unit === 'hour') selectTime((hour + delta + 24) % 24, minute)
    else selectTime(hour, (minute + delta + 60) % 60)
    const column = unit === 'hour' ? hourColumnRef : minuteColumnRef
    void nextTick(() => column.value?.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true }))
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    const column = event.key === 'ArrowRight' ? minuteColumnRef.value : hourColumnRef.value
    column?.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true })
  }
}

function triggerKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    open()
  }
}

function panelKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close(true)
  } else if (event.key === 'Tab' && panelRef.value) {
    const focusables = Array.from(panelRef.value.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), [tabindex="0"]'))
    if (!focusables.length) return
    const first = focusables[0]!
    const last = focusables[focusables.length - 1]!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
}

function rootFocusout(event: FocusEvent) {
  const next = event.relatedTarget
  if (next instanceof Node && !rootRef.value?.contains(next)) close()
}

function documentPointerDown(event: PointerEvent) {
  if (isOpen.value && event.target instanceof Node && !rootRef.value?.contains(event.target)) close()
}

function layoutChanged(event?: Event) {
  if (!isOpen.value || (event?.target instanceof Node && panelRef.value?.contains(event.target))) return
  placePanel()
}

watch(() => parsed.value.time, () => {
  if (isOpen.value) void nextTick(() => syncTimeColumns(true))
})

watch(isOpen, (openState, _previous, onCleanup) => {
  if (!openState) return
  document.addEventListener('pointerdown', documentPointerDown)
  document.addEventListener('scroll', layoutChanged, true)
  window.addEventListener('resize', layoutChanged)
  onCleanup(() => {
    document.removeEventListener('pointerdown', documentPointerDown)
    document.removeEventListener('scroll', layoutChanged, true)
    window.removeEventListener('resize', layoutChanged)
  })
})
</script>

<template>
  <div
    ref="rootRef"
    class="nothing-picker tw:relative"
    :class="[`nothing-picker-${type}`, { 'is-open': isOpen }]"
    data-nothing-picker
    @focusout="rootFocusout"
  >
    <button
      ref="triggerRef"
      v-bind="$attrs"
      :id="id"
      class="nothing-input-control nothing-picker-trigger tw:relative tw:z-[1] tw:w-full tw:min-h-[48px] tw:border tw:border-solid tw:border-control-border tw:rounded-[8px] tw:text-text tw:bg-surface tw:py-[11px] tw:px-[13px] tw:outline-none tw:font-data tw:text-body tw:font-normal tw:leading-[normal] tw:[transition:border-color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-slow)_var(--ease-standard),color_var(--motion-slow)_var(--ease-standard)] tw:[&:hover:not(:focus)]:border-text tw:[&:hover]:bg-surface-raised tw:focus:border-text-display tw:focus:bg-surface-raised tw:focus:caret-text-display tw:focus-visible:outline-2 tw:focus-visible:outline-solid tw:focus-visible:outline-transparent tw:focus-visible:outline-offset-[3px] tw:disabled:cursor-not-allowed tw:disabled:opacity-40 tw:[.nothing-input-hero_&]:min-h-[56px] tw:[.nothing-input-hero_&]:text-text-display tw:[.nothing-input-hero_&]:text-[18px] tw:[.nothing-input-hero_&]:py-[14px] tw:[.nothing-input-hero_&]:px-[15px] tw:[.nothing-input-hero_&]:border-text tw:[.nothing-input-compact_&]:min-h-[44px] tw:[.nothing-input-compact_&]:py-xs tw:[.nothing-input-compact_&]:px-[11px] tw:[.nothing-input-compact_&]:text-label tw:[.nothing-input-invalid_&]:border-accent tw:[.nothing-picker.is-open_&]:border-text-display tw:[.nothing-picker.is-open_&]:bg-surface-raised tw:appearance-none tw:flex tw:items-center tw:justify-between tw:gap-[12px] tw:text-left tw:cursor-pointer"
      type="button"
      aria-haspopup="dialog"
      :aria-expanded="isOpen ? 'true' : 'false'"
      :aria-controls="isOpen ? panelId : undefined"
      :aria-label="ariaLabel"
      :aria-required="required ? 'true' : undefined"
      :aria-invalid="invalid ? 'true' : undefined"
      :aria-describedby="describedBy"
      :disabled="disabled"
      :autofocus="autofocus"
      @click="isOpen ? close() : open()"
      @keydown="triggerKeydown"
    >
      <span v-if="hasValue" class="nothing-picker-value tw:flex tw:items-baseline tw:gap-xs tw:min-w-0 tw:overflow-hidden tw:whitespace-nowrap tw:text-ellipsis">
        <span v-if="triggerDate" class="nothing-picker-value-date tw:text-text tw:[transition:color_var(--motion-fast)_var(--ease-out)] tw:[.nothing-picker.is-open_&]:text-text-display">{{ triggerDate }}</span>
        <span v-if="triggerWeekday" class="nothing-picker-value-weekday tw:text-dim tw:text-label tw:tracking-[.06em]">{{ triggerWeekday }}</span>
        <span v-if="triggerTime" class="nothing-picker-value-time tw:text-text-display tw:[transition:color_var(--motion-fast)_var(--ease-out)]">{{ triggerTime }}</span>
      </span>
      <span v-else class="nothing-picker-value nothing-picker-placeholder tw:items-baseline tw:gap-xs tw:min-w-0 tw:overflow-hidden tw:whitespace-nowrap tw:text-ellipsis tw:block tw:text-dim">{{ placeholder }}</span>
      <span class="nothing-input-select-chevron tw:flex-none tw:w-[9px] tw:h-[9px] tw:border-r tw:border-b tw:border-current tw:text-muted tw:[transform:translateY(-2px)_rotate(45deg)] tw:[transition:transform_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out)] tw:[.nothing-picker.is-open_&]:text-text-display tw:[.nothing-picker.is-open_&]:[transform:translateY(2px)_rotate(225deg)]" aria-hidden="true" />
    </button>

    <Transition name="nothing-picker-panel">
      <div
        v-if="isOpen"
        :id="panelId"
        ref="panelRef"
        class="nothing-picker-panel tw:grid tw:gap-sm tw:w-max tw:m-0 tw:max-w-[calc(100vw-32px)] tw:border tw:border-solid tw:border-control-border tw:rounded-[8px] tw:p-sm tw:bg-surface-raised tw:text-text tw:font-data tw:text-[14px] tw:font-normal tw:leading-none tw:le-600:w-auto tw:le-600:max-w-none tw:le-600:max-h-[calc(100dvh-48px)] tw:le-600:overflow-y-auto tw:le-600:border-x-0 tw:le-600:border-b-0 tw:le-600:rounded-t-[16px] tw:le-600:rounded-b-none tw:le-600:overscroll-contain tw:le-600:[padding:24px_clamp(4px,calc((100vw_-_308px)/2),16px)_calc(16px+env(safe-area-inset-bottom))]"
        popover="manual"
        :style="panelPosition"
        :class="{ 'is-align-end': alignEnd, 'is-above': openAbove }"
        role="dialog"
        aria-modal="true"
        :aria-label="ariaLabel"
        @keydown="panelKeydown"
      >
        <div class="nothing-picker-body tw:flex tw:items-stretch tw:gap-sm tw:le-600:flex-col">
          <section v-if="hasDate" class="nothing-picker-calendar" :aria-label="t('日期')">
            <header class="nothing-picker-head tw:flex tw:items-center tw:justify-between tw:mb-sm">
              <p class="nothing-picker-month tw:flex tw:items-baseline tw:gap-xs tw:m-0" aria-live="polite">
                <span class="nothing-picker-month-number tw:text-text-display tw:font-display tw:text-[28px] tw:font-bold tw:leading-none tw:tracking-[.02em]">{{ pad(viewMonth + 1) }}</span>
                <span class="nothing-picker-month-year tw:text-muted tw:text-label tw:tracking-[.06em]">{{ viewYear }}</span>
              </p>
              <div class="nothing-picker-nav tw:flex tw:gap-2xs">
                <button class="nothing-picker-nav-button is-prev tw:relative tw:w-[44px] tw:h-[44px] tw:border tw:border-solid tw:border-control-border tw:rounded-[999px] tw:p-0 tw:bg-transparent tw:text-muted tw:cursor-pointer tw:[transition:border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out)] tw:[&:hover]:border-text tw:[&:hover]:text-text-display tw:active:border-text-display tw:active:text-text-display" type="button" :aria-label="t('上个月')" @click="stepMonth(-1)" />
                <button class="nothing-picker-nav-button is-next tw:relative tw:w-[44px] tw:h-[44px] tw:border tw:border-solid tw:border-control-border tw:rounded-[999px] tw:p-0 tw:bg-transparent tw:text-muted tw:cursor-pointer tw:[transition:border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out)] tw:[&:hover]:border-text tw:[&:hover]:text-text-display tw:active:border-text-display tw:active:text-text-display" type="button" :aria-label="t('下个月')" @click="stepMonth(1)" />
              </div>
            </header>

            <div
              :key="`${viewYear}-${viewMonth}`"
              class="nothing-picker-days tw:grid tw:grid-cols-[repeat(7,44px)] tw:le-600:grid-cols-[repeat(7,1fr)]"
              :class="slide && `is-from-${slide}`"
              role="grid"
              :aria-label="t('选择日期')"
            >
              <div class="nothing-picker-weekdays tw:contents" role="row">
                <span v-for="(weekday, wIdx) in weekdays" :key="weekday" role="columnheader" class="tw:grid tw:place-items-center tw:h-[24px] tw:mb-2xs tw:text-label tw:tracking-[.06em]" :class="wIdx >= 5 ? 'tw:text-muted' : 'tw:text-dim'">{{ weekday }}</span>
              </div>
              <div v-for="week in 6" :key="week" class="nothing-picker-week tw:contents" role="row">
              <div
                v-for="day in monthDays.slice((week - 1) * 7, week * 7)"
                :key="day.iso"
                class="tw:contents"
                role="gridcell"
                :aria-selected="day.iso === parsed.date ? 'true' : 'false'"
              >
              <button
                class="nothing-picker-day tw:relative tw:grid tw:place-items-center tw:w-[44px] tw:h-[44px] tw:border-0 tw:p-0 tw:bg-transparent tw:text-text tw:[font:inherit] tw:cursor-pointer tw:isolate tw:[&.is-outside:not(.is-selected)]:text-dim tw:[&.is-selected]:text-bg tw:focus-visible:outline-2 tw:focus-visible:outline-solid tw:focus-visible:outline-interactive tw:focus-visible:outline-offset-[-2px] tw:focus-visible:rounded-[999px] tw:le-600:w-full tw:[&.is-outside]:opacity-100"
                :class="{ 'is-outside': day.outside, 'is-today': day.iso === todayIso, 'is-selected': day.iso === parsed.date }"
                type="button"
                :data-date="day.iso"
                :tabindex="day.iso === focusDate ? 0 : -1"
                :aria-current="day.iso === todayIso ? 'date' : undefined"
                :aria-label="dayLabel.format(fromIso(day.iso))"
                @click="selectDay(day.iso)"
                @keydown="dayKeydown"
              >
                <span>{{ day.day }}</span>
              </button>
              </div>
              </div>
            </div>
          </section>

          <section v-if="hasTime" class="nothing-picker-time tw:grid tw:grid-rows-[auto_1fr] tw:min-h-0 tw:[.nothing-picker-calendar+&]:border-l tw:[.nothing-picker-calendar+&]:border-line tw:[.nothing-picker-calendar+&]:pl-sm tw:[.nothing-picker-calendar+&]:le-600:border-t tw:[.nothing-picker-calendar+&]:le-600:border-l-0 tw:[.nothing-picker-calendar+&]:le-600:pt-sm tw:[.nothing-picker-calendar+&]:le-600:pl-0" :aria-label="t('时间')">
            <div class="nothing-picker-time-head tw:grid tw:grid-cols-[repeat(2,56px)] tw:gap-2xs tw:items-center tw:h-[44px] tw:mb-sm tw:text-dim tw:text-label tw:tracking-[.06em] tw:[&_span]:text-center tw:[.nothing-picker-time:only-child_&]:mb-xs tw:le-600:grid-cols-[repeat(2,1fr)] tw:le-600:h-auto tw:le-600:mb-xs" aria-hidden="true">
              <span>{{ t('时') }}</span>
              <span>{{ t('分') }}</span>
            </div>
            <div class="nothing-picker-time-columns tw:grid tw:grid-cols-[repeat(2,56px)] tw:gap-2xs tw:relative tw:min-h-0 tw:le-600:grid-cols-[repeat(2,1fr)]">
              <div ref="hourColumnRef" class="nothing-picker-time-column tw:overflow-y-auto tw:overscroll-contain tw:[scroll-snap-type:y_proximity]" role="group" :aria-label="t('小时')">
                <button
                  v-for="hour in HOURS"
                  :key="hour"
                  class="nothing-picker-time-item tw:relative tw:grid tw:place-items-center tw:w-full tw:h-[44px] tw:border-0 tw:rounded-[4px] tw:p-0 tw:bg-transparent tw:text-muted tw:[font:inherit] tw:cursor-pointer tw:[scroll-snap-align:center] tw:[transition:color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:[&:hover]:text-text-display tw:[&:hover]:bg-surface tw:[&.is-selected]:text-text-display tw:[&.is-selected]:bg-surface tw:focus-visible:outline-1 tw:focus-visible:outline-solid tw:focus-visible:outline-text-display tw:focus-visible:outline-offset-[-1px]"
                  :class="{ 'is-selected': hour === selectedHour }"
                  type="button"
                  :tabindex="hour === Math.max(selectedHour, 0) ? 0 : -1"
                  :aria-pressed="hour === selectedHour ? 'true' : 'false'"
                  :aria-label="t('{0} 时', hour)"
                  @click="selectTime(hour, Math.max(selectedMinute, 0))"
                  @keydown="timeKeydown($event, 'hour')"
                >{{ pad(hour) }}</button>
              </div>
              <div ref="minuteColumnRef" class="nothing-picker-time-column tw:overflow-y-auto tw:overscroll-contain tw:[scroll-snap-type:y_proximity]" role="group" :aria-label="t('分钟')">
                <button
                  v-for="minute in MINUTES"
                  :key="minute"
                  class="nothing-picker-time-item tw:relative tw:grid tw:place-items-center tw:w-full tw:h-[44px] tw:border-0 tw:rounded-[4px] tw:p-0 tw:bg-transparent tw:text-muted tw:[font:inherit] tw:cursor-pointer tw:[scroll-snap-align:center] tw:[transition:color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:[&:hover]:text-text-display tw:[&:hover]:bg-surface tw:[&.is-selected]:text-text-display tw:[&.is-selected]:bg-surface tw:focus-visible:outline-1 tw:focus-visible:outline-solid tw:focus-visible:outline-text-display tw:focus-visible:outline-offset-[-1px]"
                  :class="{ 'is-selected': minute === selectedMinute }"
                  type="button"
                  :tabindex="minute === Math.max(selectedMinute, 0) ? 0 : -1"
                  :aria-pressed="minute === selectedMinute ? 'true' : 'false'"
                  :aria-label="t('{0} 分', minute)"
                  @click="selectTime(Math.max(selectedHour, hasValue ? 0 : new Date().getHours()), minute)"
                  @keydown="timeKeydown($event, 'minute')"
                >{{ pad(minute) }}</button>
              </div>
            </div>
          </section>
        </div>

        <footer class="nothing-picker-foot tw:flex tw:items-center tw:gap-xs tw:border-t tw:border-line tw:pt-[12px]">
          <button class="nothing-picker-action tw:min-h-[44px] tw:min-w-[44px] tw:border tw:border-solid tw:border-transparent tw:rounded-[999px] tw:py-[6px] tw:px-[12px] tw:bg-transparent tw:text-muted tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:cursor-pointer tw:[transition:border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out),opacity_var(--motion-fast)_var(--ease-out)] tw:[&:hover:not(.is-primary)]:border-control-border tw:[&:hover:not(.is-primary)]:text-text-display tw:active:border-text-display tw:focus-visible:outline-2 tw:focus-visible:outline-solid tw:focus-visible:outline-interactive tw:focus-visible:outline-offset-2 tw:focus-visible:border-text-display tw:[&:focus-visible:not(.is-primary)]:text-text-display tw:disabled:cursor-not-allowed tw:disabled:opacity-40 tw:[&:disabled:hover]:border-transparent tw:[&:disabled:hover]:text-muted tw:[&.is-primary]:border-text-display tw:[&.is-primary]:bg-text-display tw:[&.is-primary]:text-bg tw:[&.is-primary:hover]:opacity-[.86] tw:[&.is-primary:active]:bg-text tw:[&.is-primary:focus-visible]:outline-1 tw:[&.is-primary:focus-visible]:outline-solid tw:[&.is-primary:focus-visible]:outline-text-display tw:[&.is-primary:focus-visible]:outline-offset-2 tw:le-600:px-sm" type="button" :disabled="!hasValue" @click="clear">{{ t('清除') }}</button>
          <span class="nothing-picker-foot-spacer tw:flex-1" />
          <button class="nothing-picker-action tw:min-h-[44px] tw:min-w-[44px] tw:border tw:border-solid tw:border-transparent tw:rounded-[999px] tw:py-[6px] tw:px-[12px] tw:bg-transparent tw:text-muted tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:cursor-pointer tw:[transition:border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out),opacity_var(--motion-fast)_var(--ease-out)] tw:[&:hover:not(.is-primary)]:border-control-border tw:[&:hover:not(.is-primary)]:text-text-display tw:active:border-text-display tw:focus-visible:outline-2 tw:focus-visible:outline-solid tw:focus-visible:outline-interactive tw:focus-visible:outline-offset-2 tw:focus-visible:border-text-display tw:[&:focus-visible:not(.is-primary)]:text-text-display tw:disabled:cursor-not-allowed tw:disabled:opacity-40 tw:[&:disabled:hover]:border-transparent tw:[&:disabled:hover]:text-muted tw:[&.is-primary]:border-text-display tw:[&.is-primary]:bg-text-display tw:[&.is-primary]:text-bg tw:[&.is-primary:hover]:opacity-[.86] tw:[&.is-primary:active]:bg-text tw:[&.is-primary:focus-visible]:outline-1 tw:[&.is-primary:focus-visible]:outline-solid tw:[&.is-primary:focus-visible]:outline-text-display tw:[&.is-primary:focus-visible]:outline-offset-2 tw:le-600:px-sm" type="button" @click="selectNow">{{ type === 'date' ? t('今天') : t('现在') }}</button>
          <button class="nothing-picker-action is-primary tw:min-h-[44px] tw:min-w-[44px] tw:border tw:border-solid tw:border-transparent tw:rounded-[999px] tw:py-[6px] tw:px-[12px] tw:bg-transparent tw:text-muted tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:cursor-pointer tw:[transition:border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out),opacity_var(--motion-fast)_var(--ease-out)] tw:[&:hover:not(.is-primary)]:border-control-border tw:[&:hover:not(.is-primary)]:text-text-display tw:active:border-text-display tw:focus-visible:outline-2 tw:focus-visible:outline-solid tw:focus-visible:outline-interactive tw:focus-visible:outline-offset-2 tw:focus-visible:border-text-display tw:[&:focus-visible:not(.is-primary)]:text-text-display tw:disabled:cursor-not-allowed tw:disabled:opacity-40 tw:[&:disabled:hover]:border-transparent tw:[&:disabled:hover]:text-muted tw:[&.is-primary]:border-text-display tw:[&.is-primary]:bg-text-display tw:[&.is-primary]:text-bg tw:[&.is-primary:hover]:opacity-[.86] tw:[&.is-primary:active]:bg-text tw:[&.is-primary:focus-visible]:outline-1 tw:[&.is-primary:focus-visible]:outline-solid tw:[&.is-primary:focus-visible]:outline-text-display tw:[&.is-primary:focus-visible]:outline-offset-2 tw:le-600:px-sm" type="button" @click="close(true)">{{ t('完成') }}</button>
        </footer>
      </div>
    </Transition>
  </div>
</template>
