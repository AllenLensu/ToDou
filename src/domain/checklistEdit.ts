import type { ChecklistItem } from '../storage/types'
import { fromLocalDateTime, toLocalDateTime } from './localDateTime'
import { isChecklistRecurrenceActive } from './checklistRecurrence'
import type { ChecklistEdit, ChecklistEditDraft } from './taskUi'

/** Capture the original stored reminder, including precision not shown in the form. */
export function createChecklistEditDraft(item?: ChecklistItem): ChecklistEditDraft {
  const original = { title: item?.title ?? '', notes: item?.notes ?? '', remindAt: item?.remindAt ?? null,
    recurrenceMode: item?.recurrenceMode ?? 'independent', recurrenceRule: item?.recurrenceRule ?? '' }
  return { ...original, original, remindAt: toLocalDateTime(original.remindAt), editing: false, saving: false,
    rescheduleScope: '', titleError: '', reminderError: '' }
}

/** A reminder-only change needs an explicit scope within an active independent series. */
export function needsChecklistRescheduleScope(draft: ChecklistEditDraft) {
  const { original } = draft
  return isChecklistRecurrenceActive(original) && draft.remindAt !== toLocalDateTime(original.remindAt)
    && draft.recurrenceRule === original.recurrenceRule && draft.recurrenceMode === original.recurrenceMode
}

/** Only normalize edited fields; leave untouched text, timestamps and opaque rule metadata in storage. */
export function checklistEditChanges(draft: ChecklistEditDraft): ChecklistEdit {
  const { original } = draft
  const changes: ChecklistEdit = {}
  const title = draft.title.trim()
  const notes = draft.notes.trim()
  if (draft.title !== original.title && title !== original.title) changes.title = title
  if (draft.notes !== original.notes && notes !== original.notes) changes.notes = notes || null
  if (draft.recurrenceMode !== original.recurrenceMode) changes.recurrenceMode = draft.recurrenceMode
  if (draft.recurrenceRule !== original.recurrenceRule) changes.recurrenceRule = draft.recurrenceRule || null
  const remindAt = fromLocalDateTime(draft.remindAt, original.remindAt)
  if (remindAt !== original.remindAt) changes.remindAt = remindAt
  return changes
}
