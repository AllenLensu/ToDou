import type { SyncSnapshot, TaskSnapshot } from '../storage/types'
import type { FieldChange } from './fieldMerge'
import { sha256Hex } from '../domain/contentDigest'
import { occurrenceIndex, readRecurrence } from '../domain/recurrence'

export const taskPurgePrefix = 'purged_task:'
export const checklistPurgePrefix = 'purged_checklist:'
export const taskPurgeKey = (id: string) => taskPurgePrefix + id
export const isPurgeKey = (key: string) => [taskPurgePrefix, checklistPurgePrefix]
  .some(prefix => key.startsWith(prefix) && key.length > prefix.length)
// A completion-generated occurrence already fulfilled its predecessor's forecast.
// The schedule fingerprint distinguishes that slot from ones retired under an older rule.
export const completionPurgeValue = async (basis: string) => 'completion:' + await sha256Hex(basis)
export const validPurgeValue = (key: string, value: unknown) => value === 'deleted'
  || (key.startsWith(taskPurgePrefix) && typeof value === 'string' && /^completion:[0-9a-f]{64}$/.test(value))

// Field registers can exist without business rows after a late edit or a cascade.
// Only IDs and their deletion markers belong in a new exchange directory.
export const purgedRegisterKeysSql = `
  WITH fields AS (
    SELECT key, versions, key->>0 AS kind, key->>1 AS id, key->>2 AS field FROM sync_fields
  )
  SELECT key FROM fields WHERE CASE kind
    WHEN 'tasks' THEN 'purged_task:' || id IN (SELECT key FROM task_settings)
    WHEN 'checklistItems' THEN 'purged_checklist:' || id IN (SELECT key FROM task_settings)
    WHEN 'history' THEN 'purged_task:' || json_extract(versions,'$[0].value.taskId') IN (SELECT key FROM task_settings)
    WHEN 'relations' THEN 'purged_task:' || (id->>0) IN (SELECT key FROM task_settings)
                       OR 'purged_task:' || (id->>1) IN (SELECT key FROM task_settings)
    WHEN 'settings' THEN id='reminder_runtime' AND
      (CASE WHEN substr(field,1,12)='snooze:task:' THEN 'purged_task:' || substr(field,13)
            WHEN substr(field,1,17)='snooze:checklist:' THEN 'purged_checklist:' || substr(field,18) END)
      IN (SELECT key FROM task_settings)
  END`

/** Purges win over late edits, including edits made on a previously offline device. */
type PurgeCorrection = Pick<FieldChange, 'collection' | 'id' | 'field' | 'value'>
export function applyTaskPurges(snapshot: SyncSnapshot, correct?: (field: PurgeCorrection) => void) {
  const tasks = new Map<string, string>()
  const checklist = new Set<string>()
  for (const { key, updatedAt } of snapshot.settings) {
    if (key.startsWith(taskPurgePrefix)) tasks.set(key.slice(taskPurgePrefix.length), updatedAt)
    if (key.startsWith(checklistPurgePrefix)) checklist.add(key.slice(checklistPurgePrefix.length))
  }
  if (!tasks.size && !checklist.size) return

  // Remember an item's ID even if its owner and body arrived together after the purge.
  // A later packet may carry only the item's title, without repeating its owner.
  for (const item of snapshot.checklistItems) {
    const at = tasks.get(item.taskId)
    if (at && !checklist.has(item.id)) {
      checklist.add(item.id)
      snapshot.settings.push({ key: checklistPurgePrefix + item.id, value: 'deleted', updatedAt: at })
    }
  }
  snapshot.tasks = snapshot.tasks.filter(task => !tasks.has(task.id))
  snapshot.checklistItems = snapshot.checklistItems.filter(item => !checklist.has(item.id))
  snapshot.relations = snapshot.relations.filter(row => !tasks.has(row.taskId) && !tasks.has(row.relatedTaskId))
  snapshot.history = snapshot.history.filter(entry => !tasks.has(entry.taskId))
  const detach = (task: TaskSnapshot) => {
    const changed: Array<'parentTaskId' | 'recurrenceSeriesId' | 'recurrenceRule'> = []
    if (task.parentTaskId && tasks.has(task.parentTaskId)) {
      task.parentTaskId = null
      changed.push('parentTaskId')
    }
    const rule = readRecurrence(task.recurrenceRule)
    // Series ID and rule sync separately. A late edit to an old occurrence can
    // arrive after its owner link was cleared. A restarted series owns its own ID.
    const orphanedRule = task.recurrenceSeriesId === null && rule?.basis &&
      [...tasks.keys()].some(owner => occurrenceIndex(owner, task.id) !== null)
    if ((task.recurrenceSeriesId && tasks.has(task.recurrenceSeriesId)) || orphanedRule) {
      task.recurrenceSeriesId = null
      task.recurrenceRule = null
      changed.push('recurrenceSeriesId', 'recurrenceRule')
    } else {
      const template = rule?.plan?.template
      if (template?.parentTaskId && tasks.has(template.parentTaskId)) {
        template.parentTaskId = null
        task.recurrenceRule = JSON.stringify(rule)
        changed.push('recurrenceRule')
      }
    }
    return changed
  }
  for (const task of snapshot.tasks) {
    for (const field of detach(task)) correct?.({ collection: 'tasks', id: task.id, field, value: task[field] })
  }
  for (const entry of snapshot.history) {
    if (entry.snapshot && detach(entry.snapshot).length) correct?.({ collection: 'history', id: entry.id, field: 'entry', value: entry })
  }
  const runtime = snapshot.settings.find(setting => setting.key === 'reminder_runtime')
  if (runtime) {
    let state: Record<string, unknown>
    try { state = JSON.parse(runtime.value) } catch { return }
    if (!state || typeof state !== 'object') return
    for (const id of tasks.keys()) delete state['task:' + id]
    for (const id of checklist) delete state['checklist:' + id]
    runtime.value = JSON.stringify(state)
  }
}
