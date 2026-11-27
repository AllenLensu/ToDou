<script setup lang="ts">
import { feedbackText, getLocale, t } from '../../i18n'
// 展示页内提醒队列的当前条目；队列存在或发送未报错，都不能证明系统通知已展示。
import ReminderSnoozePicker from './ReminderSnoozePicker.vue'
import type { ReminderEvent } from '../../application/reminderService'

defineProps<{
  event: ReminderEvent | null
  position: { current: number; total: number }
  busy: boolean
  notificationError: string
}>()

// 只发出操作意图；工作区以忙碌状态防重入，写入成功后才移除队列项，失败时保留。
const emit = defineEmits<{
  snooze: [minutes: number]
  snoozeUntil: [until: number]
  dismiss: []
  complete: []
}>()
</script>

<template>
  <section v-if="event" class="reminder-toast tw:flex tw:items-center tw:justify-between tw:gap-[20px] tw:mx-0 tw:mb-lg tw:py-[14px] tw:px-sm tw:border tw:border-solid tw:border-accent tw:bg-surface tw:le-820:items-start tw:le-820:flex-col" :aria-label="t('到期提醒')">
    <div>
      <div role="alert" aria-live="assertive">
        <span class="section-kicker tw:font-data tw:tracking-[.08em] tw:uppercase tw:text-muted tw:text-label tw:mt-0 tw:mx-0 tw:mb-sm"><span class="reminder-signal" aria-hidden="true"></span>{{ t('提醒 · {0} / {1}', position.current, position.total) }}</span>
        <strong class="tw:block tw:mt-2xs tw:text-text-display tw:text-body tw:font-normal">{{ event.item.title }}</strong>
        <p class="tw:mt-2xs tw:text-muted tw:text-label">{{ t('提醒 {0}', event.item.remindAt ? new Date(event.item.remindAt).toLocaleString(getLocale()) : new Date(event.at).toLocaleString(getLocale())) }}<template v-if="event.item.dueAt"> {{ t('· 截止 {0}', new Date(event.item.dueAt).toLocaleString(getLocale())) }}</template></p>
      </div>
      <p v-if="notificationError" class="reminder-error tw:mt-2xs tw:text-warning tw:text-label" role="status">{{ feedbackText(notificationError) }}</p>
    </div>
    <fieldset class="reminder-actions tw:flex tw:flex-wrap tw:gap-xs tw:justify-end tw:min-w-0 tw:m-0 tw:p-0 tw:border-0 tw:le-820:justify-start" :disabled="busy">
      <legend class="sr-only">{{ t('提醒操作') }}</legend>
      <button class="button button-quiet touch-target" type="button" @click="emit('snooze', 10)">{{ t('推迟 10 分钟') }}</button>
      <button class="button button-quiet touch-target" type="button" @click="emit('snooze', 60)">{{ t('推迟 1 小时') }}</button>
      <button class="button button-quiet touch-target" type="button" @click="emit('dismiss')">{{ t('知道了') }}</button>
      <button class="button button-primary touch-target" type="button" @click="emit('complete')">{{ busy ? t('处理中…') : t('完成') }}</button>
      <ReminderSnoozePicker :key="event.item.kind + ':' + event.item.id + ':' + event.at" :busy="busy" @choose="emit('snoozeUntil', $event)" />
    </fieldset>
  </section>
</template>

<style scoped>
.reminder-signal { display: inline-block; width: 8px; height: 8px; margin-inline-end: 6px; border-radius: 50%; background: var(--accent); }
</style>
