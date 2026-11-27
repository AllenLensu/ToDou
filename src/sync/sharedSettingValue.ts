import { PARENT_COMPLETION_STRATEGIES } from '../storage/types'
import { isTagVisibility } from './tagVisibility'
import { isPurgeKey, validPurgeValue } from './taskPurge'

const strategyId = 'default_completion_strategy'
const followUpId = 'default_follow_up_minutes'

export function isSharedValueSetting(key: string) {
  return key === strategyId || key === followUpId || isTagVisibility(key) || isPurgeKey(key)
}

export function validSharedSettingValue(key: string, value: unknown): boolean {
  if (key === strategyId) return PARENT_COMPLETION_STRATEGIES.some(strategy => strategy === value)
  if (key === followUpId) return typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number(value) >= 5 && Number(value) <= 1440
  if (isPurgeKey(key)) return validPurgeValue(key, value)
  return isTagVisibility(key) && (value === 'active' || value === 'deleted')
}
