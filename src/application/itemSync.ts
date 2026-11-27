// 遗留的 P4 整行同步实验；当前设备共享清单使用 sync/fieldMerge.ts 的字段级合并。
import type { Task, TaskHistoryEntry, TaskRelation, SyncSnapshot } from '../storage/types'
export type { SyncSnapshot } from '../storage/types'

export type SyncEntityType =
  | 'task'
  | 'checklist_item'
  | 'task_relation'
  | 'category'
  | 'tag'
  | 'history'
  | 'setting'

export interface SyncMergeConflict {
  entityType: SyncEntityType
  id: string
  localUpdatedAt: string | null
  incomingUpdatedAt: string | null
  reason: 'equal_timestamp_different_content' | 'same_history_id_different_content'
}

export interface SyncMergeResult {
  snapshot: SyncSnapshot
  applied: number
  skipped: number
  conflicts: SyncMergeConflict[]
}

type UpdatedItem = { updatedAt: string }

const cloneBytes = (value: Uint8Array) => new Uint8Array(value)

const normalizeTask = (task: Task): Task => ({ ...task, tagIds: [...new Set(task.tagIds)].sort() })

const normalizeRelation = (relation: TaskRelation): TaskRelation => {
  const [taskId, relatedTaskId] = [relation.taskId, relation.relatedTaskId].sort()
  return { ...relation, taskId, relatedTaskId }
}

const relationId = (relation: TaskRelation) => {
  const normalized = normalizeRelation(relation)
  return `${normalized.taskId}\u0000${normalized.relatedTaskId}`
}

const cloneItem = <T>(item: T): T => {
  if (item instanceof Uint8Array) return cloneBytes(item) as T
  if (Array.isArray(item)) return item.map((entry) => cloneItem(entry)) as T
  if (item && typeof item === 'object') {
    const copy: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) copy[key] = cloneItem(value)
    return copy as T
  }
  return item
}

const equalValue = (left: unknown, right: unknown): boolean => {
  if (left instanceof Uint8Array || right instanceof Uint8Array) {
    if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false
    return left.every((byte, index) => byte === right[index])
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((value, index) => equalValue(value, right[index]))
  }
  if (left && typeof left === 'object' && right && typeof right === 'object') {
    const leftRecord = left as Record<string, unknown>
    const rightRecord = right as Record<string, unknown>
    const leftKeys = Object.keys(leftRecord).sort()
    const rightKeys = Object.keys(rightRecord).sort()
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index] && equalValue(leftRecord[key], rightRecord[key]))
  }
  return Object.is(left, right)
}

const sortedTasks = (items: Task[]) => items.map(normalizeTask)
const sortedRelations = (items: TaskRelation[]) => items.map(normalizeRelation)

interface MergeCollectionOptions<T extends UpdatedItem> {
  entityType: SyncEntityType
  key?: (item: T) => string
  normalize?: (item: T) => T
  clone?: (item: T) => T
}

const mergeCollection = <T extends UpdatedItem>(
  localItems: T[],
  incomingItems: T[],
  options: MergeCollectionOptions<T>,
  result: Omit<SyncMergeResult, 'snapshot'>,
): T[] => {
  const keyFor = options.key ?? ((item: T) => String((item as T & { id: string }).id))
  const normalize = options.normalize ?? ((item: T) => item)
  const clone = options.clone ?? cloneItem
  const merged = localItems.map((item) => clone(normalize(item)))
  const positions = new Map(merged.map((item, index) => [keyFor(item), index]))

  for (const rawIncoming of incomingItems) {
    const incoming = clone(normalize(rawIncoming))
    const key = keyFor(incoming)
    const index = positions.get(key)
    if (index === undefined) {
      positions.set(key, merged.length)
      merged.push(incoming)
      result.applied += 1
      continue
    }
    const current = merged[index]
    if (equalValue(current, incoming)) {
      result.skipped += 1
      continue
    }
    if (incoming.updatedAt > current.updatedAt) {
      merged[index] = incoming
      result.applied += 1
      continue
    }
    if (incoming.updatedAt < current.updatedAt) {
      result.skipped += 1
      continue
    }
    result.conflicts.push({
      entityType: options.entityType,
      id: key,
      localUpdatedAt: current.updatedAt,
      incomingUpdatedAt: incoming.updatedAt,
      reason: 'equal_timestamp_different_content',
    })
    result.skipped += 1
  }
  return merged
}

const mergeHistory = (
  localItems: TaskHistoryEntry[],
  incomingItems: TaskHistoryEntry[],
  result: Omit<SyncMergeResult, 'snapshot'>,
) => {
  const merged = localItems.map((item) => cloneItem(item))
  const positions = new Map(merged.map((item, index) => [item.id, index]))
  for (const rawIncoming of incomingItems) {
    const incoming = cloneItem(rawIncoming)
    const index = positions.get(incoming.id)
    if (index === undefined) {
      positions.set(incoming.id, merged.length)
      merged.push(incoming)
      result.applied += 1
      continue
    }
    if (equalValue(merged[index], incoming)) {
      result.skipped += 1
      continue
    }
    result.conflicts.push({
      entityType: 'history',
      id: incoming.id,
      localUpdatedAt: merged[index].createdAt,
      incomingUpdatedAt: incoming.createdAt,
      reason: 'same_history_id_different_content',
    })
    result.skipped += 1
  }
  return merged
}

const cloneSnapshot = (snapshot: SyncSnapshot): SyncSnapshot => ({
  tasks: sortedTasks(snapshot.tasks),
  checklistItems: snapshot.checklistItems.map((item) => cloneItem(item)),
  relations: sortedRelations(snapshot.relations),
  categories: snapshot.categories.map((item) => cloneItem(item)),
  tags: snapshot.tags.map((item) => cloneItem(item)),
  history: snapshot.history.map((item) => cloneItem(item)),
  settings: snapshot.settings.map((item) => cloneItem(item)),
})

/**
 * 按行合并设备快照，不整体替换数据库。
 * 可变行按 updatedAt 取较新版本，删除标记同样参与比较；
 * 同刻不同内容暂留本地行，并返回冲突信息供调用方处理。
 */
export const mergeSyncSnapshots = (local: SyncSnapshot, incoming: SyncSnapshot): SyncMergeResult => {
  const result: Omit<SyncMergeResult, 'snapshot'> = { applied: 0, skipped: 0, conflicts: [] }
  const localSnapshot = cloneSnapshot(local)
  const incomingSnapshot = cloneSnapshot(incoming)
  const snapshot: SyncSnapshot = {
    tasks: mergeCollection(localSnapshot.tasks, incomingSnapshot.tasks, { entityType: 'task', normalize: normalizeTask }, result),
    checklistItems: mergeCollection(localSnapshot.checklistItems, incomingSnapshot.checklistItems, { entityType: 'checklist_item' }, result),
    relations: mergeCollection(localSnapshot.relations, incomingSnapshot.relations, { entityType: 'task_relation', key: relationId, normalize: normalizeRelation }, result),
    categories: mergeCollection(localSnapshot.categories, incomingSnapshot.categories, { entityType: 'category' }, result),
    tags: mergeCollection(localSnapshot.tags, incomingSnapshot.tags, { entityType: 'tag' }, result),
    history: mergeHistory(localSnapshot.history, incomingSnapshot.history, result),
    settings: mergeCollection(localSnapshot.settings, incomingSnapshot.settings, { entityType: 'setting', key: (item) => item.key }, result),
  }
  return { snapshot, ...result }
}

