import { computed, ref, shallowRef, type Ref } from 'vue'
import { readFilterPresets, writeFilterPresets, type TaskFilterPreset } from '../application/taskFilterPresets'
import { emptyConditions, matchesConditions, type TaskListFilter } from '../domain/taskFilters'
import type { Category, Tag, Task } from '../storage/types'
import { newId } from '../storage/transform'

type Options = {
  tasks: Ref<Task[]>
  categories: Ref<Category[]>
  tags: Ref<Tag[]>
  scope: Ref<TaskListFilter>
  query: Readonly<Ref<string>>
  applyScopeQuery: (scope: TaskListFilter, query: string) => void
}

export function useTaskFilterPresets(options: Options) {
  const conditions = ref(emptyConditions())
  const presets = shallowRef<TaskFilterPreset[]>([])
  const panelOpen = shallowRef(false)
  const selectedId = shallowRef('')
  const error = shallowRef<'load' | 'save' | null>(null)
  const selected = computed(() => presets.value.find(item => item.id === selectedId.value))
  const missingCategory = computed(() => Boolean(conditions.value.categoryId)
    && !options.categories.value.some(category => category.id === conditions.value.categoryId))
  const missingTags = computed(() => {
    const known = new Set(options.tags.value.map(tag => tag.id))
    return conditions.value.tagIds.filter(id => !known.has(id))
  })
  const invalid = computed(() => missingCategory.value || missingTags.value.length > 0)
  const hasConditions = computed(() => {
    const { status, priority, categoryId, tagIds } = conditions.value
    return Boolean(status || priority || categoryId || tagIds.length)
  })
  const active = computed(() => Boolean(selected.value) || hasConditions.value)
  const ownerIds = computed(() => {
    if (!hasConditions.value) return null
    if (invalid.value) return new Set<string>()
    return new Set(options.tasks.value.filter(task => matchesConditions(task, conditions.value)).map(task => task.id))
  })

  function reload() {
    try {
      presets.value = readFilterPresets(globalThis.localStorage)
      error.value = null
    } catch { error.value = 'load' }
  }
  if (typeof window !== 'undefined') reload()

  function persist(change: (saved: TaskFilterPreset[]) => TaskFilterPreset[]) {
    try {
      const storage = globalThis.localStorage
      const next = change(readFilterPresets(storage))
      writeFilterPresets(storage, next)
      presets.value = next
      error.value = null
      return true
    } catch {
      error.value = 'save'
      return false
    }
  }

  function apply(preset: TaskFilterPreset) {
    selectedId.value = preset.id
    conditions.value = { ...preset.conditions, tagIds: [...preset.conditions.tagIds] }
    options.applyScopeQuery(preset.scope, preset.query)
  }

  function clear() {
    selectedId.value = ''
    conditions.value = emptyConditions()
    options.applyScopeQuery('all', '')
  }

  function snapshot() {
    return {
      scope: options.scope.value,
      query: options.query.value,
      conditions: { ...conditions.value, tagIds: [...conditions.value.tagIds] },
    }
  }

  function create(name: string) {
    if (!name.trim()) return
    const item = { id: newId(), name: name.trim(), ...snapshot() }
    if (persist(saved => [...saved, item])) selectedId.value = item.id
  }

  function updateSelected(changes: Partial<Omit<TaskFilterPreset, 'id'>>) {
    const id = selectedId.value
    if (id) persist(saved => saved.map(item => item.id === id ? { ...item, ...changes } : item))
  }

  function rename(name: string) {
    if (name.trim()) updateSelected({ name: name.trim() })
  }

  function remove() {
    if (persist(saved => saved.filter(item => item.id !== selectedId.value))) selectedId.value = ''
  }

  return {
    conditions, presets, selected, active, invalid, missingCategory, missingTags, ownerIds, error, panelOpen,
    apply, clear, create, rename, remove, overwrite: () => updateSelected(snapshot()), reload,
  }
}

export type TaskFilterPresets = ReturnType<typeof useTaskFilterPresets>
