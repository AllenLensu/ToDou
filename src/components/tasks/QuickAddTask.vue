<script setup lang="ts">
import { feedbackText, t } from '../../i18n'

import { computed, inject, nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import { quickReminderPreviewKey } from '../../composables/useReminderDisplay'
import { useQuickCaptureContext } from '../../composables/workspaceContexts'
import { QUICK_ADD_ID } from '../../composables/useKeyboardShortcuts'
import { fromLocalDateTime } from '../../domain/localDateTime'
import { parseQuickAddTime } from '../../domain/quickAddTime'
import BatchQuickAdd from './BatchQuickAdd.vue'
import NothingInput from '../ui/NothingInput.vue'
import NotificationPermissionHint from './NotificationPermissionHint.vue'

const props = defineProps<{ now: Date }>()
const capture = useQuickCaptureContext()
const batchButton = useTemplateRef<HTMLButtonElement>('batchButton')
let returningFromBatch = false
watch(() => [Boolean(capture.batch?.draft.value), capture.canQuickAdd.value] as const, ([open, ready], [wasOpen]) => {
  if (wasOpen && !open) returningFromBatch = true
  if (returningFromBatch && ready) {
    returningFromBatch = false
    if (batchButton.value && document.activeElement === document.body) batchButton.value.focus()
  }
}, { flush: 'post' })
const title = computed({
  get: () => capture.title.value,
  set: (value: string | number) => capture.setTitle(String(value)),
})
const showReminder = computed(() => capture.reminder.showReminder)
const date = computed({
  get: () => capture.reminder.date,
  set: (value: string | number) => capture.updateReminder({ date: String(value) }),
})
const time = computed({
  get: () => capture.reminder.time,
  set: (value: string | number) => capture.updateReminder({ time: String(value) }),
})
const canQuickAdd = capture.canQuickAdd

const candidate = computed(() => parseQuickAddTime(title.value, props.now))
const injectedPreview = inject(quickReminderPreviewKey, undefined)
const reminderPreview = computed(() => showReminder.value && date.value && time.value
  ? (injectedPreview ?? capture.previewReminder)(`${date.value}T${time.value}`) : '')
const error = shallowRef('')
const composing = shallowRef(false)
// 同一轮的 Enter／提交先同步锁住；父层负责整个异步保存期间禁用，并在成功后清空标题。
const pending = shallowRef(false)
const disabled = computed(() => !canQuickAdd.value || pending.value)

function clearReminder() {
  capture.clearReminder()
  error.value = ''
}
watch(() => capture.title.value, value => {
  if (!value) {
    clearReminder()
  }
})
watch(canQuickAdd, enabled => { if (enabled) pending.value = false })

function applyCandidate() {
  if (disabled.value || !candidate.value) return
  const result = candidate.value
  capture.setTitle(result.title)
  capture.updateReminder({ date: result.date, time: result.time, showReminder: true })
  error.value = ''
}

function submit() {
  if (disabled.value || composing.value || !title.value.trim()) return
  let remindAt: string | null = null
  if (showReminder.value) {
    if (!date.value || !time.value) {
      error.value = t('请选择提醒日期和具体时间，或清除提醒后只保存标题。')
      return
    }
    try { remindAt = fromLocalDateTime(`${date.value}T${time.value}`) }
    catch { error.value = t('时间无效，请重新选择。'); return }
  }
  error.value = ''
  pending.value = true
  void capture.submit({ title: title.value.trim(), remindAt })
  // 同步拒绝或极快失败可能不会让父层的忙碌状态渲染出来，下一轮允许重试。
  void nextTick(() => { if (canQuickAdd.value) pending.value = false })
}

function keydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return
  event.preventDefault()
  if (event.isComposing || event.keyCode === 229 || composing.value || event.repeat) return
  submit()
}
</script>

<template>
  <BatchQuickAdd v-if="capture.batch?.draft.value" :batch="capture.batch" :enabled="canQuickAdd" />
  <form v-else class="quick-add-task tw:grid tw:gap-xs" @submit.prevent="submit">
    <div class="quick-add-entry tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:items-start tw:gap-xs">
      <NothingInput
        :id="QUICK_ADD_ID" v-model="title" :label="t('快速新建')" type="text"
        placeholder-mode="raw" :placeholder="t('写下任务标题')" enterkeyhint="done" :disabled="!canQuickAdd && !pending" :readonly="pending"
        @keydown="keydown" @compositionstart="composing = true" @compositionend="composing = false"
      />
      <button class="quick-add-action quick-add-submit action-button is-primary tw:shrink-0" type="submit" :disabled="disabled || composing || !title.trim()" :aria-label="t('添加任务')">{{ pending ? t('添加中…') : t('添加') }}</button>
    </div>
    <div v-if="candidate && !showReminder" class="quick-add-candidate tw:flex tw:flex-wrap tw:items-center tw:gap-xs tw:text-label tw:text-muted" role="status">
      <span>{{ t('识别到：{0} · {1} {2}', candidate.title, candidate.date, candidate.time || t('（请补充提醒时间）')) }}</span>
      <button class="quick-add-action action-button" type="button" :disabled="disabled" @click="applyCandidate">{{ t('使用识别结果') }}</button>
    </div>
    <div class="capture-options">
      <button v-if="!showReminder" class="quick-add-action action-button" type="button" :disabled="disabled" @click="capture.updateReminder({ showReminder: true })">{{ t('添加提醒') }}</button>
      <button v-if="capture.batch" ref="batchButton" class="quick-add-action action-button" type="button" :disabled="disabled" @click="capture.batch.open()">{{ t('批量录入') }}</button>
    </div>
    <div v-if="showReminder" class="quick-add-reminder tw:grid tw:gap-xs">
      <div class="quick-add-datetime tw:grid tw:grid-cols-2 tw:gap-xs">
        <NothingInput v-model="date" type="date" :label="t('提醒日期')" show-label :placeholder="t('选择日期')" :disabled="disabled" />
        <NothingInput v-model="time" type="time" :label="t('提醒时间')" show-label :placeholder="t('选择几点')" :disabled="disabled" />
      </div>
      <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-xs">
        <button class="quick-add-action action-button" type="button" :disabled="disabled" @click="clearReminder">{{ t('清除提醒') }}</button>
      </div>
    </div>
    <p v-if="reminderPreview" class="tw:text-muted tw:text-label" aria-live="polite">{{ reminderPreview }}</p>
    <NotificationPermissionHint v-if="showReminder" />
    <p v-if="error" class="tw:text-accent-text tw:text-label" role="alert">{{ feedbackText(error) }}</p>
  </form>
</template>

<style scoped>
.capture-options { display: flex; flex-wrap: wrap; column-gap: var(--space-sm); }
.capture-options .action-button {
  border: 0;
  border-radius: 4px;
  padding-inline: var(--space-2xs);
  color: var(--muted);
  text-decoration: underline;
  text-decoration-color: var(--control-border);
  text-underline-offset: .25em;
}
.capture-options .action-button:enabled:hover { color: var(--text-display); text-decoration-color: currentColor; }
.quick-add-submit { min-height: 48px; min-width: 64px; }
@media (max-width: 380px) { .quick-add-datetime { grid-template-columns: minmax(0, 1fr); } }
</style>
