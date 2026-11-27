<script setup lang="ts">
import { t, feedbackText } from '../../i18n'

import { computed, shallowRef, watch } from 'vue'
import NothingInput from '../ui/NothingInput.vue'
import type { Category, ParentCompletionStrategy, Tag } from '../../storage/types'

const props = defineProps<{
  categories: Category[]; tags: Tag[]; disabled: boolean
  strategyLabels: Record<ParentCompletionStrategy, string>
  editCategory: (id: string, changes: { name?: string; completionStrategy?: ParentCompletionStrategy | null }) => Promise<void>
  editTag: (id: string, name: string | null) => Promise<void>
}>()
const selection = shallowRef('')
const category = computed(() => props.categories.find(row => selection.value === 'category:' + row.id))
const tag = computed(() => props.tags.find(row => selection.value === 'tag:' + row.id))
const name = shallowRef('')
const strategy = shallowRef<ParentCompletionStrategy | ''>('')
const initialName = shallowRef('')
const initialStrategy = shallowRef<ParentCompletionStrategy | ''>('')
const confirmDeletion = shallowRef(false)
const busy = shallowRef(false)
const message = shallowRef('')
watch(selection, () => {
  name.value = initialName.value = category.value?.name ?? tag.value?.name ?? ''
  strategy.value = initialStrategy.value = category.value?.completionStrategy ?? ''
  confirmDeletion.value = false
  message.value = ''
})

async function save(remove = false) {
  if (busy.value) return
  busy.value = true
  message.value = ''
  try {
    let changed = false
    if (category.value) {
      const changes: { name?: string; completionStrategy?: ParentCompletionStrategy | null } = {}
      if (initialName.value !== name.value.trim()) changes.name = name.value.trim()
      if (initialStrategy.value !== strategy.value) changes.completionStrategy = strategy.value || null
      if (Object.keys(changes).length) {
        await props.editCategory(category.value.id, changes)
        changed = true
      }
    } else if (tag.value) {
      const nextName = name.value.trim()
      if (remove || initialName.value !== nextName) {
        await props.editTag(tag.value.id, remove ? null : nextName)
        changed = true
      }
    }
    if (remove) { selection.value = ''; confirmDeletion.value = false }
    else {
      name.value = initialName.value = category.value?.name ?? tag.value?.name ?? ''
      strategy.value = initialStrategy.value = category.value?.completionStrategy ?? ''
    }
    if (remove) message.value = t('已删除标签，原任务已保留。')
    else if (changed) message.value = t('已保存修改。')
  } catch (error) { message.value = error instanceof Error ? error.message : t('保存失败，请重试。') }
  finally { busy.value = false }
}
</script>

<template>
  <details class="taxonomy-editor">
    <summary class="disclosure-summary">{{ t('编辑已有分类和标签') }}</summary>
    <form @submit.prevent="save()">
      <fieldset class="taxonomy-fieldset" :disabled="disabled || busy">
      <legend class="sr-only">{{ t('编辑已有分类和标签') }}</legend>
        <NothingInput v-model="selection" kind="select" show-label :label="t('选择分类或标签')" :disabled="disabled || busy">
          <option value="">{{ t('请选择') }}</option>
          <option v-for="row in categories" :key="'category:' + row.id" :value="'category:' + row.id">{{ row.name }} · {{ t('分类') }}</option>
          <option v-for="row in tags" :key="'tag:' + row.id" :value="'tag:' + row.id">{{ row.name }} · {{ t('标签') }}</option>
        </NothingInput>
        <template v-if="category || tag">
          <NothingInput v-model="name" :label="t('名称')" show-label required />
          <NothingInput v-if="category" v-model="strategy" kind="select" :label="t('分类完成策略')" show-label :disabled="disabled || busy">
            <option value="">{{ t('跟随全局') }}</option>
            <option v-for="(label, value) in strategyLabels" :key="value" :value="value">{{ label }}</option>
          </NothingInput>
          <div v-if="!confirmDeletion" class="actions">
            <button class="action-button is-primary" type="submit">{{ t('保存修改') }}</button>
            <button v-if="tag" class="action-button" type="button" @click="confirmDeletion = true">{{ t('删除标签') }}</button>
          </div>
          <template v-else>
            <p>{{ t('删除「{0}」会移除任务上的该标签，任务和历史记录将保留。', tag?.name) }}</p>
            <div class="actions">
              <button class="action-button" type="button" @click="confirmDeletion = false">{{ t('保留标签') }}</button>
              <button class="action-button is-danger" type="button" @click="save(true)">{{ t('确认删除标签') }}</button>
            </div>
          </template>
        </template>
      </fieldset>
      <p v-if="message" role="status">{{ feedbackText(message) }}</p>
    </form>
  </details>
</template>

<style scoped>
.taxonomy-editor { border-top: 1px solid var(--line); margin-block: 12px; }
.taxonomy-fieldset { display: grid; gap: 12px; min-width: 0; padding: 0; margin: 0; border: 0; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
