<script setup lang="ts">
import { getLocale, t } from '../../i18n'

import { computed, shallowRef, watch } from 'vue'
import NothingInput from '../ui/NothingInput.vue'
import { instantiateTemplate, type TaskTemplate } from '../../domain/taskTemplate'
import type { Task } from '../../storage/types'
import { toLocalDateTime } from '../../domain/localDateTime'

const props = defineProps<{ templates: TaskTemplate[]; source?: Task; busy: boolean }>()
const emit = defineEmits<{ save: [day: string]; apply: [id: string, day: string]; remove: [id: string] }>()
const day = shallowRef('')
const id = shallowRef('')
const removing = shallowRef(false)
const selected = computed(() => props.templates.find(t => t.id === id.value))
watch(() => props.source?.id, () => { day.value = toLocalDateTime(props.source?.dueAt ?? props.source?.remindAt ?? new Date().toISOString()).slice(0, 10) }, { immediate: true })
watch(() => props.templates, items => { if (!items.some(t => t.id === id.value)) id.value = items[0]?.id ?? '' }, { immediate: true })
watch(id, () => { removing.value = false })
const preview = computed(() => {
  if (props.source || !selected.value) return null
  try {
    return { content: instantiateTemplate(selected.value, day.value), error: undefined }
  } catch (error) {
    return { content: null, error: error instanceof Error ? error.message : String(error) }
  }
})
const dateFormatter = computed(() => new Intl.DateTimeFormat(getLocale(), {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}))
const previewRows = computed(() => {
  const content = preview.value?.content
  if (!content) return []
  return [
    { label: t('截止时间'), at: content.task.dueAt, empty: t('无截止时间') },
    { label: t('提醒时间'), at: content.task.remindAt, empty: t('无提醒') },
    ...content.steps.map(step => ({ label: step.title, at: step.remindAt, empty: t('无提醒') })),
  ]
})
</script>

<template>
  <details v-if="source || templates.length" class="task-templates advanced-fields">
    <summary class="template-summary advanced-summary">{{ source ? t('将这项任务保存为模板') : t('从本机模板新建') }}</summary>
    <fieldset class="template-fieldset" :disabled="busy">
      <legend class="sr-only">{{ source ? t('将这项任务保存为模板') : t('从本机模板新建') }}</legend>
      <NothingInput v-if="!source" v-model="id" kind="select" :label="t('选择模板')" show-label :disabled="busy">
        <option v-for="template in templates" :key="template.id" :value="template.id">{{ t('{0}（{1} 个步骤）', template.title, template.steps.length) }}</option>
      </NothingInput>
      <NothingInput v-model="day" type="date" :label="source ? t('原事项的基准日期') : t('这次的基准日期')"
        show-label :placeholder="t('选择日期')" :disabled="busy" :error="preview?.error" required />
      <p v-if="source" class="template-note">{{ t('保存标题、备注、链接、提醒设置和现有检查项。截止与提醒按相对基准日期的天数和本地时间套用。模板随整库备份保存。') }}</p>
      <dl v-else-if="preview?.content" class="template-preview" :aria-label="t('日期预览')">
        <div v-for="(row, index) in previewRows" :key="index" class="template-preview-row">
          <dt>{{ row.label }}</dt>
          <dd><time v-if="row.at" :datetime="row.at">{{ dateFormatter.format(new Date(row.at)) }}</time><span v-else class="template-note">{{ row.empty }}</span></dd>
        </div>
      </dl>
      <div class="tw:flex tw:flex-wrap tw:gap-xs">
        <button v-if="source" class="template-btn action-button" type="button" :disabled="!day" @click="emit('save', day)">{{ t('保存本机模板') }}</button>
        <template v-else>
          <button class="template-btn action-button is-primary" type="button" :disabled="!preview?.content" @click="emit('apply', id, day)">{{ t('创建独立任务') }}</button>
          <button v-if="!removing" class="template-btn action-button is-quiet" type="button" @click="removing = true">{{ t('删除模板') }}</button>
          <template v-else>
            <button class="template-btn action-button" type="button" @click="removing = false">{{ t('取消') }}</button>
            <button class="template-btn action-button is-danger" type="button" @click="emit('remove', id); removing = false">{{ t('确认删除模板') }}</button>
          </template>
        </template>
      </div>
    </fieldset>
  </details>
</template>

<style scoped>
.task-templates { margin-block: var(--space-sm); }
.template-summary { display: flex; align-items: center; gap: var(--space-xs); min-height: 44px; cursor: pointer; list-style: none; font: var(--type-label) var(--font-data); }
.template-fieldset { display: grid; gap: var(--space-sm); min-width: 0; margin: 0; padding: var(--space-xs) 0; border: 0; }
.template-note { color: var(--muted); font-size: var(--type-label); }
.template-preview { display: grid; gap: 8px; margin: 0; }
.template-preview-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2xs) var(--space-xs); padding-block: var(--space-xs); border-bottom: 1px solid var(--line); }
.template-preview-row dt { flex: 1 1 8rem; overflow-wrap: anywhere; }
.template-preview-row dd { margin: 0; font: var(--type-label) var(--font-data); font-variant-numeric: tabular-nums; }
</style>
