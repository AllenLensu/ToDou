import { t } from '../i18n'
// 展示选项、草稿类型与初始值；不在这里读写存储。
// 工作区负责本地日期与存储时间的转换；可选字段的空字符串由工作区及存储输入规范化转成 null。
import type {
  ChecklistItem,
  ChecklistRecurrenceMode,
  ParentCompletionStrategy,
  ReminderSettings,
  TaskReminderSettings,
  Task,
  TaskHistoryEntry,
  TaskStatus,
} from '../storage/types'
import { DEFAULT_REMINDER_SETTINGS } from '../storage/transform'
import type { RecurrenceScope } from './recurrence'

export const statuses: Array<{ value: TaskStatus; label: string }> = [
  { value: 'todo', get label() { return t('待办') } },
  { value: 'in_progress', get label() { return t('进行中') } },
  { value: 'waiting', get label() { return t('等待') } },
  { value: 'paused', get label() { return t('暂停') } },
  { value: 'completed', get label() { return t('已完成') } },
  { value: 'cancelled', get label() { return t('已取消') } },
]

export const priorities = [
  { value: 'none', get label() { return t('无优先级') } },
  { value: 'low', get label() { return t('低') } },
  { value: 'medium', get label() { return t('中') } },
  { value: 'high', get label() { return t('高') } },
] as const

export function statusLabel(status: TaskStatus): string {
  return statuses.find(item => item.value === status)?.label ?? status;
}

export function priorityLabel(priority: Task['priority']): string {
  return priorities.find(item => item.value === priority)?.label ?? priority;
}

export function historyLabel(operation: TaskHistoryEntry['operation']): string {
  return {
    created: t('创建'),
    updated: t('修改前快照'),
    deleted: t('移入回收站'),
    restored: t('从回收站恢复'),
    history_restored: t('恢复历史版本'),
  }[operation]
}

/** 导航栏顶层视图，仅为会话内界面状态，不持久化。 */
export type AppView = 'tasks' | 'trash' | 'settings'

export const appViews: Array<{ value: AppView; label: string }> = [
  { value: 'tasks', get label() { return t('TASKS') } },
  { value: 'trash', get label() { return t('TRASH') } },
  { value: 'settings', get label() { return t('SETTINGS') } },
]

export type Draft = {
  title: string
  notes: string
  url: string
  priority: Task['priority']
  status: TaskStatus
  dueAt: string
  remindAt: string
  parentTaskId: string
  recurrenceRule: string
  recurrenceSeriesId: string
  completionStrategy: ParentCompletionStrategy | ''
  categoryId: string
  tagIds: string[]
  reminderSettings: TaskReminderSettings
}

export type ChecklistRow = ChecklistItem & { taskTitle: string; parentStatus: TaskStatus }

export type ChecklistEdit = Partial<Pick<ChecklistItem, 'title' | 'notes' | 'remindAt' | 'recurrenceMode' | 'recurrenceRule'>>
export type SaveChecklistItem = (id: string, changes: ChecklistEdit, scope?: RecurrenceScope) => Promise<boolean>

/** 总览的虚拟行卸载时仍保留编辑状态；仅在成功保存或取消后移除。 */
export type ChecklistEditDraft = {
  editing: boolean
  saving: boolean
  title: string
  notes: string
  remindAt: string
  recurrenceMode: ChecklistRecurrenceMode
  recurrenceRule: string
  rescheduleScope: RecurrenceScope | ''
  titleError: string
  reminderError: string
  original: { title: string; notes: string; remindAt: string | null; recurrenceMode: ChecklistRecurrenceMode; recurrenceRule: string }
}

export type ChecklistDraft = {
  title: string
  notes: string
  remindAt: string
  recurrenceRule: string
  recurrenceMode: ChecklistRecurrenceMode
}

/** 每次返回独立草稿与提醒设置副本，避免新建时直接修改全局默认设置。 */
export function emptyDraft(reminderDefaults: ReminderSettings = DEFAULT_REMINDER_SETTINGS): Draft {
  return {
    title: '',
    notes: '',
    url: '',
    priority: 'none',
    status: 'todo',
    dueAt: '',
    remindAt: '',
    parentTaskId: '',
    recurrenceRule: '',
    recurrenceSeriesId: '',
    completionStrategy: '',
    categoryId: '',
    tagIds: [],
    reminderSettings: { ...reminderDefaults, followUpMinutes: null },
  }
}

export function emptyChecklistDraft(): ChecklistDraft {
  return { title: '', notes: '', remindAt: '', recurrenceRule: '', recurrenceMode: 'independent' }
}
