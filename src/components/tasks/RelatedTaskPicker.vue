<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { getLocale, t } from '../../i18n'
import {statusLabel} from '../../domain/taskUi';
import type { Category, Task } from '../../storage/types'
import NothingInput from '../ui/NothingInput.vue'

const props = defineProps<{
  selectedId: string
  availableRelatedTasks: readonly Task[]
  categories: readonly Category[]
}>()
const relatedTaskIds = defineModel<readonly string[]>('relatedTaskIds', { required: true })
const emit = defineEmits<{
  'open-related-task': [task: Task]
}>()

const pageSize = 30
const search = shallowRef('')
const limit = shallowRef(pageSize)
watch(() => props.selectedId, () => {
  search.value = ''
  limit.value = pageSize
})
watch(search, () => { limit.value = pageSize })

const selection = computed(() => new Set(relatedTaskIds.value))
const selectedTasks = computed(() => props.availableRelatedTasks.filter(task => selection.value.has(task.id)))
const matchingTasks = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return props.availableRelatedTasks.filter(task => !selection.value.has(task.id) && (!query || task.title.toLocaleLowerCase().includes(query)))
})
const visibleTasks = computed(() => matchingTasks.value.slice(0, limit.value))
const displayedTasks = computed(() => [...selectedTasks.value, ...visibleTasks.value])

const dateFormatter = computed(() => new Intl.DateTimeFormat(getLocale(), { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))
const categoryNames = computed(() => new Map(props.categories.map(item => [item.id, item.name])))
function taskSummary(task: Task) {
  const status = statusLabel(task.status) ?? t('未设置状态');
  const category = task.categoryId ? categoryNames.value.get(task.categoryId) : undefined
  const date = task.dueAt ?? task.remindAt
  const time = date ? dateFormatter.value.format(new Date(date)) : ''
  return [status, category, time && (task.dueAt ? t('截止 ') : t('提醒 ')) + time, task.notes?.replace(/\s+/g, ' ').trim().slice(0, 40)].filter(Boolean).join(' · ')
}
const titleCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const task of props.availableRelatedTasks) counts.set(task.title, (counts.get(task.title) ?? 0) + 1)
  return counts
})
// Only repeated titles need context; ordinary candidates never read or format their dates/notes.
const duplicateDetails = computed(() => {
  const summaries = new Map<string, string>()
  const counts = new Map<string, number>()
  for (const task of props.availableRelatedTasks) {
    if ((titleCounts.value.get(task.title) ?? 0) < 2) continue
    const summary = taskSummary(task)
    summaries.set(task.id, summary)
    const key = JSON.stringify([task.title, summary])
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return { summaries, counts }
})
function taskDetail(task: Task) {
  const { summaries, counts } = duplicateDetails.value
  const summary = summaries.get(task.id) ?? ''
  return (counts.get(JSON.stringify([task.title, summary])) ?? 0) > 1 ? summary + ' · #' + task.id.slice(-8) : summary
}

function setRelatedTask(taskId: string, event: Event) {
  const next = new Set(relatedTaskIds.value)
  if ((event.target as HTMLInputElement).checked) next.add(taskId)
  else next.delete(taskId)
  relatedTaskIds.value = [...next]
}
</script>

<template>
  <div class="field tw:grid tw:gap-xs tw:mb-md">
    <span class="field-label tw:text-muted tw:font-data tw:text-label tw:font-normal tw:leading-[normal] tw:tracking-[.06em] tw:uppercase">{{ t('关联任务（独立任务之间）') }}</span>
    <NothingInput v-model="search" :label="t('搜索关联任务')" show-label type="search" :placeholder="t('输入任务标题')" @keydown.enter.prevent />
    <small class="field-help tw:text-dim tw:text-label" role="status">{{ t('已关联 {0} 项，始终显示在前 · 待选显示 {1} / {2} 项。', selectedTasks.length, visibleTasks.length, matchingTasks.length) }}</small>
    <div class="tag-picker tw:flex tw:flex-wrap tw:gap-xs tw:max-h-[320px] tw:overflow-y-auto">
      <div v-for="task in displayedTasks" :key="task.id" class="tw:inline-flex tw:items-center tw:gap-xs tw:max-w-full">
        <label class="tag-option tw:inline-flex tw:items-center tw:min-h-[44px] tw:gap-[7px] tw:border tw:border-solid tw:border-control-border tw:rounded-[999px] tw:py-[7px] tw:px-[12px] tw:text-muted tw:text-label tw:cursor-pointer tw:[transition:border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:active:border-text-display tw:active:text-text-display tw:[&:has(input:checked)]:text-text-display tw:[&:has(input:checked)]:bg-surface-raised tw:[&:has(input:checked)]:border-text">
          <input
            type="checkbox"
            class="tw:w-auto tw:min-h-[auto] tw:accent-text-display"
            :checked="selection.has(task.id)"
            @change="setRelatedTask(task.id, $event)"
          />
          <span class="tw:min-w-0 tw:[overflow-wrap:anywhere]"><small v-if="selection.has(task.id)" class="tw:mr-xs tw:text-dim">{{ t('已关联') }}</small>{{ task.title }}<small v-if="(titleCounts.get(task.title) ?? 0) > 1" class="tw:block tw:text-dim">{{ taskDetail(task) }}</small></span>
        </label>
        <button v-if="selection.has(task.id)" class="button button-quiet touch-target tw:min-h-[44px] tw:px-[12px] tw:border-0 tw:rounded-[999px] tw:bg-transparent tw:text-muted tw:font-data tw:text-label tw:[&:hover]:text-text-display" type="button" :aria-label="t('打开关联任务 {0}', task.title)" @click="emit('open-related-task', task)">{{ t('打开') }}</button>
      </div>
    </div>
    <p v-if="!matchingTasks.length" class="field-help tw:text-dim tw:text-label">{{ search.trim() ? t('没有匹配的待选任务，试试其他标题。') : t('暂无其他可关联任务。') }}</p>
    <button v-if="visibleTasks.length < matchingTasks.length" type="button" class="button button-quiet touch-target tw:min-h-[44px] tw:justify-self-start tw:border tw:border-control-border tw:rounded-[999px] tw:py-xs tw:px-sm tw:bg-transparent tw:text-text tw:text-label" @click="limit += pageSize">{{ t('再显示 30 项') }}</button>
    <small class="field-help tw:text-dim tw:text-label tw:leading-[1.5]">{{ t('关联只用于互相跳转，不改变父子层级。') }}</small>
  </div>
</template>
