<script setup lang="ts">
import { feedbackText, t } from '../../i18n'
import { weekdayNames } from '../../i18n/calendar'

import { computed, shallowRef, watch } from 'vue'
import { useRecurrenceDraft } from '../../composables/useRecurrenceDraft'
import { usePendingEditorDraft } from '../../composables/useChecklistEditDrafts'
import { encodeRecurrenceRule } from '../../domain/recurrence'
import NothingInput from '../ui/NothingInput.vue'

const { dueAt, remindAt } = defineProps<{ dueAt: string; remindAt: string }>()
const model = defineModel<string>({ required: true })
const { rule, legacyText, config, changed, cadence, resetCadence } = useRecurrenceDraft(model)
const weekdays = shallowRef<number[]>([])
const weekLabels = computed(() => weekdayNames())
const count = shallowRef<number | string>('')
const until = shallowRef('')
const error = shallowRef('')
function resetConfig() {
  const current = rule.value
  resetCadence()
  weekdays.value = [...(current?.weekdays ?? [])]
  count.value = current?.count ?? ''
  until.value = current?.until ?? ''
  error.value = ''
}
watch(model, resetConfig, { immediate: true })
usePendingEditorDraft(() => {
  const current = rule.value
  const savedDays = current?.weekdays ?? []
  return changed.value
    || (count.value === '' ? undefined : Number(count.value)) !== current?.count
    || until.value !== (current?.until ?? '')
    || (config.mode === 'calendar' && config.unit === 'week' && (weekdays.value.length !== savedDays.length
      || weekdays.value.some(day => !savedDays.includes(day))))
}, resetConfig)

function setWorkdays() {
  config.mode = 'calendar'
  config.unit = 'week'
  config.interval = 1
  weekdays.value = [1, 2, 3, 4, 5]
}

function apply() {
  if (!cadence.value) { error.value = t('重复间隔须为大于 0 的整数'); return }
  if (!dueAt && !remindAt) { error.value = t('请先填写本期的截止时间或提醒时间，作为重复起点'); return }
  const maxCount = Number(count.value)
  if (count.value !== '' && (!Number.isSafeInteger(maxCount) || maxCount < 1)) {
    error.value = t('总次数须为大于 0 的整数，包含首期'); return
  }
  if (until.value && until.value < (dueAt || remindAt).slice(0, 10)) {
    error.value = t('结束日期不能早于本期日期'); return
  }
  model.value = encodeRecurrenceRule({ ...cadence.value,
    ...(config.mode === 'calendar' && config.unit === 'week' && weekdays.value.length ? { weekdays: weekdays.value } : {}),
    ...(count.value !== '' ? { count: maxCount } : {}),
    ...(until.value ? { until: until.value } : {}),
    ...(legacyText.value ? { legacyText: legacyText.value } : {}) })
}
function stop() { model.value = legacyText.value }
</script>

<template>
  <section class="tw:grid tw:gap-xs" :aria-label="t('自动重复规则')">
    <p v-if="legacyText" class="tw:m-0 tw:text-muted tw:text-label tw:leading-[1.5] tw:whitespace-pre-wrap">{{ t('原规则：{0}', legacyText) }}</p>
    <p class="tw:m-0 tw:text-dim tw:text-label tw:leading-[1.5]">{{ rule ? t('已启用自动重复。修改下方选项后，点击应用。') : t('当前未启用自动重复。确认下方规则后点击启用，原规则文字会保留。') }}</p>
    <NothingInput v-model="config.mode" :label="t('重复依据')" kind="select" show-label>
      <option value="calendar">{{ t('固定日历') }}</option>
      <option value="completion">{{ t('按实际完成日') }}</option>
    </NothingInput>
    <div class="tw:grid tw:grid-cols-[1fr_1fr] tw:gap-xs">
      <NothingInput v-model="config.interval" :label="t('每隔')" type="number" min="1" step="1" show-label />
      <NothingInput v-model="config.unit" :label="t('时间单位')" kind="select" show-label>
        <option value="day">{{ t('天') }}</option><option value="week">{{ t('周') }}</option><option value="month">{{ t('月') }}</option><option value="year">{{ t('年') }}</option>
      </NothingInput>
    </div>
    <button class="button button-quiet touch-target action-button tw:justify-self-start" type="button" @click="setWorkdays">{{ t('每个工作日') }}</button>
    <fieldset v-if="config.mode === 'calendar' && config.unit === 'week'" class="tw:m-0 tw:min-w-0 tw:p-0 tw:border-0">
      <legend class="tw:p-0 tw:font-data tw:text-label tw:text-muted">{{ t('重复星期') }}</legend>
      <div class="tw:flex tw:flex-wrap tw:gap-xs">
        <label v-for="(name, index) in weekLabels" :key="name" class="touch-target tw:inline-flex tw:items-center tw:min-h-[44px] tw:gap-xs">
          <input v-model="weekdays" type="checkbox" :value="index + 1" />{{ name }}
        </label>
      </div>
      <small class="tw:text-label tw:text-muted">{{ t('首期保留所填日期。留空时沿用首期的星期。') }}</small>
    </fieldset>
    <NothingInput v-model="until" type="date" :label="t('结束日期（含当天）')" show-label :placeholder="t('不限日期')" />
    <NothingInput v-model="count" type="number" min="1" step="1" :label="t('整个系列的总次数（含首期）')" show-label :placeholder="t('不限次数')" />
    <small class="tw:text-dim tw:text-label tw:leading-[1.5]">{{ t('{0} 跟随任务的检查项在新一期重新变为未完成。', config.mode === 'calendar' ? t('提前显示未来七天的期次；未完成的往期继续保留。') : t('本期完成后，从实际完成日计算下一期。')) }}</small>
    <p v-if="error" class="tw:m-0 tw:text-accent-text tw:text-label" role="alert">{{ feedbackText(error) }}</p>
    <div class="tw:flex tw:flex-wrap tw:gap-xs">
      <button class="button button-quiet touch-target tw:min-h-[44px] tw:border tw:border-solid tw:border-control-border tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:text-text tw:bg-transparent tw:font-data tw:text-label tw:[&:hover]:border-text" type="button" @click="apply">{{ rule ? t('应用重复设置') : t('启用自动重复') }}</button>
      <button v-if="rule" class="touch-target tw:min-h-[44px] tw:bg-transparent tw:border-0 tw:text-muted tw:font-data tw:text-label" type="button" @click="stop">{{ t('停止自动重复') }}</button>
    </div>
  </section>
</template>
