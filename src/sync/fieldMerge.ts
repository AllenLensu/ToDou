import { t } from '../i18n'
import { isPersistedDate as isDate } from '../domain/persistedDate'
import { isSharedValueSetting, validSharedSettingValue } from './sharedSettingValue'
// 纯字段合并与业务快照投影，不执行网络或持久化；每个字段独立比较修改时间。
import { validateLocalSnapshot } from '../application/localDataTransfer'
import { isTagVisibility, tagVisibilityKey, tagVisibilityPrefix } from './tagVisibility'
import { sameReminderTime } from '../application/reminderReschedule'
import { applyTaskPurges } from './taskPurge'
import { normalizeReminderRuntimeState } from '../storage/transform'
import {
  CHECKLIST_RECURRENCE_MODES, PARENT_COMPLETION_STRATEGIES, REMINDER_MODES, REMINDER_STRENGTHS,
  TASK_PRIORITIES, TASK_STATUSES, type ReminderRuntimeStateMap, type SyncSnapshot, type TaskHistoryEntry,
} from '../storage/types'

export type FieldValue = string | number | boolean | null | object
export interface FieldChange {
  collection: keyof SyncSnapshot
  id: string
  field: string
  value: FieldValue
  at: string
}
type Address = Pick<FieldChange, 'collection' | 'id' | 'field'>
/** 每个键只对应一个字段；首项是本机展示首选，不代表冲突已解决，同刻不同值全部保留。 */
export type FieldState = Map<string, FieldChange[]>
export const fieldKey = ({ collection, id, field }: Address) => JSON.stringify([collection, id, field])

type Row = Record<string, unknown>
type Validator = (value: unknown) => boolean
const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (v: unknown): v is string => typeof v === 'string'
const isId = (v: unknown): v is string => isText(v) && v.trim().length > 0
const nullable = (test: Validator): Validator => v => v === null || test(v)
const oneOf = (options: readonly string[]): Validator => v => isText(v) && options.includes(v)
const isBool = (v: unknown) => typeof v === 'boolean'
const isClock = (v: unknown) => isText(v) && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
const isStrategy = oneOf(PARENT_COMPLETION_STRATEGIES)
const reminderFields: Record<string, Validator> = {
  mode: oneOf(REMINDER_MODES), followUpMinutes: v => typeof v === 'number' && Number.isInteger(v) && v >= 5 && v <= 1440,
  strength: oneOf(REMINDER_STRENGTHS), quietHoursEnabled: isBool, quietStart: isClock, quietEnd: isClock,
  notifyAfterQuietHours: isBool,
}

function matchesFields(value: unknown, fields: Record<string, Validator>) {
  return isRow(value) && Object.keys(value).length === Object.keys(fields).length &&
    Object.entries(fields).every(([key, test]) => Object.hasOwn(value,key) && test(value[key]))
}

const taskFields: Record<string, Validator> = {
  title: isId, notes: nullable(isText), url: nullable(isText), priority: oneOf(TASK_PRIORITIES), status: oneOf(TASK_STATUSES),
  dueAt: nullable(isDate), remindAt: nullable(isDate), categoryId: nullable(isId), parentTaskId: nullable(isId),
  recurrenceRule: nullable(isText), recurrenceSeriesId: nullable(isId), occurrenceAt: nullable(isDate),
  completionStrategy: nullable(isStrategy), reminderSettings: nullable(v => matchesFields(v, { ...reminderFields, followUpMinutes: nullable(reminderFields.followUpMinutes!) })),
  createdAt: isDate, deletedAt: nullable(isDate),
}
const rowFields = {
  tasks: taskFields,
  checklistItems: {
    taskId: isId, title: isId, notes: nullable(isText), completed: isBool, remindAt: nullable(isDate),
    recurrenceRule: nullable(isText), recurrenceMode: oneOf(CHECKLIST_RECURRENCE_MODES),
    createdAt: isDate, deletedAt: nullable(isDate),
  },
  relations: { kind: oneOf(['related']), createdAt: isDate, deletedAt: nullable(isDate) },
  categories: { name: isId, completionStrategy: nullable(isStrategy), followUpMinutes: nullable(reminderFields.followUpMinutes!), createdAt: isDate },
  tags: { name: isId, createdAt: isDate },
} satisfies Record<string, Record<string, Validator>>
type MutableCollection = keyof typeof rowFields
const mutableCollections = Object.keys(rowFields) as MutableCollection[]
const knownFields = Object.fromEntries(mutableCollections.map(key => [key, Object.keys(rowFields[key])])) as Record<MutableCollection, string[]>
const historyFields: Record<string, Validator> = {
  id: isId, taskId: isId, operation: oneOf(['created','updated','deleted','restored','history_restored']), createdAt: isDate,
  snapshot: nullable(v => matchesFields(v, {
    ...taskFields, id: isId, updatedAt: isDate, tagIds: x => Array.isArray(x) && x.every(isId) && new Set(x).size === x.length,
  })),
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const instant = (date: string) => new Date(date).toISOString()
const later = (a: string, b: string) => Date.parse(a) >= Date.parse(b) ? a : b
const relationId = (taskId: string, relatedTaskId: string) => JSON.stringify([taskId,relatedTaskId].sort(compare))
function relationPair(id: string): [string,string] {
  const parts: unknown = JSON.parse(id)
  if (!Array.isArray(parts) || parts.length !== 2 || !parts.every(isId) || parts[0] >= parts[1] ||
    relationId(parts[0],parts[1]) !== id) throw new Error(t('同步关联标识无效。'))
  return parts as [string,string]
}

// 对象键的插入顺序不算值差异，避免仅因序列化顺序不同产生冲突。
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a,b)) return true
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) &&
    a.length === b.length && a.every((value,i) => same(value,b[i]))
  return isRow(a) && isRow(b) && Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every(key => Object.hasOwn(b,key) && same(a[key],b[key]))
}

const runtimeId = 'reminder_runtime'
const isReminderKey = (key: string) => /^(?:task|checklist):[\s\S]+$/.test(key)

export function validateFieldChange(raw: unknown): FieldChange {
  if (!isRow(raw) || !isId(raw.id) || !isId(raw.field) || !isDate(raw.at) || !/(?:Z|[+-]\d\d:\d\d)$/i.test(raw.at)) {
    throw new Error(t('同步字段标识或修改时间无效。'))
  }
  const { collection, id, field, value } = raw
  let valid = false
  if (typeof collection === 'string' && Object.hasOwn(rowFields,collection)) {
    if (collection === 'relations') relationPair(id)
    const fields: Record<string,Validator> = rowFields[collection as MutableCollection]
    if (Object.hasOwn(fields,field)) valid = fields[field]!(value)
    else if (collection === 'tasks' && field.startsWith('tag:')) valid = isId(field.slice(4)) && isBool(value)
    else if ((collection === 'tags' || collection === 'categories') && field.startsWith('alias:')) {
      const target = field.slice(6)
      valid = isId(target) && target < id && value === true
    }
    if (collection === 'tasks' && field === 'parentTaskId' && value === id) valid = false
  } else if (collection === 'history') {
    valid = field === 'entry' && matchesFields(value,historyFields) && isRow(value) && value.id === id &&
      (!isRow(value.snapshot) || value.snapshot.id === value.taskId)
  } else if (collection === 'settings') {
    valid = (field === 'value' && validSharedSettingValue(id, value)) ||
      (id === runtimeId && field.startsWith('snooze:') && isReminderKey(field.slice(7)) &&
        (value === null || (Number.isSafeInteger(value) && Number(value) > 0)))
  }
  if (!valid) throw new Error(t('同步文件包含不支持的字段或字段值。'))
  return {
    collection: collection as keyof SyncSnapshot, id, field, at: instant(raw.at),
    value: typeof value === 'object' && value !== null ? structuredClone(value) : value as FieldValue,
  }
}

// 先在临时集合中验证整批字段，末项无效也不能让正式状态只应用半批。
export function mergeFieldChanges(state: FieldState, changes: Iterable<FieldChange>): void {
  const touched: FieldState = new Map()
  for (const raw of changes) {
    const change = validateFieldChange(raw)
    const key = fieldKey(change)
    const versions = touched.get(key) ?? state.get(key)
    const current = versions?.[0]
    // 各字段独立取较晚时间；同刻只去重相同值，追加不同值且不改本机首选。
    if (!current || change.at > current.at) touched.set(key,[change])
    else if (change.at === current.at && !versions!.some(v => same(v.value,change.value))) {
      touched.set(key,[...versions!,change])
    }
  }
  for (const [key, versions] of touched) state.set(key, versions)
}

export function resolveField(state: FieldState, key: string, chosen: FieldValue, at: string): FieldChange {
  const versions = state.get(key)
  const match = versions?.find(v => same(v.value,chosen))
  if (!match || versions!.length < 2 || !isDate(at)) throw new Error(t('请选择当前冲突中的一个版本。'))
  // 显式选择生成严格晚于冲突的新版本，才能传播“已解决”，而非仅重排首选。
  const resolved = { ...match, at: new Date(Math.max(Date.parse(at),Date.parse(match.at) + 1)).toISOString() }
  mergeFieldChanges(state,[resolved])
  return resolved
}

const rowId = (collection: MutableCollection, row: Row) => collection === 'relations'
  ? relationId(row.taskId as string,row.relatedTaskId as string) : row.id as string
const rawRows = (rows: object[]): Row[] => rows as Row[]
function portableHistory(entry: TaskHistoryEntry) {
  // Older history JSON can still carry fields removed from the domain. Send only fields used by ToDou.
  const previous = entry.snapshot
  const snapshot = previous && Object.fromEntries(
    [...knownFields.tasks,'id','updatedAt','tagIds'].map(key => [
      key, key === 'tagIds' ? [...previous.tagIds].sort(compare) : previous[key as keyof typeof previous] ?? null,
    ]),
  )
  return { id:entry.id, taskId:entry.taskId, operation:entry.operation, createdAt:entry.createdAt, snapshot }
}

function runtimeState(raw?: string): ReminderRuntimeStateMap {
  if (!raw) return {}
  try { return normalizeReminderRuntimeState(JSON.parse(raw)) } catch { return {} }
}

export function diffSyncSnapshots(before: SyncSnapshot, after: SyncSnapshot): FieldChange[] {
  const changes: FieldChange[] = []
  const add = (collection: keyof SyncSnapshot, id: string, field: string, value: FieldValue, at: string) =>
    changes.push({ collection, id, field, value, at: instant(at) })
  for (const collection of mutableCollections) {
    const oldRows = new Map(rawRows(before[collection]).map(row => [rowId(collection,row),row]))
    for (const row of rawRows(after[collection])) {
      const id = rowId(collection,row)
      const old = oldRows.get(id)
      const updated = row.updatedAt as string
      for (const field of knownFields[collection]) {
        const value = row[field] ?? null
        if (old && same(old[field] ?? null,value)) continue
        let at = updated
        if (field === 'createdAt') at = row.createdAt as string
        // An active task first seen on a device is evidence of creation, not evidence of a recent restore.
        if (field === 'deletedAt' && !old) at = (row.deletedAt ?? row.createdAt) as string
        add(collection,id,field,value as FieldValue,at)
        // Also retire a previous cycle if this device never received its snooze.
        if (field === 'remindAt' && old && !sameReminderTime(old.remindAt as string | null,value as string | null)) {
          const kind = collection === 'tasks' ? 'task' : 'checklist'
          add('settings',runtimeId,'snooze:' + kind + ':' + id,null,updated)
        }
      }
      if (collection === 'tasks') {
        const previous = new Set(old?.tagIds as string[] ?? [])
        const current = new Set(row.tagIds as string[])
        for (const tag of previous) if (!current.has(tag)) add(collection,id,'tag:' + tag,false,updated)
        for (const tag of current) if (!previous.has(tag)) add(collection,id,'tag:' + tag,true,old ? updated : row.createdAt as string)
      }
    }
  }
  const oldHistory = new Map(before.history.map(entry => [entry.id,entry]))
  for (const entry of after.history) {
    if (!same(oldHistory.get(entry.id),entry)) add('history',entry.id,'entry',portableHistory(entry),entry.createdAt)
  }
  const oldSettings = new Map(before.settings.map(row => [row.key,row]))
  for (const row of after.settings) {
    const old = oldSettings.get(row.key)
    if (old?.value === row.value) continue
    if (isSharedValueSetting(row.key)) add('settings',row.key,'value',row.value,row.updatedAt)
    if (row.key !== runtimeId) continue
    const previous = runtimeState(old?.value)
    const current = runtimeState(row.value)
    for (const key of new Set([...Object.keys(previous),...Object.keys(current)])) {
      const value = current[key]?.snoozedUntil ?? null
      if (isReminderKey(key) && (previous[key]?.snoozedUntil ?? null) !== value) {
        add('settings',row.key,'snooze:' + key,value,row.updatedAt)
      }
    }
  }
  return changes
}

type Taxonomy = 'tags' | 'categories'

/** A discovered identity survives renames. Peers can learn overlapping pairs
 * in different orders, so unite them before comparing current visible names. */
function taxonomyAliases(collection: Taxonomy, rows: SyncSnapshot[Taxonomy], edges: FieldChange[],
  reportAlias?: (edge: FieldChange) => void) {
  const parents = new Map<string,string>()
  function root(id: string) {
    let next = id
    while (parents.has(next)) next = parents.get(next)!
    if (next !== id) parents.set(id, next)
    return next
  }
  const ids = new Set(rows.map(row => row.id))
  for (const edge of edges) {
    const target = edge.field.slice(6)
    if (!ids.has(edge.id) || !ids.has(target)) throw new Error(t('同步别名引用了不存在的分类或标签。'))
    const a = root(edge.id), b = root(target)
    if (a !== b) parents.set(a > b ? a : b, a > b ? b : a)
  }
  const canonical = new Map<string,{ id: string; createdAt: string }>()
  for (const row of [...rows].sort((a,b) => compare(a.id,b.id))) {
    if (root(row.id) !== row.id) continue
    const name = row.name.replace(/[A-Z]/g, char => char.toLowerCase()) // SQLite NOCASE
    const first = canonical.get(name)
    if (first) {
      parents.set(row.id, first.id)
      reportAlias?.({ collection, id:row.id, field:'alias:' + first.id, value:true,
        at:instant(later(first.createdAt, row.createdAt)) })
    } else canonical.set(name, row)
  }
  return new Map([...parents.keys()].map(id => [id, root(id)]))
}

type ParentCycleEdge = { id: string; parentTaskId: string }

/** Both devices may legally move different tasks under one another before meeting.
 * Pick the same edge on every peer; the caller stores its two selectable versions. */
function reconcileParentCycles(tasks: SyncSnapshot['tasks'], report: (edge: ParentCycleEdge) => void) {
  const byId = new Map(tasks.map(task => [task.id, task]))
  const visited = new Set<string>()
  for (const task of tasks) {
    if (visited.has(task.id)) continue
    const path = new Map<string,number>()
    let id: string | null = task.id
    while (id !== null && !visited.has(id)) {
      const start = path.get(id)
      if (start !== undefined) {
        const cycle = [...path.keys()].slice(start)
        const selected = byId.get(cycle.reduce((a,b) => a > b ? a : b))!
        report({ id:selected.id,parentTaskId:selected.parentTaskId! })
        selected.parentTaskId = null
        break
      }
      path.set(id,path.size)
      id = byId.get(id)?.parentTaskId ?? null
    }
    for (const key of path.keys()) visited.add(key)
  }
}

export function materializeFields(
  state: FieldState, local: SyncSnapshot, reportParentCycle?: (edge: ParentCycleEdge) => void,
  reportAlias?: (edge: FieldChange) => void,
  correctPurgedReference?: Parameters<typeof applyTaskPurges>[1],
): SyncSnapshot {
  const result = structuredClone(local)
  const maps = new Map<MutableCollection,Map<string,Row>>()
  for (const collection of mutableCollections) {
    maps.set(collection,new Map(rawRows(result[collection]).map(row => [rowId(collection,row),row])))
  }
  const history = new Map(result.history.map(row => [row.id,row]))
  const settings = new Map(result.settings.map(row => [row.key,row]))
  const runtime = runtimeState(settings.get(runtimeId)?.value)
  let runtimeAt = settings.get(runtimeId)?.updatedAt
  let runtimeChanged = false
  const snoozes: FieldChange[] = []
  const memberships = new Map<string,FieldChange[]>()
  const aliasEdges: Record<Taxonomy,FieldChange[]> = { tags:[], categories:[] }
  // 快照只投影各字段的首选；不裁剪 state 中供用户选择的其余同刻版本。
  for (const versions of state.values()) {
    const change = versions[0]!
    const { collection, id, field, value, at } = change
    if ((collection === 'tags' || collection === 'categories') && field.startsWith('alias:')) {
      aliasEdges[collection].push(change)
    } else if (collection === 'history') {
      history.set(id,structuredClone(value) as TaskHistoryEntry)
    } else if (collection === 'settings') {
      if (id === runtimeId) snoozes.push(change)
      else settings.set(id,{ key:id, value:value as string, updatedAt:at })
    } else {
      const rows = maps.get(collection)!
      let row = rows.get(id)
      if (!row) {
        if (collection === 'relations') {
          const [taskId,relatedTaskId] = relationPair(id)
          row = { taskId,relatedTaskId }
        } else row = collection === 'tasks' ? { id,tagIds:[] } : { id }
        rows.set(id,row)
      }
      if (collection === 'tasks' && field.startsWith('tag:')) {
        const fields = memberships.get(id)
        if (fields) fields.push(change)
        else memberships.set(id,[change])
      } else {
        if (field === 'remindAt' && row.remindAt !== undefined &&
          !sameReminderTime(row.remindAt as string | null,value as string | null)) {
          const key = (collection === 'tasks' ? 'task:' : 'checklist:') + id
          if (runtime[key]) {
            delete runtime[key]
            runtimeChanged = true
            runtimeAt = runtimeAt ? later(runtimeAt,at) : at
          }
        }
        row[field] = value !== null && typeof value === 'object' ? structuredClone(value) : value
      }
      row.updatedAt = row.updatedAt ? later(row.updatedAt as string,at) : at
    }
  }
  for (const collection of mutableCollections) {
    const rows = [...maps.get(collection)!].sort(([a],[b]) => compare(a,b)).map(([,row]) => row)
    Object.assign(result,{ [collection]:rows })
  }
  result.history = [...history.values()].sort((a,b) => compare(a.id,b.id))
  const tagAliases = taxonomyAliases('tags', result.tags, aliasEdges.tags, reportAlias)
  const categoryAliases = taxonomyAliases('categories', result.categories, aliasEdges.categories, reportAlias)
  if (tagAliases.size || categoryAliases.size) {
    result.tags = result.tags.filter(row => !tagAliases.has(row.id))
    result.categories = result.categories.filter(row => !categoryAliases.has(row.id))
    for (const task of [...result.tasks,...result.history.flatMap(entry => entry.snapshot ? [entry.snapshot] : [])]) {
      task.tagIds = [...new Set(task.tagIds.map(id => tagAliases.get(id) ?? id))].sort(compare)
      if (task.categoryId !== null) task.categoryId = categoryAliases.get(task.categoryId) ?? task.categoryId
    }
  }
  // 保留历史记录里的标签引用。已删除的定义不再接受旧客户端晚到的任务标签关联。
  const visibility = new Map<string, { value: string; updatedAt: string }>()
  for (const entry of [...settings.values()]) {
    if (!isTagVisibility(entry.key)) continue
    const id = entry.key.slice(tagVisibilityPrefix.length)
    const canonical = tagAliases.get(id) ?? id
    const previous = visibility.get(canonical)
    if (!previous || entry.updatedAt > previous.updatedAt || (entry.updatedAt === previous.updatedAt && entry.value === 'deleted')) {
      visibility.set(canonical, entry)
    }
  }
  const deletedTags = new Set<string>()
  for (const [id, entry] of visibility) {
    const key = tagVisibilityKey(id)
    settings.set(key, { key, value: entry.value, updatedAt: entry.updatedAt })
    if (entry.value === 'deleted') deletedTags.add(id)
  }
  for (const [id, fields] of memberships) {
    const row = maps.get('tasks')!.get(id)!
    const members = new Set(row.tagIds as string[])
    const latest = new Map<string,FieldChange>()
    for (const change of fields) {
      const rawTag = change.field.slice(4)
      const tag = tagAliases.get(rawTag) ?? rawTag
      const previous = latest.get(tag)
      // Two historical IDs can refer to the same tag. An older alias must not
      // re-add membership after the user explicitly removed the canonical tag.
      if (!previous || change.at > previous.at || (change.at === previous.at && change.value === false)) {
        latest.set(tag,change)
      }
    }
    for (const [tag,change] of latest) {
      const marker = visibility.get(tag)
      if (change.value && (!marker || (marker.value === 'active' && change.at >= marker.updatedAt))) members.add(tag)
      else members.delete(tag)
    }
    row.tagIds = [...members].sort(compare)
  }
  if (deletedTags.size) for (const task of result.tasks) task.tagIds = task.tagIds.filter(tag => !deletedTags.has(tag))
  for (const change of snoozes) {
    const key = change.field.slice(7)
    const current = runtime[key] ?? { lastNotifiedAt:null, snoozedUntil:null }
    current.snoozedUntil = change.value as number | null
    if (current.snoozedUntil || current.lastNotifiedAt || current.quietConsumed) runtime[key] = current
    else delete runtime[key]
    runtimeChanged = true
    runtimeAt = runtimeAt ? later(runtimeAt,change.at) : change.at
  }
  if (runtimeChanged && runtimeAt) settings.set(runtimeId,{ key:runtimeId,value:JSON.stringify(runtime),updatedAt:runtimeAt })
  result.settings = [...settings.values()].sort((a,b) => compare(a.key,b.key))
  applyTaskPurges(result, correctPurgedReference)
  if (reportParentCycle) reconcileParentCycles(result.tasks,reportParentCycle)
  return validateLocalSnapshot(result)
}
