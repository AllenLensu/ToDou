<script setup lang="ts">
import { shallowRef, useId } from 'vue'
import { t } from '../../i18n'
import { parseSnoozeTime, tomorrowMorning } from '../../domain/reminderSnooze'
import NothingDateTimePicker from '../ui/NothingDateTimePicker.vue'

defineProps<{ busy: boolean }>()
const emit = defineEmits<{ choose: [until: number] }>()
const localTime = shallowRef('')
const error = shallowRef('')
const errorId = useId()

function choose(value: string) {
  try {
    const until = parseSnoozeTime(value)
    error.value = ''
    emit('choose', until)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
</script>

<template>
  <div class="snooze-picker">
    <button class="action-button" type="button" :disabled="busy" @click="choose(tomorrowMorning())">{{ t('明早 09:00') }}</button>
    <NothingDateTimePicker v-model="localTime" type="datetime-local" :aria-label="t('指定推迟时刻')" :placeholder="t('指定推迟时刻')"
      :disabled="busy" :invalid="Boolean(error)" :described-by="error ? errorId : undefined" @change="error = ''" />
    <button v-if="localTime" class="action-button is-primary" type="button" :disabled="busy" @click="choose(localTime)">{{ t('确认推迟') }}</button>
    <span v-if="error" :id="errorId" class="snooze-error" role="alert">{{ error }}</span>
  </div>
</template>

<style scoped>
.snooze-picker { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-xs); min-width: 0; }
.snooze-error { color: var(--warning); font-size: var(--type-label); }
</style>
