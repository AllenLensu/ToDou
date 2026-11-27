<script setup lang="ts">
import { t, feedbackText } from '../../i18n'
import { computed, shallowReactive, shallowRef } from 'vue'
import type { Category, ParentCompletionStrategy, Tag } from '../../storage/types'
import { followUpMinutesValue } from '../../storage/transform'
import NothingInput from '../ui/NothingInput.vue'
import TaxonomyEditor from './TaxonomyEditor.vue'

const props = defineProps<{
  categories: Category[]
  tags: Tag[]
  defaultCompletionStrategy: ParentCompletionStrategy | ''
  defaultFollowUpMinutes: number
  disabled: boolean
  editCategory: (id: string, changes: { name?: string; completionStrategy?: ParentCompletionStrategy | null }) => Promise<void>
  editTag: (id: string, name: string | null) => Promise<void>
  addCategory: (name: string, strategy: ParentCompletionStrategy | null) => Promise<boolean>
}>()

const emit = defineEmits<{
  'update-default-strategy': [strategy: ParentCompletionStrategy | '']
  'update-category-follow-up': [id: string, minutes: number | null]
}>()

const newCategoryName = shallowRef('')
const newCategoryStrategy = shallowRef<ParentCompletionStrategy | ''>('')
const categoryFollowUpDrafts = shallowReactive<Record<string, string | number>>({})
const categoryFollowUpErrors = shallowReactive<Record<string, string>>({})
const followUpErrorMessage = () => t('请输入 5–1440 分钟的整数，尚未保存')

const strategyLabels = computed<Record<ParentCompletionStrategy, string>>(() => ({
  require_children: t('A · 先完成全部子项'),
  complete_parent_only: t('B · 仅完成父任务'),
  complete_all_children: t('C · 父子项一并完成'),
}))

function strategyValue(value: string | number) {
  return String(value) as ParentCompletionStrategy | ''
}

function updateCategoryFollowUp(id: string, value: string | number) {
  const minutes = followUpMinutesValue(Number(value))
  categoryFollowUpErrors[id] = minutes === null ? followUpErrorMessage() : ''
  if (minutes !== null) { delete categoryFollowUpDrafts[id]; emit('update-category-follow-up', id, minutes) }
}

function inheritCategoryFollowUp(id: string) {
  delete categoryFollowUpDrafts[id]
  categoryFollowUpErrors[id] = ''
  emit('update-category-follow-up', id, null)
}

async function submitCategory() {
  if (await props.addCategory(newCategoryName.value, newCategoryStrategy.value || null)) {
    newCategoryName.value = ''
    newCategoryStrategy.value = ''
  }
}

function submitCategoryKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return
  event.preventDefault()
  if (event.isComposing || event.keyCode === 229) return
  void submitCategory()
}
</script>

<template>
  <div>
    <div class="field tw:grid tw:gap-xs tw:mb-md">
      <NothingInput
        :model-value="defaultCompletionStrategy"
        :label="t('全局父任务完成策略')"
        kind="select"
        :placeholder="t('选择全局默认策略')"
        @update:model-value="emit('update-default-strategy', strategyValue($event))"
       show-label :help="t('父任务完成时如何处理子项；分类和单个任务可以覆盖它。')">
        <option value="">{{ t('尚未设置') }}</option>
        <option v-for="(label, value) in strategyLabels" :key="value" :value="value">{{ label }}</option>
      </NothingInput>
    </div>

    <TaxonomyEditor :categories="categories" :tags="tags" :strategy-labels="strategyLabels"
      :edit-category="editCategory" :edit-tag="editTag" :disabled="disabled" />
    <ul v-if="categories.length" class="settings-list tw:grid tw:gap-px tw:mt-md tw:mx-0 tw:mb-0 tw:p-0 tw:list-none" :aria-label="t('已有分类')">
      <li v-for="category in categories" :key="category.id" class="tw:grid tw:gap-sm tw:py-sm tw:px-0 tw:border-0 tw:border-b tw:border-solid tw:border-line">
        <div class="tw:flex tw:justify-between tw:gap-sm">
          <span>{{ category.name }}</span>
          <span class="settings-list-value tw:text-muted tw:[font:var(--type-label)_var(--font-data)] tw:tracking-[.04em]">{{ category.completionStrategy ? strategyLabels[category.completionStrategy] : t('完成策略跟随全局') }}</span>
        </div>
        <div class="tw:flex tw:items-end tw:gap-xs tw:le-500:flex-wrap">
          <div class="tw:min-w-0 tw:flex-1 tw:le-500:basis-full">
            <NothingInput :model-value="categoryFollowUpDrafts[category.id] ?? category.followUpMinutes ?? defaultFollowUpMinutes" @update:model-value="categoryFollowUpDrafts[category.id] = $event; categoryFollowUpErrors[category.id] = ''" :label="t('{0}的追提醒间隔（分钟）', category.name)" :show-label="true" type="number" min="5" max="1440" step="5" :placeholder="t('例如：15')" variant="compact" :error="feedbackText(categoryFollowUpErrors[category.id])" :disabled="disabled" @change="updateCategoryFollowUp(category.id, $event)" />
          </div>
          <button class="button button-quiet touch-target tw:min-h-[44px] tw:shrink-0 tw:border tw:border-solid tw:border-control-border tw:rounded-[999px] tw:py-[10px] tw:px-[13px] tw:text-text tw:bg-transparent tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[&:hover:not(:disabled)]:border-text tw:disabled:opacity-50" type="button" :aria-label="t('{0}的追提醒间隔跟随全局', category.name)" :disabled="(category.followUpMinutes == null && !categoryFollowUpErrors[category.id]) || disabled" @click="inheritCategoryFollowUp(category.id)">{{ t('跟随全局') }}</button>
        </div>
        <small class="field-help tw:text-dim tw:text-label tw:leading-[1.5]">{{ category.followUpMinutes == null ? t('追提醒跟随全局：每 {0} 分钟', defaultFollowUpMinutes) : t('追提醒单独设置：每 {0} 分钟', category.followUpMinutes) }}</small>
      </li>
    </ul>

    <div class="field taxonomy-tools tw:mt-md tw:grid tw:gap-xs tw:mb-md tw:content-start">
      <span class="field-label tw:font-data tw:text-label tw:font-normal tw:leading-[normal] tw:text-muted tw:tracking-[.06em] tw:uppercase">{{ t('新增分类') }}</span>
      <div class="inline-create tw:flex tw:gap-xs tw:[&>.nothing-input]:min-w-0 tw:[&>.nothing-input]:flex-1 tw:[&>.button]:whitespace-nowrap tw:[&>.button]:px-[13px]">
        <NothingInput v-model="newCategoryName" :label="t('新分类')" type="text" :placeholder="t('例如：工作')" variant="compact" @keydown="submitCategoryKeydown"  show-label/>
        <button class="button button-quiet touch-target tw:min-h-[44px] tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:text-text tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:[&:hover:not(:active):not(:disabled)]:opacity-[.78] tw:active:opacity-100 tw:disabled:cursor-wait tw:disabled:opacity-50 tw:border tw:border-solid tw:border-control-border tw:bg-transparent tw:[&:hover:not(:active)]:border-text tw:[&:hover]:text-text-display tw:active:border-text-display tw:active:text-text-display" type="button" @click="submitCategory">{{ t('添加') }}</button>
      </div>
      <NothingInput
        :model-value="newCategoryStrategy"
        :label="t('分类完成策略覆盖')"
        kind="select"
        :placeholder="t('选择分类默认策略')"
        variant="compact"
        @update:model-value="newCategoryStrategy = strategyValue($event)"
       show-label>
        <option value="">{{ t('分类跟随全局') }}</option>
        <option v-for="(label, value) in strategyLabels" :key="value" :value="value">{{ label }}</option>
      </NothingInput>
    </div>
  </div>
</template>
