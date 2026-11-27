<script setup lang="ts">
import { getLocale, t } from '../../i18n'

// 单行只派发选择、状态及删除／恢复意图；父层处理草稿保护、写入及列表刷新。
import { computed, shallowRef, useId, useTemplateRef, watch } from 'vue'
import { isOverdue } from '../../domain/taskFilters'
import {priorityLabel, statusLabel} from '../../domain/taskUi';
import type { Task, TaskStatus } from '../../storage/types'
import type { SearchDocument } from '../../domain/taskSearch'
import SearchEvidence from './SearchEvidence.vue'

import { useReminderDisplay } from '../../composables/useReminderDisplay'
import { useOptionalTaxonomyLookup } from '../../composables/workspaceContexts'

const snoozedTime = useReminderDisplay()
const taxonomy = useOptionalTaxonomyLookup()
const props = defineProps<{
  task: Task
  /** 列表嵌套层级只用于缩进展示，不提供树线或折叠行为。 */
  depth?: number
  searchDocument?: SearchDocument
  searchTokens?: readonly string[]
  selectedId: string | null
  showTrash: boolean
  now: Date
  tagLabel?: (tagId: string) => string
}>()

const emit = defineEmits<{
  select: [task: Task]
  'set-status': [task: Task, status: TaskStatus]
  restore: [task: Task]
  'permanently-delete': [task: Task]
  remove: [task: Task]
}>()

function resolveTagLabel(tagId: string) {
  return taxonomy?.tagLabel(tagId) ?? props.tagLabel?.(tagId) ?? tagId
}

/** 列表只保留便于扫读的信息；操作发出事件，分类、父任务及重复规则在详情编辑。 */
const snooze = computed(() => snoozedTime('task', props.task.id))
const overdue = computed(() => isOverdue(props.task, props.now))
const showStatus = computed(() => !['todo', 'completed'].includes(props.task.status))
const hasMeta = computed(() => Boolean(showStatus.value || props.task.dueAt || props.task.remindAt || props.task.priority !== 'none' || props.task.tagIds.length))
const metaId = useId()
const confirmingDeletion = shallowRef(false)
const deletionPromptId = useId()
const deletionButton = useTemplateRef<HTMLButtonElement>('deletionButton')
const cancelDeletionButton = useTemplateRef<HTMLButtonElement>('cancelDeletionButton')

watch(cancelDeletionButton, button => button?.focus(), { flush: 'post' })

function closeDeletionPrompt() {
  confirmingDeletion.value = false
  deletionButton.value?.focus()
}

function confirmDeletion() {
  closeDeletionPrompt()
  emit('permanently-delete', props.task)
}

const statusClasses: Record<TaskStatus, string> = {
  todo: 'status-todo',
  in_progress: 'status-in_progress',
  waiting: 'status-waiting',
  paused: 'status-paused',
  completed: 'status-completed',
  cancelled: 'status-cancelled',
}
const priorityClasses: Record<Task['priority'], string> = {
  none: '',
  low: 'task-priority-low tw:text-muted',
  medium: 'task-priority-medium',
  high: 'task-priority-high tw:text-text-display tw:font-bold',
}

function formatDue(value: string) {
  const date = new Date(value)
  const sameYear = date.getFullYear() === props.now.getFullYear()
  if (getLocale() === 'en') return date.toLocaleString('en', {
    month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric', hour: 'numeric', minute: '2-digit',
  })
  const day = `${sameYear ? '' : `${date.getFullYear()}/`}${date.getMonth() + 1}/${date.getDate()}`
  return `${day} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <article
    class="task-row tw:items-start tw:gap-xs tw:py-[10px] tw:pr-[10px] tw:ml-[-10px] tw:border-l-2 tw:[border-left-style:solid]"
    :class="[
      { selected: task.id === selectedId, completed: task.status === 'completed', 'task-row-child': (depth ?? 0) > 0, 'task-row-trash': showTrash, 'task-row-search': !!searchDocument },
      task.id === selectedId
        ? 'tw:bg-surface-raised tw:border-l-accent'
        : 'tw:bg-transparent tw:border-l-transparent tw:[&:hover]:bg-surface tw:focus-within:bg-surface',
      showTrash ? 'tw:flex tw:flex-wrap' : 'tw:grid tw:grid-cols-[44px_minmax(0,1fr)_44px]',
    ]"
    :style="{ '--depth': Math.min(depth ?? 0, 4) }"
    @click="emit('select', task)"
  >
    <button
      v-if="!showTrash"
      class="status-dot touch-target tw:relative tw:w-[44px] tw:h-[44px] tw:m-0 tw:p-0 tw:border-0 tw:rounded-full tw:bg-transparent tw:[transition:background-color_var(--motion-fast)_var(--ease-out)]"
      :class="statusClasses[task.status]"
      type="button"
      :aria-pressed="task.status === 'completed'"
      :aria-label="t('将{0}标记为{1}', task.title, task.status === 'completed' ? t('待办') : t('已完成'))"
      @click.stop="emit('set-status', task, task.status === 'completed' ? 'todo' : 'completed')"
    />
    <div class="task-main tw:min-w-0 tw:min-h-[44px] tw:pt-[12px] tw:cursor-pointer">
      <h3 class="tw:m-0 tw:text-body tw:font-normal tw:leading-[1.5]">
        <button
          class="task-main-selectable tw:block tw:w-full tw:m-0 tw:p-0 tw:border-0 tw:bg-transparent tw:text-left tw:cursor-pointer tw:rounded-[2px] tw:truncate tw:[transition:color_var(--motion-fast)_var(--ease-out)] tw:focus-visible:outline-2 tw:focus-visible:outline-solid tw:focus-visible:outline-interactive tw:focus-visible:outline-offset-[4px]"
          :class="task.status === 'completed' ? 'tw:text-dim tw:line-through' : 'tw:text-text'"
          type="button"
          :aria-current="task.id === selectedId ? 'true' : undefined"
          :aria-describedby="hasMeta ? metaId : undefined"
          @click.stop="emit('select', task)"
        >{{ task.title }}</button>
      </h3>
      <p v-if="hasMeta" :id="metaId" class="task-data tw:flex tw:flex-wrap tw:items-center tw:gap-x-[12px] tw:gap-y-2xs tw:mt-2xs tw:text-muted tw:font-data tw:text-label tw:font-normal tw:tracking-[.04em] tw:leading-[1.4]">
        <span v-if="showStatus" class="task-datum tw:inline-flex tw:gap-[6px] tw:items-baseline tw:text-text tw:[.completed_&]:text-dim">{{ statusLabel(task.status) }}</span>
        <span v-if="task.dueAt" class="task-datum tw:inline-flex tw:flex-wrap tw:gap-x-[6px] tw:items-baseline tw:[.completed_&]:text-dim" :class="overdue ? 'task-datum-overdue tw:text-accent-text' : 'tw:text-text'">
          <span class="task-datum-label" :class="overdue ? 'tw:text-accent-text' : 'tw:text-dim'">{{ overdue ? t('截止 · 逾期') : t('截止') }}</span>{{ formatDue(task.dueAt) }}
        </span>
        <span v-if="task.remindAt" class="task-datum tw:inline-flex tw:flex-wrap tw:gap-x-[6px] tw:items-baseline tw:[.completed_&]:text-dim">
          <span class="task-datum-label tw:text-dim">{{ snooze ? t('已推迟至') : t('提醒') }}</span>{{ formatDue(snooze ? new Date(snooze).toISOString() : task.remindAt) }}
        </span>
        <span v-if="task.priority !== 'none'" class="task-datum tw:inline-flex tw:gap-[6px] tw:items-baseline tw:[.completed_&]:text-dim" :class="[priorityClasses[task.priority], { 'tw:text-text': task.priority === 'medium' }]">
          <span class="task-datum-label tw:text-dim">{{ t('优先') }}</span>{{ priorityLabel(task.priority) }}
        </span>
        <span v-for="tagId in task.tagIds" :key="tagId" class="task-tag tw:py-px tw:px-[6px] tw:border tw:border-solid tw:border-control-border tw:rounded-[4px] tw:text-muted tw:tracking-[.04em]">{{ resolveTagLabel(tagId) }}</span>
      </p>
      <SearchEvidence v-if="searchDocument" :document="searchDocument" :tokens="searchTokens ?? []" />
    </div>
    <div v-if="showTrash" class="trash-actions">
      <button class="trash-btn restore-button action-button" type="button" :aria-label="t('恢复任务「{0}」', task.title)" @click.stop="emit('restore', task)">{{ t('恢复') }}</button>
      <button ref="deletionButton" class="trash-btn action-button is-quiet" type="button" :aria-label="t('永久删除「{0}」', task.title)" :aria-expanded="confirmingDeletion" :aria-controls="confirmingDeletion ? deletionPromptId : undefined" @click.stop="confirmingDeletion = !confirmingDeletion">{{ t('永久删除') }}</button>
    </div>
    <button v-else class="delete-button touch-target tw:self-start tw:justify-self-end tw:min-w-[44px] tw:min-h-[44px] tw:text-dim tw:bg-transparent tw:border-0 tw:font-data tw:text-label tw:font-normal tw:leading-[normal] tw:py-[10px] tw:px-2xs tw:[transition:color_var(--motion-fast)_var(--ease-out),opacity_var(--motion-fast)_var(--ease-out)] tw:active:text-accent-text tw:[&:hover]:text-accent-text tw:focus-visible:text-accent-text" type="button" :aria-label="t('删除任务「{0}」', task.title)" @click.stop="emit('remove', task)">{{ t('删除') }}</button>
    <div v-if="showTrash && confirmingDeletion" :id="deletionPromptId" class="trash-confirmation" @click.stop @keydown.esc.stop.prevent="closeDeletionPrompt">
      <p class="trash-confirmation-text" role="alert">{{ t('永久删除「{0}」？此操作无法撤销。', task.title) }}
        <template v-if="task.recurrenceSeriesId === task.id && task.recurrenceRule">{{ t('这会停止该系列的重复。已有期次会保留为独立任务。') }}</template>
      </p>
      <button ref="cancelDeletionButton" class="trash-btn action-button" type="button" @click="closeDeletionPrompt">{{ t('取消') }}</button>
      <button class="trash-btn confirm-delete action-button is-danger" type="button" @click="confirmDeletion">{{ t('确认永久删除') }}</button>
    </div>
  </article>
</template>

<style scoped>
/* Search results must be fully readable as soon as the query has rendered. */
.task-row-search { animation: none; }
.task-row-trash .task-main { flex: 1 1 10rem; }
.trash-actions, .trash-confirmation { display: flex; flex-wrap: wrap; gap: var(--space-xs); }
.trash-confirmation { flex-basis: 100%; padding-top: var(--space-xs); border-top: 1px solid var(--line); }
.trash-confirmation-text { flex-basis: 100%; overflow-wrap: anywhere; font-size: var(--type-label); }
</style>
