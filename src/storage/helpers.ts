import { t } from '../i18n'
import type { Database } from '@sqlite.org/sqlite-wasm'
import { rowsFor } from './database'
import {
  type Category,
  type HistoryOperation,
  type Task,
  type TaskSnapshot,
  type SqlRow,
} from './types'
import {
  checklistFromRow,
  followUpMinutesValue,
  newId,
  nowIso,
  snapshotOf,
  strategyValue,
  taskFromRow,
  textValue,
} from './transform'

/** 存储用例共用的 SQL 查询与关系约束；事务、写队列及持久化由 taskStore 负责。 */
export const createStoreHelpers = (db: Database) => {
  const tagIdsFor = (taskId: string) => rowsFor(
    db,
    'SELECT tag_id FROM task_tags WHERE task_id = $taskId ORDER BY tag_id',
    { '$taskId': taskId },
  ).map((row) => textValue(row.tag_id) ?? '').filter(Boolean)

  const getById = (id: string): Task => {
    const rows = rowsFor(
      db,
      `SELECT id, title, notes, url, priority, status, due_at, remind_at,
              category_id, parent_task_id, recurrence_rule, recurrence_series_id,
              occurrence_at, completion_strategy, reminder_settings, created_at, updated_at, deleted_at
         FROM tasks WHERE id = $id`,
      { '$id': id },
    )
    if (!rows[0]) throw new Error(t('任务不存在'))
    return taskFromRow(rows[0], tagIdsFor(id))
  }

  // 批量读取标签避免逐任务查询；只补充传入任务，仍保留任务查询的行顺序。
  const tasksWithTags = (rows: SqlRow[]): Task[] => {
    if (!rows.length) return []
    const ids = new Set(rows.map((row) => textValue(row.id) ?? ''))
    const tagsByTask = new Map<string, string[]>()
    for (const row of rowsFor(db, 'SELECT task_id, tag_id FROM task_tags ORDER BY task_id, tag_id')) {
      const taskId = textValue(row.task_id) ?? ''
      const tagId = textValue(row.tag_id)
      if (!ids.has(taskId) || !tagId) continue
      const tags = tagsByTask.get(taskId) ?? []
      tags.push(tagId)
      tagsByTask.set(taskId, tags)
    }
    return rows.map((row) => taskFromRow(row, tagsByTask.get(textValue(row.id) ?? '') ?? []))
  }

  // 先按状态分组，再按更新时间倒序；父子展示顺序由领域层在可见任务集上另行整理。
  const listByDeleted = (deleted: boolean) => tasksWithTags(rowsFor(
    db,
    `SELECT id, title, notes, url, priority, status, due_at, remind_at,
            category_id, parent_task_id, recurrence_rule, recurrence_series_id,
            occurrence_at, completion_strategy, reminder_settings, created_at, updated_at, deleted_at
       FROM tasks
      WHERE deleted_at IS ${deleted ? 'NOT ' : ''}NULL
      ORDER BY CASE status
                 WHEN 'todo' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'waiting' THEN 2
                 WHEN 'paused' THEN 3 WHEN 'completed' THEN 4 WHEN 'cancelled' THEN 5
               END, updated_at DESC, id ASC`,
  ))

  const recordHistory = (task: Task, operation: HistoryOperation, snapshot: TaskSnapshot | null = snapshotOf(task)) => {
    db.exec({
      sql: `INSERT INTO task_history (id, task_id, operation, snapshot_json, created_at)
            VALUES ($id, $taskId, $operation, $snapshot, $createdAt)`,
      bind: {
        '$id': newId(), '$taskId': task.id, '$operation': operation,
        '$snapshot': snapshot ? JSON.stringify(snapshot) : null, '$createdAt': nowIso(),
      },
    })
  }

  const setTags = (taskId: string, tagIds: string[], includeDeleted = false) => {
    db.exec({ sql: 'DELETE FROM task_tags WHERE task_id = $taskId', bind: { '$taskId': taskId } })
    for (const tagId of [...new Set(tagIds.filter(Boolean))]) {
      db.exec({
        sql: `INSERT INTO task_tags (task_id, tag_id) SELECT $taskId, $tagId
          ${includeDeleted ? '' : "WHERE NOT EXISTS (SELECT 1 FROM task_settings WHERE key='tag_visibility:' || $tagId AND value='deleted')"}`,
        bind: { '$taskId': taskId, '$tagId': tagId },
      })
    }
  }

  const listCategories = (): Category[] => rowsFor(
    db,
    'SELECT id, name, completion_strategy, follow_up_minutes, created_at, updated_at FROM categories ORDER BY name COLLATE NOCASE',
  ).map((row) => ({
    id: textValue(row.id) ?? '', name: textValue(row.name) ?? '',
    completionStrategy: strategyValue(row.completion_strategy),
    followUpMinutes: followUpMinutesValue(row.follow_up_minutes),
    createdAt: textValue(row.created_at) ?? '', updatedAt: textValue(row.updated_at) ?? '',
  }))

  const listTags = (includeDeleted = false) => rowsFor(
    db,
    `SELECT id, name, created_at, updated_at FROM tags
       ${includeDeleted ? '' : "WHERE NOT EXISTS (SELECT 1 FROM task_settings WHERE key='tag_visibility:' || tags.id AND value='deleted')"}
       ORDER BY name COLLATE NOCASE`,
  ).map((row) => ({
    id: textValue(row.id) ?? '', name: textValue(row.name) ?? '',
    createdAt: textValue(row.created_at) ?? '', updatedAt: textValue(row.updated_at) ?? '',
  }))

  // includeDeleted 为 true 时只查已删除项，并非在正常结果中附加已删除项；未完成项排在完成项前。
  const listChecklistRows = (taskId: string, includeDeleted = false) => rowsFor(
    db,
    `SELECT id, task_id, title, notes, completed, remind_at, recurrence_rule,
            recurrence_mode, created_at, updated_at, deleted_at
       FROM checklist_items
      WHERE task_id = $taskId AND deleted_at IS ${includeDeleted ? 'NOT ' : ''}NULL
      ORDER BY completed, updated_at DESC`,
    { '$taskId': taskId },
  ).map(checklistFromRow)

  // 关联是无向的：固定两端 ID 次序，使反向操作命中同一条关系；这里不检查任务是否存在。
  const relationPair = (taskId: string, relatedTaskId: string): [string, string] => {
    if (!taskId || !relatedTaskId || taskId === relatedTaskId) throw new Error(t('不能关联同一条任务'))
    return taskId < relatedTaskId ? [taskId, relatedTaskId] : [relatedTaskId, taskId]
  }

  const validateParent = (taskId: string | null, parentTaskId: string | null) => {
    if (!parentTaskId) return
    if (taskId && parentTaskId === taskId) throw new Error(t('任务不能成为自己的父任务'))
    let cursor: string | null = parentTaskId
    const seen = new Set<string>()
    while (cursor) {
      if (seen.has(cursor)) throw new Error(t('父子任务层级存在循环'))
      seen.add(cursor)
      const parent = getById(cursor)
      if (taskId && parent.id === taskId) throw new Error(t('父子任务层级不能形成循环'))
      cursor = parent.parentTaskId
    }
  }

  return {
    db,
    getById,
    listByDeleted,
    recordHistory,
    setTags,
    listCategories,
    listTags,
    listChecklistRows,
    relationPair,
    validateParent,
  }
}
