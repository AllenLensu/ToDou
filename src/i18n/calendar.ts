import { getLocale } from './index'

/** Monday-first labels match both the calendar grid and ISO recurrence weekdays. */
export function weekdayNames(compact = false) {
  const locale = getLocale()
  const formatter = new Intl.DateTimeFormat(locale, {
    weekday: compact && locale === 'zh-CN' ? 'narrow' : 'short', timeZone: 'UTC',
  })
  return Array.from({ length: 7 }, (_, index) => formatter.format(Date.UTC(2024, 0, 1 + index)))
}
