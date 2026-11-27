import {
  calendarAt, completionAt, encodeRecurrenceRule, futureField, occurrenceId, occurrenceIndex, readRecurrence, recurrenceOptions, recurrenceTemplate,
  shiftTime, storeRecurrence, upcomingSlots, withinSeriesLimit, type RecurrenceRule, type RecurrenceScope, type ScheduleSegment, type SeriesPlan
} from '../domain/recurrence'
import { rowsFor } from './database'
import { completionPurgeValue, taskPurgeKey } from '../sync/taskPurge'
import type { createStoreHelpers } from './helpers'
import { bindForTask, checklistFromRow, nowIso, taskFromRow } from './transform'
import type { ChecklistItem, Task, TaskInput } from './types'

type Helpers = ReturnType<typeof createStoreHelpers>
type ClearReminder = (kind: 'task' | 'checklist', id: string, before: string | null, after: string | null) => unknown
const basis = (segment: ScheduleSegment) => JSON.stringify(segment)
const isRetired = (task: Task) => Boolean(task.deletedAt && readRecurrence(task.recurrenceRule)?.retiredAt === task.deletedAt)
const segmentFor = (plan: SeriesPlan, index: number) => [...plan.segments].reverse().find(segment => segment.index <= index)!
const timesFor = (segment: ScheduleSegment, at: string, zone: string) => ({
  occurrenceAt: at, dueAt: shiftTime(segment.dueAt, segment.at, at, zone),
  remindAt: shiftTime(segment.remindAt, segment.at, at, zone),
})
const checkId = (task: string, source: string) => `occ-check:${encodeURIComponent(task)}:${encodeURIComponent(source)}`
function checklistOrigin(item: ChecklistItem) {
  if (!item.id.startsWith('occ-check:')) return item.id
  try {
    const origin = decodeURIComponent(item.id.slice(item.id.lastIndexOf(':') + 1))
    return checkId(item.taskId, origin) === item.id ? origin : item.id
  } catch { return item.id }
}

export function createRecurrenceStorage(h: Helpers, clearReminder: ClearReminder) {
  const { db } = h
  const members = async (series: string) => (await rowsFor(db,
    'SELECT * FROM tasks WHERE recurrence_series_id=$series', { '$series': series })).map(row => taskFromRow(row, []))
  const stepsFor = async (series: string) => (await rowsFor(db, `SELECT c.* FROM checklist_items c JOIN tasks t
    ON t.id=c.task_id WHERE t.recurrence_series_id=$series`, { '$series': series })).map(checklistFromRow)

  async function shiftSteps(task: Task, at: string, zone: string) {
    if (!task.occurrenceAt || at === task.occurrenceAt) return
    for (const item of await h.listChecklistRows(task.id)) {
      if (item.recurrenceMode !== 'follow_task' || !item.remindAt) continue
      const next = shiftTime(item.remindAt, task.occurrenceAt, at, zone)
      await db.exec({
        sql: 'UPDATE checklist_items SET remind_at=$next, updated_at=$updated WHERE id=$id',
        bind: { '$next': next, '$updated': nowIso(), '$id': item.id }
      })
      await clearReminder('checklist', item.id, item.remindAt, next)
    }
  }

  async function writeSchedule(task: Task, rule: string | null, times?: ReturnType<typeof timesFor>, zone?: string) {
    if (times && zone) await shiftSteps(task, times.occurrenceAt, zone)
    await db.exec({
      sql: `UPDATE tasks SET recurrence_rule=$rule, occurrence_at=$at, due_at=$due,
        remind_at=$remind, updated_at=$updated WHERE id=$id`,
      bind: {
        '$rule': rule, '$at': times ? times.occurrenceAt : task.occurrenceAt,
        '$due': times ? times.dueAt : task.dueAt, '$remind': times ? times.remindAt : task.remindAt,
        '$updated': nowIso(), '$id': task.id
      }
    })
    if (times) await clearReminder('task', task.id, task.remindAt, times.remindAt)
  }

  // Only forecasts retired by the scheduler can be reused. A user's deletion is final until explicitly restored.
  async function retire(task: Task, fallback: RecurrenceRule) {
    if (task.deletedAt || task.status !== 'todo') return task
    const local = readRecurrence(task.recurrenceRule)
    const retiredAt = nowIso()
    const rule = storeRecurrence(local ?? fallback, { basis: local?.basis, generatedFor: local?.generatedFor, retiredAt })
    await db.exec({ sql: 'UPDATE tasks SET deleted_at=$at, updated_at=$at, recurrence_rule=$rule WHERE id=$id',
      bind: { '$at': retiredAt, '$rule': rule, '$id': task.id } })
    await clearReminder('task', task.id, task.remindAt, null)
    for (const item of await h.listChecklistRows(task.id)) await clearReminder('checklist', item.id, item.remindAt, null)
    return { ...task, recurrenceRule: rule, updatedAt: retiredAt, deletedAt: retiredAt }
  }

  // Runs inside the same queued write transaction as the user's task and relations.
  async function prepare(current: Task | null, input: Partial<TaskInput>, scope: RecurrenceScope) {
    const original = readRecurrence(current?.recurrenceRule)
    const raw = input.recurrenceRule === undefined ? current?.recurrenceRule : input.recurrenceRule
    const rule = readRecurrence(raw)
    if (!rule && !original) return input
    const merged = { ...current, ...input }
    const due = merged.dueAt ?? null, remind = merged.remindAt ?? null
    const completedAt = merged.status === 'completed' ? original?.completedAt ?? nowIso() : undefined
    if (!original && rule) {
      const at = due ?? remind ?? merged.occurrenceAt ?? nowIso()
      const segment: ScheduleSegment = { ...recurrenceOptions(rule), index: 0, at, dueAt: due, remindAt: remind }
      const plan = { zone: Intl.DateTimeFormat().resolvedOptions().timeZone, segments: [segment], template: recurrenceTemplate(merged) }
      if (current && current.recurrenceSeriesId === current.id) {
        for (const task of await members(current.id)) {
          if ((occurrenceIndex(current.id, task.id) ?? 0) > 0) await retire(task, rule)
        }
      }
      return { ...input, occurrenceAt: at, recurrenceSeriesId: current?.id ?? null, recurrenceRule: storeRecurrence(rule, { plan, completedAt }) }
    }
    if (!current || !original) return input
    const series = current.recurrenceSeriesId ?? current.id
    const root = series === current.id ? current : await h.getById(series)
    const rootRule = readRecurrence(root.recurrenceRule)
    const plan = rootRule?.plan
    const index = occurrenceIndex(series, current.id)
    if (!rootRule || !plan || index === null) return input
    const changedRule = !rule || encodeRecurrenceRule(rule) !== encodeRecurrenceRule(original)
    const changedDates = due !== current.dueAt || remind !== current.remindAt
    const at = changedDates ? due ?? remind ?? current.occurrenceAt! : current.occurrenceAt!
    const details = { plan: index === 0 ? plan : undefined, basis: original.basis, completedAt, generatedFor: original.generatedFor }
    if (!changedRule && !(changedDates && scope === 'future')) {
      if (changedDates) await shiftSteps(current, at, plan.zone)
      return { ...input, occurrenceAt: at, recurrenceSeriesId: series, recurrenceRule: storeRecurrence(original, details) }
    }
    const later = (await members(series)).filter(task => (occurrenceIndex(series, task.id) ?? -1) > index)
    if (!rule) {
      plan.stop = index
      plan.segments = plan.segments.filter(segment => segment.index < index)
      for (const task of later) if (!task.deletedAt && task.status === 'todo' && readRecurrence(task.recurrenceRule)) await writeSchedule(task, raw ?? null)
      if (index > 0) await writeSchedule(root, storeRecurrence(rootRule, { plan, completedAt: rootRule.completedAt }))
      return { ...input, recurrenceSeriesId: series, recurrenceRule: raw ?? null }
    }
    const previous = segmentFor(plan, index)
    const nominalAt = previous.mode === 'calendar' ? calendarAt(previous, index, plan.zone) :
      original.generatedFor && completionAt(previous, original.generatedFor, plan.zone)
    const nominal = timesFor(previous, nominalAt || current.occurrenceAt!, plan.zone)
    const futureDue = scope === 'future' ? futureField(nominal.dueAt, current.dueAt, due, plan.zone) : nominal.dueAt
    const futureRemind = scope === 'future' ? futureField(nominal.remindAt, current.remindAt, remind, plan.zone) : nominal.remindAt
    const segment: ScheduleSegment = { ...recurrenceOptions(rule), index,
      at: futureDue ?? futureRemind ?? nominal.occurrenceAt, dueAt: futureDue, remindAt: futureRemind }
    plan.segments = [...plan.segments.filter(s => s.index < index), segment]
    delete plan.stop
    if (index > 0) await writeSchedule(root, storeRecurrence(rootRule, { plan, completedAt: rootRule.completedAt }))
    await shiftSteps(current, at, plan.zone)
    for (const task of later) {
      if (task.deletedAt || task.status !== 'todo') continue
      if (changedRule) {
        await retire(task, rule)
        continue
      }
      const slot = occurrenceIndex(series, task.id)!
      const nextAt = rule.mode === 'calendar' ? calendarAt(segment, slot, plan.zone) :
        shiftTime(task.occurrenceAt, current.occurrenceAt!, at, plan.zone)
      if (nextAt && !withinSeriesLimit(segment, slot, nextAt, plan.zone)) {
        await retire(task, rule)
        continue
      }
      if (nextAt) await writeSchedule(task, storeRecurrence(rule, { basis: basis(segment), completedAt: readRecurrence(task.recurrenceRule)?.completedAt }),
        timesFor(segment, nextAt, plan.zone), plan.zone)
    }
    return {
      ...input, recurrenceSeriesId: series, occurrenceAt: at,
      recurrenceRule: storeRecurrence(rule, { plan: index === 0 ? plan : undefined, basis: index ? basis(segment) : undefined, completedAt,
        generatedFor: original.generatedFor })
    }
  }

  async function insertTask(root: Task, segment: ScheduleSegment, index: number, at: string, plan: SeriesPlan, generatedFor?: string) {
    // Both offline writers seed identical field versions. Later user edits and tombstones win.
    const template = recurrenceTemplate(plan.template ?? root)
    // Field sync can coalesce same-name categories and tags after the template was saved.
    if (template.categoryId && template.categoryId !== root.categoryId &&
        !(await rowsFor(db, 'SELECT 1 FROM categories WHERE id=$id', { '$id': template.categoryId })).length) {
      template.categoryId = root.categoryId
    }
    if (template.tagIds.some(id => !root.tagIds.includes(id))) {
      const existing = new Set((await h.listTags()).map(tag => tag.id))
      template.tagIds = template.tagIds.filter(id => existing.has(id))
    }
    const task: Task = {
      ...root, ...template, ...timesFor(segment, at, plan.zone), id: occurrenceId(root.id, index),
      recurrenceRule: storeRecurrence(segment, { basis: basis(segment), generatedFor }), status: 'todo', deletedAt: null,
      createdAt: root.createdAt, updatedAt: root.createdAt
    }
    await db.exec({
      sql: `INSERT INTO tasks
      (id,title,notes,url,priority,status,due_at,remind_at,category_id,parent_task_id,recurrence_rule,
       recurrence_series_id,occurrence_at,completion_strategy,reminder_settings,created_at,updated_at)
      VALUES ($id,$title,$notes,$url,$priority,$status,$dueAt,$remindAt,$categoryId,$parentTaskId,
       $recurrenceRule,$recurrenceSeriesId,$occurrenceAt,$completionStrategy,$reminderSettings,$created,$created)`,
      bind: { '$id': task.id, ...bindForTask(task), '$created': task.createdAt }
    })
    await h.setTags(task.id, task.tagIds)
    // The creation event of a generated slot has one stable identity across devices.
    await db.exec({
      sql: `INSERT INTO task_history(id,task_id,operation,snapshot_json,created_at)
      VALUES ($id,$task,'created',$snapshot,$created)`,
      bind: { '$id': 'created:' + task.id, '$task': task.id, '$snapshot': JSON.stringify(task), '$created': task.createdAt }
    })
    return task
  }


  // This setting controls the lineage template and later forecasts, not their progress or reminder times.
  function updateChecklistMode(current: ChecklistItem, mode: ChecklistItem['recurrenceMode']) {
    const owner = h.getById(current.taskId)
    const series = owner.recurrenceSeriesId
    if (!series) return
    const boundary = occurrenceIndex(series, current.taskId)
    if (boundary === null) return
    const origin = checklistOrigin(current)
    const timestamp = nowIso()
    for (const row of rowsFor(db, `SELECT c.* FROM checklist_items c JOIN tasks t
      ON t.id=c.task_id WHERE t.recurrence_series_id=$series`, { '$series': series })) {
      const item = checklistFromRow(row)
      const index = occurrenceIndex(series, item.taskId)
      if (item.id !== origin && (checklistOrigin(item) !== origin || index === null || index <= boundary)) continue
      if (item.recurrenceMode === mode) continue
      db.exec({
        sql: 'UPDATE checklist_items SET recurrence_mode=$mode, updated_at=$updated WHERE id=$id',
        bind: { '$mode': mode, '$updated': timestamp, '$id': item.id }
      })
    }
  }

  async function copySteps(entries: Map<number, Task>, steps: ChecklistItem[], series: string, zone: string) {
    const present = new Set(steps.map(item => item.id))
    for (const source of steps) {
      if (source.recurrenceMode !== 'follow_task' || checklistOrigin(source) !== source.id) continue
      // A deleted origin remains a tombstone; live later copies can still follow its stable template.
      if (source.deletedAt && !steps.some(item => !item.deletedAt && item.recurrenceMode === 'follow_task'
        && item.id !== source.id && checklistOrigin(item) === source.id)) continue
      const origin = occurrenceIndex(series, source.taskId)
      const parent = origin !== null && entries.get(origin)
      if (!parent || !parent.occurrenceAt) continue
      for (const [index, task] of entries) {
        if (index <= origin! || task.deletedAt || !task.occurrenceAt || !readRecurrence(task.recurrenceRule)) continue
        const id = checkId(task.id, source.id)
        if (present.has(id)) continue
        await db.exec({
          sql: `INSERT OR IGNORE INTO checklist_items
          (id,task_id,title,notes,completed,remind_at,recurrence_rule,recurrence_mode,created_at,updated_at)
          VALUES ($id,$task,$title,$notes,0,$remind,$rule,'follow_task',$created,$created)`,
          bind: {
            '$id': id, '$task': task.id, '$title': source.title, '$notes': source.notes,
            '$remind': shiftTime(source.remindAt, parent.occurrenceAt, task.occurrenceAt, zone),
            '$rule': source.recurrenceRule, '$created': source.createdAt
          }
        })
        present.add(id)
      }
    }
  }

  async function generate(now: Date, completionsOnly = false) {
    let count = 0
    const roots = await rowsFor(db, `SELECT id FROM tasks WHERE id=recurrence_series_id
      AND (recurrence_rule LIKE '{"format":"todou-recurrence/1",%' OR recurrence_rule LIKE '{"format":"todou-recurrence/2",%')`)
    if (!roots.length) return count
    const purgedSlots = new Map((await rowsFor(db, "SELECT key,value FROM task_settings WHERE key GLOB 'purged_task:occ:*'"))
      .map(row => [String(row.key), String(row.value)]))
    for (const row of roots) {
      const root = await h.getById(String(row.id))
      const plan = readRecurrence(root.recurrenceRule)?.plan
      if (!plan || !plan.segments.length) continue
      const entries = new Map<number, Task>()
      for (const task of await members(root.id)) {
        const index = occurrenceIndex(root.id, task.id)
        if (index !== null) entries.set(index, task)
      }
      if (root.deletedAt && ![...entries.values()].some(task => !task.deletedAt)) continue
      const add = async (index: number, at: string, segment: ScheduleSegment, generatedFor?: string) => {
        if (index >= (plan.stop ?? Infinity) || !withinSeriesLimit(segment, index, at, plan.zone)) return
        const existing = entries.get(index)
        if (existing) {
          if (!isRetired(existing)) return
          const times = timesFor(segment, at, plan.zone)
          const rule = storeRecurrence(segment, { basis: basis(segment), generatedFor })
          await writeSchedule(existing, rule, times, plan.zone)
          await db.exec({ sql: 'UPDATE tasks SET deleted_at=NULL WHERE id=$id', bind: { '$id': existing.id } })
          entries.set(index, { ...existing, ...times, recurrenceRule: rule, deletedAt: null })
          count++
          return
        }
        // A stopped slot may have become the root of a new, independently enabled series.
        const id = occurrenceId(root.id, index)
        if (purgedSlots.has(taskPurgeKey(id)) || (await rowsFor(db, 'SELECT 1 FROM tasks WHERE id=$id', { '$id': id })).length) return
        entries.set(index, await insertTask(root, segment, index, at, plan, generatedFor))
        count++
      }
      // A peer may have forecast old slots beyond the horizon before receiving a rule edit.
      for (const [index, task] of entries) {
        if (index === 0 || index >= (plan.stop ?? Infinity) || task.deletedAt || task.status !== 'todo') continue
        const segment = segmentFor(plan, index)
        const local = readRecurrence(task.recurrenceRule)
        const forecast = segment.mode === 'calendar' && (segment.until || segment.count) ? calendarAt(segment, index, plan.zone) : null
        if (index !== segment.index && (!local || encodeRecurrenceRule(local) !== encodeRecurrenceRule(segment)
          || (forecast && !withinSeriesLimit(segment, index, forecast, plan.zone)))) {
          entries.set(index, await retire(task, segment))
        }
      }
      for (const [i, segment] of plan.segments.entries()) {
        if (completionsOnly || segment.mode !== 'calendar') continue
        const end = plan.segments[i + 1]?.index ?? plan.stop ?? Infinity
        for (const slot of upcomingSlots(segment, end, now, plan.zone)) await add(slot.index, slot.at, segment)
      }
      for (const [index, task] of entries) {
        if (index >= (plan.stop ?? Infinity) || task.deletedAt) continue
        const segment = segmentFor(plan, index)
        // A peer may have created slots beyond the local horizon before receiving a series edit.
        const local = readRecurrence(task.recurrenceRule)
        if (!completionsOnly && index > 0 && task.status === 'todo' && segment.mode === 'calendar' && local && local.basis !== basis(segment)) {
          const at = calendarAt(segment, index, plan.zone)
          if (at) {
            const times = timesFor(segment, at, plan.zone)
            const rule = storeRecurrence(segment, { basis: basis(segment), completedAt: local.completedAt })
            await writeSchedule(task, rule, times, plan.zone)
            entries.set(index, { ...task, ...times, recurrenceRule: rule })
          }
        }
        if (segment.mode !== 'completion' || (index !== segment.index && local?.basis !== basis(segment))) continue
        let next = index + 1
        // Historical completed and manually deleted slots of the previous rule keep their IDs and dates.
        while (segmentFor(plan, next) === segment) {
          const candidate = entries.get(next)
          if (candidate) {
            if (isRetired(candidate) || readRecurrence(candidate.recurrenceRule)?.basis === basis(segment)) break
          } else {
            const purged = purgedSlots.get(taskPurgeKey(occurrenceId(root.id, next)))
            if (!purged || (purged !== 'deleted' && purged === await completionPurgeValue(basis(segment)))) break
          }
          next++
        }
        if (next >= (plan.stop ?? Infinity) || segmentFor(plan, next) !== segment) continue
        const successor = entries.get(next)
        const generatedFor = successor && readRecurrence(successor.recurrenceRule)?.generatedFor
        const completion = local?.completedAt ?? task.updatedAt
        if (successor && !successor.deletedAt && successor.status === 'todo' && generatedFor &&
            (task.status !== 'completed' || generatedFor !== completion)) {
          const oldAt = completionAt(segment, generatedFor, plan.zone)
          const old = oldAt && timesFor(segment, oldAt, plan.zone)
          if (old && old.dueAt === successor.dueAt && old.remindAt === successor.remindAt && old.occurrenceAt === successor.occurrenceAt) {
            entries.set(next, await retire(successor, segment))
          }
        }
        if (task.status !== 'completed') continue
        const at = completionAt(segment, completion, plan.zone)
        if (at) await add(next, at, segment, completion)
      }
      await copySteps(entries, await stepsFor(root.id), root.id, plan.zone)
    }
    return count
  }
  return { prepare, generate, updateChecklistMode }
}
