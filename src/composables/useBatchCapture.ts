import { computed, shallowRef, type MaybeRefOrGetter, toValue } from 'vue'
import { parseQuickAddTime } from '../domain/quickAddTime'

/** Keep the reference date with the draft so a restored, accepted reminder stays on its previewed day. */
export interface BatchCaptureDraft {
  text: string
  referenceTime: number
  excluded: string[]
  reminders: string[]
}

export function useBatchCaptureDraft(now: MaybeRefOrGetter<Date>) {
  const draft = shallowRef<BatchCaptureDraft | null>(null)
  const lines = computed(() => {
    const current = draft.value
    if (!current) return []
    const seen = new Map<string, number>()
    const excluded = new Set(current.excluded)
    const reminders = new Set(current.reminders)
    const date = new Date(current.referenceTime)
    return current.text.split(/\r\n|[\r\n]/).map(line => line.trim()).filter(Boolean).map(raw => {
      const occurrence = (seen.get(raw) ?? 0) + 1
      seen.set(raw, occurrence)
      const key = `${occurrence}:${raw}`
      const candidate = parseQuickAddTime(raw, date)
      const useReminder = Boolean(candidate?.remindAt && reminders.has(key))
      return {
        key, raw, candidate, included: !excluded.has(key), useReminder,
        title: useReminder ? candidate!.title : raw,
        remindAt: useReminder ? candidate!.remindAt : null,
      }
    })
  })
  const inputs = computed(() => lines.value.filter(row => row.included)
    .map(({ title, remindAt }) => ({ title, remindAt })))

  function open() {
    draft.value ??= { text: '', referenceTime: toValue(now).getTime(), excluded: [], reminders: [] }
  }

  function setText(text: string) {
    if (!draft.value) return
    draft.value = { ...draft.value, text }
    const keys = new Set(lines.value.map(line => line.key))
    draft.value = { ...draft.value, excluded: draft.value.excluded.filter(key => keys.has(key)),
      reminders: draft.value.reminders.filter(key => keys.has(key)) }
  }

  function toggle(key: string, field: 'excluded' | 'reminders') {
    if (!draft.value) return
    const values = draft.value[field]
    draft.value = { ...draft.value, [field]: values.includes(key) ? values.filter(id => id !== key) : [...values, key] }
  }

  function discard() { draft.value = null }

  return { draft, lines, inputs, open, setText, toggle, discard }
}
