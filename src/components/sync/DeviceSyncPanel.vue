<script setup lang="ts">
import { getLocale, t } from '../../i18n'
import { syncFeedbackText } from '../../sync/connectionFeedback'
// 展示同步开关、上次成功和待传字段数；状态与同步动作均由传入的控制器维护，不以网盘授权代替启用。
// 同字段同刻的不同值保留为候选，手选后由控制器写入更新的字段版本并尝试同步，不在展示层按顺序取舍。
import { computed } from 'vue'
import type { DeviceSyncControls } from '../../composables/useDeviceSync'
import { useOptionalCloudSync } from '../../composables/workspaceContexts'
import type { FieldChange, FieldValue } from '../../sync/fieldMerge'
import SegmentedControl from '../ui/SegmentedControl.vue'
import PendingSyncDetails from './PendingSyncDetails.vue'
import { readRecurrence } from '../../domain/recurrence'

const props = defineProps<{ sync?: DeviceSyncControls; itemLabel?: (change: FieldChange) => string }>()
const cloud = useOptionalCloudSync()
const sync = computed(() => {
  const resolved = props.sync ?? cloud?.sync
  if (!resolved) throw new Error('DeviceSyncPanel requires sync controls or CloudSyncContext')
  return resolved
})
const resolveItemLabel = (change: FieldChange) => props.itemLabel?.(change) ?? cloud?.syncItemLabel(change) ?? change.id
const intervalOptions = computed(() => [
  { value: '1', label: t('1分钟') },
  { value: '5', label: t('5分钟') },
  { value: '15', label: t('15分钟') },
  { value: '30', label: t('30分钟') },
  { value: '60', label: t('1小时') },
  { value: '0', label: t('手动') },
])

const fieldNames = computed<Record<string, string>>(() => ({
  title: t('标题'), notes: t('备注'), url: t('链接'), priority: t('优先级'), status: t('任务状态'), dueAt: t('截止时间'),
  remindAt: t('提醒时间'), deletedAt: t('回收站状态'), completed: t('完成状态'), parentTaskId: t('父任务'),
  categoryId: t('分类'), name: t('名称'), createdAt: t('创建时间'), reminderSettings: t('提醒设置'),
  completionStrategy: t('完成策略'), recurrenceRule: t('重复规则'), recurrenceSeriesId: t('重复系列'),
  occurrenceAt: t('期次'), recurrenceMode: t('重复方式'), taskId: t('所属任务'), snapshot: t('历史版本'),
}))
const groupNames = computed<Record<FieldChange['collection'], string>>(() => ({
  tasks: t('任务'), checklistItems: t('检查项'), relations: t('关联'), tags: t('标签'),
  categories: t('分类'), settings: t('设置'), history: t('历史'),
}))
function describe(change: FieldChange) {
  const field = change.field.startsWith('tag:') ? t('标签成员') : change.field.startsWith('snooze:') ? t('推迟提醒') : fieldNames.value[change.field] ?? change.field
  return groupNames.value[change.collection] + ' · ' + resolveItemLabel(change) + ' · ' + field
}
function display(value: FieldValue, field?: string) {
  if (value === null) return t('（空）')
  if (field === 'recurrenceRule' && typeof value === 'string') {
    const rule = readRecurrence(value)
    if (rule) {
      const units = ['day', 'week', 'month', 'year']
      const intervalText = (interval: number, unit: string) => new Intl.NumberFormat(getLocale(), { style: 'unit', unit, unitDisplay: 'long' }).format(interval)
      const segments = rule.plan?.segments ?? []
      // 未识别的模板仍使用原有通用显示，避免错误解释或遗漏候选中的信息。
      if (!Array.isArray(segments) || segments.some(segment => !segment
        || !['calendar', 'completion'].includes(segment.mode) || !units.includes(segment.unit)
        || !Number.isSafeInteger(segment.interval) || segment.interval < 1
        || typeof segment.at !== 'string'
        || (segment.dueAt !== null && typeof segment.dueAt !== 'string')
        || (segment.remindAt !== null && typeof segment.remindAt !== 'string'))) return value
      const description = [t('{0} · 每 {1}', rule.mode === 'calendar' ? t('固定日历') : t('按实际完成日'), intervalText(rule.interval, rule.unit))]
      if (rule.legacyText) description.push(t('原规则：{0}', rule.legacyText))
      for (const segment of segments) {
        description.push(t('从 {0} 起 · {1} · 每 {2}', displayDate(segment.at), segment.mode === 'calendar' ? t('固定日历') : t('按实际完成日'), intervalText(segment.interval, segment.unit)))
        description.push(t('截止：{0} · 提醒：{1}', displayDate(segment.dueAt), displayDate(segment.remindAt)))
      }
      return description.join('\n')
    }
  }
  if (typeof value === 'string') return value || t('（空文本）')
  if (typeof value === 'boolean') return value ? t('是') : t('否')
  return JSON.stringify(value)
}
function displayDate(value: string | null) {
  if (!value) return t('未设置')
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(getLocale())
}
</script>

<template>
  <section class="settings-panel sync-panel tw:max-w-[680px] tw:mt-section tw:[.settings-view_&]:max-w-none tw:[.settings-view_>&:first-child]:mt-0" aria-labelledby="task-sync-title">
    <div class="section-heading compact-heading tw:mb-md tw:flex tw:justify-between tw:items-start tw:gap-md">
      <h2 id="task-sync-title" class="tw:text-text-display tw:text-body tw:font-normal tw:tracking-[-.02em] tw:leading-[1.2]">{{ t('待办同步') }}</h2>
      <span class="save-hint tw:font-data tw:tracking-[.08em] tw:uppercase tw:text-dim tw:text-label">{{ sync.busy ? t('同步中') : sync.enabled ? t('已启用') : t('已暂停') }}</span>
    </div>
    <PendingSyncDetails :sync="sync" />
    <template v-if="sync.enabled">
      <fieldset class="tw:min-w-0 tw:m-0 tw:p-0 tw:border-0 tw:disabled:opacity-50" :disabled="sync.busy">
        <legend class="tw:mb-xs tw:p-0 tw:text-muted tw:text-label">{{ t('同步间隔') }}</legend>
        <SegmentedControl class="interval-options tw:bg-surface-raised" :label="t('同步间隔')" size="compact"
          :options="intervalOptions" :model-value="String(sync.minutes)"
          @update:model-value="sync.setMinutes(Number($event))" />
        <p class="tw:mt-xs tw:mb-sm tw:text-dim tw:text-label tw:leading-[1.5]">{{ t('选择 1 分钟时，保存后即上传。手动档在打开应用、恢复联网或点击“立即同步”时同步。') }}</p>
      </fieldset>
      <div class="reminder-actions settings-actions tw:flex tw:flex-wrap tw:gap-xs tw:justify-end tw:le-820:justify-start">
        <button type="button" class="button button-primary tw:min-h-[44px] tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:active:opacity-100 tw:disabled:cursor-wait tw:disabled:opacity-50 tw:border-0 tw:bg-text-display tw:text-bg tw:[&:hover]:opacity-[.86] tw:active:bg-text tw:[&:active:hover]:opacity-[.86] tw:[&:disabled:hover]:opacity-[.86]" :disabled="sync.busy" @click="sync.synchronize">{{ t('立即同步') }}</button>
        <button type="button" class="button button-quiet touch-target tw:min-h-[44px] tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:text-text tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:[&:hover:not(:active):not(:disabled)]:opacity-[.78] tw:active:opacity-100 tw:disabled:cursor-wait tw:disabled:opacity-50 tw:border tw:border-solid tw:border-control-border tw:bg-transparent tw:[&:hover:not(:active)]:border-text tw:[&:hover]:text-text-display tw:active:border-text-display tw:active:text-text-display" @click="sync.pause">{{ t('暂停同步') }}</button>
      </div>
      <div v-for="conflict in sync.status?.conflicts" :key="conflict.key" class="sync-conflict tw:grid tw:gap-xs tw:border-0 tw:border-t tw:border-solid tw:border-line tw:pt-[12px]">
        <strong>{{ t('选择保留的版本') }}</strong>
        <p class="tw:[overflow-wrap:anywhere]">{{ describe(conflict.versions[0]!) }}</p>
        <button v-for="(version, index) in conflict.versions" :key="index" type="button"
          class="button button-secondary sync-choice tw:[overflow-wrap:anywhere] tw:whitespace-pre-wrap tw:h-auto tw:text-start tw:justify-start tw:min-h-[44px] tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:text-text tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:[&:hover:not(:active):not(:disabled)]:opacity-[.78] tw:active:opacity-100 tw:disabled:cursor-wait tw:disabled:opacity-50 tw:border tw:border-solid tw:border-control-border tw:bg-surface-raised tw:active:border-text-display tw:active:text-text-display" :disabled="sync.busy" @click="sync.choose(conflict.key, version.value)">
          {{ display(version.value, version.field) }}
        </button>
      </div>
    </template>
    <template v-else>
      <p class="settings-note tw:text-dim tw:leading-[1.5] tw:text-label tw:mt-[20px] tw:mx-0 tw:mb-sm">{{ t('启用后，本机待办会与当前网盘目录中的待办逐项合并。其他设备连接同一目录后可以接着使用。') }}</p>
      <button type="button" class="button button-primary tw:min-h-[44px] tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:active:opacity-100 tw:disabled:cursor-wait tw:disabled:opacity-50 tw:border-0 tw:bg-text-display tw:text-bg tw:[&:hover]:opacity-[.86] tw:active:bg-text tw:[&:active:hover]:opacity-[.86] tw:[&:disabled:hover]:opacity-[.86]" :disabled="sync.busy" @click="sync.enable">{{ t('启用并同步') }}</button>
    </template>
    <p v-if="sync.message" class="inline-status error tw:min-h-[24px] tw:font-data tw:text-label tw:font-normal tw:leading-[normal] tw:tracking-[.03em] tw:text-accent-text" role="alert">{{ syncFeedbackText(sync.message) }}</p>
  </section>
</template>

<style scoped>
.interval-options :deep(.segmented-option) {
  letter-spacing: .06em;
  transition: color var(--motion-fast) var(--ease-nothing);
}
@media (max-width: 500px) {
  .interval-options :deep(.segmented-option) {
    min-width: max-content;
    padding-inline: 3px;
  }
}
</style>
