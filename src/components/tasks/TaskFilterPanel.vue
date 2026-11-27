<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, useId, useTemplateRef, watch } from 'vue'
import { t } from '../../i18n'
import { priorities, statuses } from '../../domain/taskUi'
import type { Category, Tag } from '../../storage/types'
import type { TaskFilterPresets } from '../../composables/useTaskFilterPresets'
import { filterPreferenceKey } from '../../application/taskFilterPresets'
import NothingInput from '../ui/NothingInput.vue'

const { filters, categories, tags } = defineProps<{ filters: TaskFilterPresets; categories: Category[]; tags: Tag[] }>()
const { conditions, selected, presets, error, invalid, missingCategory, missingTags, active, panelOpen } = filters
const name = shallowRef('')
const panelId = useId()
const toggle = useTemplateRef<HTMLButtonElement>('toggle')

watch(selected, item => { name.value = item?.name ?? '' }, { immediate: true })
function close(event: KeyboardEvent) {
  if (event.defaultPrevented) return
  event.preventDefault()
  panelOpen.value = false
  toggle.value?.focus()
}
function onStorage(event: StorageEvent) {
  if (event.key === filterPreferenceKey || event.key === null) filters.reload()
}
onMounted(() => window.addEventListener('storage', onStorage))
onBeforeUnmount(() => {
  window.removeEventListener('storage', onStorage)
  panelOpen.value = false
})
</script>

<template>
  <section class="filter-presets" :aria-label="t('常用筛选')" @keydown.stop @keydown.esc="close">
    <div class="filter-actions">
      <button ref="toggle" type="button" class="filter-button action-button" :aria-controls="panelOpen ? panelId : undefined" :aria-expanded="panelOpen"
        @click="panelOpen = !panelOpen">{{ t('筛选条件') }}</button>
      <button v-for="preset in presets" :key="preset.id" type="button" class="filter-button action-button"
        :aria-pressed="selected?.id === preset.id" @click="filters.apply(preset)">{{ preset.name }}</button>
      <button v-if="active" type="button" class="filter-link action-button is-quiet" @click="filters.clear()">{{ t('清除筛选') }}</button>
    </div>
    <p v-if="invalid" role="status">{{ t('筛选中的分类或标签已删除，请重新选择。') }}</p>
    <p v-if="error" role="status">{{ error === 'load' ? t('无法读取本机筛选。') : t('未保存到本机，当前筛选仍可使用。') }}</p>
    <div v-if="panelOpen" :id="panelId" class="filter-fields">
      <NothingInput v-model="conditions.status" kind="select" variant="compact" :label="t('状态')"
        show-label placeholder-mode="raw" :placeholder="t('不限')" :options="[{ value: '', label: t('不限') }, ...statuses]" />
      <NothingInput v-model="conditions.priority" kind="select" variant="compact" :label="t('优先级')"
        show-label placeholder-mode="raw" :placeholder="t('不限')" :options="[{ value: '', label: t('不限') }, ...priorities]" />
      <NothingInput v-model="conditions.categoryId" kind="select" variant="compact" :label="t('主分类')"
        show-label placeholder-mode="raw" :placeholder="t('不限')">
        <option value="">{{ t('不限') }}</option>
        <option v-if="missingCategory" :value="conditions.categoryId">{{ t('已删除的分类') }}</option>
        <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option>
      </NothingInput>
      <fieldset v-if="tags.length || missingTags.length" class="filter-tags">
        <legend>{{ t('标签（全部匹配）') }}</legend>
        <label v-for="tag in tags" :key="tag.id"><input v-model="conditions.tagIds" type="checkbox" :value="tag.id" />{{ tag.name }}</label>
        <label v-for="id in missingTags" :key="id"><input v-model="conditions.tagIds" type="checkbox" :value="id" />{{ t('已删除的标签') }}</label>
      </fieldset>
      <div class="filter-save">
        <NothingInput v-model="name" :label="t('筛选名称')" show-label variant="compact" />
        <div class="filter-actions">
          <button type="button" class="filter-link action-button" :disabled="!name.trim()" @click="filters.create(name)">{{ t('存为新筛选') }}</button>
          <template v-if="selected">
            <button type="button" class="filter-link action-button" :disabled="!name.trim() || name.trim() === selected.name" @click="filters.rename(name)">{{ t('重命名') }}</button>
            <button type="button" class="filter-link action-button" @click="filters.overwrite()">{{ t('覆盖筛选条件') }}</button>
            <button type="button" class="filter-link action-button is-danger" @click="filters.remove()">{{ t('删除此筛选') }}</button>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.filter-presets { min-width: 0; max-width: 100%; }
.filter-presets:has(.filter-fields) { flex-basis: 100%; }
.filter-actions, .filter-tags { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2xs) var(--space-xs); }
.filter-button { max-width: 100%; overflow-wrap: anywhere; }
.filter-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr)); gap: var(--space-sm); margin-top: var(--space-sm); }
.filter-tags, .filter-save { grid-column: 1 / -1; min-width: 0; }
.filter-tags { border: 0; padding: 0; margin: 0; }
.filter-tags legend { padding: 0; color: var(--muted); font: var(--type-label) var(--font-data); }
.filter-tags label { display: inline-flex; align-items: center; min-height: 44px; gap: var(--space-xs); overflow-wrap: anywhere; }
.filter-save { display: grid; gap: var(--space-xs); }
.filter-presets p { margin-block: var(--space-xs); color: var(--accent-text); font-size: var(--type-label); }
</style>
