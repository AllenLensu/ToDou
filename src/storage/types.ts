import type { TaskTemplate } from '../domain/taskTemplate'
import type { RecurrenceScope } from '../domain/recurrence'
// 领域记录与异步存储契约；同步快照只含业务数据，不携带设备网盘授权。
import type { SqlValue } from '@sqlite.org/sqlite-wasm'
import type { FieldChange, FieldValue } from '../sync/fieldMerge'

export const TASK_STATUSES = [
  'todo',
  'in_progress',
  'waiting',
  'paused',
  'completed',
  'cancelled',
] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]

/** How the local reminder is delivered when a task reaches its reminder time. */
export const REMINDER_MODES = ['notification', 'none'] as const
export type ReminderMode = (typeof REMINDER_MODES)[number]

/** Notification strength. Alarm mode keeps the notification visible until dismissed where supported. */
export const REMINDER_STRENGTHS = ['normal', 'alarm'] as const
export type ReminderStrength = (typeof REMINDER_STRENGTHS)[number]

/** Interface theme. 'system' follows prefers-color-scheme. Stored as task_settings key 'ui_theme'. */
export const UI_THEMES = ['dark', 'light', 'system'] as const
export type UiTheme = (typeof UI_THEMES)[number]

export interface ReminderSettings {
  mode: ReminderMode
  followUpMinutes: number
  strength: ReminderStrength
  quietHoursEnabled: boolean
  quietStart: string
  quietEnd: string
  notifyAfterQuietHours: boolean
}

export type TaskReminderSettings = Omit<ReminderSettings, 'followUpMinutes'> & { followUpMinutes: number | null }

export interface ReminderRuntimeState {
  snoozedUntil: number | null
  lastNotifiedAt: number | null
  /** A consumed quiet window; separate from actual deliveries and manual snoozes. */
  quietConsumed?: {
    windowStart: number
    windowEnd: number
    remindAt: string
    settingsKey: string
  }
}

export type ReminderRuntimeStateMap = Record<string, ReminderRuntimeState>

export const TASK_PRIORITIES = ['none', 'low', 'medium', 'high'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

/** How a recurring checklist item gets its next occurrence. */
export const CHECKLIST_RECURRENCE_MODES = ['independent', 'follow_task'] as const
export type ChecklistRecurrenceMode = (typeof CHECKLIST_RECURRENCE_MODES)[number]

/** Behaviour when a parent task is completed while child items remain open. */
export const PARENT_COMPLETION_STRATEGIES = [
  'require_children',
  'complete_parent_only',
  'complete_all_children',
] as const
export type ParentCompletionStrategy = (typeof PARENT_COMPLETION_STRATEGIES)[number]

export type TaskRelationKind = 'related'

export interface Task {
  id: string
  title: string
  notes: string | null
  url: string | null
  priority: TaskPriority
  status: TaskStatus
  dueAt: string | null
  remindAt: string | null
  categoryId: string | null
  tagIds: string[]
  parentTaskId: string | null
  recurrenceRule: string | null
  recurrenceSeriesId: string | null
  occurrenceAt: string | null
  /** null 表示继承分类，再继承全局完成策略；并非显式选择“只完成父任务”。 */
  completionStrategy: ParentCompletionStrategy | null
  /** null 使用已保存的默认提醒配置；检查项沿用所属任务的有效配置，不另存一套。 */
  reminderSettings: TaskReminderSettings | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type TaskInput = Pick<
  Task,
  | 'title' | 'notes' | 'url' | 'priority' | 'status' | 'dueAt' | 'remindAt' | 'categoryId' | 'tagIds'
> & Partial<Pick<
  Task,
  'parentTaskId' | 'recurrenceRule' | 'recurrenceSeriesId' | 'occurrenceAt' | 'completionStrategy' | 'reminderSettings'
>>

export interface ChecklistItem {
  id: string
  taskId: string
  title: string
  notes: string | null
  completed: boolean
  remindAt: string | null
  recurrenceRule: string | null
  recurrenceMode: ChecklistRecurrenceMode
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type ChecklistItemInput = Pick<
  ChecklistItem,
  'title' | 'notes' | 'completed' | 'remindAt' | 'recurrenceRule' | 'recurrenceMode'
>

export interface TaskRelation {
  taskId: string
  relatedTaskId: string
  kind: TaskRelationKind
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface Category {
  id: string
  name: string
  /** null 或缺少字段时继承全局追提醒间隔。 */
  followUpMinutes?: number | null
  /** null 继续继承全局完成策略。 */
  completionStrategy: ParentCompletionStrategy | null
  createdAt: string
  updatedAt: string
}

export interface Tag {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

/** A task setting is independently timestamped so it can be merged by key. */
export interface TaskSetting {
  key: string
  value: string
  updatedAt: string
}

export type HistoryTextField = 'title' | 'notes' | 'url'
export const isHistoryTextField = (field: string): field is HistoryTextField =>
  field === 'title' || field === 'notes' || field === 'url'

export type HistoryOperation = 'created' | 'updated' | 'deleted' | 'restored' | 'history_restored'
export type TaskSnapshot = Omit<Task, 'tagIds'> & { tagIds: string[] }

export interface TaskHistoryEntry {
  id: string
  taskId: string
  operation: HistoryOperation
  snapshot: TaskSnapshot | null
  createdAt: string
}

/** 遗留整行合并及当前字段投影共用的存储无关业务快照，不含本机同步元数据。 */
export interface SyncSnapshot {
  tasks: Task[]
  checklistItems: ChecklistItem[]
  relations: TaskRelation[]
  categories: Category[]
  tags: Tag[]
  history: TaskHistoryEntry[]
  settings: TaskSetting[]
}

export interface LocalDataExport {
  format: 'todou-local'
  version: 1
  schemaVersion: number
  exportedAt: string
  snapshot: SyncSnapshot
}

/** 写操作完成所需持久化后才兑现 Promise；读操作先等待已入队写入，不绕过保存过程。 */
export interface TaskStore {
  listTasks(): Promise<Task[]>
  listDeletedTasks(): Promise<Task[]>
  listTemplates(): Promise<TaskTemplate[]>
  saveTemplate(template: TaskTemplate): Promise<void>
  deleteTemplate(id: string): Promise<void>
  applyTemplate(id: string, day: string): Promise<Task>
  createTask(input: Partial<TaskInput> & Pick<TaskInput, 'title'>): Promise<Task>
  createTasks(inputs: readonly Pick<TaskInput, 'title' | 'remindAt'>[]): Promise<Task[]>
  updateTask(id: string, input: Partial<TaskInput>): Promise<Task>
  saveTask(id: string | null, input: Partial<TaskInput>, relatedTaskIds: string[], editBatchId?: string, scope?: RecurrenceScope): Promise<Task>
  generateTaskOccurrences(now?: Date): Promise<number>
  rescheduleTaskOccurrence(id: string, input: Pick<Partial<TaskInput>, 'dueAt'|'remindAt'>, scope: RecurrenceScope): Promise<Task>
  createTaskOccurrence(taskId: string, occurrenceAt?: string): Promise<Task>
  deleteTask(id: string): Promise<void>
  permanentlyDeleteTask(id: string): Promise<void>
  restoreTask(id: string): Promise<Task>
  listChecklistItems(taskId: string): Promise<ChecklistItem[]>
  /** Undeleted checklist items whose owning task is also undeleted. */
  listAllChecklistItems(): Promise<ChecklistItem[]>
  createChecklistItem(taskId: string, input: Partial<ChecklistItemInput> & Pick<ChecklistItemInput, 'title'>): Promise<ChecklistItem>
  updateChecklistItem(id: string, input: Partial<ChecklistItemInput>, scope?: RecurrenceScope): Promise<ChecklistItem>
  deleteChecklistItem(id: string): Promise<void>
  listTaskRelations(taskId: string): Promise<TaskRelation[]>
  listTaskRelationChanges(): Promise<TaskRelation[]>
  linkTasks(taskId: string, relatedTaskId: string): Promise<TaskRelation>
  unlinkTasks(taskId: string, relatedTaskId: string): Promise<void>
  setTaskRelations(taskId: string, relatedTaskIds: string[]): Promise<void>
  getDefaultCompletionStrategy(): Promise<ParentCompletionStrategy | null>
  setDefaultCompletionStrategy(strategy: ParentCompletionStrategy): Promise<void>
  getUiTheme(): Promise<UiTheme>
  setUiTheme(theme: UiTheme): Promise<UiTheme>
  getReminderSettings(): Promise<ReminderSettings>
  setReminderSettings(settings: Partial<ReminderSettings>): Promise<ReminderSettings>
  getReminderRuntimeState(): Promise<ReminderRuntimeStateMap>
  setReminderRuntimeState(state: ReminderRuntimeStateMap): Promise<void>
  listHistory(taskId: string): Promise<TaskHistoryEntry[]>
  restoreHistory(taskId: string, historyId: string, field?: HistoryTextField): Promise<Task>
  listCategories(): Promise<Category[]>
  createCategory(name: string, completionStrategy?: ParentCompletionStrategy | null, followUpMinutes?: number | null): Promise<Category>
  updateCategory(id: string, input: { name?: string; completionStrategy?: ParentCompletionStrategy | null; followUpMinutes?: number | null }): Promise<Category>
  listTags(): Promise<Tag[]>
  createTag(name: string): Promise<Tag>
  renameTag(id: string, name: string): Promise<Tag>
  deleteTag(id: string): Promise<void>
  /** Export all syncable rows, including tombstones. */
  exportSyncSnapshot(): Promise<SyncSnapshot>
  /** Apply a snapshot already produced by the storage-independent merge layer. */
  applySyncSnapshot(snapshot: SyncSnapshot): Promise<void>
  enableFieldSync(scope: string): Promise<void>
  /** 冻结可重试的待传版本；generation 随网络结果回传，用于拒绝恢复前的旧结果。 */
  prepareFieldSync(scope: string): Promise<{ changes: FieldChange[]; seen: string[]; generation: string; restoreId?: string }>
  finishFieldSync(scope: string, incoming: Array<{ name: string; changes: FieldChange[] }>,
    sent: FieldChange[], acknowledged: string[], expectedGeneration?: string): Promise<void>
  fieldSyncStatus(scope: string): Promise<{ generation: string | null; pending: number; conflicts: Array<{ key: string; versions: FieldChange[] }>; lastSuccess: string | null; paused: boolean; restoreId?: string }>
  fieldSyncPendingDetails(scope: string, offset?: number): Promise<import('./pendingSyncDetails').PendingDetailsPage>
  chooseSyncField(scope: string, key: string, value: FieldValue): Promise<void>
  exportLocalData(): Promise<LocalDataExport>
  replaceLocalData(snapshot: SyncSnapshot): Promise<void>
  /** 持久化失败后保持禁写，直至重新打开数据库；此标志可同步读取。 */
  getLocalWriteRevision(): number
  isRecoveryRequired(): boolean
  close(): void
}

export type SqlRow = Record<string, SqlValue>
