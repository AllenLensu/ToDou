import { t } from '../i18n'
import { optionalDateInput, projectHistoryDates } from '../domain/persistedDate'
// SQL 行、业务模型与写入绑定之间的转换；普通读取兼容旧值，导入验证另走严格路径。
import type { SqlValue } from '@sqlite.org/sqlite-wasm'
import {
  CHECKLIST_RECURRENCE_MODES,
  PARENT_COMPLETION_STRATEGIES,
  REMINDER_MODES,
  REMINDER_STRENGTHS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type ChecklistItem,
  type ChecklistItemInput,
  type ChecklistRecurrenceMode,
  type HistoryOperation,
  type ParentCompletionStrategy,
  type TaskHistoryEntry,
  type ReminderSettings,
  type TaskReminderSettings,
  type ReminderRuntimeStateMap,
  type ReminderRuntimeState,
  type Task,
  type TaskInput,
  type TaskPriority,
  type TaskSnapshot,
  type TaskStatus,
} from './types'
import type { SqlRow } from './types'

export const textValue = (value: SqlValue | undefined): string | null =>
  value === null || value === undefined ? null : String(value)

export const newId = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// 普通行读取对未知枚举使用兼容默认值，不等同于允许新输入写入这些未知值。
export const priorityValue = (value: SqlValue | undefined): TaskPriority => {
  const priority = textValue(value)
  return priority && TASK_PRIORITIES.includes(priority as TaskPriority)
    ? priority as TaskPriority
    : 'none'
}

export const statusValue = (value: SqlValue | undefined): TaskStatus => {
  const status = textValue(value)
  return status && TASK_STATUSES.includes(status as TaskStatus) ? status as TaskStatus : 'todo'
}

export const strategyValue = (value: SqlValue | undefined): ParentCompletionStrategy | null => {
  const strategy = textValue(value)
  return strategy && PARENT_COMPLETION_STRATEGIES.includes(strategy as ParentCompletionStrategy)
    ? strategy as ParentCompletionStrategy
    : null
}

export const recurrenceModeValue = (value: SqlValue | undefined): ChecklistRecurrenceMode => {
  const mode = textValue(value)
  return mode && CHECKLIST_RECURRENCE_MODES.includes(mode as ChecklistRecurrenceMode)
    ? mode as ChecklistRecurrenceMode
    : 'independent'
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  mode: 'notification',
  followUpMinutes: 60,
  strength: 'normal',
  quietHoursEnabled: true,
  quietStart: '22:00',
  quietEnd: '08:00',
  notifyAfterQuietHours: true,
}

export const normalizeReminderSettings = (input: Partial<ReminderSettings> = {}): ReminderSettings => {
  const followUpMinutes = Number(input.followUpMinutes)
  const validClock = (value: unknown, fallback: string) =>
    typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback
  return {
    mode: input.mode && REMINDER_MODES.includes(input.mode) ? input.mode : DEFAULT_REMINDER_SETTINGS.mode,
    followUpMinutes: Number.isFinite(followUpMinutes) ? Math.min(24 * 60, Math.max(5, Math.round(followUpMinutes))) : DEFAULT_REMINDER_SETTINGS.followUpMinutes,
    strength: input.strength && REMINDER_STRENGTHS.includes(input.strength) ? input.strength : DEFAULT_REMINDER_SETTINGS.strength,
    quietHoursEnabled: typeof input.quietHoursEnabled === 'boolean' ? input.quietHoursEnabled : DEFAULT_REMINDER_SETTINGS.quietHoursEnabled,
    quietStart: validClock(input.quietStart, DEFAULT_REMINDER_SETTINGS.quietStart),
    quietEnd: validClock(input.quietEnd, DEFAULT_REMINDER_SETTINGS.quietEnd),
    notifyAfterQuietHours: typeof input.notifyAfterQuietHours === 'boolean' ? input.notifyAfterQuietHours : DEFAULT_REMINDER_SETTINGS.notifyAfterQuietHours,
  }
}

/** 任务显式 null 继续继承间隔；旧数字保持其显式配置。 */
export const normalizeTaskReminderSettings = (input: Partial<TaskReminderSettings> = {}): TaskReminderSettings => ({
  ...normalizeReminderSettings({ ...input, followUpMinutes: input.followUpMinutes ?? undefined }),
  followUpMinutes: input.followUpMinutes == null ? null : normalizeReminderSettings({ followUpMinutes: input.followUpMinutes }).followUpMinutes,
})

export const followUpMinutesValue = (value: SqlValue | undefined): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 5 && value <= 1440 ? value : null

/** 无法读取任务专属提醒设置时返回 null，由调用方沿用全局默认设置。 */
export const reminderSettingsValue = (value: SqlValue | undefined): TaskReminderSettings | null => {
  const raw = textValue(value)
  if (!raw) return null
  try {
    return normalizeTaskReminderSettings(JSON.parse(raw) as Partial<TaskReminderSettings>)
  } catch {
    return null
  }
}

export const taskFromRow = (row: SqlRow, tagIds: string[] = []): Task => ({
  id: textValue(row.id) ?? '',
  title: textValue(row.title) ?? '',
  notes: textValue(row.notes),
  url: textValue(row.url),
  priority: priorityValue(row.priority),
  status: statusValue(row.status),
  dueAt: textValue(row.due_at),
  remindAt: textValue(row.remind_at),
  categoryId: textValue(row.category_id),
  tagIds,
  parentTaskId: textValue(row.parent_task_id),
  recurrenceRule: textValue(row.recurrence_rule),
  recurrenceSeriesId: textValue(row.recurrence_series_id),
  occurrenceAt: textValue(row.occurrence_at),
  completionStrategy: strategyValue(row.completion_strategy),
  reminderSettings: reminderSettingsValue(row.reminder_settings),
  createdAt: textValue(row.created_at) ?? '',
  updatedAt: textValue(row.updated_at) ?? '',
  deletedAt: textValue(row.deleted_at),
})

// 写入入口拒绝空标题及未知状态／优先级／完成策略，同时规范空值与标签；
// 这不是完整导入校验，引用关系由存储用例检查，备份结构与日期等由导入层检查。
export const normalizeTaskInput = (input: Partial<TaskInput> & { title?: string }): Required<TaskInput> => {
  const title = input.title?.trim() ?? ''
  if (!title) throw new Error(t('任务标题不能为空'))

  const status = input.status ?? 'todo'
  if (!TASK_STATUSES.includes(status)) throw new Error(t('未知任务状态: {0}', status))
  const priority = input.priority ?? 'none'
  if (!TASK_PRIORITIES.includes(priority)) throw new Error(t('未知任务优先级: {0}', priority))
  const completionStrategy = input.completionStrategy ?? null
  if (completionStrategy !== null && !PARENT_COMPLETION_STRATEGIES.includes(completionStrategy)) {
    throw new Error(t('未知父任务完成策略: {0}', completionStrategy))
  }

  return {
    title,
    notes: input.notes?.trim() || null,
    url: input.url?.trim() || null,
    priority,
    status,
    dueAt: optionalDateInput(input.dueAt),
    remindAt: optionalDateInput(input.remindAt),
    categoryId: input.categoryId || null,
    tagIds: [...new Set((input.tagIds ?? []).map((id) => id.trim()).filter(Boolean))],
    parentTaskId: input.parentTaskId || null,
    recurrenceRule: input.recurrenceRule?.trim() ? input.recurrenceRule : null,
    recurrenceSeriesId: input.recurrenceSeriesId || null,
    occurrenceAt: optionalDateInput(input.occurrenceAt),
    completionStrategy,
    reminderSettings: input.reminderSettings ? normalizeTaskReminderSettings(input.reminderSettings) : null,
  }
}

export const normalizeChecklistInput = (
  input: Partial<ChecklistItemInput> & { title?: string },
): ChecklistItemInput => {
  const title = input.title?.trim() ?? ''
  if (!title) throw new Error(t('检查项标题不能为空'))
  const recurrenceMode = input.recurrenceMode ?? 'independent'
  if (!CHECKLIST_RECURRENCE_MODES.includes(recurrenceMode)) throw new Error(t('未知检查项重复模式: {0}', recurrenceMode))
  return {
    title,
    notes: input.notes?.trim() || null,
    completed: Boolean(input.completed),
    remindAt: optionalDateInput(input.remindAt),
    recurrenceRule: input.recurrenceRule?.trim() || null,
    recurrenceMode,
  }
}

export const checklistFromRow = (row: SqlRow): ChecklistItem => ({
  id: textValue(row.id) ?? '',
  taskId: textValue(row.task_id) ?? '',
  title: textValue(row.title) ?? '',
  notes: textValue(row.notes),
  completed: Number(row.completed ?? 0) === 1,
  remindAt: textValue(row.remind_at),
  recurrenceRule: textValue(row.recurrence_rule),
  recurrenceMode: recurrenceModeValue(row.recurrence_mode),
  createdAt: textValue(row.created_at) ?? '',
  updatedAt: textValue(row.updated_at) ?? '',
  deletedAt: textValue(row.deleted_at),
})

export const snapshotOf = (task: Task): TaskSnapshot => ({ ...task, tagIds: [...task.tagIds] })

// 历史快照只补缺省字段；JSON 解析失败会抛错，但这里不逐字段严格校验内容。
export const snapshotFromJson = (raw: string): TaskSnapshot => {
  let parsed: Partial<TaskSnapshot>
  try { parsed = projectHistoryDates(JSON.parse(raw) as Partial<TaskSnapshot>) } catch { throw new Error(t('历史记录内容损坏')) }
  return {
    ...parsed,
    id: parsed.id ?? '', title: parsed.title ?? '', notes: parsed.notes ?? null, url: parsed.url ?? null,
    priority: parsed.priority ?? 'none', status: parsed.status ?? 'todo', dueAt: parsed.dueAt ?? null,
    remindAt: parsed.remindAt ?? null, categoryId: parsed.categoryId ?? null,
    tagIds: Array.isArray(parsed.tagIds) ? parsed.tagIds : [], parentTaskId: parsed.parentTaskId ?? null,
    recurrenceRule: parsed.recurrenceRule ?? null, recurrenceSeriesId: parsed.recurrenceSeriesId ?? null,
    occurrenceAt: parsed.occurrenceAt ?? null, completionStrategy: parsed.completionStrategy ?? null,
    reminderSettings: parsed.reminderSettings ? normalizeTaskReminderSettings(parsed.reminderSettings) : null,
    createdAt: parsed.createdAt ?? '', updatedAt: parsed.updatedAt ?? '', deletedAt: parsed.deletedAt ?? null,
  } as TaskSnapshot
}

// 列表与同步快照共用同一转换：快照缺失或损坏时保留历史行，内容记为空。
export const historyFromRow = (row: SqlRow): TaskHistoryEntry => {
  const raw = textValue(row.snapshot_json)
  let snapshot: TaskSnapshot | null = null
  if (raw) {
    try { snapshot = snapshotFromJson(raw) } catch { snapshot = null }
  }
  return {
    id: textValue(row.id) ?? '', taskId: textValue(row.task_id) ?? '',
    operation: (textValue(row.operation) ?? 'updated') as HistoryOperation,
    snapshot, createdAt: textValue(row.created_at) ?? '',
  }
}

export const nowIso = () => new Date().toISOString()

/** 旧提醒运行态可缺少静默时段标记；无效标记不保留，仍可保留有效的推迟／通知时间。 */
export const normalizeReminderRuntimeState = (input: unknown): ReminderRuntimeStateMap => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const positiveTime = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null
  return Object.fromEntries(Object.entries(input).flatMap(([key, raw]) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const value = raw as Record<string, unknown>
    const state: ReminderRuntimeState = { snoozedUntil: positiveTime(value.snoozedUntil), lastNotifiedAt: positiveTime(value.lastNotifiedAt) }
    const marker = value.quietConsumed as Partial<NonNullable<ReminderRuntimeState['quietConsumed']>> | undefined
    if (marker && typeof marker === 'object'
      && typeof marker.windowStart === 'number' && Number.isSafeInteger(marker.windowStart) && marker.windowStart > 0
      && typeof marker.windowEnd === 'number' && Number.isSafeInteger(marker.windowEnd) && marker.windowEnd > marker.windowStart
      && typeof marker.remindAt === 'string' && Number.isFinite(Date.parse(marker.remindAt))
      && typeof marker.settingsKey === 'string' && marker.settingsKey.length > 0) {
      state.quietConsumed = { windowStart: marker.windowStart, windowEnd: marker.windowEnd, remindAt: marker.remindAt, settingsKey: marker.settingsKey }
    }
    return state.snoozedUntil || state.lastNotifiedAt || state.quietConsumed ? [[key, state]] : []
  }))
}

export const bindForTask = (task: TaskInput) => ({
  '$title': task.title,
  '$notes': task.notes,
  '$url': task.url,
  '$priority': task.priority,
  '$status': task.status,
  '$dueAt': optionalDateInput(task.dueAt),
  '$remindAt': optionalDateInput(task.remindAt),
  '$categoryId': task.categoryId,
  '$parentTaskId': task.parentTaskId ?? null,
  '$recurrenceRule': task.recurrenceRule ?? null,
  '$recurrenceSeriesId': task.recurrenceSeriesId ?? null,
  '$occurrenceAt': optionalDateInput(task.occurrenceAt),
  '$completionStrategy': task.completionStrategy ?? null,
  '$reminderSettings': task.reminderSettings ? JSON.stringify(task.reminderSettings) : null,
})

export type { HistoryOperation }
