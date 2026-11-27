import { TASK_PRIORITIES, TASK_STATUSES } from '../storage/types'
import { taskListFilters, type TaskFilterConditions, type TaskListFilter } from '../domain/taskFilters'

export interface TaskFilterPreset {
  id: string
  name: string
  scope: TaskListFilter
  query: string
  conditions: TaskFilterConditions
}

export const filterPreferenceKey = 'todou.ui.task-filters'

function isPreset(value: unknown): value is TaskFilterPreset {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<TaskFilterPreset>
  const conditions = item.conditions
  return typeof item.id === 'string' && Boolean(item.id) && typeof item.name === 'string' && Boolean(item.name.trim())
    && taskListFilters.some(filter => filter.value === item.scope) && typeof item.query === 'string'
    && Boolean(conditions && (conditions.status === '' || TASK_STATUSES.includes(conditions.status))
      && (conditions.priority === '' || TASK_PRIORITIES.includes(conditions.priority))
      && typeof conditions.categoryId === 'string' && Array.isArray(conditions.tagIds)
      && conditions.tagIds.every(id => typeof id === 'string' && id.length > 0))
}

export function readFilterPresets(storage: Storage): TaskFilterPreset[] {
  const raw = storage.getItem(filterPreferenceKey)
  if (raw === null) return []
  const data = JSON.parse(raw)
  if (data?.version !== 1 || !Array.isArray(data.presets) || !data.presets.every(isPreset)) {
    throw new Error('Invalid task filter preferences')
  }
  return data.presets
}

export function writeFilterPresets(storage: Storage, presets: TaskFilterPreset[]) {
  storage.setItem(filterPreferenceKey, JSON.stringify({ version: 1, presets }))
}
