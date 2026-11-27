import { t } from '../i18n'
// 管理本机同步开关、触发时机和反馈；合并提交交由工作区保护草稿与提醒生命周期。
import { computed, onBeforeUnmount, onMounted, reactive, readonly, shallowRef, toRef, watch, type MaybeRefOrGetter } from 'vue'
import type { TaskStore } from '../storage/types'
import type { FieldValue } from '../sync/fieldMerge'
import { synchronizeDevice } from '../sync/deviceSync'
import { openSyncRemote, readSyncScope } from '../sync/providers'
import { useDeviceConnection } from './useDeviceConnection'
import { usePendingSyncDetails } from './usePendingSyncDetails'

type Status = Awaited<ReturnType<TaskStore['fieldSyncStatus']>>
type Commit = (apply: () => Promise<void>, hasIncoming: boolean) => Promise<void>
const preferenceKey = 'todou.sync.schedule.v1'
const defaultMinutes = 5
const messageFor = (error: unknown) => error instanceof Error ? error.message : t('本次同步未完成，请重试。')

export function useDeviceSync(storeInput: MaybeRefOrGetter<TaskStore | null>, commit: Commit) {
  const store = toRef(storeInput)
  const { connected } = useDeviceConnection()
  const scope = shallowRef<string | null>(null)
  const enabled = shallowRef(false)
  const busy = shallowRef(false)
  const minutes = shallowRef(defaultMinutes)
  const message = shallowRef('')
  const statusError = shallowRef('')
  const status = shallowRef<Status | null>(null)
  const details = usePendingSyncDetails(store, scope, status, refresh)
  let bindingRequest = 0
  let resolvingBinding = false
  let statusRequest = 0
  let revision = 0
  let flight: Promise<void> | null = null
  let reconnectPending = false
  let uploadTimer: ReturnType<typeof setTimeout> | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let disposed = false

  function savePreferences() {
    localStorage.setItem(preferenceKey, JSON.stringify({ scope: scope.value, enabled: enabled.value, minutes: minutes.value }))
  }

  async function refresh(afterLocalWrite = false) {
    const request = ++statusRequest
    const db = store.value, binding = scope.value
    if (!db || !binding || resolvingBinding) { status.value = null; statusError.value = ''; return false }
    const current = () => request === statusRequest && store.value === db && scope.value === binding && !disposed
    try {
      const result = await db.fieldSyncStatus(binding)
      if (!current()) return false
      status.value = result
      statusError.value = ''
      if (result.paused && enabled.value) pause()
      if (afterLocalWrite && result.pending && enabled.value && minutes.value === 1 && !uploadTimer && navigator.onLine) {
        // 多次保存合并为一次上传，对端下一次分钟轮询即可读取。
        uploadTimer = setTimeout(() => {
          uploadTimer = undefined
          if (disposed || store.value !== db || scope.value !== binding || !enabled.value || minutes.value !== 1 || !navigator.onLine || !status.value?.pending) return
          if (flight) reconnectPending = true
          else void synchronize()
        }, 1000)
      }
      return true
    } catch (error) {
      // 同步状态读取失败不等于任务保存失败；清掉旧计数，避免继续展示过时的“已上传”。
      if (current()) { status.value = null; statusError.value = messageFor(error) }
      return false
    }
  }

  async function synchronize() {
    // 手动、定时与绑定触发共用在途 Promise，不并发交换；绑定变更或重连的补跑由 finally 安排。
    if (flight) return flight
    const db = store.value, binding = scope.value, version = revision
    if (!db || !binding || !enabled.value || disposed) return
    // 暂停、切库、换绑定或卸载都会使本轮失效；不强行取消已发网络请求，而在后续交换和本地提交前校验。
    const current = () => !disposed && revision === version && store.value === db && enabled.value && scope.value === binding
    busy.value = true
    message.value = ''
    flight = (async () => {
      try {
        if (!navigator.onLine) throw new Error(t('设备已断网，恢复联网后会继续同步。'))
        if (!current()) return
        await synchronizeDevice(db, binding, await openSyncRemote(binding), current, commit)
      } catch (error) {
        if (current()) message.value = messageFor(error)
      } finally {
        try { if (current()) await refresh() } catch (error) { if (current()) message.value = messageFor(error) }
        flight = null
        busy.value = false
        // 联网事件可能早于旧网络请求失败；待旧请求退出后补跑，避免丢掉重连触发。
        const rerun = revision !== version || reconnectPending
        reconnectPending = false
        if (rerun && enabled.value && !disposed) void synchronize()
      }
    })()
    return flight
  }

  function pause() {
    revision++
    clearTimeout(uploadTimer)
    uploadTimer = undefined
    reconnectPending = false
    enabled.value = false
    savePreferences()
  }

  async function enable() {
    // 网盘授权只建立连接；此处才显式启用当前库的字段同步，并记录本机调度偏好。
    const db = store.value, binding = scope.value
    if (!db || !binding || busy.value) return
    busy.value = true
    try {
      await db.enableFieldSync(binding)
      if (db !== store.value || binding !== scope.value) return
      enabled.value = true
      savePreferences()
      await synchronize()
    } catch (error) {
      if (!disposed && store.value === db && scope.value === binding) message.value = messageFor(error)
    }
    finally { if (!flight) busy.value = false }
  }

  function setMinutes(value: number) {
    if (!Number.isSafeInteger(value) || value < 0) {
      message.value = t('请输入 0 或正整数分钟。')
      return
    }
    minutes.value = value
    savePreferences()
  }

  async function choose(key: string, value: FieldValue) {
    const db = store.value, binding = scope.value
    if (!db || !binding || !enabled.value || busy.value) return
    try {
      await commit(() => db.chooseSyncField(binding, key, value), true)
      if (await refresh()) await synchronize()
    } catch (error) {
      if (!disposed && store.value === db && scope.value === binding) message.value = messageFor(error)
    }
  }

  async function bind() {
    // 绑定读取可重叠，只有最新请求能接纳目录身份；调度开关只沿用同一目录的本机偏好。
    const request = ++bindingRequest
    resolvingBinding = true
    statusRequest++
    status.value = null
    try {
      const binding = await readSyncScope()
      if (request !== bindingRequest || disposed) return
      resolvingBinding = false
      if (scope.value !== binding) {
        revision++
        scope.value = binding
        statusError.value = ''
        message.value = ''
      }
      if (!binding || !store.value) { enabled.value = false; return }
      const raw = localStorage.getItem(preferenceKey)
      const prefs = raw ? JSON.parse(raw) : null
      enabled.value = prefs?.scope === binding && prefs.enabled === true
      const sameBinding = prefs?.scope === binding
      minutes.value = sameBinding && Number.isSafeInteger(prefs.minutes) && prefs.minutes >= 0
        ? prefs.minutes : defaultMinutes
      if (!await refresh()) return
      if (request === bindingRequest && enabled.value) void synchronize()
    } catch (error) {
      if (request === bindingRequest) {
        resolvingBinding = false
        revision++
        statusRequest++
        scope.value = null
        status.value = null
        statusError.value = ''
        enabled.value = false
        message.value = messageFor(error)
      }
    }
  }

  // 恢复或重新打开数据库后，上一个工作区的网络错误不再属于当前清单。
  watch(store, () => { status.value = null; message.value = '' }, { flush: 'sync' })
  watch([store, connected], () => { void bind() }, { immediate: true })
  watch([enabled, minutes], () => {
    clearInterval(timer)
    if (enabled.value && minutes.value > 0) {
      let nextPoll = Date.now() + minutes.value * 60_000
      timer = setInterval(() => {
        if (Date.now() < nextPoll - 250) return
        nextPoll = Date.now() + minutes.value * 60_000
        if (navigator.onLine) void synchronize()
      }, 60_000)
    }
  })

  function online() {
    if (flight && enabled.value) reconnectPending = true
    else void synchronize()
  }
  onMounted(() => {
    window.addEventListener('online', online)
  })
  onBeforeUnmount(() => {
    disposed = true
    clearTimeout(uploadTimer)
    clearInterval(timer)
    window.removeEventListener('online', online)
  })
  return reactive({
    scope: readonly(scope),
    enabled: readonly(enabled),
    busy: readonly(busy),
    minutes: readonly(minutes),
    status: computed(() => status.value),
    details,
    statusError: readonly(statusError),
    message: readonly(message),
    enable,
    pause,
    setMinutes,
    synchronize,
    refresh,
    choose,
  })
}

export type DeviceSyncControls = ReturnType<typeof useDeviceSync>
