import { onScopeDispose, reactive, shallowRef, watch, type Ref } from 'vue'
import type { TaskStore } from '../storage/types'
import type { PendingDetailsPage } from '../storage/pendingSyncDetails'

type SyncStatus = Awaited<ReturnType<TaskStore['fieldSyncStatus']>>

export function usePendingSyncDetails(
  store: Readonly<Ref<TaskStore | null>>, scope: Readonly<Ref<string | null>>,
  status: Readonly<Ref<SyncStatus | null>>, refreshStatus: () => Promise<boolean>,
) {
  const expanded = shallowRef(false)
  const page = shallowRef<PendingDetailsPage | null>(null)
  const failed = shallowRef(false)
  const loading = shallowRef(false)
  let request = 0

  async function read(offset: number) {
    const token = ++request
    const db = store.value, binding = scope.value, expected = status.value
    if (!db || !binding || !expected || !expanded.value) return
    const previous = page.value
    loading.value = true
    failed.value = false
    try {
      const result = await db.fieldSyncPendingDetails(binding, offset)
      if (token !== request) return
      if (expected.restoreId !== result.restoreId || expected.generation !== result.generation
        || (!offset && expected.pending !== result.pending)) {
        await refreshStatus()
        return
      }
      if (offset && previous && previous.revision !== result.revision) {
        await read(0)
        return
      }
      page.value = offset && previous ? { ...result, entries: [...previous.entries, ...result.entries] } : result
    } catch {
      if (token === request) failed.value = true
    } finally {
      if (token === request) loading.value = false
    }
  }

  function reset() {
    request++
    loading.value = false
    failed.value = false
    page.value = null
    if (expanded.value && store.value && scope.value && status.value) void read(0)
  }

  watch([store, scope, status, expanded], reset, { flush: 'sync' })
  onScopeDispose(() => { request++ })
  return reactive({
    expanded, page, failed, loading,
    setExpanded(value: boolean) { expanded.value = value },
    loadMore() { if (!loading.value && page.value?.nextOffset != null) void read(page.value.nextOffset) },
    retry() { if (!loading.value) void read(page.value?.nextOffset ?? 0) },
  })
}
