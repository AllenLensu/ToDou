import { t } from '../i18n'
import { isPersistedDate } from './persistedDate'

/** 无法同步的旧值显示为空，让用户能够清除或重新选择。 */
export function toLocalDateTime(value: string | null): string {
  if (!isPersistedDate(value)) return ''
  const date = new Date(value)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 与原值的本地分钟显示一致时原样返回，保留秒数、偏移及夏令时回拨的具体时刻。 */
export function fromLocalDateTime(value: string, original: string | null = null): string | null {
  if (!value) return null
  if (original && value === toLocalDateTime(original)) return original
  // 新值按本地时间解析；往返检查拒绝自动进位的日期和夏令时跳过的时间，回拨歧义沿用 Date 的选择。
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || toLocalDateTime(date.toISOString()) !== value) {
    throw new Error(t('时间无效，请重新选择'))
  }
  return date.toISOString()
}
