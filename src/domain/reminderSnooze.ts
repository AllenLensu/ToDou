import { t } from '../i18n'
import { fromLocalDateTime, toLocalDateTime } from './localDateTime'

export function tomorrowMorning(now = new Date()) {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12)
  return toLocalDateTime(tomorrow.toISOString()).slice(0, 10) + 'T09:00'
}

export function parseSnoozeTime(value: string, now = new Date()) {
  const iso = fromLocalDateTime(value)
  if (!iso || Date.parse(iso) <= now.getTime()) throw new Error(t('请选择未来的推迟时刻。'))
  return Date.parse(iso)
}
