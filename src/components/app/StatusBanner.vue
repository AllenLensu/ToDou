<script setup lang="ts">
import { computed } from 'vue'
import { t, feedbackText } from '../../i18n'
import type { DraftSaveState } from '../../application/taskDraftSession'

// 统一常驻全局状态行：错误优先于工作区提示与编辑保存状态；不自行重开数据或执行撤销。
const props = defineProps<{
  errorMessage: string
  statusMessage: string
  /** 当前编辑草稿的保存状态。 */
  saveState?: DraftSaveState
  /** 当前任务详情模式：empty | create | edit。 */
  detailMode?: 'empty' | 'create' | 'edit'
  /** 本地数据库是否正在初始化。 */
  isLoading?: boolean
  /** 重复任务改期尚未选择影响范围。 */
  needsRescheduleScope?: boolean
  /** 快速新建或检查项等非详情表单是否存在未提交草稿。 */
  hasPendingDraft?: boolean
  /** 由父级根据数据库状态和忙碌状态决定是否提供重新打开入口。 */
  canRetry?: boolean
  /** 普通状态旁的可选操作（当前用于删除后撤销）；错误分支不展示它。 */
  actionLabel?: string
}>()

defineEmits<{
  retry: []
  action: []
}>()

interface EditIndicator {
  text: string
  tone: 'muted' | 'active' | 'error'
  state: 'idle' | 'pending' | 'saving' | 'saved' | 'failed'
}

const editIndicator = computed<EditIndicator | null>(() => {
  if (props.detailMode && props.detailMode !== 'empty') {
    if (props.saveState === 'failed') return { text: t('[保存失败]'), tone: 'error', state: 'failed' }
    if (props.saveState === 'saving') return { text: t('[保存中…]'), tone: 'active', state: 'saving' }
    if (props.needsRescheduleScope) return { text: t('[待选择改期范围]'), tone: 'active', state: 'pending' }
    if (props.detailMode === 'create') {
      return props.saveState === 'pending'
        ? { text: t('[新任务待创建]'), tone: 'active', state: 'pending' }
        : { text: t('[新任务 · 创建后自动保存]'), tone: 'muted', state: 'idle' }
    }
    if (props.saveState === 'pending') return { text: t('[待保存]'), tone: 'active', state: 'pending' }
    // 常态「已保存」已由详情标题旁的 #todou-task-save-state 展示，顶栏状态行不再重复占位。
    return null
  }
  if (props.hasPendingDraft) return { text: t('[草稿待提交]'), tone: 'active', state: 'pending' }
  return null
})

const isIdle = computed(() => !props.errorMessage && !props.statusMessage && !props.isLoading && !editIndicator.value)

const primaryText = computed(() => {
  if (props.statusMessage) return props.statusMessage
  if (props.isLoading) return t('[OPENING LOCAL DATABASE]')
  if (editIndicator.value) return editIndicator.value.text
  return t('[就绪]')
})

const primaryTone = computed<'dim' | 'muted' | 'active' | 'error'>(() => {
  if (props.statusMessage) return 'muted'
  if (props.isLoading) return 'muted'
  if (editIndicator.value) return editIndicator.value.tone
  return 'dim'
})

const secondaryEditIndicator = computed<EditIndicator | null>(() => {
  if (!props.statusMessage || !editIndicator.value) return null
  return editIndicator.value.state === 'pending' || editIndicator.value.state === 'saving' || editIndicator.value.state === 'failed'
    ? editIndicator.value
    : null
})
</script>

<template>
  <div v-if="errorMessage" class="inline-status error status-banner tw:min-h-[24px] tw:text-accent-text tw:[font:var(--type-label)_var(--font-data)] tw:tracking-[.03em] tw:flex tw:items-center tw:flex-wrap tw:gap-[12px]" role="alert" data-status-tone="error">
    <span>{{ t('[错误] {0}', feedbackText(errorMessage)) }}</span>
    <button v-if="canRetry" type="button" class="button button-danger status-retry tw:text-accent-text tw:[&:hover]:text-accent-text tw:[&:hover]:opacity-100" @click="$emit('retry')">
      {{ t('重新打开本地数据') }}
    </button>
  </div>
  <div v-else class="inline-status status-banner tw:min-h-[24px] tw:[font:var(--type-label)_var(--font-data)] tw:tracking-[.03em] tw:flex tw:items-center tw:flex-wrap tw:gap-[12px]" :class="primaryTone === 'error' ? 'tw:text-accent-text' : primaryTone === 'active' ? 'tw:text-text' : primaryTone === 'dim' ? 'tw:text-dim' : 'tw:text-muted'" role="status" aria-live="polite" :data-status-tone="primaryTone" :data-edit-state="editIndicator?.state ?? 'idle'" :data-idle="isIdle ? 'true' : undefined">
    <span>{{ primaryText }}</span>
    <span v-if="secondaryEditIndicator" class="status-edit-chip" :class="secondaryEditIndicator.tone === 'error' ? 'tw:text-accent-text' : 'tw:text-text'" :data-edit-state="secondaryEditIndicator.state">{{ secondaryEditIndicator.text }}</span>
    <button v-if="statusMessage && actionLabel" type="button" class="button button-quiet status-action" @click="$emit('action')">{{ actionLabel }}</button>
  </div>
</template>
