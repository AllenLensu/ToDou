import { computed, reactive, toValue, type MaybeRefOrGetter } from 'vue'
import { parseRecurrenceRule, type RecurrenceRule } from '../domain/recurrence'

interface CadenceDraft {
  mode: RecurrenceRule['mode']
  unit: RecurrenceRule['unit']
  interval: string | number
}

/** Each editor owns its draft; reset and dirty checks use the same saved cadence. */
export function useRecurrenceDraft(source: MaybeRefOrGetter<string>) {
  const rule = computed(() => parseRecurrenceRule(toValue(source)))
  const legacyText = computed(() => rule.value?.legacyText ?? (rule.value ? '' : toValue(source)))
  const saved = computed(() => ({
    mode: rule.value?.mode ?? 'calendar',
    unit: rule.value?.unit ?? 'week',
    interval: rule.value?.interval ?? 1,
  }))
  const config = reactive<CadenceDraft>({ ...saved.value })
  const changed = computed(() => config.mode !== saved.value.mode || config.unit !== saved.value.unit
    || Number(config.interval) !== saved.value.interval)
  const cadence = computed(() => {
    const interval = Number(config.interval)
    return Number.isSafeInteger(interval) && interval >= 1 ? { mode: config.mode, unit: config.unit, interval } : null
  })
  function resetCadence() { Object.assign(config, saved.value) }
  return { rule, legacyText, config, changed, cadence, resetCadence }
}
