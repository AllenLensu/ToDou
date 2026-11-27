<script setup lang="ts">
import { computed, inject, reactive } from 'vue'
import { t } from '../../i18n'

// 当前任务的检查项编辑区：自身持有新建检查项草稿并通过 usePendingEditorDraft 纳入离开守卫；
// 提交、编辑及状态操作通过检查项上下文或显式事件交给工作区调用存储层。
import { emptyChecklistDraft, type ChecklistDraft, type SaveChecklistItem } from '../../domain/taskUi'
import type { ChecklistItem, TaskStatus } from '../../storage/types'
import NothingInput from '../ui/NothingInput.vue'
import ChecklistItemRow from './ChecklistItemRow.vue'
import { useChecklistEditDrafts, useNewChecklistDraftGuard } from '../../composables/useChecklistEditDrafts'
import { checklistPreviewKey } from '../../composables/useReminderDisplay'
import { useOptionalChecklistActions } from '../../composables/workspaceContexts'
import type { NewChecklistPayload } from '../../composables/useChecklistWorkflow'
import ChecklistRecurrenceEditor from './ChecklistRecurrenceEditor.vue'

const props = defineProps<{
  selectedId?: string | null
  parentStatus?: TaskStatus
  items: ChecklistItem[]
  previewReminder?: (local: string) => string
  saveItem?: SaveChecklistItem
}>()

const emit = defineEmits<{
  toggle: [item: ChecklistItem]
  remove: [item: ChecklistItem]
  add: [payload: NewChecklistPayload]
}>()

const checklistActions = useOptionalChecklistActions()
const injectedPreview = inject(checklistPreviewKey, undefined)
const edits = useChecklistEditDrafts()
const draft = reactive<ChecklistDraft>(emptyChecklistDraft())

function resetDraft() {
  Object.assign(draft, emptyChecklistDraft())
}

function hasChanges() {
  return Boolean(draft.title || draft.notes || draft.remindAt || draft.recurrenceRule || draft.recurrenceMode !== 'independent')
}

useNewChecklistDraftGuard(hasChanges, resetDraft)

const reminderPreviewText = computed(() => {
  if (!draft.remindAt) return ''
  if (props.previewReminder) return props.previewReminder(draft.remindAt)
  if (injectedPreview && props.selectedId) return injectedPreview(null, props.selectedId, draft.remindAt, null)
  return ''
})

async function submitNewChecklist() {
  if (!draft.title.trim()) return
  const captured: NewChecklistPayload = {
    title: draft.title,
    notes: draft.notes,
    remindAt: draft.remindAt,
    recurrenceRule: draft.recurrenceRule,
    recurrenceMode: draft.recurrenceMode,
  }
  if (checklistActions) {
    if (await checklistActions.addItem(captured) && JSON.stringify(captured) === JSON.stringify(draft)) {
      resetDraft()
    }
    return
  }
  emit('add', captured)
  resetDraft()
}

function submitKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return
  event.preventDefault()
  if (event.isComposing || event.keyCode === 229) return
  void submitNewChecklist()
}
</script>

<template>
  <section class="checklist-panel tw:max-w-[680px] tw:mt-section" :aria-label="t('检查项')">
    <div class="section-heading history-heading tw:flex tw:justify-between tw:items-start tw:gap-md tw:mb-md">
      <div>
        <span class="section-kicker tw:font-data tw:tracking-[.08em] tw:uppercase tw:text-muted tw:text-label tw:mt-0 tw:mx-0 tw:mb-sm">{{ t('CHECKLIST') }}</span>
        <h2 class="tw:m-0 tw:text-text-display tw:text-body tw:font-normal tw:tracking-[-.02em] tw:leading-[1.2]">{{ t('检查项') }}</h2>
      </div>
      <span class="save-hint tw:font-data tw:tracking-[.08em] tw:uppercase tw:text-dim tw:text-label">{{ t('{0} 项', items.length) }}</span>
    </div>
    <TransitionGroup v-if="items.length" name="checklist-edit-row" tag="div" class="selected-checklist tw:relative tw:grid tw:gap-px tw:mb-md">
      <ChecklistItemRow v-for="item in items" :key="item.id" :item="item" :parent-status="parentStatus" :save-item="saveItem" :edit-drafts="edits" @toggle="emit('toggle', item)" @remove="emit('remove', item)" />
    </TransitionGroup>
    <div class="checklist-create tw:grid tw:gap-xs tw:le-500:grid-cols-[1fr]">
      <div class="checklist-quick-add tw:flex tw:items-end tw:gap-xs tw:[&>.nothing-input]:flex-1">
        <NothingInput id="todou-checklist-title" v-model="draft.title" :label="t('检查项')" type="text" :placeholder="t('添加一个检查项，Enter 确认')" variant="compact" @keydown="submitKeydown"  show-label/>
        <button class="button button-quiet touch-target tw:min-h-[44px] tw:border tw:border-solid tw:border-control-border tw:rounded-[999px] tw:py-[10px] tw:px-[13px] tw:whitespace-nowrap tw:text-text tw:bg-transparent tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:[&:hover:not(:active):not(:disabled)]:opacity-[.78] tw:[&:hover:not(:active)]:border-text tw:[&:hover]:text-text-display tw:active:opacity-100 tw:active:border-text-display tw:active:text-text-display tw:disabled:cursor-wait tw:disabled:opacity-50" type="button" @click="submitNewChecklist">{{ t('添加') }}</button>
      </div>
      <details class="advanced-fields checklist-options tw:m-0 tw:p-0 tw:[&>.nothing-input]:mb-sm">
        <summary class="advanced-summary tw:flex tw:items-center tw:gap-[12px] tw:min-h-[44px] tw:text-text tw:cursor-pointer tw:list-none tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:color_var(--motion-fast)_var(--ease-out)] tw:[.advanced-fields[open]_&]:mb-md">{{ t('提醒与重复') }}</summary>
        <NothingInput v-model="draft.remindAt" :label="t('检查项提醒时间')" type="datetime-local" :placeholder="t('选择检查项提醒时间')" variant="compact"  show-label/>
        <p v-if="reminderPreviewText" class="tw:text-muted tw:text-label" aria-live="polite">{{ reminderPreviewText }}</p>
        <ChecklistRecurrenceEditor v-model="draft.recurrenceRule" v-model:recurrence-mode="draft.recurrenceMode" :remind-at="draft.remindAt" />
      </details>
    </div>
  </section>
</template>
