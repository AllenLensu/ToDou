import { t } from '../i18n'

export const isPersistedDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value))

export function optionalDateInput(value: string | null | undefined) {
  if (value == null || value === '') return null
  if (!isPersistedDate(value)) throw new Error(t('时间无效，请重新选择。'))
  return value
}

export const taskDateFields = ['dueAt', 'remindAt', 'occurrenceAt'] as const

/** Old clients recorded free text in optional date fields. Keep every other historical value. */
export function projectHistoryDates<T extends object>(snapshot: T): T {
  let result = snapshot
  for (const key of taskDateFields) {
    const value: unknown = Reflect.get(snapshot, key)
    if (typeof value === 'string' && !isPersistedDate(value)) result = { ...result, [key]: null }
  }
  return result
}
