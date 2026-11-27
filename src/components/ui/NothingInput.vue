<script setup lang="ts">
import { feedbackText, t } from '../../i18n'

// 统一原生文本输入、自定义单选及日期入口；属性显式分发到实际控件，保持标签和错误关联。
import {
  computed,
  shallowRef,
  useAttrs,
  useId,
} from 'vue'
import NothingDateTimePicker from './NothingDateTimePicker.vue'
import NothingSelectControl from './NothingSelectControl.vue'

// 额外属性和未声明事件显式转发给实际控件（下拉和日期分支继续转发给触发器），而非外层容器。
defineOptions({ inheritAttrs: false })

type InputKind = 'input' | 'textarea' | 'select'
type InputVariant = 'default' | 'hero' | 'compact'
type InputPlaceholderMode = 'contextual' | 'raw'

export interface NothingInputOption {
  value: string | number
  label: string
  disabled?: boolean
}

const {
  kind = 'input',
  type = 'text',
  label,
  showLabel = false,
  id,
  ariaLabel,
  ariaDescribedby,
  placeholder,
  placeholderMode = 'contextual',
  variant = 'default',
  required = false,
  disabled = false,
  autofocus = false,
  rows = 4,
  options,
  help,
  error,
} = defineProps<{
  kind?: InputKind
  type?: string
  label?: string
  showLabel?: boolean
  id?: string
  ariaLabel?: string
  ariaDescribedby?: string
  placeholder?: string
  placeholderMode?: InputPlaceholderMode
  variant?: InputVariant
  required?: boolean
  disabled?: boolean
  autofocus?: boolean
  rows?: number
  options?: readonly NothingInputOption[]
  help?: string
  error?: string
}>()

const model = defineModel<string | number>({ default: '' })

const emit = defineEmits<{
  change: [value: string | number]
  blur: [value: string | number]
}>()

const generatedId = useId()
// 普通 input 由原生 v-model 处理中文组词；转发组词／键盘事件，搜索与快速新建由调用方拦截误提交。
const inputValue = computed({
  get: () => model.value ?? '',
  set: (value: string | number) => { model.value = value },
})
const controlId = computed(() => id ?? generatedId)
const listboxId = `${generatedId}-listbox`
const attrs = useAttrs()
const selectOpen = shallowRef(false)
const inheritedAriaLabel = computed(() => {
  const value = attrs['aria-label']
  return typeof value === 'string' ? value : undefined
})
const contextualPlaceholder = computed(() => {
  const hint = placeholder?.trim()
  if (placeholderMode === 'raw' || !label || !hint) return hint || label || ariaLabel || inheritedAriaLabel.value || ''
  return t('{0}｜{1}', label, hint)
})
const accessibleLabel = computed(() => ariaLabel || label || inheritedAriaLabel.value || contextualPlaceholder.value || undefined)
const hasValue = computed(() => model.value !== '' && model.value !== null && model.value !== undefined)
const pickerType = computed(() => kind === 'input' && (type === 'date' || type === 'time' || type === 'datetime-local') ? type : null)
const describedBy = computed(() => {
  const ids = []
  if (ariaDescribedby) ids.push(ariaDescribedby)
  if (help) ids.push(`${controlId.value}-help`)
  if (error) ids.push(`${controlId.value}-error`)
  return ids.length ? ids.join(' ') : undefined
})

// 完整字面量确保 Tailwind 可扫描各输入变体；日期触发器的等价样式由日期组件维护。
const controlClasses = computed(() => [
  'tw:relative tw:z-[1] tw:w-full tw:border tw:border-solid tw:rounded-[8px] tw:bg-surface tw:[outline:none] tw:font-data tw:font-normal tw:leading-[normal] tw:[transition:border-color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-slow)_var(--ease-standard),color_var(--motion-slow)_var(--ease-standard)] tw:[&:hover]:bg-surface-raised tw:focus:bg-surface-raised tw:focus:caret-text-display tw:focus-visible:outline-offset-[3px] tw:placeholder:text-dim tw:placeholder:opacity-100 tw:disabled:cursor-not-allowed tw:disabled:opacity-40',
  kind === 'select'
    ? 'tw:focus-visible:outline-2 tw:focus-visible:outline-solid tw:focus-visible:outline-interactive'
    : 'tw:focus-visible:[outline:2px_solid_transparent]',
  variant === 'hero'
    ? 'tw:min-h-[56px] tw:text-text-display tw:text-[18px] tw:py-[14px] tw:px-[15px]'
    : variant === 'compact'
      ? 'tw:min-h-[44px] tw:text-text tw:text-label tw:py-xs tw:px-[11px]'
      : 'tw:min-h-[48px] tw:text-text tw:text-body tw:py-[11px] tw:px-[13px]',
  error
    ? 'tw:border-accent tw:[&:hover]:border-accent tw:focus:border-accent'
    : variant === 'hero'
      ? 'tw:border-text tw:[&:hover]:border-text tw:focus:border-text'
      : 'tw:border-control-border tw:[&:hover:not(:focus)]:border-text tw:focus:border-text-display',
  'tw:[.field-title_&]:text-text-display tw:[.field-title_&]:text-body tw:[.field-title_&]:py-[12px] tw:[.field-title_&]:px-[13px] tw:[.field-title_&]:tracking-[-.02em] tw:[.quick-add_&&]:pr-[72px]',
])

function valueFromEvent(event: Event) {
  const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value
  if (type === 'number') return value === '' ? '' : Number(value)
  return value
}

function update(event: Event) {
  model.value = valueFromEvent(event)
}

function change(event: Event) {
  emit('change', valueFromEvent(event))
}

function blur(event: Event) {
  emit('blur', valueFromEvent(event))
}
</script>

<template>
  <div class="nothing-input tw:grid tw:gap-xs tw:min-w-0" :class="[`nothing-input-${variant}`, { 'nothing-input-invalid': error, 'nothing-input-disabled': disabled, 'nothing-input-has-value': hasValue }]">
    <label v-if="label && showLabel" class="nothing-input-label tw:text-muted tw:font-data tw:text-label tw:font-normal tw:leading-[normal] tw:tracking-[.06em] tw:uppercase" :for="controlId">
      {{ label }} <b v-if="required" class="tw:text-accent-text tw:font-bold" aria-hidden="true">*</b>
    </label>

    <div class="nothing-input-shell tw:relative tw:min-w-0 tw:isolate" :class="{ 'nothing-input-shell-motion': kind !== 'select', 'nothing-input-shell-singleline': kind === 'input', 'nothing-input-shell-select': kind === 'select', 'nothing-input-shell-select-open tw:z-[20]': kind === 'select' && selectOpen, 'nothing-input-shell-picker': pickerType }">
      <textarea
        v-if="kind === 'textarea'"
        v-bind="$attrs"
        :id="controlId"
        class="nothing-input-control tw:resize-y tw:[&&]:min-h-[96px] tw:[&&]:leading-[1.5] tw:[scrollbar-gutter:stable] tw:[&&]:pe-[var(--scroll-reading-gap)]"
        :class="controlClasses"
        :value="model ?? ''"
        :placeholder="contextualPlaceholder"
        :required="required"
        :disabled="disabled"
        :autofocus="autofocus"
        :rows="rows"
        :aria-label="accessibleLabel"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
        @input="update"
        @change="change"
        @blur="blur"
      />

      <NothingSelectControl
        v-else-if="kind === 'select'"
        v-bind="$attrs"
        v-model="model"
        :id="controlId"
        :listbox-id="listboxId"
        :control-classes="controlClasses"
        :variant="variant"
        :placeholder="showLabel && !placeholder ? '' : contextualPlaceholder"
        :accessible-label="accessibleLabel"
        :described-by="describedBy"
        :required="required"
        :disabled="disabled"
        :autofocus="autofocus"
        :invalid="Boolean(error)"
        :options="options"
        @change="emit('change', $event)"
        @blur="emit('blur', $event)"
        @open-change="selectOpen = $event"
      >
        <slot />
      </NothingSelectControl>

      <NothingDateTimePicker
        v-else-if="pickerType"
        v-bind="$attrs"
        v-model="model"
        :id="controlId"
        :type="pickerType"
        :placeholder="contextualPlaceholder"
        :aria-label="accessibleLabel"
        :required="required"
        :disabled="disabled"
        :autofocus="autofocus"
        :invalid="Boolean(error)"
        :described-by="describedBy"
        @change="emit('change', $event)"
        @blur="emit('blur', $event)"
      />

      <input
        v-else
        v-bind="$attrs"
        v-model="inputValue"
        :id="controlId"
        class="nothing-input-control"
        :class="controlClasses"
        :type="type"
        :placeholder="contextualPlaceholder"
        :required="required"
        :disabled="disabled"
        :autofocus="autofocus"
        :aria-label="accessibleLabel"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
        @change="change"
        @blur="blur"
      />
    </div>

    <small v-if="help" :id="`${controlId}-help`" class="nothing-input-help tw:text-label tw:leading-[1.5] tw:text-dim">{{ help }}</small>
    <small v-if="error" :id="`${controlId}-error`" class="nothing-input-error tw:text-label tw:leading-[1.5] tw:text-accent-text">{{ t('[ERROR] {0}', feedbackText(error)) }}</small>
  </div>
</template>
