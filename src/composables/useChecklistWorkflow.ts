import { notice, t } from '../i18n'
import { reactive, toValue, type MaybeRefOrGetter } from 'vue'
import { fromLocalDateTime } from '../domain/localDateTime'
import type { RecurrenceScope } from '../domain/recurrence'
import { effectiveReminderSettings, previewReminder } from '../application/reminderService'
import { runReminderTimeChange } from '../application/reminderReschedule'
import { emptyChecklistDraft, type ChecklistDraft, type ChecklistEdit, type ChecklistRow } from '../domain/taskUi'
import type { Category, ChecklistItem, ReminderRuntimeStateMap, ReminderSettings, Task, TaskStore } from '../storage/types'
import { provideChecklistEditDrafts } from './useChecklistEditDrafts'

export type NewChecklistPayload = Pick<ChecklistDraft, 'title' | 'notes' | 'remindAt' | 'recurrenceRule' | 'recurrenceMode'>

interface ChecklistWorkflowOptions {
  store: MaybeRefOrGetter<TaskStore | null>
  selectedId: MaybeRefOrGetter<string | null>
  tasks: MaybeRefOrGetter<readonly Task[]>
  allChecklistItems: MaybeRefOrGetter<readonly ChecklistRow[]>
  categories: MaybeRefOrGetter<readonly Category[]>
  reminderSettings: ReminderSettings
  reminderRuntime: MaybeRefOrGetter<ReminderRuntimeStateMap>
  now: MaybeRefOrGetter<Date>
  canMutate: () => boolean
  withMutation: <T>(action: () => Promise<T>) => Promise<T>
  reminderLifecycle: { pause: () => Promise<void>; resume: () => Promise<void> }
  onRefreshAfterWrite: (ownerTaskId?: string | null) => Promise<void>
  onNotice: (message: () => string) => void
  onClearError: () => void
  onError: (error: unknown) => void
}

/** 管理当前任务的新建检查项草稿、行内检查项编辑草稿登记、提醒预览与增删改操作。 */
export function useChecklistWorkflow(options: ChecklistWorkflowOptions) {
  const checklistDraft = reactive<ChecklistDraft>(emptyChecklistDraft())
  const checklistEdits = provideChecklistEditDrafts()

  function resetChecklistDraft() {
    Object.assign(checklistDraft, emptyChecklistDraft())
    checklistEdits.discardNewChecklist()
  }

  function hasNewChecklistDraft() {
    return Boolean(checklistDraft.title || checklistDraft.notes || checklistDraft.remindAt || checklistDraft.recurrenceRule
      || checklistDraft.recurrenceMode !== 'independent') || checklistEdits.hasNewChecklistChanges()
  }

  function hasAnyDraft() {
    return hasNewChecklistDraft() || checklistEdits.hasChanges()
  }

  function discardRowEdits() {
    checklistEdits.discard()
  }

  function previewChecklist(id: string | null, taskId: string, local: string, original: string | null) {
    const owner = toValue(options.tasks).find(task => task.id === taskId)
    if (!owner || !local) return ''
    if (owner.status === 'paused' || owner.status === 'cancelled') return t('所属任务已暂停或取消，检查项提醒已暂停。')
    try {
      const time = fromLocalDateTime(local, original)
      if (!time) return ''
      const settings = effectiveReminderSettings(
        owner,
        toValue(options.categories).find(category => category.id === owner.categoryId),
        options.reminderSettings,
      )
      const runtime = toValue(options.reminderRuntime)
      return previewReminder(time, settings, toValue(options.now), id !== null && time === original ? runtime['checklist:' + id] : undefined)
    } catch {
      return t('请选择有效的提醒时间。')
    }
  }

  async function addChecklistItem(payload?: NewChecklistPayload): Promise<boolean> {
    const db = toValue(options.store)
    const ownerId = toValue(options.selectedId)
    const source = payload ?? checklistDraft
    if (!db || !ownerId || !source.title.trim() || !options.canMutate()) return false
    return options.withMutation(async () => {
      try {
        const captured = { ...source }
        await db.createChecklistItem(ownerId, {
          title: captured.title.trim(),
          notes: captured.notes.trim(),
          completed: false,
          remindAt: fromLocalDateTime(captured.remindAt),
          recurrenceRule: captured.recurrenceRule.trim() || null,
          recurrenceMode: captured.recurrenceMode,
        })
        if (!payload && toValue(options.selectedId) === ownerId && JSON.stringify(captured) === JSON.stringify(checklistDraft)) {
          resetChecklistDraft()
        }
        await options.onRefreshAfterWrite(ownerId)
        options.onNotice(notice('[已添加检查项]'))
        return true
      } catch (error) {
        options.onError(error)
        return false
      }
    })
  }

  async function saveChecklistItem(id: string, changes: ChecklistEdit, scope?: RecurrenceScope): Promise<boolean> {
    const db = toValue(options.store)
    if (!db) return false
    try {
      const original = toValue(options.allChecklistItems).find(item => item.id === id)
      await runReminderTimeChange(
        original?.remindAt ?? null,
        'remindAt' in changes ? changes.remindAt ?? null : original?.remindAt ?? null,
        () => toValue(options.store)!.updateChecklistItem(id, changes, scope),
        options.reminderLifecycle,
      )
      await options.onRefreshAfterWrite(toValue(options.selectedId))
      options.onClearError()
      options.onNotice(notice('[已保存检查项]'))
      return true
    } catch (error) {
      options.onError(error)
      return false
    }
  }

  async function toggleChecklist(item: ChecklistItem) {
    const db = toValue(options.store)
    if (!db) return
    try {
      await db.updateChecklistItem(item.id, { completed: !item.completed })
      await options.onRefreshAfterWrite(toValue(options.selectedId))
    } catch (error) {
      options.onError(error)
    }
  }

  async function removeChecklist(item: ChecklistItem) {
    const db = toValue(options.store)
    if (!db) return
    try {
      await db.deleteChecklistItem(item.id)
      await options.onRefreshAfterWrite(toValue(options.selectedId))
    } catch (error) {
      options.onError(error)
    }
  }

  return {
    checklistDraft,
    editDrafts: checklistEdits,
    resetChecklistDraft,
    hasNewChecklistDraft,
    hasAnyDraft,
    discardRowEdits,
    previewChecklist,
    addChecklistItem,
    saveChecklistItem,
    toggleChecklist,
    removeChecklist,
  }
}
