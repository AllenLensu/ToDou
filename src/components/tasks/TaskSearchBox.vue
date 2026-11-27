<script setup lang="ts">
import { t } from '../../i18n'
import { shallowRef } from 'vue'
import AppIcon from '../ui/AppIcon.vue'
import NothingInput from '../ui/NothingInput.vue'

defineProps<{ active: boolean; resultCount: number; scopeLabel: string }>()
const query = defineModel<string>({ required: true })
const emit = defineEmits<{ 'open-first': [target: 'list' | 'detail'] }>()
// 搜索组词状态：确认中文候选时不能误触发打开结果。
const composing = shallowRef(false)

function openFirstResult(event: KeyboardEvent) {
  // IME 确认候选的 Enter 不能误开任务；兼容仍报告 229 的输入法。
  if (event.isComposing || event.keyCode === 229 || composing.value) return
  if (!['Enter', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  emit('open-first', event.key === 'Enter' ? 'detail' : 'list')
}
</script>

<template>
  <div class="task-search" role="search" :aria-label="t('搜索任务')">
    <div class="search-controls tw:flex tw:items-center tw:gap-xs tw:[&>.nothing-input]:flex-1">
      <AppIcon class="search-icon" name="search" />
      <NothingInput
        id="todou-task-search"
        v-model="query"
        type="search"
        :label="t('搜索任务')"
        placeholder-mode="raw"
        :placeholder="t('搜索标题、备注、检查项、分类或标签')"
        autocomplete="off"
        aria-keyshortcuts="/"
        aria-describedby="todou-search-status"
        @keydown="openFirstResult"
        @compositionstart="composing = true"
        @compositionend="composing = false"
      />
      <button v-if="query" class="button button-quiet touch-target tw:shrink-0 tw:min-h-[44px] tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:text-text tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:[&:hover:not(:active):not(:disabled)]:opacity-[.78] tw:active:opacity-100 tw:disabled:cursor-wait tw:disabled:opacity-50 tw:border tw:border-solid tw:border-control-border tw:bg-transparent tw:[&:hover:not(:active)]:border-text tw:[&:hover]:text-text-display tw:active:border-text-display tw:active:text-text-display" type="button" @click="query = ''">{{ t('清除搜索') }}</button>
    </div>
    <p id="todou-search-status" class="search-summary tw:mt-xs tw:text-muted tw:text-label tw:leading-[1.5]" :class="{ 'search-summary-idle': !active }" role="status" aria-live="polite" aria-atomic="true">
      {{ active ? t('{0} · {1} 条结果', scopeLabel, resultCount) : t('搜索全部未删除任务 · / 聚焦') }}
    </p>
  </div>
</template>

<style scoped>
.search-controls { position: relative; }
.search-icon { position: absolute; inset-inline-start: 12px; z-index: 2; color: var(--muted); pointer-events: none; }
.search-controls :deep(input[type='search']) { padding-inline-start: 42px; }
.search-controls :deep(input::-webkit-search-cancel-button) { appearance: none; }
@media (max-width: 820px) {
  .search-summary-idle { display: none; }
}
</style>
