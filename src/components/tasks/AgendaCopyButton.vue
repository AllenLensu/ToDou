<script setup lang="ts">
import { nextTick, shallowRef, useTemplateRef } from 'vue'
import { formatAgendaText, type GroupedAgendaRow } from '../../domain/taskAgenda'
import { getLocale, t } from '../../i18n'

const props = defineProps<{ rows: readonly GroupedAgendaRow[] }>()
const copying = shallowRef(false)
const copied = shallowRef(false)
const fallback = shallowRef('')
const field = useTemplateRef<HTMLTextAreaElement>('field')

async function copyAgenda() {
  if (copying.value || !props.rows.length) return
  const text = formatAgendaText(props.rows, getLocale(), { task: t('[任务]'), checklist: t('[检查项]') })
  copying.value = true
  copied.value = false
  fallback.value = ''
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
  } catch {
    fallback.value = text
    await nextTick()
    field.value?.focus()
    field.value?.select()
  } finally {
    copying.value = false
  }
}
</script>

<template>
  <div class="agenda-copy">
    <button class="action-button" type="button" :disabled="copying || !rows.length" @click="copyAgenda">{{ t('复制当前日程') }}</button>
    <span role="status">{{ copied ? t('日程已复制') : '' }}</span>
    <label v-if="fallback">{{ t('请选择并复制日程文本') }}
      <textarea ref="field" :value="fallback" rows="5" readonly spellcheck="false" />
    </label>
  </div>
</template>

<style scoped>
.agenda-copy { margin-bottom: var(--space-sm); color: var(--muted); font-size: var(--type-label); }
.agenda-copy span { margin-inline-start: var(--space-xs); }
.agenda-copy label, .agenda-copy textarea { display: block; margin-top: var(--space-xs); }
.agenda-copy textarea { width: 100%; padding: var(--space-xs); border: 1px solid var(--control-border); border-radius: 8px; background: var(--surface); color: var(--text); font: var(--type-label)/1.5 var(--font-data); resize: vertical; user-select: text; }
</style>
