import { t } from '../i18n'
import { isPersistedDate } from '../domain/persistedDate'
import { isSharedValueSetting, validSharedSettingValue } from '../sync/sharedSettingValue'
import { decodeTemplate } from '../domain/taskTemplate'
// 本地 JSON 导入的格式与引用校验；可补齐旧格式字段，但不触碰现有数据库。
import {
  CHECKLIST_RECURRENCE_MODES, PARENT_COMPLETION_STRATEGIES, REMINDER_MODES,
  REMINDER_STRENGTHS, TASK_PRIORITIES, TASK_STATUSES,
  type LocalDataExport, type SyncSnapshot,
} from '../storage/types'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const fail = (path: string): never => { throw new Error(t('导入数据不完整或无效：{0}', path)) }
const text = (value: unknown, path: string, nonempty = false) => {
  if (typeof value !== 'string' || (nonempty && !value.trim())) fail(path)
}
const nullableText = (value: unknown, path: string) => { if (value !== null) text(value, path) }
const date = (value: unknown, path: string, nullable = false) => {
  if (nullable && value === null) return
  if (!isPersistedDate(value)) fail(path)
}
const choice = (value: unknown, choices: readonly string[], path: string, nullable = false) => {
  if (nullable && value === null) return
  if (typeof value !== 'string' || !choices.includes(value)) fail(path)
}
const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!isRecord(value)) return fail(path)
  return value
}
const timestamps = (row: Record<string, unknown>, path: string, deleted = true) => {
  date(row.createdAt, `${path}.createdAt`)
  date(row.updatedAt, `${path}.updatedAt`)
  if (deleted) date(row.deletedAt, `${path}.deletedAt`, true)
}
const reminderSettings = (value: unknown, path: string) => {
  if (value === null) return
  const row = record(value, path)
  choice(row.mode, REMINDER_MODES, `${path}.mode`)
  choice(row.strength, REMINDER_STRENGTHS, `${path}.strength`)
  if (row.followUpMinutes !== null && (!Number.isInteger(row.followUpMinutes) || (row.followUpMinutes as number) < 5 || (row.followUpMinutes as number) > 1440)) fail(`${path}.followUpMinutes`)
  for (const key of ['quietHoursEnabled', 'notifyAfterQuietHours']) if (typeof row[key] !== 'boolean') fail(`${path}.${key}`)
  for (const key of ['quietStart', 'quietEnd']) if (typeof row[key] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row[key])) fail(`${path}.${key}`)
}

/** 替换事务删除旧数据前，先校验全部记录、引用及父子关系，避免部分有效数据被静默导入。 */
export const validateLocalSnapshot = (value: unknown, schemaVersion = 8): SyncSnapshot => {
  const snapshot = record(value, 'snapshot')
  const arrays = ['tasks', 'checklistItems', 'relations', 'categories', 'tags', 'history', 'settings'] as const
  if (arrays.some((key) => !Array.isArray(snapshot[key]))) throw new Error(t('导入文件缺少完整的数据集合'))
  const rows = Object.fromEntries(arrays.map((key) => [key, (snapshot[key] as unknown[]).map((row, index) => record(row, `${key}[${index}]`))])) as Record<typeof arrays[number], Record<string, unknown>[]>
  const unique = (items: Record<string, unknown>[], key: string, path: string) => {
    const ids = new Set<string>()
    items.forEach((row, index) => {
      text(row[key], `${path}[${index}].${key}`, true)
      const id = row[key] as string
      if (ids.has(id)) fail(t('{0} 包含重复标识 {1}', path, id))
      ids.add(id)
    })
    return ids
  }
  const taskIds = unique(rows.tasks, 'id', 'tasks')
  const categoryIds = unique(rows.categories, 'id', 'categories')
  const tagIds = unique(rows.tags, 'id', 'tags')
  unique(rows.checklistItems, 'id', 'checklistItems')
  unique(rows.history, 'id', 'history')
  unique(rows.settings, 'key', 'settings')
  const reference = (id: unknown, ids: Set<string>, path: string, nullable = false) => {
    if (nullable && id === null) return
    if (typeof id !== 'string' || !ids.has(id)) fail(t('{0} 引用不存在', path))
  }
  const validateTask = (row: Record<string, unknown>, path: string, historical = false) => {
    text(row.id, `${path}.id`, true)
    text(row.title, `${path}.title`, true)
    for (const key of ['notes', 'url', 'recurrenceRule', 'recurrenceSeriesId']) nullableText(row[key], `${path}.${key}`)
    choice(row.priority, TASK_PRIORITIES, `${path}.priority`)
    choice(row.status, TASK_STATUSES, `${path}.status`)
    choice(row.completionStrategy, PARENT_COMPLETION_STRATEGIES, `${path}.completionStrategy`, true)
    for (const key of ['dueAt', 'remindAt', 'occurrenceAt']) date(row[key], `${path}.${key}`, true)
    timestamps(row, path)
    reference(row.categoryId, categoryIds, `${path}.categoryId`, true)
    reference(row.parentTaskId, taskIds, `${path}.parentTaskId`, true)
    reference(row.recurrenceSeriesId, taskIds, `${path}.recurrenceSeriesId`, true)
    if (!historical && row.parentTaskId === row.id) fail(t('{0}.parentTaskId 自引用', path))
    if (!Array.isArray(row.tagIds)) fail(`${path}.tagIds`)
    const tags = row.tagIds as unknown[]
    if (new Set(tags).size !== tags.length) fail(t('{0}.tagIds 重复', path))
    tags.forEach((id) => reference(id, tagIds, `${path}.tagIds`))
    // 格式 6 尚无逐任务提醒设置；只为该旧格式补上“跟随默认值”。
    if (schemaVersion === 6 && !('reminderSettings' in row)) row.reminderSettings = null
    reminderSettings(row.reminderSettings, `${path}.reminderSettings`)
  }
  rows.categories.forEach((row, index) => {
    const path = `categories[${index}]`
    text(row.name, `${path}.name`, true)
    choice(row.completionStrategy, PARENT_COMPLETION_STRATEGIES, `${path}.completionStrategy`, true)
    if (!('followUpMinutes' in row)) row.followUpMinutes = null
    if (row.followUpMinutes !== null && (!Number.isInteger(row.followUpMinutes) || (row.followUpMinutes as number) < 5 || (row.followUpMinutes as number) > 1440)) fail(`${path}.followUpMinutes`)
    timestamps(row, path, false)
  })
  rows.tags.forEach((row, index) => { text(row.name, `tags[${index}].name`, true); timestamps(row, `tags[${index}]`, false) })
  const folded = (name: unknown) => (name as string).replace(/[A-Z]/g, (char) => char.toLowerCase())
  for (const key of ['categories', 'tags'] as const) {
    const names = rows[key].map((row) => folded(row.name))
    if (new Set(names).size !== names.length) fail(t('{0} 名称重复', key))
  }
  rows.tasks.forEach((row, index) => validateTask(row, `tasks[${index}]`))
  const parents = new Map(rows.tasks.map((row) => [row.id as string, row.parentTaskId as string | null]))
  const visited = new Set<string>()
  for (const id of taskIds) {
    const path = new Set<string>()
    let cursor: string | null = id
    while (cursor !== null && !visited.has(cursor)) {
      if (path.has(cursor)) fail(t('tasks 父子关系形成循环'))
      path.add(cursor)
      cursor = parents.get(cursor) ?? null
    }
    path.forEach((item) => visited.add(item))
  }
  rows.checklistItems.forEach((row, index) => {
    const path = `checklistItems[${index}]`
    reference(row.taskId, taskIds, `${path}.taskId`)
    text(row.title, `${path}.title`, true)
    nullableText(row.notes, `${path}.notes`)
    nullableText(row.recurrenceRule, `${path}.recurrenceRule`)
    if (typeof row.completed !== 'boolean') fail(`${path}.completed`)
    date(row.remindAt, `${path}.remindAt`, true)
    choice(row.recurrenceMode, CHECKLIST_RECURRENCE_MODES, `${path}.recurrenceMode`)
    timestamps(row, path)
  })
  const relationIds = new Set<string>()
  rows.relations.forEach((row, index) => {
    const path = `relations[${index}]`
    reference(row.taskId, taskIds, `${path}.taskId`)
    reference(row.relatedTaskId, taskIds, `${path}.relatedTaskId`)
    if (row.taskId === row.relatedTaskId) fail(t('{0} 自引用', path))
    choice(row.kind, ['related'], `${path}.kind`)
    timestamps(row, path)
    const key = JSON.stringify([row.taskId, row.relatedTaskId].sort())
    if (relationIds.has(key)) fail(t('{0} 关联重复', path))
    relationIds.add(key)
  })
  rows.history.forEach((row, index) => {
    const path = `history[${index}]`
    reference(row.taskId, taskIds, `${path}.taskId`)
    choice(row.operation, ['created', 'updated', 'deleted', 'restored', 'history_restored'], `${path}.operation`)
    date(row.createdAt, `${path}.createdAt`)
    if (row.snapshot !== null) {
      const previous = record(row.snapshot, `${path}.snapshot`)
      validateTask(previous, `${path}.snapshot`, true)
      if (previous.id !== row.taskId) fail(t('{0}.snapshot.id 不匹配', path))
    }
  })
  rows.settings.forEach((row, index) => {
    text(row.value, `settings[${index}].value`)
    if (typeof row.key === 'string' && row.key.startsWith('task_template.')) decodeTemplate(String(row.value), row.key)
    if (typeof row.key === 'string' && isSharedValueSetting(row.key) && !validSharedSettingValue(row.key, row.value)) fail(`settings[${index}].value`)
    date(row.updatedAt, `settings[${index}].updatedAt`)
  })
  return snapshot as unknown as SyncSnapshot
}

export const parseLocalDataExport = (raw: string): LocalDataExport => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(t('导入文件不是有效的 JSON'))
  }
  if (!isRecord(parsed) || parsed.format !== 'todou-local' || parsed.version !== 1) {
    throw new Error(t('导入文件不是受支持的 ToDou 本地数据格式'))
  }
  const candidate = parsed as Record<string, unknown>
  if (candidate.schemaVersion !== 6 && candidate.schemaVersion !== 7 && candidate.schemaVersion !== 8) {
    throw new Error(t('导入文件的数据库版本不受支持，请先使用当前版本重新导出'))
  }
  date(candidate.exportedAt, 'exportedAt')
  candidate.snapshot = validateLocalSnapshot(candidate.snapshot, candidate.schemaVersion)
  return parsed as unknown as LocalDataExport
}

export const localDataSummary = (data: LocalDataExport) => ({
  tasks: data.snapshot.tasks.length,
  checklistItems: data.snapshot.checklistItems.length,
  categories: data.snapshot.categories.length,
  tags: data.snapshot.tags.length,
  history: data.snapshot.history.length,
})

export function downloadLocalDataExport(data: LocalDataExport, now = new Date()) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `todou-local-${now.toISOString().slice(0, 10)}.todou.json`
  document.body.append(link)
  link.click()
  link.remove()
  // Chromium may start reading the Blob after the click handler returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
