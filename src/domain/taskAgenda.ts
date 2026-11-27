import type { ReminderRuntimeStateMap, Task } from '../storage/types'
import { isOverdue, scheduledTime, snoozedTime, startOfLocalDay } from './taskFilters'
import type { TaskListEntry } from './taskHierarchy'
import type { ChecklistRow } from './taskUi'

type AgendaRow = { key: string; time: number; overdue: boolean } & ({ task: Task } | { check: ChecklistRow })

/** Merge the filtered task and checklist rows before the view formats day headings. */
export function buildAgenda(entries: readonly TaskListEntry[], checks: readonly ChecklistRow[], filter: 'today' | 'upcoming', now: Date, runtime: ReminderRuntimeStateMap): AgendaRow[] {
  const rows: AgendaRow[] = []
  for (const { task } of entries) {
    const time = scheduledTime(task, filter, now, runtime)
    if (time !== null) rows.push({ key: 'task:' + task.id, task, time, overdue: filter === 'today' && isOverdue(task, now) })
  }
  for (const check of checks) {
    if (!check.remindAt) continue
    const time = snoozedTime(runtime, 'checklist', check.id) ?? Date.parse(check.remindAt)
    if (Number.isFinite(time)) rows.push({ key: 'checklist:' + check.id, check, time, overdue: false })
  }
  return rows.sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.time - b.time || a.key.localeCompare(b.key))
}

export type GroupedAgendaRow = AgendaRow & { group: string }

export function formatAgendaText(rows: readonly GroupedAgendaRow[], locale: string, labels: { task: string; checklist: string }) {
  const clock = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })
  const dateAndTime = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' })
  const lines: string[] = []
  let previousGroup: string | undefined
  for (const row of rows) {
    if (row.group !== previousGroup) {
      if (lines.length) lines.push('')
      lines.push(row.group)
      previousGroup = row.group
    }
    const time = (row.overdue ? dateAndTime : clock).format(row.time)
    const label = 'task' in row ? labels.task : labels.checklist
    const title = ('task' in row ? row.task.title : row.check.title).replace(/[\r\n\u2028\u2029]+/g, ' ')
    lines.push(`- [ ] ${time} ${label} ${title}`)
  }
  return lines.join('\n')
}

export type AgendaDay = { date: Date; count: number; firstKey: string | null; firstIndex: number }

export function countAgendaDays(rows: readonly AgendaRow[], now: Date): AgendaDay[] {
  const days = Array.from({ length: 7 }, (_, index): AgendaDay => ({
    date: startOfLocalDay(now, index + 1), count: 0, firstKey: null, firstIndex: -1,
  }))
  const byDate = new Map(days.map(day => [day.date.getTime(), day]))
  rows.forEach((row, index) => {
    const day = byDate.get(startOfLocalDay(new Date(row.time)).getTime())
    if (!day) return
    if (!day.count) {
      day.firstKey = row.key
      day.firstIndex = index
    }
    day.count++
  })
  return days
}
