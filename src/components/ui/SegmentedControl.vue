<script setup lang="ts" generic="T extends string">
/**
 * 分段单选控件：以 radiogroup 暴露语义，方向键循环切换选项及焦点。
 */
import { computed, onBeforeUnmount, useTemplateRef, watch } from 'vue'
import { attachSegmentThumb } from './segmentThumb'

const {
  options,
  label,
  size,
  spring = true,
} = defineProps<{
  options: ReadonlyArray<{ value: T; label: string }>
  label: string
  size?: 'default' | 'compact'
  spring?: boolean
}>()

const model = defineModel<T>({ required: true })
const hasSelection = computed(() => options.some(option => option.value === model.value))
// 游走焦点：仅选中项可由 Tab 进入，模型未匹配时退到首项；方向键同时更新选值与实际焦点。
const buttons = useTemplateRef<HTMLButtonElement[]>('buttons')
const group = useTemplateRef<HTMLElement>('group')
const track = useTemplateRef<HTMLElement>('track')
let thumb: ReturnType<typeof attachSegmentThumb> | undefined

watch([track, () => options], () => {
  thumb?.destroy()
  thumb = group.value && track.value
    ? attachSegmentThumb(group.value, track.value, index => { model.value = options[index].value })
    : undefined
}, { flush: 'post' })
watch(model, () => thumb?.syncSelection(), { flush: 'post' })
onBeforeUnmount(() => thumb?.destroy())

function move(index: number, delta: number) {
  const next = (index + delta + options.length) % options.length
  model.value = options[next].value
  buttons.value?.[next]?.focus()
}
</script>

<template>
  <div ref="group" class="segmented tw:inline-flex tw:w-fit tw:max-w-full tw:p-[2px] tw:border tw:border-solid tw:border-control-border tw:rounded-[999px] tw:gap-[2px]" :class="{ 'segmented-compact': size === 'compact', 'segmented-spring': spring }" role="radiogroup" :aria-label="label">
    <span v-if="spring && hasSelection" ref="track" class="segment-track" aria-hidden="true"><span class="segment-thumb" /></span>
    <button
      v-for="(option, index) in options"
      :key="option.value"
      ref="buttons"
      class="segmented-option tw:min-h-[44px] tw:min-w-[44px] tw:py-xs tw:border-0 tw:rounded-[999px] tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.08em] tw:uppercase tw:whitespace-nowrap"
      :class="[
        { active: model === option.value },
        { 'tw:[transition:background-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out)]': !spring },
        size === 'compact' ? 'tw:px-[12px]' : 'tw:px-sm',
        !spring && model === option.value ? 'tw:bg-text-display tw:text-bg tw:[&:hover]:text-bg' : 'tw:bg-transparent tw:text-muted tw:[&:hover]:text-text-display',
      ]"
      type="button"
      role="radio"
      :aria-checked="model === option.value"
      :tabindex="model === option.value || (index === 0 && !hasSelection) ? 0 : -1"
      @click="model = option.value"
      @keydown.right.prevent="move(index, 1)"
      @keydown.down.prevent="move(index, 1)"
      @keydown.left.prevent="move(index, -1)"
      @keydown.up.prevent="move(index, -1)"
    >
      {{ option.label }}
      <span v-if="spring && hasSelection" class="segment-ink" aria-hidden="true">{{ option.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.segmented-spring {
  position: relative;
  touch-action: pan-y pinch-zoom;
  user-select: none;
}
.segment-track {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: inherit;
  pointer-events: none;
}
.segment-thumb {
  position: absolute;
  inset: 2px auto 2px 0;
  width: var(--thumb-width, 0px);
  transform: translateX(var(--thumb-x, 0px));
  border-radius: inherit;
  background: var(--text-display);
}
.segmented-spring .segmented-option { position: relative; }
/* 文字仅在滑块覆盖的区域反色，移动途中仍能读清每个选项。 */
.segment-ink {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--bg);
  pointer-events: none;
  clip-path: inset(0 calc(100% + var(--option-x) - var(--thumb-x) - var(--thumb-width)) 0 calc(var(--thumb-x) - var(--option-x)) round 999px);
}
</style>
