import { t } from '../i18n'
import { computed, readonly, shallowRef } from 'vue'
import { localDataSummary, parseLocalDataExport } from '../application/localDataTransfer'
import { listLocalRecoveryCopies, recoverLocalData, recoverLocalDatabaseCopy, type LocalRecoveryCopy, type LocalRecoveryResult } from '../storage/recovery'
import type { LocalDataExport } from '../storage/types'

export type RecoveryAction = () => Promise<LocalRecoveryResult>

interface LocalRecoveryOptions {
  /** 关闭当前库、执行恢复并重新打开；失败时抛出，原文件由存储层保留。 */
  replace: (action: RecoveryAction, assertUnchanged?: () => void) => Promise<void>
  /** 网盘版本恢复另外要求本机没有正在进行的编辑。 */
  canReplace: (fromShared: boolean) => boolean
  /** 导入前提交当前草稿；返回 false 时保留草稿并取消本次导入。 */
  commitDraft: () => Promise<boolean>
}

export interface PendingImportPreview {
  name: string
  summary: ReturnType<typeof localDataSummary>
}

/** 恢复来源二选一：导入文件预览与本地副本选择互斥，确认后才替换本机数据。 */
export function useLocalRecovery(options: LocalRecoveryOptions) {
  const copies = shallowRef<readonly LocalRecoveryCopy[]>([])
  const selectedCopy = shallowRef<string | null>(null)
  const busy = shallowRef(false)
  const error = shallowRef('')
  const pending = shallowRef<{ name: string; data: LocalDataExport; summary: ReturnType<typeof localDataSummary> } | null>(null)
  const pendingImport = computed<PendingImportPreview | null>(() => pending.value && { name: pending.value.name, summary: pending.value.summary })
  const importBusy = shallowRef(false)
  const importError = shallowRef('')
  let importRequest = 0

  async function loadCopies() {
    try { copies.value = await listLocalRecoveryCopies() }
    catch (cause) { error.value = cause instanceof Error ? cause.message : t('无法读取本地副本') }
  }

  function clearError() {
    error.value = ''
  }

  function selectCopy(name: string | null) {
    if (busy.value || importBusy.value) return
    selectedCopy.value = name
    pending.value = null
    importError.value = ''
    error.value = ''
  }

  async function restore(action: RecoveryAction, assertUnchanged?: () => void) {
    if (busy.value || !options.canReplace(Boolean(assertUnchanged))) return false
    busy.value = true
    error.value = ''
    try {
      await options.replace(action, assertUnchanged)
      selectedCopy.value = null
      return true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : t('恢复失败，当前文件仍已保留')
      await loadCopies()
      return false
    } finally {
      busy.value = false
    }
  }

  async function recoverCopy() {
    const name = selectedCopy.value
    if (name) await restore(() => recoverLocalDatabaseCopy(name))
  }

  async function previewImport(file: File) {
    if (importBusy.value) return
    const request = ++importRequest
    importBusy.value = true
    importError.value = ''
    pending.value = null
    selectedCopy.value = null
    try {
      const data = parseLocalDataExport(await file.text())
      if (request === importRequest) pending.value = { name: file.name, data, summary: localDataSummary(data) }
    } catch (cause) {
      if (request === importRequest) importError.value = cause instanceof Error ? cause.message : t('无法读取导入文件')
    } finally {
      if (request === importRequest) importBusy.value = false
    }
  }

  function cancelImport() {
    if (importBusy.value) return
    ++importRequest
    pending.value = null
    importError.value = ''
  }

  async function confirmImport() {
    const current = pending.value
    if (!current || importBusy.value) return
    if (!await options.commitDraft()) return
    importBusy.value = true
    importError.value = ''
    try {
      if (await restore(() => recoverLocalData(current.data))) pending.value = null
      else importError.value = error.value || t('导入未完成，请重试。')
    } finally {
      importBusy.value = false
    }
  }

  const controls = {
    copies: computed(() => copies.value),
    selectedCopy: readonly(selectedCopy),
    busy: readonly(busy),
    error: readonly(error),
    pendingImport,
    importBusy: readonly(importBusy),
    importError: readonly(importError),
    loadCopies,
    selectCopy,
    recoverCopy,
    previewImport,
    cancelImport,
    confirmImport,
  }

  return {
    controls,
    isBusy: computed(() => busy.value || importBusy.value),
    clearError,
    loadCopies,
    restore,
  }
}

export type LocalRecoveryControls = ReturnType<typeof useLocalRecovery>['controls']
