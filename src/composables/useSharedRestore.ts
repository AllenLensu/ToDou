import { t } from '../i18n'
import { sha256Hex } from '../domain/contentDigest'
import { computed, reactive, readonly, shallowRef, toRef, watch, type MaybeRefOrGetter } from 'vue'
import { localDataSummary } from '../application/localDataTransfer'
import type { LocalDataExport, TaskStore } from '../storage/types'
import { openSyncRemote, readSyncScope } from '../sync/providers'
import { loadSharedRestore, prepareSharedRestore, publishSharedRestore, restoreHeads,
  type RestoreBinding, type RestoreCandidate } from '../sync/sharedRestore'

type Review = { scope: string; db: TaskStore; data: LocalDataExport; id: string; mode: 'receive' | 'publish' | 'resolve'; candidate?: RestoreCandidate; localDigest?: string }
type Apply = (data: LocalDataExport, binding: RestoreBinding, assertUnchanged: () => void) => Promise<boolean>

const snapshotDigest = (data: LocalDataExport) => sha256Hex(JSON.stringify(data.snapshot))

export function useSharedRestore(storeInput: MaybeRefOrGetter<TaskStore | null>, scopeInput: MaybeRefOrGetter<string | null>, apply: Apply) {
  const store = toRef(storeInput)
  const scope = toRef(scopeInput)
  const busy = shallowRef(false)
  const message = shallowRef('')
  const heads = shallowRef<string[]>([])
  const review = shallowRef<Review | null>(null)
  const summary = computed(() => review.value ? {
    mode: review.value.mode, id: review.value.id, at: review.value.data.exportedAt,
    titles: review.value.data.snapshot.tasks.slice(0, 5).map(task => task.title),
    ...localDataSummary(review.value.data),
  } : null)
  let revision = 0
  watch([scope, store], () => { revision++; heads.value = []; review.value = null; message.value = '' }, { flush: 'sync' })

  async function perform(action: (db: TaskStore, binding: string, current: () => boolean) => Promise<void>) {
    const db = store.value, binding = scope.value, version = revision
    if (!db || !binding || busy.value) return
    const current = () => revision === version && store.value === db && scope.value === binding
    busy.value = true
    message.value = ''
    try { await action(db, binding, current) }
    catch (error) { if (current()) message.value = error instanceof Error ? error.message : t('共享恢复未完成，请重试。') }
    finally { busy.value = false }
  }

  const inspect = () => perform(async (_db, binding, current) => {
    review.value = null
    const latest = restoreHeads(await (await openSyncRemote(binding)).list())
    if (!current()) return
    heads.value = latest
    message.value = latest.length > 1 ? t('有多个同时发布的版本。请选择要保留的快照，核对后发布为新的共同版本。')
      : latest.length ? t('已找到共享恢复版本。') : t('当前目录还没有共享恢复版本。')
  })

  const propose = () => perform(async (db, binding, current) => {
    review.value = null
    if (!(await db.fieldSyncStatus(binding)).paused) throw new Error(t('请先在本机确认恢复所选备份。'))
    const files = await openSyncRemote(binding)
    const data = await db.exportLocalData()
    const candidate = await prepareSharedRestore(files, data)
    if (current()) review.value = { db, scope: binding, id: candidate.id, mode: 'publish', data, candidate }
  })

  const preview = (id: string) => perform(async (db, binding, current) => {
    review.value = null
    const files = await openSyncRemote(binding)
    const latest = restoreHeads(await files.list())
    if (!latest.includes(id)) throw new Error(t('网盘恢复版本已改变，请重新查看。'))
    const data = await loadSharedRestore(files, id)
    const candidate = latest.length > 1 ? await prepareSharedRestore(files, data) : undefined
    const localDigest = candidate ? undefined : await snapshotDigest(await db.exportLocalData())
    if (candidate && JSON.stringify(candidate.previous) !== JSON.stringify(latest)) throw new Error(t('网盘恢复版本已改变，请重新查看。'))
    if (current()) review.value = { db, scope: binding, mode: candidate ? 'resolve' : 'receive', id, data, candidate, localDigest }
  })

  const confirm = () => perform(async (db, binding, current) => {
    const item = review.value
    if (!item || item.db !== db || item.scope !== binding) return
    const files = await openSyncRemote(binding)
    const revisionAtCheck = db.getLocalWriteRevision()
    let localChanged = false
    const stale = () => {
      localChanged = true
      review.value = null
      throw new Error(t('本机清单在预览后已修改，请重新预览。'))
    }
    const assertUnchanged = () => {
      if (db.getLocalWriteRevision() !== revisionAtCheck) stale()
    }
    if (item.mode !== 'resolve') {
      const expected = item.localDigest ?? await snapshotDigest(item.data)
      if (await snapshotDigest(await db.exportLocalData()) !== expected) stale()
      assertUnchanged()
    }
    if (item.candidate) {
      if (item.mode === 'publish' && !(await db.fieldSyncStatus(binding)).paused) throw new Error(t('本机同步状态已改变，请重新预览。'))
      if (!current()) return
      const committed = await publishSharedRestore(files, item.candidate, () => {
        if (!current()) throw new Error(t('网盘目录已改变，请重新预览。'))
        if (item.mode === 'publish') assertUnchanged()
      })
      if (!current()) return
      heads.value = committed
      review.value = null
      message.value = committed.length === 1 ? t('已发布。每台设备须预览并确认替换，随后可启用新版本的日常同步。') : t('有并发发布的版本，请预览并选择。')
    } else {
      if ((await db.fieldSyncStatus(binding)).restoreId === item.id) throw new Error(t('本机已接受此版本，可直接启用同步。'))
      const latest = restoreHeads(await files.list())
      if (latest.length !== 1 || latest[0] !== item.id) throw new Error(t('网盘版本已改变，请重新查看。'))
      if (await readSyncScope() !== binding || !current()) return
      assertUnchanged()
      if (!await apply(item.data, { scope: binding, id: item.id }, assertUnchanged)) {
        if (scope.value === binding) message.value = localChanged ? t('本机清单在预览后已修改，请重新预览。') : t('本机恢复未完成，请查看数据与备份中的恢复提示。')
        return
      }
      message.value = t('本机已接受该版本，原数据已保留。启用同步后将交换此版本的后续修改。')
    }
  })
  const cancel = () => { if (!busy.value) review.value = null }
  return reactive({
    busy: readonly(busy),
    message: readonly(message),
    heads: computed(() => heads.value),
    summary,
    inspect,
    propose,
    preview,
    confirm,
    cancel,
  })
}

export type SharedRestoreControls = ReturnType<typeof useSharedRestore>
