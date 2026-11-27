import { fromLocalDateTime, toLocalDateTime } from './localDateTime'

export interface QuickAddInput { title: string; remindAt: string | null }
export interface QuickAddTimeCandidate extends QuickAddInput { date: string; time: string }
/** 留在工作区的录入草稿，切换设置或回收站时仍保留用户已确认的日期时间。 */
export interface QuickAddReminderDraft { showReminder: boolean; date: string; time: string }

const pad = (value: number) => String(value).padStart(2, '0')
const digits = '零一二三四五六七八九'
function number(value: string): number {
  if (/^\d+$/.test(value)) return Number(value)
  if (value === '两') return 2
  if (value.includes('十')) {
    const [tens, units] = value.split('十')
    return (tens ? digits.indexOf(tens) : 1) * 10 + (units ? digits.indexOf(units) : 0)
  }
  return value.length === 1 ? digits.indexOf(value) : NaN
}

/** 只识别标题开头的明确日期；结果始终是候选，由用户确认后才用于新建。 */
export function parseQuickAddTime(input: string, now = new Date()): QuickAddTimeCandidate | null {
  const text = input.trim()
  const dateToken = /^(今天|明天|后天|(?:周|星期)[一二三四五六日天]|(?:today|tomorrow|day after tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b|(?:(\d{4})[-/年])?(\d{1,2})[-/月](\d{1,2})(?!\d)(?:日|号)?)/i.exec(text)
  if (!dateToken || !Number.isFinite(now.getTime())) return null
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const token = dateToken[1]!.toLowerCase()
  const offset = ({ 今天: 0, 明天: 1, 后天: 2, today: 0, tomorrow: 1, 'day after tomorrow': 2 } as Record<string, number>)[token]
  const englishDay = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(token)
  if (offset !== undefined) date.setDate(date.getDate() + offset)
  else if (/^(周|星期)/.test(token) || englishDay >= 0) {
    const weekday = englishDay >= 0 ? englishDay : '日一二三四五六'.indexOf(token.at(-1)!.replace('天', '日'))
    date.setDate(date.getDate() + (weekday - date.getDay() + 7) % 7)
  } else {
    const year = dateToken[2] ? Number(dateToken[2]) : now.getFullYear()
    const month = Number(dateToken[3])
    const day = Number(dateToken[4])
    date.setFullYear(year, month - 1, day)
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
    if (!dateToken[2] && date.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) {
      date.setFullYear(year + 1)
      if (date.getMonth() !== month - 1 || date.getDate() !== day) return null
    }
  }
  const dateValue = toLocalDateTime(date.toISOString()).slice(0, 10)
  let rest = text.slice(dateToken[0].length).trimStart()
  let time = ''
  // Accept English clocks with an explicit AM/PM or colon, without consuming ordinary title words.
  const englishClock = /^(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|^at\s+(\d{1,2}):(\d{2})\b/i.exec(rest)
  if (englishClock) {
    const period = englishClock[3]?.toLowerCase()
    let hour = Number(englishClock[1] ?? englishClock[4])
    const minute = Number(englishClock[2] ?? englishClock[5] ?? 0)
    if (minute > 59 || hour > 23 || (period && (hour < 1 || hour > 12))) return null
    if (period) hour = hour % 12 + (period === 'pm' ? 12 : 0)
    time = `${pad(hour)}:${pad(minute)}`
    rest = rest.slice(englishClock[0].length)
  } else if (/^at\s+\d/i.test(rest)) return null
  // 分钟以“分”、半／刻或冒号明确分隔，不把“两个人”等标题开头当作分钟。
  const clock = /^(凌晨|早上|上午|中午|下午|晚上)?\s*([\d零一二两三四五六七八九十]+)(?:[:：](\d{1,2})(?!\d)|(?:点|时)(?:(半|一刻|三刻)|([\d零一二两三四五六七八九十]+)分)?)/.exec(rest)
  if (!englishClock && clock) {
    let hour = number(clock[2]!)
    const minute = clock[3] ? Number(clock[3]) : clock[4] ? ({ 半: 30, 一刻: 15, 三刻: 45 }[clock[4]] ?? NaN) : clock[5] ? number(clock[5]) : 0
    const period = clock[1]
    if (period && (hour < 1 || hour > 12)) return null
    // “晚上十二点”可能指次日零点，保留原文交给用户手选，不猜日期归属。
    if (period === '晚上' && hour === 12) return null
    if (period === '中午') {
      if (hour <= 2) hour += 12
      else if (hour < 11) return null
    } else if (period === '下午' || period === '晚上') hour = hour % 12 + 12
    else if (period === '凌晨' && hour === 12) hour = 0
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null
    time = `${pad(hour)}:${pad(minute)}`
    rest = rest.slice(clock[0].length)
  } else if (!englishClock && /^(凌晨|早上|上午|中午|下午|晚上|\d+[:：])/.test(rest)) return null
  const title = rest.replace(/^[\s，,：:]+/, '').trim()
  if (!title) return null
  try {
    return { title, date: dateValue, time, remindAt: time ? fromLocalDateTime(`${dateValue}T${time}`) : null }
  } catch {
    return null
  }
}
