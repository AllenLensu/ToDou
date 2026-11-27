<script setup lang="ts">
import { feedbackText, t } from '../../i18n'

import { computed, shallowRef, watch } from 'vue'
import { useRecurrenceDraft } from '../../composables/useRecurrenceDraft'
import { usePendingEditorDraft } from '../../composables/useChecklistEditDrafts'
import { encodeRecurrenceRule } from '../../domain/recurrence'
import { isChecklistRecurrenceActive } from '../../domain/checklistRecurrence'
import type { ChecklistRecurrenceMode } from '../../storage/types'
import NothingInput from '../ui/NothingInput.vue'

const { remindAt, disabled = false } = defineProps<{ remindAt: string; disabled?: boolean }>()
const model = defineModel<string>({ required: true })
const recurrenceMode = defineModel<ChecklistRecurrenceMode>('recurrenceMode', { required: true })
const active = computed(() => isChecklistRecurrenceActive({ recurrenceRule: model.value, recurrenceMode: recurrenceMode.value }))
const { rule, legacyText, config, changed, cadence, resetCadence } = useRecurrenceDraft(model)
const selection = shallowRef<'this' | 'repeat' | 'follow_task'>('this')
const error = shallowRef('')
const savedSelection = computed(() => recurrenceMode.value === 'follow_task' ? 'follow_task' : active.value ? 'repeat' : 'this')
function resetConfig() {
  selection.value = savedSelection.value
  resetCadence()
  error.value = ''
}
watch([model, recurrenceMode], resetConfig, { immediate: true })
usePendingEditorDraft(() => selection.value !== savedSelection.value || (selection.value === 'repeat' && changed.value), resetConfig)

function choose(value: string | number) {
  if (value !== 'this' && value !== 'repeat' && value !== 'follow_task') return
  selection.value = value
  error.value = ''
  if (selection.value === 'repeat') return
  recurrenceMode.value = selection.value === 'follow_task' ? 'follow_task' : 'independent'
  // 从结构化规则退回原说明表示主动停止，存储层据此记录系列的停止位置。
  if (rule.value) model.value = legacyText.value
}
function apply() {
  if (!cadence.value) { error.value = t('重复间隔须为大于 0 的整数'); return }
  if (!remindAt || !Number.isFinite(new Date(remindAt).getTime())) { error.value = t('请先填写检查项提醒时间，作为独立重复的起点'); return }
  recurrenceMode.value = 'independent'
  model.value = encodeRecurrenceRule({ ...cadence.value,
    ...(legacyText.value ? { legacyText: legacyText.value } : {}) })
}
function stop() { choose('this') }
</script>

<template>
  <section class="tw:grid tw:gap-xs" :aria-label="t('检查项重复规则')">
    <NothingInput :model-value="selection" :label="t('检查项重复方式')" kind="select" show-label variant="compact" :disabled="disabled" @update:model-value="choose">
      <option value="this">{{ t('仅本期') }}</option>
      <option value="repeat">{{ t('独立重复') }}</option>
      <option value="follow_task">{{ t('跟随所属任务，下一期重新勾选') }}</option>
    </NothingInput>
    <p v-if="legacyText" class="tw:m-0 tw:text-muted tw:text-label tw:leading-[1.5] tw:whitespace-pre-wrap">{{ t('原重复说明：{0}', legacyText) }}</p>
    <template v-if="selection === 'repeat'">
      <p class="tw:m-0 tw:text-dim tw:text-label tw:leading-[1.5]">{{ active ? t('已启用独立重复。更改规则会应用于此次及以后，修改后请应用设置。') : t('以检查项提醒时间为起点。确认规则并点击启用后才会自动生成后续期次。') }}</p>
      <NothingInput v-model="config.mode" :label="t('检查项重复依据')" kind="select" show-label variant="compact" :disabled="disabled">
        <option value="calendar">{{ t('固定日历') }}</option><option value="completion">{{ t('按实际完成日') }}</option>
      </NothingInput>
      <div class="tw:grid tw:grid-cols-[1fr_1fr] tw:gap-xs">
        <NothingInput v-model="config.interval" :label="t('每隔')" type="number" min="1" step="1" show-label variant="compact" :disabled="disabled" />
        <NothingInput v-model="config.unit" :label="t('时间单位')" kind="select" show-label variant="compact" :disabled="disabled">
          <option value="day">{{ t('天') }}</option><option value="week">{{ t('周') }}</option><option value="month">{{ t('月') }}</option><option value="year">{{ t('年') }}</option>
        </NothingInput>
      </div>
      <small class="tw:text-dim tw:text-label tw:leading-[1.5]">{{ t('{0} 各期分别完成、分别提醒。', config.mode === 'calendar' ? t('提前显示未来七天的检查项；未完成的往期继续保留。') : t('本期检查项完成后，从实际完成日计算下一期。')) }}</small>
      <p v-if="error" class="tw:m-0 tw:text-accent-text tw:text-label" role="alert">{{ feedbackText(error) }}</p>
      <div class="tw:flex tw:flex-wrap tw:gap-xs">
        <button class="button button-quiet touch-target tw:min-h-[44px] tw:border tw:border-solid tw:border-control-border tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:text-text tw:bg-transparent tw:font-data tw:text-label tw:[&:hover]:border-text tw:disabled:opacity-50" type="button" :disabled="disabled" @click="apply">{{ active ? t('应用独立重复设置') : t('启用独立重复') }}</button>
        <button v-if="active" class="touch-target tw:min-h-[44px] tw:bg-transparent tw:border-0 tw:text-muted tw:font-data tw:text-label tw:disabled:opacity-50" type="button" :disabled="disabled" @click="stop">{{ t('停止自动重复') }}</button>
      </div>
    </template>
    <p v-else class="tw:m-0 tw:text-dim tw:text-label tw:leading-[1.5]">{{ selection === 'follow_task' ? t('随所属任务的新一期重新创建，不单独生成期次。') : t('只保留本期检查项，不自动生成后续期次。') }}</p>
  </section>
</template>
