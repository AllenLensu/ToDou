import { t } from '../i18n'
import { decodeTemplate, instantiateTemplate } from '../domain/taskTemplate'
import { createChecklistRecurrenceStorage } from './checklistRecurrenceStore'
import { createRecurrenceStorage } from './recurrenceStore'
import { readRecurrence, type RecurrenceScope } from '../domain/recurrence'
import { DATABASE_PERSIST, openTaskDatabase, rowsFor } from './database'
import type { Database } from '@sqlite.org/sqlite-wasm'
import { createStoreHelpers } from './helpers'
import { installFieldCapture } from './fieldSyncCapture'
import { createFieldSyncStorage } from './fieldSyncStore'
import { pauseRestoredFieldSync } from './fieldSyncSchema'
import { validateLocalSnapshot } from '../application/localDataTransfer'
import { tagVisibilityKey } from '../sync/tagVisibility'
import { completionPurgeValue, taskPurgeKey } from '../sync/taskPurge'
import { sameReminderTime } from '../application/reminderReschedule'
import {
  PARENT_COMPLETION_STRATEGIES,
  isHistoryTextField,
  UI_THEMES,
  type UiTheme,
  type Category,
  type ChecklistItem,
  type Tag,
  type Task,
  type TaskInput,
  type TaskRelation,
  type TaskRelationKind,
  type TaskStore,
  type ReminderSettings,
  type LocalDataExport,
  type SyncSnapshot,
  type TaskSetting,
} from './types'
export { CHECKLIST_RECURRENCE_MODES, PARENT_COMPLETION_STRATEGIES, TASK_PRIORITIES, TASK_STATUSES } from './types'
export type {
  Category,
  ChecklistItem,
  ChecklistItemInput,
  ChecklistRecurrenceMode,
  HistoryOperation,
  ParentCompletionStrategy,
  Tag,
  Task,
  TaskInput,
  TaskPriority,
  TaskRelation,
  TaskRelationKind,
  TaskSnapshot,
  TaskStatus,
  TaskStore,
  TaskHistoryEntry,
  ReminderSettings,
  TaskReminderSettings,
  SyncSnapshot,
  TaskSetting,
} from './types'
import {
  bindForTask,
  checklistFromRow,
  historyFromRow,
  normalizeChecklistInput,
  normalizeTaskInput,
  nowIso,
  newId,
  DEFAULT_REMINDER_SETTINGS,
  normalizeReminderSettings,
  normalizeTaskReminderSettings,
  followUpMinutesValue,
  normalizeReminderRuntimeState,
  snapshotFromJson,
  strategyValue,
  textValue,
} from './transform'

// 业务存储统一维护任务、历史及同步元数据；公开写操作经队列提交并完成所需落盘后才返回。
type TaskSaveInput = Partial<TaskInput>

export class PersistenceRecoveryError extends Error {
  constructor(cause?: unknown) {
    super(t('保存失败，已停止后续写入。请保留草稿并重新打开最后成功保存的数据后重试。'), { cause })
    this.name = 'PersistenceRecoveryError'
  }
}

export const createTaskStore = async (): Promise<TaskStore> => {
  const database = await openTaskDatabase()
  return createTaskStoreFromDatabase(database, database[DATABASE_PERSIST])
}

export const createTaskStoreFromDatabase = (db: Database, persistDatabase?: () => Promise<void>): TaskStore => {
  installFieldCapture(db)
  const helpers = createStoreHelpers(db)
  const {
    db: storeDb,
    getById,
    listByDeleted,
    recordHistory,
    setTags,
    listCategories,
    listTags,
    listChecklistRows,
    relationPair,
    validateParent,
  } = helpers

  // 内层保存点允许复合业务操作整体回滚，不代表数据库文件已经持久化。
  const withTransaction = <T>(work: () => T): T => {
    storeDb.exec('SAVEPOINT task_operation')
    try {
      const result = work()
      storeDb.exec('RELEASE task_operation')
      return result
    } catch (error) {
      try { storeDb.exec('ROLLBACK TO task_operation; RELEASE task_operation') } catch { /* preserve the write error */ }
      throw error
    }
  }

  const normalizeRelationIds = (taskId: string, relatedTaskIds: string[]) => {
    const ids = [...new Set(relatedTaskIds.map((id) => id.trim()).filter((id) => id && id !== taskId))]
    ids.forEach((id) => getById(id))
    return ids
  }

  const relationRowsForTask = (taskId: string, includeDeleted = false) => rowsFor(
    storeDb,
    `SELECT task_id, related_task_id, kind, created_at, updated_at, deleted_at
       FROM task_relations
      WHERE (task_id = $taskId OR related_task_id = $taskId)
        AND deleted_at IS ${includeDeleted ? 'NOT ' : ''}NULL
      ORDER BY updated_at ASC, created_at ASC`,
    { '$taskId': taskId },
  )

  const relationKey = (taskId: string, relatedTaskId: string) => relationPair(taskId, relatedTaskId).join('\u0000')

  const upsertRelationInTransaction = (taskId: string, relatedTaskId: string, changedAt: string): TaskRelation => {
    const [first, second] = relationPair(taskId, relatedTaskId)
    const existing = rowsFor(
      storeDb,
      `SELECT kind, created_at, updated_at, deleted_at
         FROM task_relations WHERE task_id = $taskId AND related_task_id = $relatedTaskId`,
      { '$taskId': first, '$relatedTaskId': second },
    )[0]
    const existingKind = textValue(existing?.kind) ?? 'related'
    const existingDeletedAt = textValue(existing?.deleted_at)
    if (existing) {
      if (existingDeletedAt !== null || existingKind !== 'related') {
        storeDb.exec({
          sql: `UPDATE task_relations
                   SET kind = 'related', updated_at = $updatedAt, deleted_at = NULL
                 WHERE task_id = $taskId AND related_task_id = $relatedTaskId`,
          bind: { '$taskId': first, '$relatedTaskId': second, '$updatedAt': changedAt },
        })
      }
    } else {
      storeDb.exec({
        sql: `INSERT INTO task_relations
              (task_id, related_task_id, kind, created_at, updated_at, deleted_at)
              VALUES ($taskId, $relatedTaskId, 'related', $createdAt, $updatedAt, NULL)`,
        bind: { '$taskId': first, '$relatedTaskId': second, '$createdAt': changedAt, '$updatedAt': changedAt },
      })
    }
    return {
      taskId,
      relatedTaskId,
      kind: 'related',
      createdAt: textValue(existing?.created_at) ?? changedAt,
      updatedAt: existing && existingDeletedAt === null && existingKind === 'related'
        ? textValue(existing.updated_at) ?? textValue(existing.created_at) ?? changedAt
        : changedAt,
      deletedAt: null,
    }
  }

  const replaceTaskRelationsInTransaction = (taskId: string, relatedTaskIds: string[], changedAt: string) => {
    const desired = new Set(relatedTaskIds.map((relatedTaskId) => relationKey(taskId, relatedTaskId)))
    for (const row of relationRowsForTask(taskId)) {
      const existingTaskId = textValue(row.task_id) ?? ''
      const existingRelatedTaskId = textValue(row.related_task_id) ?? ''
      if (!desired.has(`${existingTaskId}\u0000${existingRelatedTaskId}`)) {
        storeDb.exec({
          sql: `UPDATE task_relations SET updated_at = $updatedAt, deleted_at = $deletedAt
                WHERE task_id = $taskId AND related_task_id = $relatedTaskId AND deleted_at IS NULL`,
          bind: {
            '$taskId': existingTaskId,
            '$relatedTaskId': existingRelatedTaskId,
            '$updatedAt': changedAt,
            '$deletedAt': changedAt,
          },
        })
      }
    }
    for (const relatedTaskId of relatedTaskIds) upsertRelationInTransaction(taskId, relatedTaskId, changedAt)
  }

  let editBatch: { taskId: string; id: string } | null = null

  const readReminderRuntime = () => {
    const raw = textValue(rowsFor(storeDb, "SELECT value FROM task_settings WHERE key = 'reminder_runtime'")[0]?.value)
    try { return raw ? normalizeReminderRuntimeState(JSON.parse(raw)) : {} } catch { return {} }
  }

  const writeReminderRuntime = (state: ReturnType<typeof readReminderRuntime>) => {
    const serialized = JSON.stringify(normalizeReminderRuntimeState(state))
    if (textValue(rowsFor(storeDb, "SELECT value FROM task_settings WHERE key = 'reminder_runtime'")[0]?.value) === serialized) return
    storeDb.exec({
      sql: `INSERT INTO task_settings (key, value, updated_at) VALUES ('reminder_runtime', $value, $updatedAt)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      bind: { '$value': serialized, '$updatedAt': nowIso() },
    })
  }

  const clearChangedReminderCycle = (kind: 'task' | 'checklist', id: string, before: string | null, after: string | null) => {
    if (sameReminderTime(before, after)) return
    const state = readReminderRuntime()
    const key = `${kind}:${id}`
    if (!(key in state)) return
    delete state[key]
    writeReminderRuntime(state)
  }

  const applyCompletionStrategy = (task: Task) => {
    if (task.deletedAt) return
    const category = task.categoryId ? listCategories().find((item) => item.id === task.categoryId) : null
    const global = rowsFor(storeDb, "SELECT value FROM task_settings WHERE key = 'default_completion_strategy'")[0]
    // null 表示继续继承：任务 → 分类 → 全局；均未配置时只完成父任务，不写入隐式默认值。
    const strategy = task.completionStrategy ?? category?.completionStrategy ?? strategyValue(global?.value)
    if (strategy === null || strategy === 'complete_parent_only') return
    const descendants = rowsFor(storeDb, `WITH RECURSIVE subtree(id) AS (
        SELECT $taskId UNION SELECT child.id FROM tasks AS child JOIN subtree ON child.parent_task_id = subtree.id
        WHERE child.deleted_at IS NULL
      ) SELECT task.id FROM tasks AS task JOIN subtree ON subtree.id = task.id
        WHERE task.deleted_at IS NULL`, { '$taskId': task.id }).map((row) => String(row.id))
    const subtree = new Set(descendants)
    const childTasks = listByDeleted(false).filter((child) => child.id !== task.id && subtree.has(child.id))
    if (strategy === 'complete_all_children') checklistRecurrence.stopForTasks(subtree)
    const checklist = rowsFor(storeDb, 'SELECT id, task_id, completed FROM checklist_items WHERE deleted_at IS NULL')
      .filter((item) => subtree.has(String(item.task_id)))
    if (strategy === 'require_children') {
      if (childTasks.some((child) => child.status !== 'completed') || checklist.some((item) => item.completed !== 1)) {
        throw new Error(t('请先完成全部子任务和检查项，再完成父任务'))
      }
      return
    }
    const changedAt = nowIso()
    for (const child of childTasks) {
      if (child.status === 'completed') continue
      // 批量完成也固定实际完成时间，避免之后编辑备注改变按完成日计算的下一期。
      const rule = readRecurrence(child.recurrenceRule)
      const recurrenceRule = rule ? JSON.stringify({ ...rule, completedAt: changedAt }) : child.recurrenceRule
      recordHistory(child, 'updated')
      storeDb.exec({ sql: "UPDATE tasks SET status = 'completed', recurrence_rule = $recurrenceRule, updated_at = $updatedAt WHERE id = $id",
        bind: { '$id': child.id, '$recurrenceRule': recurrenceRule, '$updatedAt': changedAt } })
    }
    for (const item of checklist) {
      if (item.completed === 1) continue
      storeDb.exec({ sql: 'UPDATE checklist_items SET completed = 1, updated_at = $updatedAt WHERE id = $id',
        bind: { '$id': String(item.id), '$updatedAt': changedAt } })
    }
  }

  const writeTaskInTransaction = (id: string | null, input: TaskSaveInput, recordUpdate = true,
    creation?: { id: string; timestamp: string }) => {
    const current = id ? getById(id) : null
    const next = normalizeTaskInput(current ? { ...current, ...input } : input)
    validateParent(id, next.parentTaskId)
    if (next.recurrenceRule && !next.recurrenceSeriesId && current) next.recurrenceSeriesId = current.recurrenceSeriesId ?? current.id
    if (current && !next.recurrenceRule && !('recurrenceSeriesId' in input)) next.recurrenceSeriesId = null
    if (current && Object.entries(next).every(([key, value]) =>
      JSON.stringify(current[key as keyof Task]) === JSON.stringify(value))) return current
    const timestamp = creation?.timestamp ?? nowIso()
    const task: Task = current
      ? { ...current, ...next, updatedAt: timestamp }
      : {
          id: creation?.id ?? newId(),
          ...next,
          recurrenceSeriesId: next.recurrenceRule ? next.recurrenceSeriesId : null,
          createdAt: timestamp,
          updatedAt: timestamp,
          deletedAt: null,
        }
    if (!current && task.recurrenceRule && !task.recurrenceSeriesId) task.recurrenceSeriesId = task.id

    if (current) {
      if (recordUpdate) recordHistory(current, 'updated')
      storeDb.exec({
        sql: `UPDATE tasks SET title = $title, notes = $notes, url = $url, priority = $priority,
              status = $status, due_at = $dueAt, remind_at = $remindAt, category_id = $categoryId,
              parent_task_id = $parentTaskId, recurrence_rule = $recurrenceRule,
              recurrence_series_id = $recurrenceSeriesId, occurrence_at = $occurrenceAt,
              completion_strategy = $completionStrategy, reminder_settings = $reminderSettings,
              updated_at = $updatedAt WHERE id = $id`,
        bind: { '$id': task.id, ...bindForTask(task), '$updatedAt': timestamp },
      })
    } else {
      storeDb.exec({
        sql: `INSERT INTO tasks
              (id, title, notes, url, priority, status, due_at, remind_at, category_id,
               parent_task_id, recurrence_rule, recurrence_series_id, occurrence_at,
               completion_strategy, reminder_settings, created_at, updated_at)
              VALUES ($id, $title, $notes, $url, $priority, $status, $dueAt, $remindAt, $categoryId,
                      $parentTaskId, $recurrenceRule, $recurrenceSeriesId, $occurrenceAt,
                      $completionStrategy, $reminderSettings, $createdAt, $updatedAt)`,
        bind: { '$id': task.id, ...bindForTask(task), '$createdAt': timestamp, '$updatedAt': timestamp },
      })
      recordHistory(task, 'created')
    }
    if (current) clearChangedReminderCycle('task', task.id, current.remindAt, task.remindAt)
    setTags(task.id, task.tagIds)
    if (task.status === 'completed' && current?.status !== 'completed') applyCompletionStrategy(task)
    return task
  }

  const recurrence = createRecurrenceStorage(helpers, clearChangedReminderCycle)
  const checklistRecurrence = createChecklistRecurrenceStorage(helpers, clearChangedReminderCycle)

  const saveTaskWithRelations = async (id: string | null, input: TaskSaveInput, relatedTaskIds: string[], editBatchId?: string, scope: RecurrenceScope = 'this') => {
    const current = id ? getById(id) : null
    input = await recurrence.prepare(current,input,scope)
    const sameBatch = Boolean(id && editBatchId && editBatch?.taskId === id && editBatch.id === editBatchId)
    const separateAction = current !== null && input.status !== undefined && input.status !== current.status
    const recordUpdate = !sameBatch || separateAction
    let changed = false
    const saved = withTransaction(() => {
      const task = writeTaskInTransaction(id, input, recordUpdate)
      const normalizedRelationIds = normalizeRelationIds(task.id, relatedTaskIds)
      const before = current ? currentRelationIds(current.id).sort() : []
      const relationsChanged = JSON.stringify(before) !== JSON.stringify([...normalizedRelationIds].sort())
      changed = task !== current || relationsChanged
      if (current && task === current && relationsChanged && recordUpdate) recordHistory(current, 'updated')
      replaceTaskRelationsInTransaction(task.id, normalizedRelationIds, task === current && relationsChanged ? nowIso() : task.updatedAt)
      return task
    })
    if (changed) editBatch = editBatchId && !separateAction ? { taskId: saved.id, id: editBatchId } : null
    if ((saved.status === 'completed') !== (current?.status === 'completed')) await recurrence.generate(new Date(), true)
    return saved
  }

  const currentRelationIds = (taskId: string) => relationRowsForTask(taskId)
    .map((row) => textValue(row.task_id) === taskId ? textValue(row.related_task_id) : textValue(row.task_id))
    .filter((id): id is string => Boolean(id))

  const exportSyncSnapshot = (): SyncSnapshot => {
    const tasks = [...listByDeleted(false), ...listByDeleted(true)]
    const checklistItems = rowsFor(storeDb, `SELECT id, task_id, title, notes, completed, remind_at,
        recurrence_rule, recurrence_mode, created_at, updated_at, deleted_at
      FROM checklist_items ORDER BY id`).map(checklistFromRow)
    const relations = rowsFor(storeDb, `SELECT task_id, related_task_id, kind, created_at, updated_at, deleted_at
      FROM task_relations ORDER BY task_id, related_task_id`).map((row) => ({
      taskId: textValue(row.task_id) ?? '', relatedTaskId: textValue(row.related_task_id) ?? '',
      kind: (textValue(row.kind) ?? 'related') as TaskRelationKind,
      createdAt: textValue(row.created_at) ?? '',
      updatedAt: textValue(row.updated_at) ?? textValue(row.created_at) ?? '',
      deletedAt: textValue(row.deleted_at),
    }))
    const history = rowsFor(storeDb, `SELECT id, task_id, operation, snapshot_json, created_at
      FROM task_history ORDER BY id`).map(historyFromRow)
    const settings: TaskSetting[] = rowsFor(storeDb,
      'SELECT key, value, updated_at FROM task_settings ORDER BY key',
    ).map((row) => ({
      key: textValue(row.key) ?? '', value: textValue(row.value) ?? '',
      updatedAt: textValue(row.updated_at) ?? '1970-01-01T00:00:00.000Z',
    }))
    return { tasks, checklistItems, relations, categories: listCategories(), tags: listTags(true), history, settings }
  }

  const applySyncSnapshotInTransaction = (snapshot: SyncSnapshot, mergedFields = false) => {
    const laterThan = (left: string, right: string) => {
      const leftTime = Date.parse(left)
      const rightTime = Date.parse(right)
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime > rightTime
      return left > right
    }

    const categoryIdMap = new Map<string, string>()
    for (const category of snapshot.categories) {
      const byId = rowsFor(storeDb, 'SELECT id, updated_at FROM categories WHERE id = $id', { '$id': category.id })[0]
      const byName = rowsFor(storeDb, 'SELECT id, updated_at FROM categories WHERE name = $name', { '$name': category.name })[0]
      const existing = byName && textValue(byName.id) !== category.id ? byName : byId
      const targetId = textValue(existing?.id) ?? category.id
      categoryIdMap.set(category.id, targetId)
      if (!existing) {
        storeDb.exec({
          sql: `INSERT INTO categories (id, name, completion_strategy, follow_up_minutes, created_at, updated_at)
            VALUES ($id, $name, $completionStrategy, $followUpMinutes, $createdAt, $updatedAt)`,
          bind: { '$id': targetId, '$name': category.name, '$completionStrategy': category.completionStrategy, '$followUpMinutes': category.followUpMinutes ?? null,
            '$createdAt': category.createdAt, '$updatedAt': category.updatedAt },
        })
      } else if (mergedFields || laterThan(category.updatedAt, textValue(existing.updated_at) ?? '')) {
        storeDb.exec({
          sql: `UPDATE categories SET name = $name, completion_strategy = $completionStrategy, follow_up_minutes = $followUpMinutes,
            updated_at = $updatedAt WHERE id = $id`,
          bind: { '$id': targetId, '$name': category.name, '$completionStrategy': category.completionStrategy, '$followUpMinutes': category.followUpMinutes ?? null,
            '$updatedAt': category.updatedAt },
        })
      }
    }

    const tagIdMap = new Map<string, string>()
    for (const tag of snapshot.tags) {
      const byId = rowsFor(storeDb, 'SELECT id, updated_at FROM tags WHERE id = $id', { '$id': tag.id })[0]
      const byName = rowsFor(storeDb, 'SELECT id, updated_at FROM tags WHERE name = $name', { '$name': tag.name })[0]
      const existing = byName && textValue(byName.id) !== tag.id ? byName : byId
      const targetId = textValue(existing?.id) ?? tag.id
      tagIdMap.set(tag.id, targetId)
      if (!existing) {
        storeDb.exec({
          sql: 'INSERT INTO tags (id, name, created_at, updated_at) VALUES ($id, $name, $createdAt, $updatedAt)',
          bind: { '$id': targetId, '$name': tag.name, '$createdAt': tag.createdAt, '$updatedAt': tag.updatedAt },
        })
      } else if (mergedFields || laterThan(tag.updatedAt, textValue(existing.updated_at) ?? '')) {
        storeDb.exec({
          sql: 'UPDATE tags SET name = $name, updated_at = $updatedAt WHERE id = $id',
          bind: { '$id': targetId, '$name': tag.name, '$updatedAt': tag.updatedAt },
        })
      }
    }

    const tagIds = new Set(rowsFor(storeDb, 'SELECT id FROM tags').map((row) => textValue(row.id) ?? '').filter(Boolean))
    for (const task of snapshot.tasks) {
      const existing = rowsFor(storeDb, 'SELECT updated_at FROM tasks WHERE id = $id', { '$id': task.id })[0]
      if (!mergedFields && existing && !laterThan(task.updatedAt, textValue(existing.updated_at) ?? '')) continue
      storeDb.exec({
        sql: `INSERT INTO tasks
          (id, title, notes, url, priority, status, due_at, remind_at, category_id,
           parent_task_id, recurrence_rule, recurrence_series_id, occurrence_at,
           completion_strategy, reminder_settings, created_at, updated_at, deleted_at)
          VALUES ($id, $title, $notes, $url, $priority, $status, $dueAt, $remindAt, $categoryId,
            $parentTaskId, $recurrenceRule, $recurrenceSeriesId, $occurrenceAt,
            $completionStrategy, $reminderSettings, $createdAt, $updatedAt, $deletedAt)
          ON CONFLICT(id) DO UPDATE SET title = excluded.title, notes = excluded.notes,
            url = excluded.url, priority = excluded.priority, status = excluded.status,
            due_at = excluded.due_at, remind_at = excluded.remind_at,
            category_id = excluded.category_id, parent_task_id = excluded.parent_task_id,
            recurrence_rule = excluded.recurrence_rule, recurrence_series_id = excluded.recurrence_series_id,
            occurrence_at = excluded.occurrence_at, completion_strategy = excluded.completion_strategy,
            reminder_settings = excluded.reminder_settings,
            created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`,
        bind: {
          '$id': task.id, '$title': task.title, '$notes': task.notes, '$url': task.url,
          '$priority': task.priority, '$status': task.status, '$dueAt': task.dueAt, '$remindAt': task.remindAt,
          '$categoryId': task.categoryId ? categoryIdMap.get(task.categoryId) ?? task.categoryId : null,
          '$parentTaskId': task.parentTaskId, '$recurrenceRule': task.recurrenceRule,
          '$recurrenceSeriesId': task.recurrenceSeriesId, '$occurrenceAt': task.occurrenceAt,
          '$completionStrategy': task.completionStrategy, '$reminderSettings': task.reminderSettings ? JSON.stringify(normalizeTaskReminderSettings(task.reminderSettings)) : null,
          '$createdAt': task.createdAt,
          '$updatedAt': task.updatedAt, '$deletedAt': task.deletedAt,
        },
      })
      setTags(task.id, task.tagIds.map((id) => tagIdMap.get(id) ?? id).filter((id) => tagIds.has(id)), true)
    }

    const taskIds = new Set(rowsFor(storeDb, 'SELECT id FROM tasks').map((row) => textValue(row.id) ?? '').filter(Boolean))
    for (const item of snapshot.checklistItems) {
      if (!taskIds.has(item.taskId)) continue
      storeDb.exec({
        sql: `INSERT INTO checklist_items
          (id, task_id, title, notes, completed, remind_at, recurrence_rule, recurrence_mode,
           created_at, updated_at, deleted_at)
          VALUES ($id, $taskId, $title, $notes, $completed, $remindAt, $recurrenceRule, $recurrenceMode,
            $createdAt, $updatedAt, $deletedAt)
          ON CONFLICT(id) DO UPDATE SET task_id = excluded.task_id, title = excluded.title,
            notes = excluded.notes, completed = excluded.completed, remind_at = excluded.remind_at,
            recurrence_rule = excluded.recurrence_rule, recurrence_mode = excluded.recurrence_mode,
            created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
          ${mergedFields ? '' : 'WHERE excluded.updated_at > checklist_items.updated_at'}`,
        bind: {
          '$id': item.id, '$taskId': item.taskId, '$title': item.title, '$notes': item.notes,
          '$completed': item.completed ? 1 : 0, '$remindAt': item.remindAt,
          '$recurrenceRule': item.recurrenceRule, '$recurrenceMode': item.recurrenceMode,
          '$createdAt': item.createdAt, '$updatedAt': item.updatedAt, '$deletedAt': item.deletedAt,
        },
      })
    }

    for (const relation of snapshot.relations) {
      if (!taskIds.has(relation.taskId) || !taskIds.has(relation.relatedTaskId) || relation.taskId === relation.relatedTaskId) continue
      const [taskId, relatedTaskId] = relationPair(relation.taskId, relation.relatedTaskId)
      storeDb.exec({
        sql: `INSERT INTO task_relations
          (task_id, related_task_id, kind, created_at, updated_at, deleted_at)
          VALUES ($taskId, $relatedTaskId, $kind, $createdAt, $updatedAt, $deletedAt)
          ON CONFLICT(task_id, related_task_id) DO UPDATE SET kind = excluded.kind,
            created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
          ${mergedFields ? '' : 'WHERE excluded.updated_at > task_relations.updated_at'}`,
        bind: { '$taskId': taskId, '$relatedTaskId': relatedTaskId, '$kind': relation.kind,
          '$createdAt': relation.createdAt, '$updatedAt': relation.updatedAt, '$deletedAt': relation.deletedAt },
      })
    }

    for (const entry of snapshot.history) {
      if (!taskIds.has(entry.taskId)) continue
      storeDb.exec({
        sql: `INSERT INTO task_history (id, task_id, operation, snapshot_json, created_at)
          VALUES ($id, $taskId, $operation, $snapshot, $createdAt)
          ON CONFLICT(id) ${mergedFields ? 'DO UPDATE SET task_id=excluded.task_id, operation=excluded.operation, snapshot_json=excluded.snapshot_json, created_at=excluded.created_at' : 'DO NOTHING'}`,
        bind: { '$id': entry.id, '$taskId': entry.taskId, '$operation': entry.operation,
          '$snapshot': entry.snapshot ? JSON.stringify(entry.snapshot) : null, '$createdAt': entry.createdAt },
      })
    }

    for (const setting of snapshot.settings) {
      storeDb.exec({
        sql: `INSERT INTO task_settings (key, value, updated_at) VALUES ($key, $value, $updatedAt)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
          ${mergedFields ? '' : 'WHERE excluded.updated_at > task_settings.updated_at'}`,
        bind: { '$key': setting.key, '$value': setting.value, '$updatedAt': setting.updatedAt },
      })
    }
  }

  const applySyncSnapshot = (snapshot: SyncSnapshot) => withTransaction(() => {
    applySyncSnapshotInTransaction(snapshot)
    fields.reconcileTaskPurges()
  })
  const fields = createFieldSyncStorage(storeDb, exportSyncSnapshot, (changed, removed) => {
    for (const id of removed.tasks) storeDb.exec({ sql: 'DELETE FROM tasks WHERE id=$id', bind: { '$id': id } })
    for (const table of ['categories', 'tags'] as const) {
      for (const id of removed[table]) {
        storeDb.exec({ sql: `DELETE FROM ${table} WHERE id=$id`, bind: { '$id': id } })
      }
      // Names are unique. Free old names before applying swaps or replacing an alias.
      for (const item of changed[table]) {
        storeDb.exec({ sql: `UPDATE ${table} SET name=$temporary WHERE id=$id`,
          bind: { '$id': item.id, '$temporary': 'ToDou-' + newId() } })
      }
    }
    applySyncSnapshotInTransaction(changed, true)
  })

  const replaceLocalData = (snapshot: SyncSnapshot) => {
    validateLocalSnapshot(snapshot)
    return withTransaction(() => {
    storeDb.exec('DELETE FROM task_tags')
    storeDb.exec('DELETE FROM task_relations')
    storeDb.exec('DELETE FROM checklist_items')
    storeDb.exec('DELETE FROM task_history')
    storeDb.exec('DELETE FROM tasks')
    storeDb.exec('DELETE FROM categories')
    storeDb.exec('DELETE FROM tags')
    storeDb.exec('DELETE FROM task_settings')
    applySyncSnapshotInTransaction(snapshot)
    fields.reconcileTaskPurges()
    pauseRestoredFieldSync(storeDb)
    })
  }

  let recoveryRequired = false

  const store: TaskStore = {
    async listTasks() { return listByDeleted(false) },
    async listDeletedTasks() { return listByDeleted(true) },

    async listTemplates() {
      const rows = rowsFor(storeDb, "SELECT key, value FROM task_settings WHERE key GLOB 'task_template.*' ORDER BY updated_at DESC, key")
      return rows.flatMap(row => {
        try { return [decodeTemplate(String(row.value), String(row.key))] } catch { return [] }
      })
    },

    async saveTemplate(template) {
      storeDb.exec({ sql: 'INSERT INTO task_settings (key, value, updated_at) VALUES ($key,$value,$at)',
        bind: { '$key': 'task_template.' + template.id, '$value': JSON.stringify(template), '$at': nowIso() } })
    },

    async deleteTemplate(id) {
      storeDb.exec({ sql: 'DELETE FROM task_settings WHERE key = $key', bind: { '$key': 'task_template.' + id } })
    },

    async applyTemplate(id, day) {
      const row = (rowsFor(storeDb, 'SELECT value FROM task_settings WHERE key = $key', { '$key': 'task_template.' + id }))[0]
      if (!row) throw new Error(t('此模板已删除。'))
      const content = instantiateTemplate(decodeTemplate(String(row.value), 'task_template.' + id), day)
      // The outer store mutation commits the task, its history and all steps together.
      const task = await store.createTask(content.task)
      for (const step of content.steps) await store.createChecklistItem(task.id, step)
      return task
    },

    async createTask(input) {
      return saveTaskWithRelations(null, input, [])
    },

    async createTasks(inputs) {
      // The default list sorts simultaneous edits by ID. Assign sorted UUIDs in pasted order
      // so this transaction reads back the same way on every device, including after sync.
      const ids = inputs.map(() => newId()).sort()
      const timestamp = nowIso()
      const created: Task[] = []
      for (const [index, { title, remindAt }] of inputs.entries()) {
        const identity = { id: ids[index]!, timestamp }
        created.push(writeTaskInTransaction(null, { title, remindAt }, true, identity))
      }
      if (created.length) editBatch = null
      return created
    },

    async updateTask(id, input) {
      return saveTaskWithRelations(id, input, currentRelationIds(id))
    },

    async saveTask(id, input, relatedTaskIds, editBatchId, scope) {
      return saveTaskWithRelations(id, input, relatedTaskIds, editBatchId, scope)
    },

    async generateTaskOccurrences(now = new Date()) {
      return await recurrence.generate(now) + checklistRecurrence.generate(now)
    },

    async rescheduleTaskOccurrence(id, input, scope) {
      return saveTaskWithRelations(id,input,await currentRelationIds(id),undefined,scope)
    },

    async createTaskOccurrence(taskId, occurrenceAt) {
      const source = getById(taskId)
      if (source.deletedAt) throw new Error(t('已删除任务不能创建重复期次'))
      const timestamp = nowIso()
      const created: Task = {
        ...source,
        id: newId(),
        status: 'todo',
        recurrenceSeriesId: source.recurrenceSeriesId ?? source.id,
        occurrenceAt: occurrenceAt || timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      }
      withTransaction(() => {
        storeDb.exec({
          sql: `INSERT INTO tasks
                (id, title, notes, url, priority, status, due_at, remind_at, category_id,
                 parent_task_id, recurrence_rule, recurrence_series_id, occurrence_at,
                 completion_strategy, reminder_settings, created_at, updated_at)
                VALUES ($id, $title, $notes, $url, $priority, $status, $dueAt, $remindAt, $categoryId,
                        $parentTaskId, $recurrenceRule, $recurrenceSeriesId, $occurrenceAt,
                        $completionStrategy, $reminderSettings, $createdAt, $updatedAt)`,
          bind: { '$id': created.id, ...bindForTask(created), '$createdAt': timestamp, '$updatedAt': timestamp },
        })
        setTags(created.id, created.tagIds)
        recordHistory(created, 'created')
      })
      return created
    },

    async deleteTask(id) {
      const current = getById(id)
      const deletedAt = nowIso()
      withTransaction(() => {
        recordHistory(current, 'deleted')
        storeDb.exec({
          sql: 'UPDATE tasks SET deleted_at = $deletedAt, updated_at = $deletedAt WHERE id = $id',
          bind: { '$id': id, '$deletedAt': deletedAt },
        })
      })
    },

    async permanentlyDeleteTask(id) {
      const task = getById(id)
      if (!task.deletedAt) throw new Error(t('只能永久删除回收站中的任务。'))
      const rule = readRecurrence(task.recurrenceRule)
      const value = rule?.mode === 'completion' && rule.basis ? await completionPurgeValue(rule.basis) : 'deleted'
      fields.reconcileTaskPurges({ key: taskPurgeKey(id), value, updatedAt: nowIso() })
    },

    async restoreTask(id) {
      const current = getById(id)
      if (!current.deletedAt) return current
      const restoredAt = nowIso()
      withTransaction(() => {
        recordHistory(current, 'restored')
        storeDb.exec({
          sql: 'UPDATE tasks SET deleted_at = NULL, updated_at = $updatedAt WHERE id = $id',
          bind: { '$id': id, '$updatedAt': restoredAt },
        })
      })
      return { ...current, deletedAt: null, updatedAt: restoredAt }
    },

    async listChecklistItems(taskId) {
      getById(taskId)
      return listChecklistRows(taskId)
    },

    async listAllChecklistItems() {
      return rowsFor(storeDb, `SELECT item.id, item.task_id, item.title, item.notes, item.completed,
          item.remind_at, item.recurrence_rule, item.recurrence_mode,
          item.created_at, item.updated_at, item.deleted_at
        FROM checklist_items AS item JOIN tasks AS task ON task.id = item.task_id
        WHERE item.deleted_at IS NULL AND task.deleted_at IS NULL
        ORDER BY item.task_id, item.completed, item.updated_at DESC`).map(checklistFromRow)
    },

    async createChecklistItem(taskId, input) {
      const parent = getById(taskId)
      if (parent.deletedAt) throw new Error(t('已删除任务不能添加检查项'))
      const item = normalizeChecklistInput(input)
      const timestamp = nowIso()
      let created: ChecklistItem = {
        id: newId(), taskId, ...item, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
      }
      created = { ...created, ...checklistRecurrence.prepare(null, created) }
      storeDb.exec({
        sql: `INSERT INTO checklist_items
              (id, task_id, title, notes, completed, remind_at, recurrence_rule, recurrence_mode, created_at, updated_at)
              VALUES ($id, $taskId, $title, $notes, $completed, $remindAt, $recurrenceRule, $recurrenceMode, $createdAt, $updatedAt)`,
        bind: {
          '$id': created.id, '$taskId': taskId, '$title': created.title, '$notes': created.notes,
          '$completed': created.completed ? 1 : 0, '$remindAt': created.remindAt,
          '$recurrenceRule': created.recurrenceRule, '$recurrenceMode': created.recurrenceMode,
          '$createdAt': timestamp, '$updatedAt': timestamp,
        },
      })
      return created
    },

    async updateChecklistItem(id, input, scope = 'this') {
      const row = rowsFor(storeDb, `SELECT id, task_id, title, notes, completed, remind_at, recurrence_rule,
          recurrence_mode, created_at, updated_at, deleted_at FROM checklist_items WHERE id = $id`, { '$id': id })[0]
      if (!row) throw new Error(t('检查项不存在'))
      const current = checklistFromRow(row)
      let next = normalizeChecklistInput({
        title: 'title' in input ? input.title : current.title,
        notes: 'notes' in input ? input.notes : current.notes,
        completed: 'completed' in input ? input.completed : current.completed,
        remindAt: 'remindAt' in input ? input.remindAt : current.remindAt,
        recurrenceRule: 'recurrenceRule' in input ? input.recurrenceRule : current.recurrenceRule,
        recurrenceMode: 'recurrenceMode' in input ? input.recurrenceMode : current.recurrenceMode,
      })
      next = checklistRecurrence.prepare(current, { ...current, ...next }, scope)
      const updatedAt = nowIso()
      withTransaction(() => {
        storeDb.exec({
          sql: `UPDATE checklist_items SET title = $title, notes = $notes, completed = $completed,
              remind_at = $remindAt, recurrence_rule = $recurrenceRule, recurrence_mode = $recurrenceMode,
              updated_at = $updatedAt WHERE id = $id`,
          bind: {
            '$id': id, '$title': next.title, '$notes': next.notes, '$completed': next.completed ? 1 : 0,
            '$remindAt': next.remindAt, '$recurrenceRule': next.recurrenceRule,
            '$recurrenceMode': next.recurrenceMode, '$updatedAt': updatedAt,
          },
        })
        if (next.recurrenceMode !== current.recurrenceMode) recurrence.updateChecklistMode(current, next.recurrenceMode)
        clearChangedReminderCycle('checklist', id, current.remindAt, next.remindAt)
      })
      if (next.completed !== current.completed) checklistRecurrence.generate(new Date(), true)
      return { ...current, ...next, updatedAt }
    },

    async deleteChecklistItem(id) {
      const existing = rowsFor(storeDb, 'SELECT id FROM checklist_items WHERE id = $id', { '$id': id })[0]
      if (!existing) throw new Error(t('检查项不存在'))
      storeDb.exec({ sql: 'UPDATE checklist_items SET deleted_at = $deletedAt, updated_at = $deletedAt WHERE id = $id', bind: { '$id': id, '$deletedAt': nowIso() } })
    },

    async listTaskRelations(taskId) {
      getById(taskId)
      return relationRowsForTask(taskId)
        .map((row) => ({
          taskId,
          relatedTaskId: textValue(row.task_id) === taskId ? textValue(row.related_task_id) ?? '' : textValue(row.task_id) ?? '',
          kind: (textValue(row.kind) ?? 'related') as TaskRelationKind,
          createdAt: textValue(row.created_at) ?? '',
          updatedAt: textValue(row.updated_at) ?? textValue(row.created_at) ?? '',
          deletedAt: textValue(row.deleted_at),
        }))
    },

    async listTaskRelationChanges() {
      return rowsFor(storeDb, `SELECT task_id, related_task_id, kind, created_at, updated_at, deleted_at
        FROM task_relations ORDER BY updated_at ASC, created_at ASC`).map((row) => ({
        taskId: textValue(row.task_id) ?? '',
        relatedTaskId: textValue(row.related_task_id) ?? '',
        kind: (textValue(row.kind) ?? 'related') as TaskRelationKind,
        createdAt: textValue(row.created_at) ?? '',
        updatedAt: textValue(row.updated_at) ?? textValue(row.created_at) ?? '',
        deletedAt: textValue(row.deleted_at),
      }))
    },

    async linkTasks(taskId, relatedTaskId) {
      getById(taskId)
      getById(relatedTaskId)
      return withTransaction(() => upsertRelationInTransaction(taskId, relatedTaskId, nowIso()))
    },

    async unlinkTasks(taskId, relatedTaskId) {
      const [first, second] = relationPair(taskId, relatedTaskId)
      const timestamp = nowIso()
      withTransaction(() => {
        storeDb.exec({
          sql: `UPDATE task_relations SET updated_at = $updatedAt, deleted_at = $deletedAt
                WHERE task_id = $taskId AND related_task_id = $relatedTaskId AND deleted_at IS NULL`,
          bind: { '$taskId': first, '$relatedTaskId': second, '$updatedAt': timestamp, '$deletedAt': timestamp },
        })
      })
    },

    async setTaskRelations(taskId, relatedTaskIds) {
      getById(taskId)
      const ids = normalizeRelationIds(taskId, relatedTaskIds)
      withTransaction(() => replaceTaskRelationsInTransaction(taskId, ids, nowIso()))
    },

    async getDefaultCompletionStrategy() {
      const row = rowsFor(storeDb, `SELECT value FROM task_settings WHERE key = 'default_completion_strategy'`)[0]
      return strategyValue(row?.value)
    },

    async setDefaultCompletionStrategy(strategy) {
      if (!PARENT_COMPLETION_STRATEGIES.includes(strategy)) throw new Error(t('未知父任务完成策略: {0}', strategy))
      storeDb.exec({ sql: `INSERT INTO task_settings (key, value, updated_at) VALUES ('default_completion_strategy', $value, $updatedAt)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, bind: { '$value': strategy, '$updatedAt': nowIso() } })
    },

    async getUiTheme() {
      const row = rowsFor(storeDb, `SELECT value FROM task_settings WHERE key = 'ui_theme'`)[0]
      const value = textValue(row?.value)
      return (UI_THEMES as readonly string[]).includes(value ?? '') ? value as UiTheme : 'system'
    },

    async setUiTheme(theme) {
      if (!UI_THEMES.includes(theme)) throw new Error(t('未知主题: {0}', theme))
      storeDb.exec({ sql: `INSERT INTO task_settings (key, value, updated_at) VALUES ('ui_theme', $value, $updatedAt)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, bind: { '$value': theme, '$updatedAt': nowIso() } })
      return theme
    },

    async getReminderSettings() {
      const row = (await rowsFor(storeDb, `SELECT value FROM task_settings WHERE key = 'reminder_settings'`))[0]
      const raw = textValue(row?.value)
      let settings = { ...DEFAULT_REMINDER_SETTINGS }
      if (raw) {
        try { settings = normalizeReminderSettings(JSON.parse(raw) as Partial<ReminderSettings>) } catch { /* retain local defaults */ }
      }
      const shared = textValue((await rowsFor(storeDb, `SELECT value FROM task_settings WHERE key = 'default_follow_up_minutes'`))[0]?.value)
      if (shared && /^[1-9]\d*$/.test(shared) && Number(shared) >= 5 && Number(shared) <= 1440) settings.followUpMinutes = Number(shared)
      return settings
    },

    async setReminderSettings(settings) {
      const current = await this.getReminderSettings()
      const next = normalizeReminderSettings({ ...current, ...settings })
      const updatedAt = nowIso()
      await storeDb.exec({
        sql: `INSERT INTO task_settings (key, value, updated_at) VALUES ('reminder_settings', $value, $updatedAt)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        bind: { '$value': JSON.stringify(next), '$updatedAt': updatedAt },
      })
      if (Object.hasOwn(settings, 'followUpMinutes')) await storeDb.exec({
        sql: `INSERT INTO task_settings (key, value, updated_at) VALUES ('default_follow_up_minutes', $value, $updatedAt)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        bind: { '$value': String(next.followUpMinutes), '$updatedAt': updatedAt },
      })
      return next
    },

    async getReminderRuntimeState() {
      return readReminderRuntime()
    },

    async setReminderRuntimeState(state) {
      writeReminderRuntime(state)
    },

    async listHistory(taskId) {
      return rowsFor(
        storeDb,
        `SELECT id, task_id, operation, snapshot_json, created_at
           FROM task_history WHERE task_id = $taskId ORDER BY created_at DESC`,
        { '$taskId': taskId },
      ).map(historyFromRow)
    },

    async restoreHistory(taskId, historyId, field) {
      const history = rowsFor(
        storeDb,
        'SELECT snapshot_json FROM task_history WHERE id = $id AND task_id = $taskId',
        { '$id': historyId, '$taskId': taskId },
      )[0]
      const raw = textValue(history?.snapshot_json)
      if (!raw) throw new Error(t('历史记录没有可恢复内容'))
      const snapshot = snapshotFromJson(raw)
      const current = getById(taskId)
      const restoredAt = nowIso()
      if (field !== undefined) {
        if (!isHistoryTextField(field) || (snapshot.id && snapshot.id !== taskId)) throw new Error(t('历史记录没有可恢复内容'))
        if (current.deletedAt) throw new Error(t('任务已删除，无法取回字段。'))
        const value = snapshot[field]
        if (value !== null && typeof value !== 'string') throw new Error(t('历史记录内容损坏'))
        if (field === 'title' && !value?.trim()) throw new Error(t('任务标题不能为空'))
        if (value === current[field]) return current
        recordHistory(current, 'updated')
        storeDb.exec({
          sql: `UPDATE tasks SET ${field} = $value, updated_at = $updatedAt WHERE id = $id`,
          bind: { '$value': value, '$updatedAt': restoredAt, '$id': taskId },
        })
        return getById(taskId)
      }
      withTransaction(() => {
        validateParent(taskId, snapshot.parentTaskId)
        recordHistory(current, 'history_restored')
        storeDb.exec({
          sql: `UPDATE tasks SET title = $title, notes = $notes, url = $url, priority = $priority,
                status = $status, due_at = $dueAt, remind_at = $remindAt, category_id = $categoryId,
                parent_task_id = $parentTaskId, recurrence_rule = $recurrenceRule,
                recurrence_series_id = $recurrenceSeriesId, occurrence_at = $occurrenceAt,
                completion_strategy = $completionStrategy, reminder_settings = $reminderSettings,
                updated_at = $updatedAt, deleted_at = $deletedAt WHERE id = $id`,
          bind: { '$id': taskId, ...bindForTask(snapshot), '$updatedAt': restoredAt, '$deletedAt': snapshot.deletedAt },
        })
        setTags(taskId, snapshot.tagIds)
        clearChangedReminderCycle('task', taskId, current.remindAt, snapshot.remindAt)
        if (snapshot.status === 'completed' && current.status !== 'completed') applyCompletionStrategy({ ...snapshot, updatedAt: restoredAt })
      })
      return getById(taskId)
    },

    async listCategories() { return listCategories() },

    async createCategory(name, completionStrategy = null, followUpMinutes = null) {
      const normalized = name.trim()
      if (!normalized) throw new Error(t('分类名称不能为空'))
      if (completionStrategy !== null && !PARENT_COMPLETION_STRATEGIES.includes(completionStrategy)) {
        throw new Error(t('未知父任务完成策略: {0}', completionStrategy))
      }
      if (followUpMinutes !== null && followUpMinutesValue(followUpMinutes) === null) throw new Error(t('追提醒间隔须为 5 至 1440 的整数'))
      const existing = rowsFor(storeDb, 'SELECT id FROM categories WHERE name = $name', { '$name': normalized })[0]
      if (existing) return listCategories().find((item) => item.id === textValue(existing.id)) as Category
      const timestamp = nowIso()
      const category: Category = { id: newId(), name: normalized, completionStrategy, followUpMinutes, createdAt: timestamp, updatedAt: timestamp }
      storeDb.exec({
        sql: 'INSERT INTO categories (id, name, completion_strategy, follow_up_minutes, created_at, updated_at) VALUES ($id, $name, $completionStrategy, $followUpMinutes, $createdAt, $updatedAt)',
        bind: { '$id': category.id, '$name': category.name, '$completionStrategy': completionStrategy, '$followUpMinutes': followUpMinutes, '$createdAt': timestamp, '$updatedAt': timestamp },
      })
      return category
    },

    async updateCategory(id, input) {
      const current = listCategories().find((item) => item.id === id)
      if (!current) throw new Error(t('分类不存在'))
      const name = 'name' in input ? input.name?.trim() ?? '' : current.name
      if (!name) throw new Error(t('分类名称不能为空'))
      if (rowsFor(storeDb, 'SELECT id FROM categories WHERE name=$name AND id<>$id', { '$name': name, '$id': id })[0]) throw new Error(t('已有同名分类'))
      const completionStrategy = 'completionStrategy' in input ? input.completionStrategy ?? null : current.completionStrategy
      if (completionStrategy !== null && !PARENT_COMPLETION_STRATEGIES.includes(completionStrategy)) {
        throw new Error(t('未知父任务完成策略: {0}', completionStrategy))
      }
      const followUpMinutes = 'followUpMinutes' in input ? input.followUpMinutes ?? null : current.followUpMinutes ?? null
      if (followUpMinutes !== null && followUpMinutesValue(followUpMinutes) === null) throw new Error(t('追提醒间隔须为 5 至 1440 的整数'))
      const updatedAt = nowIso()
      storeDb.exec({
        sql: 'UPDATE categories SET name = $name, completion_strategy = $completionStrategy, follow_up_minutes = $followUpMinutes, updated_at = $updatedAt WHERE id = $id',
        bind: { '$id': id, '$name': name, '$completionStrategy': completionStrategy, '$followUpMinutes': followUpMinutes, '$updatedAt': updatedAt },
      })
      return { ...current, name, completionStrategy, followUpMinutes, updatedAt }
    },

    async listTags() { return listTags() },

    async createTag(name) {
      const normalized = name.trim()
      if (!normalized) throw new Error(t('标签名称不能为空'))
      const existing = rowsFor(storeDb, 'SELECT id FROM tags WHERE name = $name', { '$name': normalized })[0]
      if (existing) {
        const id = String(existing.id)
        storeDb.exec({ sql: "UPDATE task_settings SET value='active', updated_at=$at WHERE key=$key AND value='deleted'",
          bind: { '$key': tagVisibilityKey(id), '$at': nowIso() } })
        return listTags().find(item => item.id === id) as Tag
      }
      const timestamp = nowIso()
      const tag: Tag = { id: newId(), name: normalized, createdAt: timestamp, updatedAt: timestamp }
      storeDb.exec({
        sql: 'INSERT INTO tags (id, name, created_at, updated_at) VALUES ($id, $name, $createdAt, $updatedAt)',
        bind: { '$id': tag.id, '$name': tag.name, '$createdAt': timestamp, '$updatedAt': timestamp },
      })
      return tag
    },

    async renameTag(id, requested) {
      const name = requested.trim()
      if (!name) throw new Error(t('标签名称不能为空'))
      const current = listTags().find(tag => tag.id === id)
      if (!current) throw new Error(t('标签不存在'))
      // 修剪后名称未变就不是修改。重写 updated_at 会让这次空保存压过另一台设备更早的真实改名。
      if (current.name === name) return current
      if (rowsFor(storeDb, 'SELECT id FROM tags WHERE name=$name AND id<>$id', { '$name': name, '$id': id })[0]) throw new Error(t('已有同名标签'))
      const updatedAt = nowIso()
      storeDb.exec({ sql: 'UPDATE tags SET name=$name, updated_at=$at WHERE id=$id',
        bind: { '$name': name, '$at': updatedAt, '$id': id } })
      return { ...current, name, updatedAt }
    },

    async deleteTag(id) {
      if (!listTags().some(tag => tag.id === id)) return
      const updatedAt = nowIso()
      storeDb.exec({ sql: `INSERT INTO task_settings(key,value,updated_at) VALUES ($key,'deleted',$at)
        ON CONFLICT(key) DO UPDATE SET value='deleted', updated_at=excluded.updated_at`,
        bind: { '$key': tagVisibilityKey(id), '$at': updatedAt } })
      storeDb.exec({ sql: 'UPDATE tasks SET updated_at=$at WHERE id IN (SELECT task_id FROM task_tags WHERE tag_id=$id)',
        bind: { '$id': id, '$at': updatedAt } })
      storeDb.exec({ sql: 'DELETE FROM task_tags WHERE tag_id=$id', bind: { '$id': id } })
    },

    async exportSyncSnapshot() {
      return exportSyncSnapshot()
    },

    async applySyncSnapshot(snapshot) {
      applySyncSnapshot(snapshot)
    },

    async exportLocalData(): Promise<LocalDataExport> {
      return {
        format: 'todou-local',
        version: 1,
        schemaVersion: 8,
        exportedAt: nowIso(),
        snapshot: exportSyncSnapshot(),
      }
    },

    async replaceLocalData(snapshot) {
      replaceLocalData(snapshot)
    },

    async enableFieldSync(scope) { fields.enable(scope) },
    async prepareFieldSync(scope) { return fields.prepare(scope) },
    async finishFieldSync(scope, incoming, sent, acknowledged, generation) {
      fields.finish(scope, incoming, sent, acknowledged, generation)
    },
    async fieldSyncStatus(scope) { return fields.status(scope) },
    async fieldSyncPendingDetails(scope, offset) { return fields.pendingDetails(scope, offset) },
    async chooseSyncField(scope, key, value) { fields.choose(scope, key, value) },

    getLocalWriteRevision() { return localWriteRevision },
    isRecoveryRequired() { return recoveryRequired },

    close() {
      storeDb.close()
    },
  }

  const persistedMethods = new Set<keyof TaskStore>([
    'saveTemplate', 'deleteTemplate', 'applyTemplate', 'createTask', 'createTasks', 'updateTask', 'saveTask', 'generateTaskOccurrences', 'rescheduleTaskOccurrence', 'createTaskOccurrence', 'deleteTask', 'restoreTask',
    'permanentlyDeleteTask', 'createChecklistItem', 'updateChecklistItem', 'deleteChecklistItem', 'linkTasks', 'unlinkTasks',
    'setTaskRelations', 'setDefaultCompletionStrategy', 'setUiTheme', 'setReminderSettings', 'setReminderRuntimeState',
    'restoreHistory', 'createCategory', 'updateCategory', 'createTag', 'renameTag', 'deleteTag', 'applySyncSnapshot', 'replaceLocalData',
    'enableFieldSync', 'prepareFieldSync', 'finishFieldSync', 'chooseSyncField',
  ])
  // 写事务与其后的异步落盘共用队列，避免下一次写入污染本次持久化镜像。
  let queue: Promise<void> = Promise.resolve()
  let localWriteRevision = 0
  let closed = false
  return new Proxy(store, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== 'function' || property === 'isRecoveryRequired' || property === 'getLocalWriteRevision') return value
      if (property === 'close') return () => {
        closed = true
        void queue.then(() => store.close())
      }
      // 读操作等待调用时已入队的写入完成；恢复标志单独同步读取，不进入此等待。
      if (!persistedMethods.has(property as keyof TaskStore)) return async (...args: unknown[]) => {
        await queue
        if (closed) throw new Error(t('本地数据库已关闭'))
        return (value as (...values: unknown[]) => Promise<unknown>).apply(target, args)
      }
      return (...args: unknown[]) => {
        if (closed) return Promise.reject(new Error(t('本地数据库已关闭')))
        // Include queued user writes even while their SQLite transaction has yet to start.
        const onlySyncMetadata = property === 'enableFieldSync' || property === 'prepareFieldSync'
          || (property === 'finishFieldSync' && Array.isArray(args[1]) && args[1].length === 0)
        if (!onlySyncMetadata) localWriteRevision++
        const result = queue.then(async () => {
          if (recoveryRequired) throw new PersistenceRecoveryError()
          const before = Number(rowsFor(storeDb, 'SELECT total_changes() AS count')[0]?.count)
          let result: unknown
          // 整体替换、字段合并及冲突选择自行维护同步状态，不再捕获为新的本机编辑。
          // 遗留 applySyncSnapshot 不在此列，仍按本机变更捕获。
          const externalWrite = property === 'replaceLocalData' || property === 'finishFieldSync' || property === 'chooseSyncField'
          const previousEditBatch = editBatch
          storeDb.exec('BEGIN IMMEDIATE')
          try {
            if (externalWrite) storeDb.exec('INSERT INTO skip_field_capture VALUES (1)')
            result = await (value as (...values: unknown[]) => Promise<unknown>).apply(target, args)
            if (externalWrite) storeDb.exec('DELETE FROM skip_field_capture')
            else fields.recordLocal()
            storeDb.exec('COMMIT')
          } catch (cause) {
            editBatch = previousEditBatch
            try { storeDb.exec('ROLLBACK') } catch { /* retain the operation failure */ }
            const message = cause instanceof Error ? cause.message : String(cause)
            // 存储 I/O 或容量错误同样禁写；普通业务校验失败只回滚本次事务。
            if (/SQLITE_(IOERR|FULL)|disk I\/O|disk is full|quota/i.test(message)) {
              recoveryRequired = true
              throw new PersistenceRecoveryError(cause)
            }
            throw cause
          }
          if (['deleteTask', 'permanentlyDeleteTask', 'restoreTask', 'restoreHistory', 'replaceLocalData'].includes(property as string)) editBatch = null
          const after = Number(rowsFor(storeDb, 'SELECT total_changes() AS count')[0]?.count)
          // 调用入口已计入修订；标签空保存没有行变更，收回这次计数。
          if (property === 'renameTag' && after === before) localWriteRevision--
          // 文件型后端的 COMMIT 只更新内存，须等待导出落盘；失败禁写，重新打开最后成功数据后再用。
          if (persistDatabase && after !== before) {
            try { await persistDatabase() } catch (cause) {
              recoveryRequired = true
              throw new PersistenceRecoveryError(cause)
            }
          }
          return result
        })
        // 吞掉的仅是队列尾部拒绝，调用者仍收到原异常；禁写标志会拦住后续已排队写入。
        queue = result.then(() => undefined, () => undefined)
        return result
      }
    },
  })
}

