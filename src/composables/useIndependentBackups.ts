import { newId } from '../storage/transform'
import { getLocale, t } from '../i18n'
import { syncFeedbackText } from '../sync/connectionFeedback'
import { computed, onBeforeUnmount, onMounted, readonly, shallowRef, toRef, watch, type MaybeRefOrGetter } from 'vue'
import { ensureWebDavFolder, normalizeFolder, webDavFiles, type WebDav } from '../sync/providers/webdav'
import { probeFiles } from '../sync/providers/files'
import { backupInfo, listBackups, localBackupFiles, makeBackup, readBackup, saveBackup,
  type BackupDestination, type BackupFile, type BackupKind, type BackupLocation } from '../storage/independentBackups'
import type { LocalDataExport } from '../storage/types'

const key = 'todou.independent-backup.'
const locations: BackupLocation[] = ['local', 'webdav']
const placeLabel = (place: BackupLocation) => place === 'local' ? t('本机') : 'WebDAV'
export type BackupSchedule = { readonly minutes: number; readonly destination: BackupDestination; readonly after: Readonly<Record<BackupLocation, number>> }
type Attempt = { file: BackupFile; remaining: BackupLocation[] }
const messageOf = (e: unknown) => e instanceof Error ? e.message : t('备份操作未完成，请重试。')

function readSchedule(): BackupSchedule {
  try {
    const saved = JSON.parse(localStorage.getItem(key + 'schedule') ?? 'null')
    if (saved && Number.isSafeInteger(saved.minutes) && saved.minutes >= 0 &&
      ['local', 'webdav', 'both'].includes(saved.destination) &&
      locations.every(place => Number.isFinite(saved.after?.[place]))) return saved
  } catch { /* 无可用设置时沿用默认的每日本机备份。 */ }
  const firstDue = Date.now() + 1440 * 60_000
  const daily: BackupSchedule = { minutes: 1440, destination: 'local', after: { local: firstDue, webdav: firstDue } }
  try { localStorage.setItem(key + 'schedule', JSON.stringify(daily)) } catch { /* 本次窗口仍沿用每日计划。 */ }
  return daily
}

function configuredWebDav(): WebDav | null {
  try {
    const config = JSON.parse(localStorage.getItem(key + 'webdav') ?? 'null')
    if (config?.kind === 'webdav' && typeof config.url === 'string' && typeof config.username === 'string' &&
      typeof config.password === 'string') return config
  } catch { /* 其他备份和工作区仍可使用。 */ }
  return null
}

function backupDevice() {
  let id = localStorage.getItem(key + 'device')
  if (!id) { id = newId(); localStorage.setItem(key + 'device', id) }
  return id
}

function filesAt(place: BackupLocation) {
  if (place === 'local') return localBackupFiles
  const config = configuredWebDav()
  if (!config) throw new Error(t('请先连接 WebDAV 备份目录。'))
  return webDavFiles(config)
}

export function useIndependentBackups(capture: (manual: boolean) => Promise<LocalDataExport>, readyInput: MaybeRefOrGetter<boolean>) {
  const ready = toRef(readyInput)
  const schedule = shallowRef<BackupSchedule>(readSchedule())
  const connectedFolder = shallowRef(configuredWebDav()?.url ?? '')
  const busy = shallowRef(false)
  const message = shallowRef<string | (() => string)>('')
  const visibleMessage = computed(() => typeof message.value === 'function' ? message.value() : message.value)
  const retry = shallowRef<Attempt | null>(null)
  const listing = shallowRef<Awaited<ReturnType<typeof listBackups>>>([])
  const listingPlace = shallowRef<BackupLocation | null>(null)
  let timer: ReturnType<typeof setInterval> | undefined

  async function run(action: () => Promise<void>) {
    if (busy.value) return
    busy.value = true
    message.value = ''
    try { await action() }
    catch (error) { message.value = messageOf(error) }
    finally { busy.value = false }
  }

  function clearListing() { listing.value = []; listingPlace.value = null }

  async function connect(url: string, username: string, password: string) {
    await run(async () => {
      if (!username.trim() || username.includes(':') || !password) throw new Error(t('请填写 WebDAV 账号和应用密码。'))
      const config: WebDav = { kind: 'webdav', url: normalizeFolder(url), username: username.trim(), password }
      await ensureWebDavFolder(config)
      await probeFiles(webDavFiles(config))
      localStorage.setItem(key + 'webdav', JSON.stringify(config))
      connectedFolder.value = config.url
      retry.value = null
      clearListing()
      message.value = t('已连接备份目录。')
    })
  }

  function disconnect() {
    if (busy.value) return
    localStorage.removeItem(key + 'webdav')
    connectedFolder.value = ''
    retry.value = null
    if (listingPlace.value === 'webdav') clearListing()
    message.value = t('已断开备份目录。')
  }

  function setSchedule(minutes: number, destination: BackupDestination) {
    if (busy.value) return
    if (!Number.isSafeInteger(minutes) || minutes < 0 || !Number.isSafeInteger(minutes * 60_000 + Date.now())) {
      message.value = t('请输入有效的整数分钟，0 表示关闭。')
      return
    }
    if (minutes && destination !== 'local' && !connectedFolder.value) {
      message.value = t('请先连接 WebDAV 备份目录。')
      return
    }
    const next = Date.now() + minutes * 60_000
    const updated: BackupSchedule = { minutes, destination, after: { local: next, webdav: next } }
    localStorage.setItem(key + 'schedule', JSON.stringify(updated))
    schedule.value = updated
    message.value = minutes ? t('已保存自动备份间隔。') : t('已关闭自动备份。')
  }

  async function writeAttempt(attempt: Attempt, kind: BackupKind) {
    const results: Array<() => string> = []
    for (const place of [...attempt.remaining]) {
      try {
        const result = await saveBackup(filesAt(place), place, attempt.file)
        if (kind === 'auto') {
          const updated: BackupSchedule = {
            ...schedule.value,
            after: { ...schedule.value.after, [place]: Date.now() + schedule.value.minutes * 60_000 },
          }
          schedule.value = updated
          localStorage.setItem(key + 'schedule', JSON.stringify(updated))
        }
        attempt.remaining = attempt.remaining.filter(p => p !== place)
        results.push(() => result === 'cleanup-incomplete'
          ? t('{0}已备份，但旧副本未全部清理。', placeLabel(place)) : t('{0}已备份', placeLabel(place)))
      } catch (error) {
        const reason = messageOf(error)
        results.push(() => t('{0}备份未完成。{1}', placeLabel(place), syncFeedbackText(reason)))
      }
    }
    if (kind === 'manual') retry.value = attempt.remaining.length ? { ...attempt } : null
    clearListing()
    message.value = () => results.map(describe => describe()).join(getLocale() === 'en' ? ' ' : '；')
  }

  async function manual(destination: BackupDestination) {
    await run(async () => {
      if (destination !== 'local' && !connectedFolder.value) throw new Error(t('请先连接 WebDAV 备份目录。'))
      const file = await makeBackup(await capture(true), 'manual', backupDevice())
      await writeAttempt({ file, remaining: destination === 'both' ? [...locations] : [destination] }, 'manual')
    })
  }

  async function repeat() {
    const pending = retry.value
    if (pending) await run(() => writeAttempt(pending, 'manual'))
  }

  async function automatic() {
    if (busy.value || !schedule.value.minutes || !ready.value) return
    const due = locations.filter(p => (schedule.value.destination === 'both' || schedule.value.destination === p)
      && schedule.value.after[p] <= Date.now() && (p === 'local' || (connectedFolder.value && navigator.onLine)))
    if (due.length) await run(async () => {
      const file = await makeBackup(await capture(false), 'auto', backupDevice())
      await writeAttempt({ file, remaining: due }, 'auto')
    })
  }

  async function list(place: BackupLocation) {
    await run(async () => {
      clearListing()
      listing.value = await listBackups(filesAt(place))
      listingPlace.value = place
    })
  }

  async function preview(place: BackupLocation, name: string, importFile: (file: File) => void) {
    await run(async () => {
      const content = await readBackup(filesAt(place), name)
      importFile(new File([content], name, { type: 'application/json' }))
    })
  }

  async function remove(place: BackupLocation, name: string) {
    await run(async () => {
      if (!backupInfo(name) || listingPlace.value !== place || !listing.value.some(row => row.name === name)) {
        throw new Error(t('请选择备份列表中的文件。'))
      }
      const files = filesAt(place)
      await files.remove(name)
      listing.value = listing.value.filter(row => row.name !== name)
      message.value = t('已删除所选备份。')
    })
  }

  watch(ready, available => { if (available) void automatic() })
  onMounted(() => {
    void automatic()
    timer = setInterval(() => { void automatic() }, 60_000)
    window.addEventListener('online', automatic)
    window.addEventListener('focus', automatic)
  })
  onBeforeUnmount(() => {
    clearInterval(timer)
    window.removeEventListener('online', automatic)
    window.removeEventListener('focus', automatic)
  })
  return {
    schedule: computed(() => schedule.value),
    connectedFolder: readonly(connectedFolder),
    busy: readonly(busy),
    message: visibleMessage,
    retry: computed(() => retry.value),
    listing: computed(() => listing.value),
    listingPlace: readonly(listingPlace),
    connect,
    disconnect,
    setSchedule,
    manual,
    repeat,
    list,
    preview,
    remove,
  }
}

export type BackupControls = ReturnType<typeof useIndependentBackups>
