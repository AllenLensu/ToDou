import { getLocale, t } from '../i18n'
import { weekdayNames } from '../i18n/calendar'
import { normalizeTaskInput } from '../storage/transform'
import type { TaskInput } from '../storage/types'

export interface RecurrenceRule {
  mode: 'calendar' | 'completion'
  interval: number
  unit: 'day' | 'week' | 'month' | 'year'
  weekdays?: number[]
  until?: string
  count?: number
  legacyText?: string
}

export type RecurrenceScope = 'this' | 'future'
export interface ScheduleSegment extends RecurrenceRule {
  index: number
  at: string
  dueAt: string | null
  remindAt: string | null
}
export interface SeriesPlan {
  zone: string
  segments: ScheduleSegment[]
  stop?: number
  template?: ReturnType<typeof recurrenceTemplate>
}

/** Keep occurrence content independent of later edits to individual tasks. */
export function recurrenceTemplate(input: Partial<TaskInput>) {
  const { title, notes, url, priority, reminderSettings, completionStrategy, parentTaskId, categoryId, tagIds } = normalizeTaskInput(input)
  return { title, notes, url, priority, reminderSettings, completionStrategy, parentTaskId, categoryId, tagIds }
}
export interface StoredRecurrence extends RecurrenceRule {
  plan?: SeriesPlan
  basis?: string
  completedAt?: string
  generatedFor?: string
  retiredAt?: string
}

const standardFormat = 'todou-recurrence/1'
const extendedFormat = 'todou-recurrence/2'
const extended = (rule: Partial<RecurrenceRule>) => rule.weekdays !== undefined || rule.until !== undefined || rule.count !== undefined
function validDay(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00Z')
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value
}
const validRule = (rule: Partial<RecurrenceRule>) =>
  (rule.mode === 'calendar' || rule.mode === 'completion') &&
  Number.isSafeInteger(rule.interval) && rule.interval! >= 1 &&
  ['day', 'week', 'month', 'year'].includes(rule.unit ?? '') &&
  (rule.count === undefined || (Number.isSafeInteger(rule.count) && rule.count > 0)) &&
  (rule.until === undefined || validDay(rule.until)) &&
  (rule.weekdays === undefined || (rule.mode === 'calendar' && rule.unit === 'week' &&
    Array.isArray(rule.weekdays) && rule.weekdays.length > 0 && rule.weekdays.length <= 7 &&
    rule.weekdays.every(day => Number.isInteger(day) && day >= 1 && day <= 7) &&
    new Set(rule.weekdays).size === rule.weekdays.length)) &&
  (rule.legacyText === undefined || typeof rule.legacyText === 'string')

const validDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))
function validPlan(plan: SeriesPlan): boolean {
  if (!plan || typeof plan.zone !== 'string' || !Array.isArray(plan.segments) || !plan.segments.length ||
    plan.segments[0]?.index !== 0 || (plan.stop !== undefined && !(Number.isSafeInteger(plan.stop) && plan.stop > 0))) return false
  // Imported and synced rule text may have been edited by another client.
  if (!formats.has(plan.zone)) formatterFor(plan.zone)
  if (plan.template !== undefined) {
    const normalized = recurrenceTemplate(plan.template)
    if (![normalized.parentTaskId, normalized.categoryId].every(id => id === null || typeof id === 'string')) return false
  }
  return plan.segments.every((segment, i) => segment && validRule(segment) && Number.isSafeInteger(segment.index) &&
    (i === 0 || segment.index > plan.segments[i - 1]!.index) && segment.index < (plan.stop ?? Infinity) &&
    validDate(segment.at) && (segment.dueAt === null || validDate(segment.dueAt)) &&
    (segment.remindAt === null || validDate(segment.remindAt)))
}

export function readRecurrence(raw: string | null | undefined): StoredRecurrence | null {
  if (!raw?.startsWith('{')) return null
  try {
    const value = JSON.parse(raw)
    if (![standardFormat, extendedFormat].includes(value?.format) || !validRule(value)
      || (value.format === standardFormat && (extended(value) || value.plan?.segments?.some(extended))) || (value.plan !== undefined && !validPlan(value.plan)) ||
      (value.basis !== undefined && typeof value.basis !== 'string') ||
      ['completedAt', 'generatedFor', 'retiredAt'].some(key => value[key] !== undefined && !validDate(value[key]))) return null
    return value
  } catch { return null }
}

export function recurrenceOptions(rule: RecurrenceRule): RecurrenceRule {
  return {
    mode: rule.mode, interval: rule.interval, unit: rule.unit,
    ...(rule.weekdays ? { weekdays: [...rule.weekdays].sort((a,b) => a-b) } : {}),
    ...(rule.until ? { until: rule.until } : {}),
    ...(rule.count ? { count: rule.count } : {}),
    ...(rule.legacyText === undefined ? {} : { legacyText: rule.legacyText })
  }
}

export function parseRecurrenceRule(raw: string | null | undefined): RecurrenceRule | null {
  const rule = readRecurrence(raw)
  return rule && recurrenceOptions(rule)
}

/** Short summary used beside the task dates and in the restore comparison. */
export function describeRecurrence(raw: string | null) {
  const rule = parseRecurrenceRule(raw)
  if (!rule) return raw || t('无')
  const cadence = recurrenceCadence(rule)
  const weekdays = weekdayNames(true)
  const english = getLocale() === 'en'
  const days = rule.weekdays?.map(day => weekdays[day - 1]).join(english ? ', ' : '、')
  return [days ? cadence + (english ? ': ' : '') + days : cadence,
    rule.mode === 'completion' && t('按完成日'), rule.until && t('至 {0}', rule.until),
    rule.count && t('共 {0} 次', rule.count)].filter(Boolean).join(' · ')
}

export function recurrenceCadence(rule: Pick<RecurrenceRule, 'interval' | 'unit'>) {
  const key = rule.interval === 1
    ? { day: '每天', week: '每周', month: '每月', year: '每年' }[rule.unit]
    : { day: '每{0}天', week: '每{0}周', month: '每{0}月', year: '每{0}年' }[rule.unit]
  return t(key, rule.interval)
}

export function encodeRecurrenceRule(rule: RecurrenceRule): string {
  if (!validRule(rule)) throw new Error(t('请填写有效的正整数重复间隔和单位'))
  return JSON.stringify({ format: extended(rule) ? extendedFormat : standardFormat, ...recurrenceOptions(rule) })
}

export function storeRecurrence(rule: RecurrenceRule, details: Omit<StoredRecurrence, keyof RecurrenceRule>): string {
  const format = extended(rule) || details.plan?.segments.some(extended) ? extendedFormat : standardFormat
  return JSON.stringify({ format, ...recurrenceOptions(rule), ...details })
}

export const occurrenceId = (series: string, index: number) => index === 0 ? series : `occ:${encodeURIComponent(series)}:${index}`
export function occurrenceIndex(series: string, id: string): number | null {
  if (id === series) return 0
  const prefix = `occ:${encodeURIComponent(series)}:`
  if (!id.startsWith(prefix)) return null
  const index = Number(id.slice(prefix.length))
  return Number.isSafeInteger(index) && index > 0 && occurrenceId(series, index) === id ? index : null
}

// Calendar calculations use the wall clock of the device that enabled the series.
// UTC here represents civil components, so travelling devices compute the same slot.
const formats = new Map<string, Intl.DateTimeFormat>()
function formatterFor(zone: string) {
  let formatter = formats.get(zone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    })
    formats.set(zone, formatter)
  }
  return formatter
}

function civil(iso: string, zone: string): Date {
  const instant = new Date(iso)
  const parts = Object.fromEntries(formatterFor(zone).formatToParts(instant).map(part => [part.type, Number(part.value)]))
  return new Date(Date.UTC(parts.year!, parts.month! - 1, parts.day, parts.hour, parts.minute, parts.second, instant.getUTCMilliseconds()))
}

function instant(wall: Date, zone: string): string {
  let tentative = wall.getTime(), previous = tentative
  for (let i = 0;i < 4;i++) {
    const iso = new Date(tentative).toISOString()
    const delta = wall.getTime() - civil(iso, zone).getTime()
    if (!delta) return iso
    const next = tentative + delta
    // The wall time falls in a DST gap. Use the first equivalent time after the gap.
    if (next === previous) return new Date(Math.max(next, tentative)).toISOString()
    previous = tentative
    tentative = next
  }
  return new Date(tentative).toISOString()
}

export function shiftTime(value: string | null, from: string, to: string, zone: string): string | null {
  if (!value || from === to) return value
  if (value === from) return to
  return instant(new Date(+civil(value, zone) + +civil(to, zone) - +civil(from, zone)), zone)
}

/** A clock-only edit preserves the nominal date even if this occurrence was temporarily moved. */
export function futureField(nominal: string | null, previous: string | null, selected: string | null, zone: string) {
  if (previous === selected) return nominal
  if (nominal && previous && selected &&
      civil(previous, zone).toISOString().slice(0, 10) === civil(selected, zone).toISOString().slice(0, 10)) {
    return shiftTime(nominal, previous, selected, zone)
  }
  return selected
}

function advance(wall: Date, rule: RecurrenceRule, count: number): void {
  if (rule.weekdays && count > 0) {
    const day = wall.getUTCDay() || 7
    const ordered = [...rule.weekdays].sort((a, b) => a - b)
    const afterAnchor = ordered.filter(weekday => weekday > day)
    const remaining = count - afterAnchor.length - 1
    const offset = remaining < 0 ? afterAnchor[count - 1]! - day
      : (1 + Math.floor(remaining / ordered.length)) * 7 * rule.interval + ordered[remaining % ordered.length]! - day
    wall.setUTCDate(wall.getUTCDate() + offset)
    return
  }
  const n = rule.interval * count
  if (rule.unit === 'day' || rule.unit === 'week') {
    wall.setUTCDate(wall.getUTCDate() + n * (rule.unit === 'week' ? 7 : 1))
  } else {
    const day = wall.getUTCDate()
    wall.setUTCDate(1)
    wall.setUTCMonth(wall.getUTCMonth() + (rule.unit === 'year' ? 12 : 1) * n + 1, 0)
    wall.setUTCDate(Math.min(day, wall.getUTCDate()))
  }
}

export function withinSeriesLimit(rule: RecurrenceRule, index: number, at: string, zone: string): boolean {
  return index < (rule.count ?? Infinity) && (!rule.until || civil(at, zone).toISOString().slice(0, 10) <= rule.until)
}

export function calendarAt(segment: ScheduleSegment, index: number, zone: string): string | null {
  const wall = civil(segment.at, zone)
  advance(wall, segment, index - segment.index)
  return Number.isFinite(+wall) && wall.getUTCFullYear() <= 9999 ? instant(wall, zone) : null
}

export function completionAt(segment: ScheduleSegment, completed: string, zone: string): string | null {
  const wall = civil(segment.at, zone), day = civil(completed, zone)
  wall.setUTCFullYear(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())
  advance(wall, segment, 1)
  return Number.isFinite(+wall) && wall.getUTCFullYear() <= 9999 ? instant(wall, zone) : null
}

export function upcomingSlots(segment: ScheduleSegment, endIndex: number, now: Date, zone: string) {
  const today = civil(now.toISOString(), zone)
  today.setUTCHours(0, 0, 0, 0)
  const first = civil(segment.at, zone)
  const months = 12 * (today.getUTCFullYear() - first.getUTCFullYear()) + today.getUTCMonth() - first.getUTCMonth()
  const days = (+today - +first) / 86_400_000
  const units = { day: days, week: days / 7, month: months, year: months / 12 }[segment.unit]
  const estimate = segment.weekdays
    ? (Math.floor(days / (7 * segment.interval)) - 1) * segment.weekdays.length
    : Math.floor(units / segment.interval) - 1
  const start = segment.index + Math.max(1, estimate)
  const end = new Date(+today + 8 * 86_400_000)
  const slots: Array<{ index: number; at: string }> = []
  for (let index = start;index < Math.min(endIndex, segment.count ?? Infinity);index++) {
    const at = calendarAt(segment, index, zone)
    if (!at) break
    const wall = civil(at, zone)
    if (wall >= end || (segment.until && wall.toISOString().slice(0, 10) > segment.until)) break
    if (wall >= today) slots.push({ index, at })
  }
  return slots
}
