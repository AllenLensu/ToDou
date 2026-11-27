import { t } from '../i18n'
import { fromLocalDateTime, toLocalDateTime } from './localDateTime'
import type { Category, Task, TaskReminderSettings, ChecklistItem } from '../storage/types'
import { DEFAULT_REMINDER_SETTINGS, newId, normalizeTaskReminderSettings } from '../storage/transform'

type RelativeTime = { day: number; time: string } | null
export type TaskTemplate = {
  id: string; title: string; notes: string | null; url: string | null
  reminderSettings?: TaskReminderSettings | null
  due: RelativeTime; reminder: RelativeTime
  steps: Array<{ title: string; notes: string | null; reminder: RelativeTime }>
}

const DAY_MS = 86_400_000
const FIRST_DAY = Date.parse('0000-01-01T00:00:00Z') / DAY_MS
const LAST_DAY = Date.parse('9999-12-31T00:00:00Z') / DAY_MS

export function decodeTemplate(raw: string, key: string): TaskTemplate {
  const value = JSON.parse(raw)
  const text = (v: unknown) => v === null || typeof v === 'string'
  const relative = (v: RelativeTime) => v === null || (v && Number.isSafeInteger(v.day) &&
    Math.abs(v.day) <= LAST_DAY - FIRST_DAY && typeof v.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.time))
  if (!value || typeof value.id !== 'string' || key !== 'task_template.' + value.id || !value.id ||
    typeof value.title !== 'string' || !value.title.trim() || !text(value.notes) || !text(value.url) ||
    !relative(value.due) || !relative(value.reminder) || !Array.isArray(value.steps) ||
    !value.steps.every((step: TaskTemplate['steps'][number]) => step && typeof step.title === 'string' && step.title.trim() && text(step.notes) && relative(step.reminder))) {
    throw new Error(t('无法读取任务模板，请检查备份文件。'))
  }
  if (value.reminderSettings != null) {
    const settings = value.reminderSettings
    if (typeof settings !== 'object' || Object.entries(normalizeTaskReminderSettings(settings)).some(([key, v]) => settings[key] !== v)) {
      throw new Error(t('模板中的提醒设置无效。'))
    }
  }
  return value
}

function civilDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(t('请选择有效的基准日期。'))
  const date = new Date(day + 'T00:00:00Z')
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== day) throw new Error(t('基准日期无效。'))
  return +date / 86_400_000
}

export function captureTemplate(task: Task, checks: ChecklistItem[], day: string,
  category?: Pick<Category, 'followUpMinutes'>, defaults = DEFAULT_REMINDER_SETTINGS): TaskTemplate {
  const anchor = civilDay(day)
  function relative(iso: string | null): RelativeTime {
    if (!iso) return null
    const [date, time] = toLocalDateTime(iso).split('T')
    return { day: civilDay(date!) - anchor, time: time! }
  }
  // New instances are uncategorized, so keep any interval that came from the source category.
  const reminderSettings = category?.followUpMinutes != null && task.reminderSettings?.followUpMinutes == null
    ? { ...(task.reminderSettings ?? defaults), followUpMinutes: category.followUpMinutes } : task.reminderSettings
  return { id: newId(), reminderSettings: reminderSettings ? { ...reminderSettings } : null, title: task.title, notes: task.notes, url: task.url,
    due: relative(task.dueAt), reminder: relative(task.remindAt),
    steps: checks.filter(c => !c.deletedAt && c.taskId === task.id).map(c => ({ title: c.title, notes: c.notes, reminder: relative(c.remindAt) })) }
}

export function instantiateTemplate(template: TaskTemplate, day: string) {
  const anchor = civilDay(day)
  function at(relative: RelativeTime) {
    if (!relative) return null
    const target = anchor + relative.day
    if (!Number.isSafeInteger(target) || target < FIRST_DAY || target > LAST_DAY) throw new Error(t('模板中的相对日期无效。'))
    const date = new Date(target * DAY_MS).toISOString().slice(0, 10)
    try {
      return fromLocalDateTime(date + 'T' + relative.time)
    } catch {
      throw new Error(t('本地时间 {0} 无效，请选择其他基准日期。', date + ' ' + relative.time))
    }
  }
  return { task: { title: template.title, notes: template.notes, url: template.url,
    reminderSettings: template.reminderSettings ? { ...template.reminderSettings } : null, dueAt: at(template.due), remindAt: at(template.reminder) },
    steps: template.steps.map(s => ({ title: s.title, notes: s.notes, remindAt: at(s.reminder) })) }
}
