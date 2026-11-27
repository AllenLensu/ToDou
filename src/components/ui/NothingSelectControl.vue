<script setup lang="ts">
import { t } from '../../i18n'
import {
  Comment,
  Fragment,
  computed,
  nextTick,
  shallowRef,
  useSlots,
  useTemplateRef,
  watch,
  type VNode,
} from 'vue'
import type { NothingInputOption } from './NothingInput.vue'

defineOptions({ inheritAttrs: false })

const {
  id,
  listboxId,
  controlClasses,
  variant = 'default',
  placeholder = '',
  accessibleLabel,
  describedBy,
  required = false,
  disabled = false,
  autofocus = false,
  invalid = false,
  options = [],
} = defineProps<{
  id: string
  listboxId: string
  controlClasses: ReadonlyArray<string>
  variant?: 'default' | 'hero' | 'compact'
  placeholder?: string
  accessibleLabel?: string
  describedBy?: string
  required?: boolean
  disabled?: boolean
  autofocus?: boolean
  invalid?: boolean
  options?: readonly NothingInputOption[]
}>()

const model = defineModel<string | number>({ default: '' })

const emit = defineEmits<{
  change: [value: string]
  blur: [value: string]
  openChange: [open: boolean]
}>()

interface SelectOption {
  value: string
  label: string
  disabled: boolean
}

const slots = useSlots()
const isOpen = shallowRef(false)
const activeIndex = shallowRef(-1)
const triggerRef = useTemplateRef<HTMLButtonElement>('triggerRef')

const hasValue = computed(() => model.value !== '' && model.value !== null && model.value !== undefined)

function textFromVNodeChildren(children: VNode['children']): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children).trim()
  if (Array.isArray(children)) {
    return children.map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child)
      if (child && typeof child === 'object') return textFromVNodeChildren((child as VNode).children)
      return ''
    }).join('').trim()
  }
  return ''
}

function optionVNodes(nodes: VNode[]): VNode[] {
  return nodes.flatMap((node) => {
    if (node.type === Comment) return []
    if (node.type === Fragment && Array.isArray(node.children)) return optionVNodes(node.children as VNode[])
    return node.type === 'option' ? [node] : []
  })
}

const selectOptions = computed<SelectOption[]>(() => {
  // 兼容已有 option 插槽（含 Fragment）；有插槽选项就优先采用，否则用 options，值统一为字符串。
  const slotOptions = optionVNodes(slots.default?.() ?? []).map((node) => ({
    value: String(node.props?.value ?? ''),
    label: textFromVNodeChildren(node.children) || String(node.props?.label ?? ''),
    disabled: node.props?.disabled === '' || Boolean(node.props?.disabled),
  }))
  return slotOptions.length ? slotOptions : options.map((option) => ({
    value: String(option.value),
    label: option.label,
    disabled: Boolean(option.disabled),
  }))
})

const selectedOption = computed(() => selectOptions.value.find((option) => option.value === String(model.value ?? '')))
const selectLabel = computed(() => selectedOption.value && hasValue.value ? selectedOption.value.label : placeholder || selectedOption.value?.label || '')
let typedPrefix = ''
let lastTypedAt = 0

function optionId(index: number) {
  return `${listboxId}-option-${index}`
}

function firstEnabledIndex(direction = 1, start = direction > 0 ? 0 : selectOptions.value.length - 1) {
  let index = start
  while (index >= 0 && index < selectOptions.value.length) {
    if (!selectOptions.value[index]?.disabled) return index
    index += direction
  }
  return -1
}

function setActiveIndex(index: number) {
  // 单选菜单保留触发器焦点，以 aria-activedescendant 指示活动项；跳过禁用项且不循环到另一端。
  if (!selectOptions.value.length) {
    activeIndex.value = -1
    return
  }
  const direction = index >= activeIndex.value ? 1 : -1
  const nextIndex = firstEnabledIndex(direction, Math.min(Math.max(index, 0), selectOptions.value.length - 1))
  activeIndex.value = nextIndex
  if (nextIndex >= 0) void nextTick(() => document.getElementById(optionId(nextIndex))?.scrollIntoView({ block: 'nearest' }))
}

function openMenu() {
  if (disabled) return
  isOpen.value = true
  emit('openChange', true)
  const selectedIndex = selectOptions.value.findIndex((option) => option.value === String(model.value ?? ''))
  setActiveIndex(selectedIndex >= 0 ? selectedIndex : firstEnabledIndex())
}

function closeMenu(restoreFocus = false) {
  if (!isOpen.value) return
  isOpen.value = false
  activeIndex.value = -1
  typedPrefix = ''
  emit('openChange', false)
  if (restoreFocus) void nextTick(() => triggerRef.value?.focus())
}

function chooseOption(option: SelectOption) {
  if (option.disabled) return
  model.value = option.value
  emit('change', option.value)
  closeMenu(true)
}

function moveActive(direction: number) {
  if (!isOpen.value) {
    openMenu()
    return
  }
  const next = firstEnabledIndex(direction, activeIndex.value + direction)
  if (next >= 0) setActiveIndex(next)
}

function findByPrefix(key: string) {
  if (!isOpen.value) openMenu()
  const now = performance.now()
  const letter = key.toLocaleLowerCase()
  const extending = now - lastTypedAt < 700 && typedPrefix !== letter
  typedPrefix = (extending ? typedPrefix : '') + letter
  lastTypedAt = now
  const count = selectOptions.value.length
  for (let offset = 0; offset < count; offset++) {
    const index = (Math.max(0, activeIndex.value + (extending ? 0 : 1)) + offset) % count
    const option = selectOptions.value[index]
    if (option && !option.disabled && option.label.toLocaleLowerCase().startsWith(typedPrefix)) {
      setActiveIndex(index)
      return
    }
  }
}

function triggerKeydown(event: KeyboardEvent) {
  if (disabled) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveActive(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveActive(-1)
  } else if (event.key === 'Home' && isOpen.value) {
    event.preventDefault()
    setActiveIndex(firstEnabledIndex())
  } else if (event.key === 'End' && isOpen.value) {
    event.preventDefault()
    setActiveIndex(firstEnabledIndex(-1))
  } else if ((event.key === 'Enter' || event.key === ' ') && isOpen.value) {
    event.preventDefault()
    const option = selectOptions.value[activeIndex.value]
    if (option) chooseOption(option)
  } else if (event.key === 'Escape' && isOpen.value) {
    event.preventDefault()
    event.stopPropagation()
    closeMenu(true)
  } else if (event.key.length === 1 && event.key !== ' ' && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault()
    findByPrefix(event.key)
  }
}

function documentPointerDown(event: PointerEvent) {
  const target = event.target
  if (!(target instanceof Node)) return
  const shell = (target as Element).closest('.nothing-input-shell')
  if (!shell || shell !== triggerRef.value?.parentElement) closeMenu()
}

function handleBlur() {
  closeMenu()
  emit('blur', String(model.value ?? ''))
}

watch(isOpen, (open, _previous, onCleanup) => {
  if (!open) return
  document.addEventListener('pointerdown', documentPointerDown)
  onCleanup(() => document.removeEventListener('pointerdown', documentPointerDown))
})
</script>

<template>
  <button
    ref="triggerRef"
    v-bind="$attrs"
    :id="id"
    class="nothing-input-control nothing-input-select-trigger tw:appearance-none tw:flex tw:items-center tw:justify-between tw:gap-[12px] tw:text-left tw:cursor-pointer"
    :class="[controlClasses, variant === 'compact' ? 'tw:[&&]:pr-[11px]' : 'tw:[&&]:pr-[13px]']"
    type="button"
    role="combobox"
    aria-haspopup="listbox"
    :aria-expanded="isOpen ? 'true' : 'false'"
    :aria-controls="isOpen ? listboxId : undefined"
    :aria-activedescendant="isOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined"
    :aria-required="required ? 'true' : undefined"
    :aria-label="accessibleLabel"
    :aria-invalid="invalid ? 'true' : undefined"
    :aria-describedby="describedBy"
    :disabled="disabled"
    :autofocus="autofocus"
    @click="isOpen ? closeMenu() : openMenu()"
    @keydown="triggerKeydown"
    @blur="handleBlur"
  >
    <span class="nothing-input-select-value tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap" :class="{ 'nothing-input-select-placeholder tw:text-dim': !hasValue }">{{ selectLabel }}</span>
    <span class="nothing-input-select-chevron tw:flex-[0_0_auto] tw:size-[9px] tw:border-r tw:border-b tw:border-current tw:[transition:transform_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out)]" :class="isOpen ? 'tw:text-text-display tw:[transform:translateY(2px)_rotate(225deg)]' : 'tw:text-muted tw:[transform:translateY(-2px)_rotate(45deg)]'" aria-hidden="true" />
  </button>

  <ul v-if="isOpen" :id="listboxId" class="nothing-input-select-menu tw:absolute tw:z-[30] tw:top-[calc(100%+8px)] tw:right-0 tw:left-0 tw:max-h-[280px] tw:m-0 tw:py-2xs tw:px-0 tw:overflow-y-auto tw:border tw:border-solid tw:border-control-border tw:rounded-[8px] tw:bg-surface-raised tw:text-text tw:list-none tw:font-data tw:text-body tw:font-normal tw:leading-[normal] tw:overscroll-contain" role="listbox" :aria-label="accessibleLabel">
    <li
      v-for="(option, index) in selectOptions"
      :id="optionId(index)"
      :key="`${option.value}-${index}`"
      class="nothing-input-select-option tw:relative tw:flex tw:items-center tw:min-h-[44px] tw:border-l-[2px] tw:[border-left-style:solid] tw:py-[10px] tw:pr-[13px] tw:[overflow-wrap:anywhere] tw:[transition:background-color_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out)]"
      :class="[
        { 'is-active': index === activeIndex, 'is-selected': option.value === String(model ?? ''), 'is-disabled': option.disabled },
        index === activeIndex ? 'tw:bg-surface' : '',
        option.value === String(model ?? '') ? 'tw:border-l-accent tw:pl-[11px] tw:text-text-display' : 'tw:border-l-transparent tw:pl-[13px]',
        option.disabled ? 'tw:cursor-not-allowed tw:opacity-40 tw:[&:hover]:bg-transparent' : 'tw:cursor-pointer tw:[&:hover]:bg-surface',
      ]"
      role="option"
      :aria-selected="option.value === String(model ?? '') ? 'true' : 'false'"
      :aria-disabled="option.disabled ? 'true' : undefined"
      @mousedown.prevent
      @click="chooseOption(option)"
    >
      <span>{{ option.label }}</span>
    </li>
    <li v-if="!selectOptions.length" class="nothing-input-select-empty tw:min-h-[44px] tw:p-[13px] tw:text-dim tw:font-data tw:text-label tw:font-normal tw:leading-[normal] tw:tracking-[.06em]" role="presentation">{{ t('[NO OPTIONS]') }}</li>
  </ul>
</template>
