import { parseRecurrenceRule, recurrenceOptions, type RecurrenceRule, type ScheduleSegment } from './recurrence'
import type { ChecklistItem } from '../storage/types'

export interface ChecklistSeriesPlan {
  zone: string
  segments: ScheduleSegment[]
  template: { title: string; notes: string | null }
  stop?: number
  stoppedAt?: string
  completeAllAt?: string
}
export interface ChecklistRecurrence {
  format: 'todou-checklist-recurrence/1'
  series: string
  index: number
  generation?: number
  at: string
  active: boolean
  plan?: ChecklistSeriesPlan
  basis?: string
  completedAt?: string
  completedFor?: string
  generatedFor?: string
  retiredAt?: string
  exception?: boolean
  timeException?: boolean
  stoppedText?: string | null
  previous?: Array<{ generation: number; plan: ChecklistSeriesPlan }>
}
const validDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))

export function hasChecklistRecurrenceMetadata(raw: string | null | undefined): boolean {
  try { return Boolean(raw && Object.prototype.hasOwnProperty.call(JSON.parse(raw), 'checklist')) } catch { return false }
}

export function readChecklistRecurrence(raw: string | null | undefined): ChecklistRecurrence | null {
  if (!parseRecurrenceRule(raw)) return null
  try {
    const value = JSON.parse(raw!).checklist as ChecklistRecurrence | undefined
    if (!value || value.format !== 'todou-checklist-recurrence/1' || typeof value.series !== 'string' || !value.series ||
      !Number.isSafeInteger(value.index) || value.index < 0 || (value.generation !== undefined && (!Number.isSafeInteger(value.generation) || value.generation < 0)) || !validDate(value.at) || typeof value.active !== 'boolean' ||
      ['completedAt','completedFor','generatedFor','retiredAt'].some(key => value[key as keyof ChecklistRecurrence] !== undefined && !validDate(value[key as keyof ChecklistRecurrence]))) return null
    if (value.previous !== undefined && (!Array.isArray(value.previous) || value.previous.some(entry => !entry?.plan || !Number.isSafeInteger(entry.generation) || entry.generation < 0))) return null
    const plans = (value.previous ?? []).map(entry => entry.plan)
    if (value.plan !== undefined) plans.push(value.plan)
    for (const plan of plans) {
      if (typeof plan.zone !== 'string' || !Array.isArray(plan.segments) || !plan.segments.length || plan.segments[0]?.index !== 0 ||
        !plan.template || typeof plan.template.title !== 'string' || (plan.template.notes !== null && typeof plan.template.notes !== 'string') ||
        (plan.stop !== undefined && (!Number.isSafeInteger(plan.stop) || plan.stop < 0)) ||
        (plan.stoppedAt !== undefined && !validDate(plan.stoppedAt)) ||
        (plan.completeAllAt !== undefined && !validDate(plan.completeAllAt))) return null
      new Intl.DateTimeFormat('en', { timeZone: plan.zone }).format()
      if (!plan.segments.every((s,i) => s && Number.isSafeInteger(s.index) && s.index >= 0 &&
        (!i || s.index > plan.segments[i-1]!.index) && validDate(s.at) && s.dueAt === null && validDate(s.remindAt) &&
        parseRecurrenceRule(JSON.stringify({ format: 'todou-recurrence/1', ...recurrenceOptions(s) })))) return null
    }
    return value
  } catch { return null }
}

export function isChecklistRecurrenceActive(item: Pick<ChecklistItem,'recurrenceMode'|'recurrenceRule'>): boolean {
  return item.recurrenceMode === 'independent' && Boolean(parseRecurrenceRule(item.recurrenceRule)) &&
    (hasChecklistRecurrenceMetadata(item.recurrenceRule) ? readChecklistRecurrence(item.recurrenceRule)?.active === true : true)
}
export function storeChecklistRecurrence(rule: RecurrenceRule, checklist: ChecklistRecurrence): string {
  return JSON.stringify({ format: 'todou-recurrence/1', ...recurrenceOptions(rule), checklist })
}
export const checklistOccurrenceId = (series: string, index: number, generation = 0) => index === 0 ? series : `occ-step:${encodeURIComponent(series)}:${generation}:${index}`
