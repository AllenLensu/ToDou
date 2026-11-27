import { computed, readonly, shallowRef, toRef, toValue, type MaybeRef, type MaybeRefOrGetter } from 'vue'
import { buildSearchIndex, searchTaskIds, searchTokens, type SearchSource } from '../domain/taskSearch'
import type { TaskListFilter } from '../domain/taskFilters'

type Options = {
  [K in keyof SearchSource]: MaybeRefOrGetter<SearchSource[K]>
} & {
  listFilter: MaybeRef<TaskListFilter>
}

/** 搜索只属于当前工作区会话，不提交、重置或离开编辑器；清空搜索时恢复进入前的列表范围。 */
export function useTaskSearch(options: Options) {
  const filter = toRef(options.listFilter)
  const query = shallowRef('')
  const tokens = computed(() => searchTokens(query.value))
  const active = computed(() => tokens.value.length > 0)
  const index = computed(() => buildSearchIndex({
    tasks: toValue(options.tasks),
    checklistItems: toValue(options.checklistItems),
    categories: toValue(options.categories),
    tags: toValue(options.tags),
  }))
  const ids = computed(() => searchTaskIds(index.value, tokens.value))
  let previousFilter: TaskListFilter = filter.value

  function setQuery(value: string, keepScope = false) {
    // 以有效词而非原始字符串判定进入/退出；只在首次进入时记住原范围，后续改词或切范围不重记。
    // 所有查询更新应经此入口，退出时连同仅含空白的输入一起恢复原筛选。
    const nextActive = searchTokens(value).length > 0
    if (!active.value && nextActive) {
      previousFilter = filter.value
      if (!keepScope) filter.value = 'all'
    } else if (active.value && !nextActive) {
      filter.value = previousFilter
    }
    query.value = value
  }

  function applyScopeQuery(scope: TaskListFilter, value: string) {
    previousFilter = scope
    filter.value = scope
    query.value = value
  }

  return { query: readonly(query), tokens, active, index, ids, setQuery, applyScopeQuery }
}
