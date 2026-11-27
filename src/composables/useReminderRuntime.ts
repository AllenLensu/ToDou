import { getLocale, notice } from '../i18n'
import { computed, onBeforeUnmount, onMounted, readonly, shallowRef, watch, type Ref } from 'vue'
import {
  ReminderScheduler,
  getReminderPermission,
  notificationFailureMessage,
  requestReminderPermission,
  type ReminderEvent,
  type ReminderItem,
} from '../application/reminderService'
import { closeReminderNotification, closeWindowReminderNotifications } from '../application/browserReminderNotifications'
import { sameReminderTime } from '../application/reminderReschedule'
import type { ReminderRuntimeStateMap, ReminderSettings, TaskStore } from '../storage/types'

interface ReminderRuntimeOptions {
  store: Readonly<Ref<TaskStore | null>>
  items: () => ReminderItem[]
  settings: ReminderSettings
  /** 工作区正在导航或改写数据时，页内提醒操作不执行。 */
  busy: () => boolean
  onNotice: (message: () => string) => void
  onStateChange: () => unknown
  onError: (error: unknown) => void
}

const reminderKey = (event: ReminderEvent) => `${event.item.kind}:${event.item.id}`

/** 每个工作区只保留一个提醒调度器；任何改期暂停未结束前，不会重新启动调度。 */
export function useReminderRuntime(options: ReminderRuntimeOptions) {
  const runtime = shallowRef<ReminderRuntimeStateMap>({})
  const queue = shallowRef<ReminderEvent[]>([])
  const active = computed(() => queue.value[0] ?? null)
  const actionBusy = shallowRef(false)
  const notificationError = shallowRef('')
  const permission = shallowRef<NotificationPermission | 'unsupported'>('default')
  let scheduler: ReminderScheduler | null = null
  let drain = Promise.resolve()
  let startFlight: Promise<void> | null = null
  let revision = 0
  let pauses = 0
  let disposed = false

  async function suspend() {
    revision++
    const previous = scheduler
    scheduler = null
    // 后来的暂停也等待前一次排空，不能在旧通知仍写状态时开始改期。
    drain = Promise.all([drain, previous?.stopAndDrain()]).then(() => undefined)
    await drain
  }

  async function pause() {
    pauses++
    try { await suspend() }
    catch (error) { pauses--; throw error }
  }

  /** 结束一次暂停；工作区已卸载时返回 false。 */
  function release() {
    pauses--
    return !disposed
  }

  async function start() {
    await drain
    while (startFlight) await startFlight
    const activeStore = options.store.value
    if (disposed || pauses || scheduler || !activeStore || activeStore.isRecoveryRequired()) return
    const startRevision = revision
    const starting = (async () => {
      const initialState = await activeStore.getReminderRuntimeState()
      if (disposed || pauses || startRevision !== revision || options.store.value !== activeStore || activeStore.isRecoveryRequired()) return
      runtime.value = initialState
      scheduler = new ReminderScheduler({
        getItems: options.items,
        getSettings: () => ({ ...options.settings }),
        onNotify: (event) => {
          const key = reminderKey(event)
          queue.value = queue.value.some(queued => reminderKey(queued) === key)
            ? queue.value.map(queued => reminderKey(queued) === key ? event : queued)
            : [...queue.value, event]
          options.onNotice(notice('[提醒] {0}', event.item.title))
        },
        initialState,
        onStateChange: async (state) => {
          await activeStore.setReminderRuntimeState(state)
          runtime.value = state
          await options.onStateChange()
        },
        onError: (error, context) => {
          if (context.kind === 'notification') notificationError.value = notificationFailureMessage(error)
          else options.onError(error)
        },
      })
      scheduler.start()
    })()
    startFlight = starting
    try { await starting }
    finally { if (startFlight === starting) startFlight = null }
  }

  /** 本地库进入恢复状态时只停止计时；实例保留到下一次 suspend，避免恢复前被重新启动。 */
  function halt() {
    scheduler?.stop()
  }

  async function refreshItems() {
    await scheduler?.refreshItems()
  }

  function clearQueue() {
    queue.value = []
  }

  /** 其他设备推迟过的提醒不再留在本机页内队列。 */
  function dropSnoozed(state: ReminderRuntimeStateMap) {
    queue.value = queue.value.filter((event) => (state[reminderKey(event)]?.snoozedUntil ?? 0) <= Date.now())
  }

  async function loadPermission() {
    try { permission.value = await getReminderPermission() }
    catch (error) {
      permission.value = 'default'
      notificationError.value = error instanceof Error ? error.message : String(error)
    }
  }

  async function requestPermission() {
    try {
      const result = await requestReminderPermission()
      permission.value = result
      if (result === 'granted') notificationError.value = ''
      return result
    } catch (error) {
      notificationError.value = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  /** 处理队首提醒；操作返回 false 表示未完成，提醒继续留在队列中。 */
  async function act(action: (event: ReminderEvent) => Promise<boolean | void>) {
    const event = active.value
    if (!event || actionBusy.value || options.busy()) return
    actionBusy.value = true
    try {
      if (await action(event) !== false) {
        queue.value = queue.value.filter(queued => reminderKey(queued) !== reminderKey(event) || queued.at !== event.at)
      }
    } catch (error) { options.onError(error) }
    finally { actionBusy.value = false }
  }

  async function snooze(minutes: number) {
    await act(async (event) => {
      if (!scheduler) return false
      if (await scheduler.snoozeUntil(event, Date.now() + minutes * 60_000)) {
        options.onNotice(notice('[已推迟提醒] {0} 分钟', minutes))
      }
    })
  }

  async function snoozeUntil(until: number) {
    await act(async event => {
      if (!scheduler) return false
      if (await scheduler.snoozeUntil(event, until)) {
        options.onNotice(notice('已推迟至 {0}。', new Date(until).toLocaleString(getLocale())))
      }
    })
  }

  async function dismiss() {
    await act(async (event) => {
      if (!scheduler) return false
      await scheduler.dismiss(event.item)
    })
  }

  watch(options.items, (items) => {
    const current = new Map(items.map((item) => [`${item.kind}:${item.id}`, item]))
    queue.value = queue.value.flatMap((event) => {
      const item = current.get(reminderKey(event))
      return item && !item.suppressed && sameReminderTime(item.remindAt, event.item.remindAt) && (item.settings ?? options.settings).mode !== 'none' ? [{ ...event, item }] : []
    })
  })

  watch(queue, (current, previous) => {
    const kept = new Set(current.map(reminderKey))
    for (const event of previous) if (!kept.has(reminderKey(event))) closeReminderNotification(event.item)
  }, { flush: 'sync' })

  onMounted(() => window.addEventListener('pagehide', closeWindowReminderNotifications))
  onBeforeUnmount(() => {
    disposed = true
    closeWindowReminderNotifications()
    window.removeEventListener('pagehide', closeWindowReminderNotifications)
    void suspend().catch(options.onError)
  })

  return {
    runtime: computed(() => runtime.value),
    queue: computed(() => queue.value),
    active,
    actionBusy: readonly(actionBusy),
    notificationError: readonly(notificationError),
    permission: readonly(permission),
    suspend,
    pause,
    release,
    start,
    halt,
    refreshItems,
    clearQueue,
    dropSnoozed,
    loadPermission,
    requestPermission,
    act,
    snooze,
    snoozeUntil,
    dismiss,
  }
}
