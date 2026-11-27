import { getLocale, t } from '../i18n'
// 页面内提醒调度及系统通知适配；接口发送成功不代表操作系统实际展示了通知。
import { getReminderRegistration, reminderNotificationPrefix, reminderTag, showReminderNotification, withdrawReminderNotification } from './browserReminderNotifications'
import { sameReminderTime } from './reminderReschedule'
import { DEFAULT_REMINDER_SETTINGS } from '../storage/transform'
import type { Category, ChecklistItem, ReminderRuntimeState, ReminderRuntimeStateMap, ReminderSettings, Task, TaskStatus } from '../storage/types'

export type ReminderItemKind = 'task' | 'checklist'

export interface ReminderItem {
  id: string
  kind: ReminderItemKind
  title: string
  remindAt: string | null
  dueAt?: string | null
  status?: TaskStatus
  completed?: boolean
  /** 暂停或取消父任务时保留检查项的推迟和追提醒时刻。 */
  suppressed?: boolean
  /** 所属任务的提醒设置；未提供或为 null 时使用调度器默认值。 */
  settings?: ReminderSettings | null
}

export interface ReminderEvent {
  item: ReminderItem
  at: string
  strength: ReminderSettings['strength']
}

export interface ReminderSchedulerOptions {
  getItems: () => Promise<ReminderItem[]> | ReminderItem[]
  getSettings: () => Promise<ReminderSettings> | ReminderSettings
  onNotify?: (event: ReminderEvent) => void
  /** 轮询间隔，默认一分钟；不代表操作系统保证的通知展示时刻。 */
  intervalMs?: number
  now?: () => Date
  initialState?: ReminderRuntimeStateMap
  onStateChange?: (state: ReminderRuntimeStateMap) => void | Promise<void>
  onError?: (error: unknown, context: { kind: 'notification' | 'persistence' | 'check' }) => void
}

const ACTIVE_STATUSES: ReadonlySet<TaskStatus> = new Set(['todo', 'in_progress', 'waiting'])

export function effectiveReminderSettings(task: Task, category?: Category, defaults = DEFAULT_REMINDER_SETTINGS): ReminderSettings {
  return { ...(task.reminderSettings ?? defaults),
    followUpMinutes: task.reminderSettings?.followUpMinutes ?? category?.followUpMinutes ?? defaults.followUpMinutes }
}

/** 将任务和检查项转换为统一调度输入；检查项继承所属任务的提醒设置。 */
export const reminderItemsFromRows = (
  tasks: Task[], checklistItems: ChecklistItem[], categories: Category[] = [], defaults?: ReminderSettings,
): ReminderItem[] => {
  const categoryById = new Map(categories.map(category => [category.id, category]))
  const settingsFor = (task: Task) => !defaults && !categories.length && !task.reminderSettings ? null
    : effectiveReminderSettings(task, categoryById.get(task.categoryId ?? ''), defaults)
  const owners = new Map(tasks.filter(task => !task.deletedAt).map(task => [task.id, task]))
  return [
    ...tasks
      .filter((task) => !task.deletedAt && ACTIVE_STATUSES.has(task.status) && task.remindAt)
      .map((task) => ({
        id: task.id,
        kind: 'task' as const,
        title: task.title,
        remindAt: task.remindAt,
        dueAt: task.dueAt,
        status: task.status,
        settings: settingsFor(task),
      })),
    ...checklistItems.flatMap((item) => {
      const owner = owners.get(item.taskId)
      if (!owner || item.deletedAt || item.completed || !item.remindAt) return []
      return [{
        id: item.id,
        kind: 'checklist' as const,
        title: item.title,
        remindAt: item.remindAt,
        completed: item.completed,
        suppressed: owner.status === 'paused' || owner.status === 'cancelled',
        settings: settingsFor(owner),
      }]
    }),
  ]
}

const clockMinutes = (value: string) => {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

/** 按本地时钟判断免打扰区间，支持跨午夜；起止相同表示全天免打扰。 */
export const isInQuietHours = (date: Date, settings: ReminderSettings) => {
  if (!settings.quietHoursEnabled) return false
  const start = clockMinutes(settings.quietStart)
  const end = clockMinutes(settings.quietEnd)
  const current = date.getHours() * 60 + date.getMinutes()
  if (start === end) return true
  return start < end ? current >= start && current < end : current >= start || current < end
}

type QuietConsumption = NonNullable<ReminderRuntimeState['quietConsumed']>

const quietSettingsKey = (settings: ReminderSettings, timeZone: string) => JSON.stringify([settings.quietStart, settings.quietEnd, timeZone])

const localBoundary = (year: number, month: number, day: number, minute: number) => {
  const hour = Math.floor(minute / 60)
  const date = new Date(year, month, day, hour, minute % 60)
  const wallTime = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate(), value.getHours(), value.getMinutes(), value.getSeconds(), value.getMilliseconds())
  const requested = Date.UTC(year, month, day, hour, minute % 60)
  const gap = wallTime(date) - requested
  if (gap > 0) {
    // 夏令时跳过的本地边界取跳变时刻，而非 Date 构造器顺延的分钟（如 02:30 → 03:30）。
    let low = date.getTime() - gap
    let high = date.getTime()
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (wallTime(new Date(middle)) >= requested) high = middle
      else low = middle + 1
    }
    date.setTime(high)
  }
  return date
}

/** 以本地日历构造免打扰边界，兼容夏令时导致的夜间时长变化。 */
const quietWindow = (at: Date, settings: ReminderSettings) => {
  const start = clockMinutes(settings.quietStart)
  const end = clockMinutes(settings.quietEnd)
  const current = at.getHours() * 60 + at.getMinutes()
  const overnight = start >= end
  const startDay = overnight && current < start ? -1 : 0
  const endDay = overnight && current >= start ? 1 : 0
  const startDate = localBoundary(at.getFullYear(), at.getMonth(), at.getDate() + startDay, start)
  const endDate = localBoundary(at.getFullYear(), at.getMonth(), at.getDate() + endDay, end)
  // 夏令时回拨可能让短区间出现两次，应选择包含当前时刻的那一次。
  if (endDate.getTime() <= at.getTime()) {
    const repeatedOffset = (at.getTimezoneOffset() - endDate.getTimezoneOffset()) * 60_000
    if (repeatedOffset > 0 && endDate.getTime() + repeatedOffset > at.getTime()) {
      startDate.setTime(startDate.getTime() + repeatedOffset)
      endDate.setTime(endDate.getTime() + repeatedOffset)
    }
  }
  return { windowStart: startDate.getTime(), windowEnd: endDate.getTime() }
}

// 从原本到期的那一刻重算：整夜没运行时不会留下 quietConsumed，
// 而在免打扰开始前就已经逾期的提醒仍有投递资格。
function eligibleAfterMissedQuiet(due: number, now: number, settings: ReminderSettings, consumedEnd?: number) {
  const interval = settings.followUpMinutes * 60_000
  if (!settings.quietHoursEnabled || settings.notifyAfterQuietHours) return due
  let end = consumedEnd
  if (end === undefined) {
    if (due > now) return due
    const deadline = new Date(due)
    if (!isInQuietHours(deadline, settings)) return due
    end = quietWindow(deadline, settings).windowEnd
  }
  const startMinute = clockMinutes(settings.quietStart)
  const endMinute = clockMinutes(settings.quietEnd)
  if (startMinute === endMinute) return Infinity
  // 追提醒尚未到期就进入下一轮免打扰时，从新的结束时刻重新计时。
  while (end < now) {
    const date = new Date(end)
    const nextStart = localBoundary(date.getFullYear(), date.getMonth(),
      date.getDate() + (startMinute < endMinute ? 1 : 0), startMinute)
    if (nextStart.getTime() > Math.min(end + interval, now)) break
    const nextEnd = quietWindow(nextStart, settings).windowEnd
    if (nextEnd <= end) break
    end = nextEnd
  }
  return Math.max(due, end + interval)
}

/** 编辑器和顶栏共用最早可投递的本地时间。 */
// 按本地时间跳到投递时刻或免打扰开始。回拨可能让当天的免打扰再发生一次，
// 因此两个时刻跨越时区偏移变化时，先在偏移改变处重新判断。
function nextProjectionBoundary(date: Date, eligible: number, quietStart: number) {
  const now = date.getTime()
  const day = date.getDate() + (date.getHours() * 60 + date.getMinutes() >= quietStart ? 1 : 0)
  const start = localBoundary(date.getFullYear(), date.getMonth(), day, quietStart)
  // localBoundary 默认取回拨前的第一次；若已过该时刻，改取第二次。
  const repeated = start.getTime() <= now ? (date.getTimezoneOffset() - start.getTimezoneOffset()) * 60_000 : 0
  const next = Math.min(eligible, start.getTime() + repeated)
  if (next <= now) return Math.min(eligible, now + 60_000)
  const offset = date.getTimezoneOffset()
  if (new Date(next).getTimezoneOffset() === offset) return next
  let low = now + 1
  let high = next
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (new Date(middle).getTimezoneOffset() === offset) low = middle + 1
    else high = middle
  }
  return low
}

function projectReminder(remindAt: string, settings: ReminderSettings, now: Date, runtime?: ReminderRuntimeState) {
  const result = { at: null as number | null, snooze: null as number | null, quietAffected: false, notice: '' }
  if (settings.mode === 'none') return { ...result, notice: t('本任务已关闭提醒。') }
  const original = Date.parse(remindAt)
  if (!Number.isFinite(original)) return result
  if (!(settings.followUpMinutes >= 5 && settings.followUpMinutes <= 1440)) {
    return { ...result, notice: t('请填写 5–1440 分钟的追提醒间隔。') }
  }
  const previous = runtime?.lastNotifiedAt ?? 0
  const snooze = runtime?.snoozedUntil
  result.snooze = snooze && snooze > previous ? snooze : null
  const interval = settings.followUpMinutes * 60_000
  const pending = runtime?.lastNotifiedAt == null ? original : Math.max(original, previous + interval)
  const start = Math.max(original, now.getTime(), result.snooze ?? pending)
  let eligible = start
  if (!settings.quietHoursEnabled) return { ...result, at: eligible }
  if (settings.quietStart === settings.quietEnd) return { ...result, notice: t('全天免打扰。') }
  const consumed = runtime?.quietConsumed
  if (!result.snooze && !settings.notifyAfterQuietHours) {
    const consumedEnd = consumed?.remindAt === remindAt && now.getTime() >= consumed.windowStart && pending < consumed.windowEnd
      && consumed.settingsKey === quietSettingsKey(settings, Intl.DateTimeFormat().resolvedOptions().timeZone) ? consumed.windowEnd : undefined
    const afterQuiet = eligibleAfterMissedQuiet(pending, now.getTime(), settings, consumedEnd)
    result.quietAffected = afterQuiet > eligible
    eligible = Math.max(eligible, afterQuiet)
  }
  // 追提醒间隔可能跨入下一个免打扰时段，各段复用调度器的本地日历边界。
  for (let at = start; at <= start + 48 * 3_600_000;) {
    const date = new Date(at)
    if (isInQuietHours(date, settings)) {
      const end = quietWindow(date, settings).windowEnd
      if (!result.snooze && !settings.notifyAfterQuietHours) eligible = Math.max(eligible, end + interval)
      result.quietAffected = true
      at = end > at ? end : at + 60_000
    } else if (at >= eligible) {
      return { ...result, at }
    } else {
      at = nextProjectionBoundary(date, eligible, clockMinutes(settings.quietStart))
    }
  }
  return { ...result, notice: t('追提醒间隔跨入下一轮免打扰，按当前设置预计连续 48 小时没有提醒。') }
}

export function nextReminderTime(items: ReminderItem[], runtime: ReminderRuntimeStateMap, defaults: ReminderSettings, now: Date) {
  let next: number | null = null
  for (const item of items) {
    if (!item.remindAt || item.suppressed) continue
    if (next !== null && Date.parse(item.remindAt) >= next) continue
    const { at } = projectReminder(item.remindAt, item.settings ?? defaults, now, runtime[item.kind + ':' + item.id])
    if (at !== null && (next === null || at < next)) next = at
    if (next === now.getTime()) break
  }
  return next
}

export function previewReminder(remindAt: string, settings: ReminderSettings, now: Date, runtime?: ReminderRuntimeState) {
  const { at, snooze, quietAffected, notice } = projectReminder(remindAt, settings, now, runtime)
  const format = (time: number) => new Date(time).toLocaleString(getLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const separator = getLocale() === 'en' ? ' ' : ''
  const parts = snooze ? [t('已推迟至 {0}。', format(snooze))] : []
  if (at === null) return [...parts, notice].filter(Boolean).join(separator)
  if (quietAffected) parts.push(snooze || settings.notifyAfterQuietHours ? t('免打扰结束后补发。') : t('免打扰结束后再等一个追提醒间隔。'))
  parts.push(t('预计从 {0} 起提醒，之后每 {1} 分钟追提醒。', format(at), settings.followUpMinutes))
  return parts.join(separator)
}


export const notificationFailureMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return message.trim() || t('系统通知未能显示，页面提醒仍会保留。请检查系统通知权限。')
}

/** 读取权限状态时不触发浏览器提示。 */
export const getReminderPermission = async (): Promise<NotificationPermission | 'unsupported'> => {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

/** 用户显式开启提醒时请求浏览器授权。 */
export const requestReminderPermission = async (): Promise<NotificationPermission | 'unsupported'> => {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission === 'default') return Notification.requestPermission()
  return Notification.permission
}

/**
 * 页面存活期间运行的进程内调度器，不能保证浏览器窗口完全关闭后仍提醒。
 * 检查、推迟和关闭操作共用串行队列；状态持久化失败后停止调度，等待恢复。
 */
export class ReminderScheduler {
  private readonly options: ReminderSchedulerOptions
  private readonly notify: (event: ReminderEvent, registration?: ServiceWorkerRegistration) => Promise<void>
  private readonly lastNotifiedAt = new Map<string, number>()
  private readonly snoozedUntil = new Map<string, number>()
  private readonly quietConsumed = new Map<string, QuietConsumption>()
  private timer: ReturnType<typeof setInterval> | null = null
  private snoozeTimer: ReturnType<typeof setTimeout> | undefined
  private nextSnooze = Infinity
  private checking = false
  private suspended = false
  private itemsRevision = 0
  private pending = Promise.resolve()
  private savedState = ''
  private stateFailure: unknown = null

  constructor(options: ReminderSchedulerOptions) {
    this.options = options
    this.notify = async (event, registration) => {
      // 先保留页面提醒，系统权限拒绝或浏览器发送失败都不能吞掉它。
      options.onNotify?.(event)
      try {
        await showReminderNotification(event, registration)
      } catch (error) {
        // 系统通知失败只上报，不回滚本轮提醒记账；页面提醒保留，后续仍按追提醒间隔检查。
        options.onError?.(error, { kind: 'notification' })
      }
    }
    for (const [key, state] of Object.entries(options.initialState ?? {})) {
      if (state.lastNotifiedAt !== null) this.lastNotifiedAt.set(key, state.lastNotifiedAt)
      if (state.snoozedUntil !== null) this.snoozedUntil.set(key, state.snoozedUntil)
      if (state.quietConsumed) this.quietConsumed.set(key, { ...state.quietConsumed })
    }
    this.savedState = JSON.stringify(this.state())
  }

  private state(): ReminderRuntimeStateMap {
    const keys = new Set([...this.lastNotifiedAt.keys(), ...this.snoozedUntil.keys(), ...this.quietConsumed.keys()])
    return Object.fromEntries([...keys].sort().map((key) => [key, {
      snoozedUntil: this.snoozedUntil.get(key) ?? null,
      lastNotifiedAt: this.lastNotifiedAt.get(key) ?? null,
      ...(this.quietConsumed.has(key) ? { quietConsumed: { ...this.quietConsumed.get(key)! } } : {}),
    }]))
  }

  private async stateChanged() {
    const state = this.state()
    const serialized = JSON.stringify(state)
    if (serialized === this.savedState) return
    try {
      await this.options.onStateChange?.(state)
      this.savedState = serialized
    } catch (error) {
      this.stateFailure = error
      this.stop()
      this.options.onError?.(error, { kind: 'persistence' })
      throw error
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(async () => {
      if (this.stateFailure) throw this.stateFailure
      return operation()
    })
    this.pending = next.then(() => undefined, () => undefined)
    return next
  }

  private runScheduledCheck() {
    void this.check().catch((error) => {
      if (!this.stateFailure) this.options.onError?.(error, { kind: 'check' })
    })
  }

  private setSnoozeWake(deadline: number) {
    clearTimeout(this.snoozeTimer)
    this.snoozeTimer = undefined
    this.nextSnooze = this.timer === null ? Infinity : deadline
    if (!Number.isFinite(this.nextSnooze)) return
    const now = this.options.now?.().getTime() ?? Date.now()
    // Browser timers use a signed 32-bit delay. A long snooze is rechecked at the cap.
    const delay = Math.min(2_147_483_647, Math.max(0, this.nextSnooze - now))
    this.snoozeTimer = setTimeout(() => {
      this.snoozeTimer = undefined
      this.nextSnooze = Infinity
      this.runScheduledCheck()
    }, delay)
  }

  start() {
    if (this.timer) return
    if (this.stateFailure) return
    this.suspended = false
    this.runScheduledCheck()
    this.timer = setInterval(() => this.runScheduledCheck(), this.options.intervalMs ?? 60_000)
  }

  stop() {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
    this.setSnoozeWake(Infinity)
  }

  /** 替换存储前停用旧调度器，并等待已产生事件的状态写入结束。 */
  async stopAndDrain() {
    this.stop()
    this.suspended = true
    // 排空队列不重抛旧操作的失败，以便恢复继续；原调用方仍收到拒绝，持久化错误仍经 onError 上报。
    await this.pending
  }

  /** 检查一次到期项并返回已触发事件；不表示系统通知实际展示成功。 */
  check(at = (this.options.now ?? (() => new Date()))()): Promise<ReminderEvent[]> {
    if (this.suspended) return Promise.resolve([])
    return this.serialize(() => this.checkOnce(at))
  }

  /** 列表刷新后按新状态立即检查，作废仍在发送旧通知的那一轮。 */
  refreshItems() {
    this.itemsRevision++
    return this.check()
  }

  private async reconcilePublished(registration: ServiceWorkerRegistration, items: ReminderItem[], defaults: ReminderSettings, nowMs: number, revision: number) {
    const published = await registration.getNotifications()
    if (!published.length || this.suspended || this.itemsRevision !== revision) return
    const byTag = new Map(items.map(item => [reminderTag(item), item]))
    for (const notification of published) {
      if (!notification.tag.startsWith(reminderNotificationPrefix)) continue
      const item = byTag.get(notification.tag)
      if (!item || !item.remindAt || item.suppressed || item.completed || (item.status && !ACTIVE_STATUSES.has(item.status))
        || (item.settings ?? defaults).mode === 'none' || !sameReminderTime(item.remindAt, notification.data?.remindAt ?? null)) {
        notification.close()
        continue
      }
      const key = item.kind + ':' + item.id
      if ((this.snoozedUntil.get(key) ?? 0) > nowMs) {
        notification.close()
        continue
      }
      // The browser can finish publication before SQLite finishes recording the delivery.
      const delivered = Date.parse(notification.data?.notifiedAt)
      if (delivered <= nowMs && delivered > (this.lastNotifiedAt.get(key) ?? 0)) this.lastNotifiedAt.set(key, delivered)
    }
  }

  private async withdraw(item: Pick<ReminderItem, 'id' | 'kind'>) {
    try { await withdrawReminderNotification(item) }
    catch (error) { this.options.onError?.(error, { kind: 'notification' }) }
  }

  private async checkOnce(at: Date): Promise<ReminderEvent[]> {
    if (this.checking || this.suspended) return []
    this.checking = true
    const revision = this.itemsRevision
    try {
      const defaults = await this.options.getSettings()
      const nowMs = at.getTime()
      const events: ReminderEvent[] = []
      const activeIds = new Set<string>()
      let nextSnooze = Infinity
      const items = await this.options.getItems()
      if (this.suspended) return []
      let registration: ServiceWorkerRegistration | undefined
      try {
        registration = await getReminderRegistration()
        if (registration) await this.reconcilePublished(registration, items, defaults, nowMs, revision)
      } catch (error) { this.options.onError?.(error, { kind: 'notification' }) }
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const windows = new Map<string, ReturnType<typeof quietWindow>>()
      for (const item of items) {
        if (this.suspended || this.itemsRevision !== revision) break
        if (!item.remindAt) continue
        if (item.status && !ACTIVE_STATUSES.has(item.status)) continue
        if (item.completed) continue
        const key = `${item.kind}:${item.id}`
        activeIds.add(key)
        if (item.suppressed) continue
        const settings = item.settings ?? defaults
        const settingsKey = quietSettingsKey(settings, timeZone)
        const consumed = this.quietConsumed.get(key)
        if (consumed && (!settings.quietHoursEnabled || settings.notifyAfterQuietHours
          || consumed.settingsKey !== settingsKey || consumed.remindAt !== item.remindAt || nowMs < consumed.windowStart)) {
          this.quietConsumed.delete(key)
        }
        if (settings.mode === 'none') continue
        const reminderAt = Date.parse(item.remindAt)
        if (!Number.isFinite(reminderAt)) continue
        const previous = this.lastNotifiedAt.get(key)
        const snoozed = this.snoozedUntil.get(key)
        const manualSnooze = snoozed !== undefined && (previous === undefined || snoozed > previous)
        if (manualSnooze) {
          const due = Math.max(snoozed, reminderAt)
          if (due > nowMs) nextSnooze = Math.min(nextSnooze, due)
        }
        if (reminderAt > nowMs) continue
        const pending = previous === undefined ? reminderAt : Math.max(reminderAt, previous + settings.followUpMinutes * 60_000)
        // 旧版曾把尚未到达的追提醒记为静默消费；这个窗口内实际没有到期事件。
        if (consumed && pending >= consumed.windowEnd) this.quietConsumed.delete(key)
        // 手动推迟不被静默消费；到点仍在免打扰区间时，留到区间结束后再检查。
        if (manualSnooze) this.quietConsumed.delete(key)
        if ((manualSnooze ? snoozed : pending) > nowMs) continue
        if (isInQuietHours(at, settings)) {
          if (manualSnooze && settings.quietStart !== settings.quietEnd) {
            const end = quietWindow(at, settings).windowEnd
            if (end > nowMs) nextSnooze = Math.min(nextSnooze, end)
          }
          if (!settings.notifyAfterQuietHours && !manualSnooze) {
            let window = windows.get(settingsKey)
            if (!window) { window = quietWindow(at, settings); windows.set(settingsKey, window) }
            const existing = this.quietConsumed.get(key)
            if (!existing || existing.windowStart !== window.windowStart || existing.windowEnd !== window.windowEnd) {
              this.quietConsumed.set(key, { ...window, remindAt: item.remindAt, settingsKey })
            }
          }
          continue
        }
        if (!manualSnooze && nowMs < eligibleAfterMissedQuiet(pending, nowMs, settings, this.quietConsumed.get(key)?.windowEnd)) continue
        const event: ReminderEvent = { item, at: at.toISOString(), strength: settings.strength }
        this.lastNotifiedAt.set(key, nowMs)
        this.snoozedUntil.delete(key)
        this.quietConsumed.delete(key)
        await this.notify(event, registration)
        events.push(event)
      }
      if (!this.suspended && this.itemsRevision === revision) {
        for (const key of this.lastNotifiedAt.keys()) if (!activeIds.has(key)) this.lastNotifiedAt.delete(key)
        for (const key of this.snoozedUntil.keys()) if (!activeIds.has(key)) this.snoozedUntil.delete(key)
        for (const key of this.quietConsumed.keys()) if (!activeIds.has(key)) this.quietConsumed.delete(key)
      }
      await this.stateChanged()
      this.setSnoozeWake(nextSnooze)
      return events
    } finally {
      this.checking = false
    }
  }

  /** 清除旧提醒／静默记录，设置推迟期限并交由回调持久化；到点仍受免打扰约束。 */
  snooze(item: Pick<ReminderItem, 'id' | 'kind'>, minutes: number, at = (this.options.now ?? (() => new Date()))()) {
    if (this.suspended) return Promise.reject(new Error(t('提醒正在重新打开，请稍后重试。')))
    return this.serialize(async () => {
      await this.saveSnooze(item, at.getTime() + Math.max(1, Math.round(minutes)) * 60_000)
    })
  }

  snoozeUntil(event: ReminderEvent, until: number) {
    return this.serialize(async () => {
      if (this.suspended) throw new Error(t('提醒正在重新打开，请稍后重试。'))
      if (!Number.isSafeInteger(until) || until <= (this.options.now?.() ?? new Date()).getTime()) {
        throw new Error(t('请选择未来的推迟时刻。'))
      }
      const { kind, id } = event.item
      const key = `${kind}:${id}`
      const item = (await this.options.getItems()).find(row => row.kind === kind && row.id === id)
      if (!item || item.completed || item.suppressed || (item.status && !ACTIVE_STATUSES.has(item.status))
        || !item.remindAt || !sameReminderTime(item.remindAt, event.item.remindAt)
        || (item.settings ?? await this.options.getSettings()).mode === 'none'
        || this.lastNotifiedAt.get(key) !== Date.parse(event.at) || this.snoozedUntil.has(key)) return false
      await this.saveSnooze(item, until)
      return true
    })
  }

  private async saveSnooze(item: Pick<ReminderItem, 'id' | 'kind'>, until: number) {
    const key = `${item.kind}:${item.id}`
    this.lastNotifiedAt.delete(key)
    this.quietConsumed.delete(key)
    this.snoozedUntil.set(key, until)
    await this.stateChanged()
    this.setSnoozeWake(Math.min(this.nextSnooze, until))
    await this.withdraw(item)
  }

  /** 关闭仅从当前时刻重新计追提醒间隔，不完成任务，也不永久关闭提醒。 */
  dismiss(item: Pick<ReminderItem, 'id' | 'kind'>) {
    if (this.suspended) return Promise.reject(new Error(t('提醒正在重新打开，请稍后重试。')))
    return this.serialize(async () => {
      const key = `${item.kind}:${item.id}`
      this.lastNotifiedAt.set(key, (this.options.now ?? (() => new Date()))().getTime())
      this.snoozedUntil.delete(key)
      this.quietConsumed.delete(key)
      await this.stateChanged()
      await this.withdraw(item)
    })
  }
}

