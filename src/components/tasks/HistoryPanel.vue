<script setup lang="ts">
import { getLocale, t } from '../../i18n'

// 展示工作区提供的当前任务历史；仅有可解析快照的条目显示恢复按钮，此处只发出恢复请求。
// 工作区先提交当前草稿，再由存储层核对历史所属任务并恢复任务字段与标签，不是整库恢复。
// 检查项和任务关联不随快照回滚；恢复为完成状态时，存储层仍可能按完成策略联动子项。
import { describeRecurrence } from '../../domain/recurrence'
import { historyLabel } from '../../domain/taskUi'
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import { isHistoryTextField, type HistoryTextField, type TaskHistoryEntry, type Task, type Category, type Tag } from '../../storage/types'

const props = defineProps<{
  current?: Task
  otherTasks: Task[]
  categories: Category[]
  tags: Tag[]
  canRestore: boolean
  canRestoreField: boolean
  entries: TaskHistoryEntry[]
}>()

const emit = defineEmits<{
  restore: [entry: TaskHistoryEntry, field?: HistoryTextField]
}>()

const reviewing = shallowRef<string | null>(null)
const previewHeading = useTemplateRef<HTMLElement>('previewHeading')
let previewTrigger: HTMLButtonElement | null = null
watch(() => props.current?.id, () => { reviewing.value = null })
const selected = computed(() => props.entries.find(e => e.id === reviewing.value))
const fieldKeys = [
  'title', 'notes', 'url', 'status', 'priority', 'dueAt', 'remindAt',
  'tagIds', 'categoryId', 'parentTaskId', 'completionStrategy',
  'recurrenceRule', 'recurrenceSeriesId', 'occurrenceAt', 'reminderSettings', 'deletedAt',
] as const
type Field = typeof fieldKeys[number]
const fieldLabels = computed<Record<Field, string>>(() => ({
  title: t('标题'), notes: t('备注'), url: t('链接'), status: t('状态'), priority: t('优先级'),
  dueAt: t('截止时间'), remindAt: t('提醒时间'), tagIds: t('标签'), categoryId: t('分类'),
  parentTaskId: t('父任务'), completionStrategy: t('完成策略'), recurrenceRule: t('重复规则'),
  recurrenceSeriesId: t('重复系列'), occurrenceAt: t('期次时间'), reminderSettings: t('提醒设置'),
  deletedAt: t('删除时间'),
}))
const valueLabels = computed<Record<string, string>>(() => ({
  todo: t('待办'), in_progress: t('进行中'), waiting: t('等待'), paused: t('暂停'), completed: t('已完成'),
  cancelled: t('已取消'), none: t('无'), low: t('低'), medium: t('中'), high: t('高'),
  require_children: t('先完成全部子项'), complete_parent_only: t('仅完成父任务'), complete_all_children: t('父子项一并完成'),
}))
const activeTagNames = computed(() => new Map(props.tags.map(tag => [tag.id, tag.name])))
const hasDeletedTags = computed(() => selected.value?.snapshot?.tagIds.some(id => !activeTagNames.value.has(id)))
function restorableTags(task: Task) {
  return task.tagIds.filter(id => activeTagNames.value.has(id)).sort()
}
function format(task: Task, key: Field): string {
  const value = task[key]
  if (key === 'tagIds') return restorableTags(task).map(id => activeTagNames.value.get(id)!).join(getLocale() === 'en' ? ', ' : '、') || t('无')
  if (value === null || value === '') return t('无')
  if (key === 'parentTaskId') return props.otherTasks.find(item => item.id === value)?.title ?? t('原父任务 ') + value
  if (key === 'recurrenceRule') return describeRecurrence(task.recurrenceRule)
  if (key === 'reminderSettings' && task.reminderSettings) {
    const r = task.reminderSettings
    return [r.mode === 'none' ? t('关闭提醒') : (r.strength === 'alarm' ? t('闹钟式提醒') : t('普通提醒')),
      r.followUpMinutes === null ? t('继承追提醒间隔') : t('每 {0} 分钟追提醒', r.followUpMinutes),
      r.quietHoursEnabled ? t('{0} 免打扰', r.quietStart + '–' + r.quietEnd) : t('免打扰关闭'),
      r.quietHoursEnabled && (r.notifyAfterQuietHours ? t('结束后补发') : t('结束后按间隔追提醒'))].filter(Boolean).join(' · ')
  }
  if (key === 'categoryId') return props.categories.find(c => c.id === value)?.name ?? String(value)
  if (['dueAt', 'remindAt', 'occurrenceAt', 'deletedAt'].includes(key)) return new Date(String(value)).toLocaleString(getLocale())
  if (key === 'status' || key === 'priority' || key === 'completionStrategy') return valueLabels.value[String(value)] ?? String(value)
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}
const changes = computed(() => {
  const before = props.current, after = selected.value?.snapshot
  if (!before || !after) return []
  return fieldKeys.filter(key => key === 'tagIds'
    ? JSON.stringify(restorableTags(before)) !== JSON.stringify(restorableTags(after))
    : JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map(key => ({ key, label: fieldLabels.value[key], from: format(before, key), to: format(after, key) }))
})
async function review(entry: TaskHistoryEntry, event: MouseEvent) {
  previewTrigger = event.currentTarget as HTMLButtonElement
  reviewing.value = entry.id
  await nextTick()
  previewHeading.value?.focus()
}
function closePreview() {
  reviewing.value = null
  previewTrigger?.focus()
}
function confirm() {
  if (selected.value && props.canRestore) emit('restore', selected.value)
  closePreview()
}
</script>

<template>
  <details class="history-panel tw:max-w-[680px] tw:mt-section" :aria-label="t('修改历史')">
    <summary class="section-heading history-heading history-summary tw:mb-md tw:min-h-[44px] tw:cursor-pointer tw:list-none tw:[&::-webkit-details-marker]:hidden tw:[.history-panel:not([open])_&]:mb-0 tw:[&:hover_h2]:text-text-display tw:flex tw:justify-between tw:items-start tw:gap-md">
      <div>
        <span class="section-kicker tw:font-data tw:tracking-[.08em] tw:uppercase tw:text-muted tw:text-label tw:mt-0 tw:mx-0 tw:mb-sm">{{ t('HISTORY') }}</span>
        <h2 class="tw:text-text-display tw:text-body tw:font-normal tw:tracking-[-.02em] tw:leading-[1.2]">{{ t('修改历史') }}</h2>
      </div>
      <span class="save-hint tw:font-data tw:tracking-[.08em] tw:uppercase tw:text-dim tw:text-label"><span class="history-toggle" aria-hidden="true"></span>{{ t('{0} 条记录', entries.length) }}</span>
    </summary>
    <p v-if="entries.length === 0" class="empty-state tw:max-w-[34rem] tw:text-muted tw:leading-[1.7] tw:text-body tw:py-2xl tw:px-0">{{ t('还没有修改历史。') }}</p>
    <TransitionGroup v-else name="history-row" tag="div" class="history-list tw:relative tw:grid tw:gap-px">
      <article v-for="entry in entries" :key="entry.id" class="history-row tw:flex tw:items-center tw:justify-between tw:gap-sm tw:py-[10px] tw:px-0 tw:border-0 tw:border-b tw:border-solid tw:border-line">
        <div class="tw:grid tw:gap-[5px]">
          <strong class="tw:text-body tw:font-normal">{{ historyLabel(entry.operation) }}</strong>
          <span class="tw:text-muted tw:[font:var(--type-label)_var(--font-data)]">{{ new Date(entry.createdAt).toLocaleString(getLocale()) }}</span>
        </div>
        <button v-if="entry.snapshot" class="button button-quiet touch-target tw:min-h-[44px] tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:text-text tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:[&:hover:not(:active):not(:disabled)]:opacity-[.78] tw:active:opacity-100 tw:disabled:cursor-wait tw:disabled:opacity-50 tw:border tw:border-solid tw:border-control-border tw:bg-transparent tw:[&:hover:not(:active)]:border-text tw:[&:hover]:text-text-display tw:active:border-text-display tw:active:text-text-display" type="button" :aria-label="t('查看恢复差异：{0}', new Date(entry.createdAt).toLocaleString(getLocale()))" @click="review(entry, $event)">{{ t('查看恢复差异') }}</button>
      </article>
    </TransitionGroup>
    <section v-if="selected && current" class="history-preview" :aria-label="t('恢复前比较')" @keydown.esc.stop.prevent="closePreview">
      <h3 ref="previewHeading" tabindex="-1">{{ t('恢复前比较') }}</h3>
      <time :datetime="selected.createdAt">{{ new Date(selected.createdAt).toLocaleString(getLocale()) }}</time>
      <dl v-if="changes.length">
        <template v-for="change in changes" :key="change.key">
          <dt class="history-diff-label">{{ change.label }}</dt>
          <dd class="history-diff-value">
            <span><span class="history-before">{{ change.from }} → </span>{{ change.to }}</span>
            <button v-if="isHistoryTextField(change.key)" type="button" class="action-button is-quiet"
              :disabled="!canRestoreField" :aria-label="t('取回此字段：{0}', change.label)"
              @click="emit('restore', selected, change.key)">{{ t('取回此字段') }}</button>
          </dd>
        </template>
      </dl>
      <p v-else>{{ t('此版本与当前已保存的任务字段相同。') }}</p>
      <p v-if="hasDeletedTags">{{ t('历史版本中的已删除标签将跳过。') }}</p>
      <p>{{ t('检查项和关联任务保留现状。恢复为已完成时，父任务的完成策略仍会作用于子项。') }}</p>
      <p v-if="!canRestore">{{ t('请先保存当前修改，再确认恢复。') }}</p>
      <div class="tw:flex tw:flex-wrap tw:gap-xs">
        <button type="button" class="action-button is-primary" :disabled="!canRestore" @click="confirm">{{ t('确认恢复此版本') }}</button>
        <button type="button" class="action-button" @click="closePreview">{{ t('取消') }}</button>
      </div>
    </section>
  </details>
</template>

<style scoped>
.history-preview { display: grid; gap: var(--space-xs); margin-top: var(--space-md); overflow-wrap: anywhere; }
.history-preview h3 { font-size: var(--type-body); font-weight: 500; }
.history-preview time, .history-diff-label { color: var(--muted); font: var(--type-label) var(--font-data); }
.history-preview dl { margin: 0; }
.history-diff-label { padding-top: var(--space-xs); border-top: 1px solid var(--line); }
.history-diff-value { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2xs) var(--space-sm); margin: 0; padding-block: var(--space-xs); white-space: pre-wrap; }
.history-before, .history-preview p { color: var(--muted); }
.history-preview p { font-size: var(--type-label); line-height: 1.5; }
</style>
