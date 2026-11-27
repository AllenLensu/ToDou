import { computed, inject, shallowRef, toValue, watch, type InjectionKey, type MaybeRefOrGetter, type Ref } from 'vue'
import type { ReminderEvent } from '../application/reminderService'
import type { ReminderRuntimeStateMap } from '../storage/types'
import { snoozedTime } from '../domain/taskFilters'

export const reminderRuntimeKey: InjectionKey<Readonly<Ref<ReminderRuntimeStateMap>>> = Symbol('reminderRuntime')

export function useReminderDisplay() {
  const runtime = inject(reminderRuntimeKey, undefined)
  return (kind: 'task' | 'checklist', id: string) => snoozedTime(runtime?.value ?? {}, kind, id)
}

export function useReminderQueuePosition(queue: MaybeRefOrGetter<readonly ReminderEvent[]>) {
  const viewed = shallowRef(0)
  const headKey = () => {
    const item = toValue(queue)[0]?.item
    return item ? item.kind + ':' + item.id : null
  }
  watch(headKey, (current, previous) => {
    if (current === null) viewed.value = 0
    else if (previous !== null) viewed.value++
  }, { flush: 'sync' })
  return computed(() => {
    const length = toValue(queue).length
    return {
      current: length ? viewed.value + 1 : 0,
      total: viewed.value + length,
    }
  })
}

export const quickReminderPreviewKey: InjectionKey<(local: string) => string> = Symbol('quickReminderPreview')
export const checklistPreviewKey: InjectionKey<(id: string | null, owner: string, local: string, original: string | null) => string> = Symbol('checklistPreview')
