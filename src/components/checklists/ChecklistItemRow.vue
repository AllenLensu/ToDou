<script setup lang="ts">
import { getLocale, t } from '../../i18n'

// 详情和总览共用编辑入口；只提交用户改动过的字段，保存失败时保留本行草稿。
import { computed, inject, nextTick, reactive, toRefs, useTemplateRef, watch } from 'vue'
import type { ChecklistEdit, ChecklistEditDraft, SaveChecklistItem } from '../../domain/taskUi'
import type { ChecklistItem, TaskStatus } from '../../storage/types'
import { checklistEditChanges, createChecklistEditDraft, needsChecklistRescheduleScope } from '../../domain/checklistEdit'
import { parseRecurrenceRule, recurrenceCadence } from '../../domain/recurrence'
import { isChecklistRecurrenceActive } from '../../domain/checklistRecurrence'
import NothingInput from '../ui/NothingInput.vue'
import ChecklistRecurrenceEditor from './ChecklistRecurrenceEditor.vue'

import { checklistPreviewKey, useReminderDisplay } from '../../composables/useReminderDisplay'
import { useOptionalChecklistActions } from '../../composables/workspaceContexts'

const preview = inject(checklistPreviewKey, undefined)
const checklistActions = useOptionalChecklistActions()
const snoozedTime = useReminderDisplay()
const props = defineProps<{
  item: ChecklistItem
  taskTitle?: string
  parentStatus?: TaskStatus
  saveItem?: SaveChecklistItem
  editDrafts?: Map<string, ChecklistEditDraft>
}>()
const snooze = computed(() => snoozedTime('checklist', props.item.id))
const pausedReason = computed(() => {
  if (props.item.completed || !props.item.remindAt) return ''
  if (props.parentStatus === 'cancelled') return t('父任务已取消，提醒已暂停')
  if (props.parentStatus === 'paused') return t('父任务已暂停，提醒已暂停')
  return ''
})
const emit = defineEmits<{
  toggle: []
  remove: []
}>()

function handleToggle() {
  if (checklistActions) void checklistActions.toggleItem(props.item)
  else emit('toggle')
}

function handleRemove() {
  if (checklistActions) void checklistActions.removeItem(props.item)
  else emit('remove')
}

// 草稿由总览持有，虚拟行滚出窗口后重挂载仍复用原状态；详情没有虚拟化，沿用本行状态。
const editDraft = reactive(props.editDrafts?.get(props.item.id) ?? createChecklistEditDraft())
const { editing, saving, title, notes, remindAt, recurrenceMode, recurrenceRule, rescheduleScope, titleError, reminderError } = toRefs(editDraft)
const editor = useTemplateRef<HTMLFormElement>('editor')
const editButton = useTemplateRef<HTMLButtonElement>('editButton')
const needsRescheduleScope = computed(() => needsChecklistRescheduleScope(editDraft))
watch(remindAt, () => { rescheduleScope.value = ''; reminderError.value = '' })
const recurrenceDescription = computed(() => {
  if (props.item.recurrenceMode === 'follow_task') return t('跟随任务重复')
  const rule = parseRecurrenceRule(props.item.recurrenceRule)
  if (!rule) return props.item.recurrenceRule ? t('原重复说明（未自动执行）：{0}', props.item.recurrenceRule) : ''
  if (!isChecklistRecurrenceActive(props.item)) return t('独立重复已停止{0}', rule.legacyText ? t(' · 原重复说明：{0}', rule.legacyText) : '')
  const schedule = rule.mode === 'calendar' ? t('固定日历') : t('按实际完成日')
  const summary = schedule + ' · ' + recurrenceCadence(rule)
  return rule.legacyText ? t('{0} · 原重复说明：{1}', summary, rule.legacyText) : summary
})
const metaText = computed(() => {
  const parts: string[] = []
  if (props.taskTitle !== undefined) parts.push(t('检查项 · {0}', props.taskTitle))
  if (props.item.remindAt) {
    if (pausedReason.value) {
      parts.push(t('{0} · 原定提醒 {1}', pausedReason.value, new Date(props.item.remindAt).toLocaleString(getLocale())))
    } else {
      parts.push(`${snooze.value ? t('已推迟至') : t('本期提醒')} ${new Date(snooze.value ?? props.item.remindAt).toLocaleString(getLocale())}`)
    }
  }
  if (recurrenceDescription.value) parts.push(recurrenceDescription.value)
  return parts.join(' · ')
})

async function startEditing() {
  Object.assign(editDraft, createChecklistEditDraft(props.item), { editing: true })
  props.editDrafts?.set(props.item.id, editDraft)
  await nextTick()
  editor.value?.querySelector('input')?.focus()
}

async function finishEditing() {
  editing.value = false
  props.editDrafts?.delete(props.item.id)
  await nextTick()
  editButton.value?.focus()
}

async function save() {
  if (saving.value) return
  if (!title.value.trim()) {
    titleError.value = t('检查项标题不能为空')
    return
  }
  let changes: ChecklistEdit
  try {
    changes = checklistEditChanges(editDraft)
  } catch (error) {
    reminderError.value = error instanceof Error ? error.message : t('时间无效，请重新选择')
    return
  }
  if (needsRescheduleScope.value && !rescheduleScope.value) {
    reminderError.value = t('请选择本次改期仅影响此次，还是此次及以后')
    return
  }
  if (!Object.keys(changes).length) {
    await finishEditing()
    return
  }
  saving.value = true
  try {
    const ruleChanged = 'recurrenceRule' in changes || 'recurrenceMode' in changes
    const scope = ruleChanged ? 'future' : needsRescheduleScope.value ? rescheduleScope.value || undefined : undefined
    const saveFn = props.saveItem ?? checklistActions?.saveItem
    if (saveFn && await saveFn(props.item.id, changes, scope)) await finishEditing()
  } finally {
    saving.value = false
  }
}

function titleKeydown(event: KeyboardEvent) {
  // 输入法确认候选时不能同时提交检查项。
  if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) event.preventDefault()
}
</script>

<template>
  <article class="tw:grid tw:grid-cols-[44px_minmax(0,1fr)_auto] tw:items-start tw:gap-x-xs" :class="taskTitle !== undefined ? 'task-row checklist-row tw:py-[10px] tw:pr-[10px] tw:ml-[-10px] tw:border-l-2 tw:[border-left-style:solid] tw:border-l-dim tw:bg-transparent tw:[&:hover]:bg-surface tw:focus-within:bg-surface' : 'checklist-edit-row tw:py-[2px] tw:px-0 tw:border-b tw:border-line tw:[transition:border-color_var(--motion-fast)_var(--ease-out),opacity_var(--motion-fast)_var(--ease-out)]'">
    <button class="status-dot touch-target tw:relative tw:size-[44px] tw:m-0 tw:p-0 tw:border-0 tw:rounded-[3px] tw:bg-transparent tw:[transition:background-color_var(--motion-fast)_var(--ease-out)]" :class="{ 'status-completed': item.completed }" type="button" :aria-pressed="item.completed" :aria-label="t('{0}检查项 {1}', item.completed ? t('取消完成') : t('完成'), item.title)" :disabled="saving" @click="handleToggle" />
    <template v-if="!editing">
      <div class="task-main tw:min-w-0 tw:pt-[12px]">
        <h3 class="tw:m-0 tw:text-text tw:text-body tw:font-normal tw:leading-[1.5] tw:truncate tw:[transition:color_var(--motion-fast)_var(--ease-out)]" :class="{ 'checklist-completed tw:line-through': item.completed }">{{ item.title }}</h3>
        <p v-if="item.notes" class="checklist-notes tw:mt-2xs tw:mb-0 tw:text-muted tw:text-label tw:leading-[1.5] tw:whitespace-pre-wrap tw:break-words">{{ item.notes }}</p>
        <p v-if="metaText" class="task-meta tw:mx-0 tw:mb-0 tw:mt-2xs tw:text-muted tw:font-data tw:text-label tw:leading-[1.4] tw:tracking-[.03em] tw:normal-case">{{ metaText }}</p>
      </div>
      <div class="tw:flex tw:self-start tw:justify-self-end">
        <button ref="editButton" class="checklist-edit-button touch-target tw:min-w-[44px] tw:min-h-[44px] tw:p-2xs tw:text-muted tw:bg-transparent tw:border-0 tw:font-data tw:text-label tw:[&:hover]:text-text-display" type="button" :aria-label="t('编辑检查项 {0}', item.title)" @click="startEditing">{{ t('编辑') }}</button>
        <button class="delete-button touch-target tw:min-w-[44px] tw:min-h-[44px] tw:text-dim tw:bg-transparent tw:border-0 tw:font-data tw:text-label tw:font-normal tw:leading-[normal] tw:py-[10px] tw:px-2xs tw:[transition:color_var(--motion-fast)_var(--ease-out),opacity_var(--motion-fast)_var(--ease-out)] tw:active:text-accent-text tw:[&:hover]:text-accent-text tw:focus-visible:text-accent-text" type="button" :aria-label="t('删除检查项「{0}」', item.title)" @click="handleRemove">{{ t('删除') }}</button>
      </div>
    </template>
    <form v-else ref="editor" class="checklist-item-editor tw:col-[2/-1] tw:grid tw:min-w-0 tw:gap-xs tw:py-xs" :aria-label="t('编辑检查项 {0}', item.title)" novalidate @submit.prevent="save">
      <NothingInput v-model="title" :label="t('检查项标题')" show-label required variant="compact" :disabled="saving" :error="titleError" @update:model-value="titleError = ''" @keydown="titleKeydown" />
      <NothingInput v-model="notes" :label="t('检查项备注')" show-label kind="textarea" :rows="3" :placeholder="t('补充说明，可留空')" variant="compact" :disabled="saving" />
      <NothingInput v-model="remindAt" :label="t('检查项提醒时间')" show-label type="datetime-local" :placeholder="t('选择提醒时间，可清除')" variant="compact" :disabled="saving" :error="reminderError" @update:model-value="reminderError = ''" />
      <p v-if="preview && remindAt && !item.completed" class="tw:text-muted tw:text-label" aria-live="polite">{{ preview(item.id, item.taskId, remindAt, item.remindAt) }}</p>
      <NothingInput v-if="needsRescheduleScope" v-model="rescheduleScope" :label="t('本次改期范围')" kind="select" show-label variant="compact" :disabled="saving">
        <option value="" disabled>{{ t('请选择影响范围') }}</option><option value="this">{{ t('仅此次') }}</option><option value="future">{{ t('此次及以后') }}</option>
      </NothingInput>
      <ChecklistRecurrenceEditor v-model="recurrenceRule" v-model:recurrence-mode="recurrenceMode" :remind-at="remindAt" :disabled="saving" />
      <div class="tw:flex tw:flex-wrap tw:gap-xs">
        <button class="button button-quiet touch-target tw:min-h-[44px] tw:min-w-[60px] tw:border tw:border-solid tw:border-control-border tw:rounded-[999px] tw:py-[10px] tw:px-[13px] tw:text-text tw:bg-transparent tw:font-data tw:text-label tw:[&:hover]:border-text tw:disabled:cursor-wait tw:disabled:opacity-50" type="submit" :disabled="saving">{{ saving ? t('保存中') : t('保存') }}</button>
        <button class="touch-target tw:min-h-[44px] tw:min-w-[60px] tw:p-2xs tw:text-muted tw:bg-transparent tw:border-0 tw:font-data tw:text-label tw:[&:hover]:text-text-display tw:disabled:opacity-50" type="button" :disabled="saving" @click="finishEditing">{{ t('取消') }}</button>
      </div>
    </form>
  </article>
</template>
