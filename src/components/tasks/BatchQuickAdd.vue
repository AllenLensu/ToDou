<script setup lang="ts">
import { computed, nextTick, onMounted, shallowRef, useId } from 'vue'
import { t } from '../../i18n'
import type { QuickCaptureControls } from '../../composables/useQuickCapture'
import DraftLeaveGuard from '../app/DraftLeaveGuard.vue'
import NothingInput from '../ui/NothingInput.vue'

const props = defineProps<{ batch: QuickCaptureControls['batch']; enabled: boolean }>()
const { draft, lines, inputs } = props.batch
const composing = shallowRef(false)
const confirming = shallowRef(false)
const inputId = useId()
onMounted(() => document.getElementById(inputId)?.focus())
const text = computed({
  get: () => draft.value?.text ?? '',
  set: (value: string | number) => props.batch.setText(String(value)),
})

function continueEditing() {
  confirming.value = false
  void nextTick(() => document.getElementById(inputId)?.focus())
}

function close() {
  if (!props.enabled) return
  if (confirming.value) continueEditing()
  else if (text.value.trim()) confirming.value = true
  else props.batch.discard()
}

function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229 && !composing.value) {
    event.preventDefault()
    close()
  }
}
</script>

<template>
  <section class="batch-capture tw:grid tw:gap-xs tw:mb-md" :aria-label="t('批量录入')" @keydown.stop="keydown">
    <NothingInput :id="inputId" v-model="text" kind="textarea" :label="t('批量录入')" show-label
      :placeholder="t('每行一个任务标题')" :disabled="!enabled || confirming"
      @compositionstart="composing = true" @compositionend="composing = false" />
    <ul v-if="lines.length" class="batch-lines" :aria-label="t('待创建任务')">
      <li v-for="line in lines" :key="line.key">
        <label class="batch-choice">
          <input type="checkbox" :checked="line.included" :disabled="!enabled || confirming"
            @change="batch.toggle(line.key, 'excluded')" />
          <span :class="{ omitted: !line.included }">{{ line.title }}</span>
        </label>
        <label v-if="line.candidate?.remindAt" class="batch-choice batch-reminder">
          <input type="checkbox" :checked="line.useReminder" :disabled="!line.included || !enabled || confirming"
            @change="batch.toggle(line.key, 'reminders')" />
          <span>{{ t('使用提醒 {0} {1}', line.candidate.date, line.candidate.time) }}</span>
        </label>
      </li>
    </ul>
    <DraftLeaveGuard v-if="confirming" open @continue-editing="continueEditing" @discard="batch.discard" />
    <div v-else class="tw:flex tw:flex-wrap tw:gap-xs">
      <button type="button" class="batch-action batch-save action-button is-primary" :disabled="!enabled || !batch.canSubmit.value || composing || !inputs.length"
        @click="batch.submit">{{ t('创建 {0} 项任务', inputs.length) }}</button>
      <button type="button" class="batch-action action-button" :disabled="!enabled" @click="batch.discard">{{ t('取消') }}</button>
    </div>
  </section>
</template>

<style scoped>
.batch-lines { margin: 0; padding: 0; list-style: none; }
.batch-lines li { padding-block: 2px; border-bottom: 1px solid var(--line); }
.batch-choice { display: flex; align-items: center; gap: 8px; min-height: 44px; overflow-wrap: anywhere; }
.batch-choice input { flex: none; accent-color: var(--text); }
.batch-reminder { padding-inline-start: 20px; font-size: var(--type-label); color: var(--muted); }
.omitted { text-decoration: line-through; color: var(--muted); }
</style>
