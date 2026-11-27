import { t } from '../i18n'
import type { ChecklistItem, ReminderRuntimeStateMap, Task } from '../storage/types'

/**
 * 任务列表范围：TODAY 包含当天到期／提醒和此前逾期的未结束任务，
 * UPCOMING 包含后续七天内到期／提醒的未结束任务，DONE 包含完成或取消。
 * 日期窗口以本地日历日的零点为界；调用方先排除回收站，本模块不检查 deletedAt。
 */
export type TaskListFilter = 'all' | 'today' | 'upcoming' | 'done'

export type TaskFilterConditions = {
  status: Task['status'] | ''
  priority: Task['priority'] | ''
  categoryId: string
  tagIds: string[]
}

export function emptyConditions(): TaskFilterConditions {
  return { status: '', priority: '', categoryId: '', tagIds: [] }
}

export function matchesConditions(task: Task, conditions: TaskFilterConditions) {
  return (!conditions.status || task.status === conditions.status)
    && (!conditions.priority || task.priority === conditions.priority)
    && (!conditions.categoryId || task.categoryId === conditions.categoryId)
    && conditions.tagIds.every(id => task.tagIds.includes(id))
}

export const taskListFilters: Array<{ value: TaskListFilter; label: string }> = [
  { value: 'all', get label() { return t('ALL') } },
  { value: 'today', get label() { return t('TODAY') } },
  { value: 'upcoming', get label() { return t('UPCOMING') } },
  { value: 'done', get label() { return t('DONE') } },
]


export function isClosed(task: Pick<Task, 'status'>) {
  return task.status === 'completed' || task.status === 'cancelled'
}

export function startOfLocalDay(now: Date, offset = 0) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
}

function timeOf(value: string | null) {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

/** 逾期只依据未结束任务的截止时间，不把已过去的提醒时间算作逾期。 */
export function isOverdue(task: Pick<Task, 'status' | 'dueAt'>, now = new Date()) {
  const due = timeOf(task.dueAt)
  return !isClosed(task) && due !== null && due < now.getTime()
}

export function snoozedTime(runtime: ReminderRuntimeStateMap, kind: 'task' | 'checklist', id: string) {
  const state = runtime[kind + ':' + id]
  const time = state?.snoozedUntil
  return time && Number.isFinite(time) && time > (state?.lastNotifiedAt ?? 0) ? time : null
}

export function scheduledTime(task: Task, filter: 'today' | 'upcoming', now: Date, runtime: ReminderRuntimeStateMap) {
  const from = startOfLocalDay(now, filter === 'today' ? 0 : 1).getTime()
  const to = startOfLocalDay(now, filter === 'today' ? 1 : 8).getTime()
  const due = timeOf(task.dueAt)
  const remind = task.remindAt ? snoozedTime(runtime, 'task', task.id) ?? timeOf(task.remindAt) : null
  const dueInView = due !== null && due < to && (filter === 'today' || due >= from)
  const remindInView = remind !== null && remind >= from && remind < to
  if (dueInView && remindInView) return Math.min(due, remind)
  return dueInView ? due : remindInView ? remind : null
}

export function taskCounts(tasks: Task[], now: Date, runtime: ReminderRuntimeStateMap) {
  const counts = { open: 0, overdue: 0, today: 0 }
  for (const task of tasks) {
    if (task.deletedAt || isClosed(task)) continue
    counts.open++
    if (isOverdue(task, now)) counts.overdue++
    if (scheduledTime(task, 'today', now, runtime) !== null) counts.today++
  }
  return counts
}

export function matchesFilter(task: Task, filter: TaskListFilter, now = new Date(), runtime: ReminderRuntimeStateMap = {}) {
  if (filter === 'all') return true
  if (filter === 'done') return isClosed(task)
  return !isClosed(task) && scheduledTime(task, filter, now, runtime) !== null
}

export function filterTasks(tasks: Task[], filter: TaskListFilter, now = new Date(), runtime: ReminderRuntimeStateMap = {}) {
  return tasks.filter(task => matchesFilter(task, filter, now, runtime))
}

/** 日常视图按检查项自己的提醒筛选；ALL 保持既有的完整检查项总览。 */
export function filterChecklistItems<T extends ChecklistItem>(items: T[], tasks: Task[], filter: TaskListFilter, now = new Date(), runtime: ReminderRuntimeStateMap = {}): T[] {
  if (filter === 'all') return items
  if (filter === 'done') return []
  const owners = new Map(tasks.map(task => [task.id, task]))
  const from = startOfLocalDay(now, filter === 'today' ? 0 : 1).getTime()
  const to = startOfLocalDay(now, filter === 'today' ? 1 : 8).getTime()
  return items.filter(item => {
    const owner = owners.get(item.taskId)
    const remind = item.remindAt ? snoozedTime(runtime, 'checklist', item.id) ?? timeOf(item.remindAt) : null
    return !item.deletedAt && !item.completed && owner && !owner.deletedAt
      && remind !== null && remind >= from && remind < to
  })
}
