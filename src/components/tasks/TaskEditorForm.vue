<script setup lang="ts">
import { t } from '../../i18n'

// 表单直接修改工作区传入的草稿；提交只发事件，工作区通过草稿会话与存储层完成保存。
// 已有任务防抖自动保存，新任务首次须显式提交；空白标题由工作区拒绝，保存状态不是本地乐观标记。
// 新标签的 Enter 松键直接请求添加，未在此过滤组词；全局快捷键的组词保护不覆盖这条局部事件。
import type { Category, Tag, Task } from '../../storage/types'
import { priorities, statuses, type Draft } from '../../domain/taskUi'
import { TASK_TITLE_ID } from '../../composables/useKeyboardShortcuts'
import AppIcon from '../ui/AppIcon.vue'
import NothingInput from '../ui/NothingInput.vue'
import ReminderSettingsPanel from '../reminders/ReminderSettingsPanel.vue'
import SegmentedControl from '../ui/SegmentedControl.vue'
import RecurrenceRuleEditor from './RecurrenceRuleEditor.vue'
import { describeRecurrence, parseRecurrenceRule } from '../../domain/recurrence'
import type { DraftSaveState } from '../../application/taskDraftSession'
import { computed, shallowRef } from 'vue'
import RelatedTaskPicker from './RelatedTaskPicker.vue'

import NotificationPermissionHint from './NotificationPermissionHint.vue'
import { previewReminder } from '../../application/reminderService'
import { fromLocalDateTime, toLocalDateTime } from '../../domain/localDateTime'
import type { ReminderRuntimeState } from '../../storage/types'

const props = defineProps<{
  savedTask?: Task
  runtime?: ReminderRuntimeState
  now: Date
  draft: Draft
  selectedId: string | null
  categories: Category[]
  tags: Tag[]
  availableRelatedTasks: Task[]
  addTag: (name: string) => Promise<boolean>
  isSaving: boolean
  saveState: DraftSaveState
  isLoading: boolean
  inheritedFollowUpMinutes: number
  needsRescheduleScope: boolean
  rescheduleScope: 'this' | 'future' | ''
}>()
const savedUrl = computed(() => {
  try {
    const url = new URL(props.savedTask?.url ?? '')
    return ['https:', 'http:'].includes(url.protocol) && props.savedTask?.url === props.draft.url.trim() ? url.href : ''
  } catch { return '' }
})
const preview = computed(() => {
  const d = props.draft
  if (!d.remindAt) return ''
  if (['paused', 'completed', 'cancelled'].includes(d.status)) return t('当前任务状态已停止提醒。')
  try {
    const at = fromLocalDateTime(d.remindAt, props.savedTask?.remindAt)
    if (!at) return ''
    return previewReminder(at, { ...d.reminderSettings, followUpMinutes: d.reminderSettings.followUpMinutes ?? props.inheritedFollowUpMinutes },
      props.now, d.remindAt === toLocalDateTime(props.savedTask?.remindAt ?? null) ? props.runtime : undefined)
  } catch { return t('请选择有效的提醒时间。') }
})
const repeatSummary = computed(() => props.draft.recurrenceRule ? t('重复 · ') + describeRecurrence(props.draft.recurrenceRule) : t('设置重复'))
const commonStatuses = computed(() => statuses.filter(item => ['todo', 'in_progress', 'completed'].includes(item.value)))
const moreStatuses = computed(() => statuses.filter(item => !['todo', 'in_progress', 'completed'].includes(item.value)))
const moreStatusesSummary = computed(() => {
  const active = moreStatuses.value.find(item => item.value === props.draft.status)
  return t('更多{0}', active ? ` · ${active.label}` : '')
})
const saveLabel = computed(() => ({ pending: t('待保存'), saving: t('保存中'), saved: t('已保存'), failed: t('保存失败') })[props.saveState])
const titleSaveHint = computed(() => props.selectedId || props.saveState === 'failed' || props.saveState === 'saving' ? saveLabel.value : t('创建后自动保存'))

const relatedTaskIds = defineModel<string[]>('relatedTaskIds', { required: true })

const hierarchyHint = computed(() => {
  const parts: string[] = []
  if (props.draft.parentTaskId) parts.push(t('已设父任务'))
  if (relatedTaskIds.value.length) parts.push(t('关联 {0} 项', relatedTaskIds.value.length))
  return parts.length ? parts.join(' · ') : t('父子关系 · 关联任务')
})

const taxonomyHint = computed(() => {
  const parts: string[] = []
  const category = props.categories.find(item => item.id === props.draft.categoryId)
  if (category) parts.push(category.name)
  if (props.draft.tagIds.length) parts.push(t('{0} 个标签', props.draft.tagIds.length))
  return parts.length ? parts.join(' · ') : t('主分类 · 多标签')
})

const reminderOptionsHint = computed(() => {
  const settings = props.draft.reminderSettings
  const parts: string[] = []
  if (settings.mode === 'none') parts.push(t('关闭提醒'))
  else if (settings.strength === 'alarm') parts.push(t('闹钟式提醒'))
  if (settings.followUpMinutes !== null) parts.push(t('自定义追提醒'))
  if (settings.quietHoursEnabled) parts.push(t('已设免打扰'))
  return parts.length ? parts.join(' · ') : t('追提醒 · 强度 · 免打扰')
})

const emit = defineEmits<{
  submit: []
  cancel: []
  'create-occurrence': []
  'open-related-task': [task: Task]
  'update:rescheduleScope': [value: 'this' | 'future']
}>()

const newTagName = shallowRef('')

async function submitTag() {
  if (await props.addTag(newTagName.value)) newTagName.value = ''
}

function submitTagKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return
  event.preventDefault()
  if (event.isComposing || event.keyCode === 229) return
  void submitTag()
}
</script>

<template>
  <form class="task-form tw:max-w-[680px]" @submit.prevent="emit('submit')">
    <fieldset class="editor-fields tw:min-w-0 tw:m-0 tw:p-0 tw:border-0" :disabled="isLoading">
      <legend class="sr-only">{{ t('任务详情字段') }}</legend>
    <div class="field field-title tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-xs tw:mb-md">
      <NothingInput :id="TASK_TITLE_ID" v-model="draft.title" :label="t('标题')" aria-describedby="todou-task-save-state" required type="text" :placeholder="t('现在最需要记住什么？')" variant="hero" show-label />
      <span id="todou-task-save-state" class="draft-save-state tw:text-muted tw:font-data tw:text-label tw:data-[state=failed]:text-accent-text"
        role="status" aria-live="polite" :data-state="saveState">{{ titleSaveHint }}</span>
    </div>

    <div class="field tw:grid tw:gap-xs tw:mb-md">
      <NothingInput v-model="draft.notes" :label="t('备注')" kind="textarea" :rows="4" :placeholder="t('补充背景、下一步或相关信息')"  show-label/>
    </div>

    <div class="field tw:grid tw:gap-xs tw:mb-md">
      <NothingInput v-model="draft.url" :label="t('链接')" type="url" placeholder="https://"  show-label/>
      <a v-if="savedUrl" :href="savedUrl" target="_blank" rel="noopener noreferrer" class="tw:justify-self-start tw:min-h-[44px] tw:content-center tw:text-text tw:underline tw:underline-offset-[3px]">{{ t('打开链接') }}<span class="sr-only">（{{ t('在新标签页中打开') }}）</span></a>
    </div>

    <div class="field-grid core-fields tw:grid tw:grid-cols-[1fr_1fr] tw:gap-md tw:mb-xs tw:items-start tw:le-500:grid-cols-[1fr] tw:le-500:gap-0">
      <div class="field tw:grid tw:gap-xs tw:mb-md tw:content-start">
        <span class="field-label tw:text-muted tw:font-data tw:text-label tw:font-normal tw:leading-[normal] tw:tracking-[.06em] tw:uppercase">{{ t('状态') }}</span>
        <SegmentedControl v-model="draft.status" class="tw:justify-self-start" :options="commonStatuses" :label="t('常用状态')" />
        <details class="more-statuses advanced-fields">
          <summary class="advanced-summary tw:min-h-[44px] tw:flex tw:items-center tw:gap-xs tw:font-data tw:text-label tw:text-muted tw:cursor-pointer tw:list-none">
            <AppIcon name="disclosure" class="advanced-chevron" />
            <span>{{ moreStatusesSummary }}</span>
          </summary>
          <NothingInput v-model="draft.status" :label="t('其他状态')" kind="select" :placeholder="t('选择状态')" show-label>
            <option v-for="item in moreStatuses" :key="item.value" :value="item.value">{{ item.label }}</option>
          </NothingInput>
        </details>
      </div>
      <div class="field tw:grid tw:gap-xs tw:mb-md tw:content-start">
        <span class="field-label tw:text-muted tw:font-data tw:text-label tw:font-normal tw:leading-[normal] tw:tracking-[.06em] tw:uppercase">{{ t('优先级') }}</span>
        <SegmentedControl v-model="draft.priority" class="tw:justify-self-start" :options="priorities" :label="t('优先级')" />
      </div>
    </div>

    <div class="field-grid tw:grid tw:grid-cols-[1fr_1fr] tw:gap-md tw:le-500:grid-cols-[1fr] tw:le-500:gap-0">
      <div class="field tw:grid tw:gap-xs tw:mb-md">
        <NothingInput v-model="draft.dueAt" :label="t('截止时间')" show-label type="datetime-local" :placeholder="t('选择任务截止时间')" />
      </div>
      <div class="field tw:grid tw:gap-xs tw:mb-md">
        <NothingInput v-model="draft.remindAt" :label="t('提醒时间')" show-label type="datetime-local" :placeholder="t('选择任务提醒时间')" />
      </div>
    </div>

    <div v-if="draft.remindAt" class="field tw:grid tw:gap-xs tw:mb-md">
      <NotificationPermissionHint />
      <p class="tw:text-muted tw:text-label" aria-live="polite">{{ preview }}</p>
    </div>
    <details class="advanced-fields tw:mb-md">
      <summary class="advanced-summary tw:flex tw:items-center tw:gap-xs tw:min-h-[44px] tw:font-data tw:text-label tw:text-text tw:cursor-pointer tw:list-none">
        <AppIcon name="disclosure" class="advanced-chevron" />
        <span>{{ repeatSummary }}</span>
      </summary>
      <div class="field tw:grid tw:gap-xs tw:mb-md">
        <RecurrenceRuleEditor :key="selectedId ?? 'new'" v-model="draft.recurrenceRule" :due-at="draft.dueAt" :remind-at="draft.remindAt" />
        <button v-if="selectedId && draft.recurrenceRule && !parseRecurrenceRule(draft.recurrenceRule)" class="button button-quiet touch-target occurrence-button tw:justify-self-start" type="button" @click="emit('create-occurrence')">{{ t('手动创建下一期') }}</button>
      </div>
    </details>

    <fieldset v-if="needsRescheduleScope" class="tw:m-0 tw:mb-md tw:p-0 tw:border-0 tw:grid tw:gap-xs" :aria-label="t('本次改期范围')">
      <legend class="tw:text-text tw:text-label tw:mb-xs">{{ t('本次改期适用于') }}</legend>
      <label class="tw:flex tw:items-center tw:gap-xs tw:min-h-[44px] tw:text-label"><input class="tw:w-auto tw:min-h-[auto] tw:accent-text-display" type="radio" name="reschedule-scope" :checked="rescheduleScope === 'this'" @change="emit('update:rescheduleScope', 'this')" />{{ t('仅此次') }}</label>
      <label class="tw:flex tw:items-center tw:gap-xs tw:min-h-[44px] tw:text-label"><input class="tw:w-auto tw:min-h-[auto] tw:accent-text-display" type="radio" name="reschedule-scope" :checked="rescheduleScope === 'future'" @change="emit('update:rescheduleScope', 'future')" />{{ t('此次及以后') }}</label>
      <small class="tw:text-dim tw:text-label tw:leading-[1.5]">{{ t('选择范围后才会保存本次改期；再次更改截止或提醒时间时需重新选择。') }}</small>
    </fieldset>

    <details class="advanced-fields tw:mt-lg tw:mx-0 tw:mb-0 tw:p-0">
      <summary class="advanced-summary tw:flex tw:items-center tw:gap-[10px] tw:min-h-[44px] tw:text-text tw:cursor-pointer tw:list-none tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:color_var(--motion-fast)_var(--ease-out)] tw:[.advanced-fields[open]_&]:mb-md">
        <AppIcon name="disclosure" class="advanced-chevron" />
        <span>{{ t('层级与关联') }}</span>
        <span class="advanced-summary-hint tw:text-dim tw:font-normal tw:tracking-[.03em] tw:normal-case">{{ hierarchyHint }}</span>
      </summary>

      <div class="field-grid tw:grid tw:grid-cols-[1fr_1fr] tw:gap-md tw:le-500:grid-cols-[1fr] tw:le-500:gap-0">
        <div class="field tw:grid tw:gap-xs tw:mb-md">
          <NothingInput v-model="draft.parentTaskId" :label="t('父任务（可选）')" kind="select" :placeholder="t('选择所属父任务，或保持独立')" show-label>
            <option value="">{{ t('独立任务') }}</option>
            <option v-for="task in availableRelatedTasks" :key="task.id" :value="task.id">{{ task.title }}</option>
          </NothingInput>
        </div>
        <div class="field tw:grid tw:gap-xs tw:mb-md">
          <NothingInput v-model="draft.completionStrategy" :label="t('父任务完成策略覆盖')" kind="select" :placeholder="t('选择本任务的完成策略')" show-label>
            <option value="">{{ t('跟随默认设置') }}</option>
            <option value="require_children">{{ t('A · 先完成全部子项') }}</option>
            <option value="complete_parent_only">{{ t('B · 仅完成父任务') }}</option>
            <option value="complete_all_children">{{ t('C · 父子项一并完成') }}</option>
          </NothingInput>
        </div>
      </div>

      <RelatedTaskPicker v-if="selectedId"
        v-model:related-task-ids="relatedTaskIds"
        :selected-id="selectedId" :available-related-tasks="availableRelatedTasks"
        :categories="categories"
        @open-related-task="emit('open-related-task', $event)"
      />
    </details>

    <details class="advanced-fields tw:mt-lg tw:mx-0 tw:mb-0 tw:p-0">
      <summary class="advanced-summary tw:flex tw:items-center tw:gap-[10px] tw:min-h-[44px] tw:text-text tw:cursor-pointer tw:list-none tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:color_var(--motion-fast)_var(--ease-out)] tw:[.advanced-fields[open]_&]:mb-md">
        <AppIcon name="disclosure" class="advanced-chevron" />
        <span>{{ t('分类与标签') }}</span>
        <span class="advanced-summary-hint tw:text-dim tw:font-normal tw:tracking-[.03em] tw:normal-case">{{ taxonomyHint }}</span>
      </summary>
      <div class="field tw:grid tw:gap-xs tw:mb-md">
        <NothingInput v-model="draft.categoryId" :label="t('主分类')" kind="select" :placeholder="t('选择一个主分类')" show-label :help="t('分类在「设置」中新增和设置完成策略。')">
          <option value="">{{ t('未分类') }}</option>
          <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option>
        </NothingInput>
      </div>

      <div class="field tw:grid tw:gap-xs tw:mb-md">
        <span class="field-label tw:text-muted tw:font-data tw:text-label tw:font-normal tw:leading-[normal] tw:tracking-[.06em] tw:uppercase">{{ t('标签') }}</span>
        <div class="tag-picker tw:flex tw:flex-wrap tw:gap-xs">
          <label v-for="tag in tags" :key="tag.id" class="tag-option tw:inline-flex tw:items-center tw:min-h-[44px] tw:gap-[7px] tw:border tw:border-solid tw:border-control-border tw:rounded-[999px] tw:py-[7px] tw:px-[12px] tw:text-muted tw:text-label tw:cursor-pointer tw:[transition:border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:active:border-text-display tw:active:text-text-display tw:[&:has(input:checked)]:text-text-display tw:[&:has(input:checked)]:bg-surface-raised tw:[&:has(input:checked)]:border-text">
            <input v-model="draft.tagIds" class="tw:w-auto tw:min-h-[auto] tw:accent-text-display" type="checkbox" :value="tag.id" />
            <span>{{ tag.name }}</span>
          </label>
        </div>
        <div class="inline-create tw:flex tw:gap-xs tw:[&>.nothing-input]:min-w-0 tw:[&>.nothing-input]:flex-1">
          <NothingInput :model-value="newTagName" :label="t('新标签')" type="text" :placeholder="t('例如：待处理')" variant="compact" @update:model-value="newTagName = String($event)" @keydown="submitTagKeydown"  show-label/>
          <button class="button button-quiet touch-target tw:px-[13px] tw:whitespace-nowrap" type="button" @click="submitTag">{{ t('添加') }}</button>
        </div>
      </div>
    </details>

    <details class="advanced-fields tw:mt-lg tw:mx-0 tw:mb-0 tw:p-0">
      <summary class="advanced-summary tw:flex tw:items-center tw:gap-[10px] tw:min-h-[44px] tw:text-text tw:cursor-pointer tw:list-none tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:color_var(--motion-fast)_var(--ease-out)] tw:[.advanced-fields[open]_&]:mb-md">
        <AppIcon name="disclosure" class="advanced-chevron" />
        <span>{{ t('提醒细则') }}</span>
        <span class="advanced-summary-hint tw:text-dim tw:font-normal tw:tracking-[.03em] tw:normal-case">{{ reminderOptionsHint }}</span>
      </summary>

      <ReminderSettingsPanel
        v-model="draft.reminderSettings"
        :inherited-follow-up-minutes="inheritedFollowUpMinutes"
      />
    </details>

    <div class="form-actions tw:flex tw:gap-[10px] tw:mt-sm tw:le-500:items-stretch tw:le-500:flex-col">
      <button class="button button-primary tw:le-500:w-full" type="submit" :disabled="isSaving || isLoading">
        {{ isSaving ? t('保存中…') : selectedId ? t('立即保存') : t('创建任务') }}
      </button>
      <button class="button button-quiet touch-target tw:le-500:w-full" type="button" @click="emit('cancel')">{{ selectedId ? t('关闭详情') : t('取消') }}</button>
    </div>
    </fieldset>
  </form>
</template>

<style scoped>
.advanced-summary::-webkit-details-marker { display: none; }
.advanced-chevron {
  flex: 0 0 14px;
  width: 14px;
  height: 14px;
  color: var(--muted);
  transition: transform var(--motion-fast) var(--ease-out);
}
.advanced-fields[open] > .advanced-summary > .advanced-chevron {
  transform: rotate(90deg);
}
</style>
