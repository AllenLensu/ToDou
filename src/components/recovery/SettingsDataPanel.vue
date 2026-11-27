<script setup lang="ts">
import { computed, useTemplateRef, watch } from 'vue'
import { feedbackText, t } from '../../i18n'
import type { BackupControls } from '../../composables/useIndependentBackups'
import type { LocalRecoveryControls } from '../../composables/useLocalRecovery'
import IndependentBackups from './IndependentBackups.vue'
import LocalRecoveryCopies from './LocalRecoveryCopies.vue'

const props = defineProps<{
  backups: BackupControls
  recovery: LocalRecoveryControls
  isSaving: boolean
  isDatabaseReady: boolean
}>()
const emit = defineEmits<{ exportData: [] }>()

const copies = computed(() => props.recovery.copies.value)
const selectedCopy = computed(() => props.recovery.selectedCopy.value)
const pendingImport = computed(() => props.recovery.pendingImport.value)
const importBusy = computed(() => props.recovery.importBusy.value || props.recovery.busy.value)
const combinedError = computed(() => props.recovery.importError.value || props.recovery.error.value)
const importInput = useTemplateRef<HTMLInputElement>('importInput')
const importReview = useTemplateRef<HTMLElement>('importReview')
const importButton = useTemplateRef<HTMLButtonElement>('importButton')

watch(pendingImport, (pending, previous) => {
  if (pending) importReview.value?.focus()
  else if (previous) importButton.value?.focus()
}, { flush: 'post' })

function handleImport() {
  const input = importInput.value
  if (!input) return
  const file = input.files?.[0]
  // 清空文件控件以便再次选择同一文件；预览及确认状态由恢复控制持有。
  input.value = ''
  if (file) void props.recovery.previewImport(file)
}

function findCopies(event: Event) {
  if ((event.currentTarget as HTMLDetailsElement).open) void props.recovery.loadCopies()
}
</script>

<template>
  <section class="settings-panel tw:max-w-none tw:mt-section" aria-labelledby="data-transfer-title">
    <div class="section-heading compact-heading tw:mb-md tw:flex tw:justify-between tw:items-start tw:gap-md">
      <div>
        <span class="section-kicker tw:font-data tw:tracking-[.08em] tw:uppercase tw:text-muted tw:text-label tw:mt-0 tw:mx-0 tw:mb-sm">{{ t('DATA SAFETY') }}</span>
        <h2 id="data-transfer-title" class="tw:text-text-display tw:text-body tw:font-normal tw:tracking-[-.02em] tw:leading-[1.2]">{{ t('本地数据') }}</h2>
      </div>
      <span class="save-hint tw:font-data tw:tracking-[.08em] tw:uppercase tw:text-dim tw:text-label">{{ t('JSON · LOCAL ONLY') }}</span>
    </div>
    <p class="settings-note tw:text-dim tw:leading-[1.5] tw:text-label tw:mt-[20px] tw:mx-0 tw:mb-sm">{{ t('导出可用于更换浏览器或重装 PWA；导入会覆盖当前本地数据，并在执行前要求确认。') }}</p>
    <div class="reminder-actions settings-actions tw:flex tw:flex-wrap tw:gap-xs tw:justify-end tw:le-820:justify-start">
      <button class="button button-secondary tw:min-h-[44px] tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:text-text tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:[&:hover:not(:active):not(:disabled)]:opacity-[.78] tw:active:opacity-100 tw:disabled:cursor-wait tw:disabled:opacity-50 tw:border tw:border-solid tw:border-control-border tw:bg-surface-raised tw:active:border-text-display tw:active:text-text-display" type="button" :disabled="!isDatabaseReady || importBusy" @click="emit('exportData')">{{ t('导出本地数据') }}</button>
      <button ref="importButton" class="button button-primary tw:min-h-[44px] tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:active:opacity-100 tw:disabled:cursor-wait tw:disabled:opacity-50 tw:border-0 tw:bg-text-display tw:text-bg tw:[&:hover]:opacity-[.86] tw:active:bg-text tw:[&:active:hover]:opacity-[.86] tw:[&:disabled:hover]:opacity-[.86]" type="button" :disabled="!isDatabaseReady || importBusy" @click="importInput?.click()">{{ importBusy ? t('正在处理…') : t('导入本地数据') }}</button>
      <input ref="importInput" hidden type="file" accept=".todou.json,application/json" @change="handleImport" />
    </div>
    <IndependentBackups :backups="backups" :disabled="!isDatabaseReady || importBusy" @preview="recovery.previewImport($event)" />
    <p v-if="combinedError" class="inline-status error tw:min-h-[24px] tw:font-data tw:text-label tw:font-normal tw:leading-[normal] tw:tracking-[.03em] tw:text-accent-text" role="alert">{{ feedbackText(combinedError) }}</p>
    <section v-if="pendingImport" ref="importReview" class="import-review tw:grid tw:gap-[12px] tw:mt-md tw:py-[20px] tw:px-0 tw:border-0 tw:border-y tw:border-solid tw:border-line" tabindex="-1" aria-labelledby="import-review-title">
      <h3 id="import-review-title" class="tw:text-text-display tw:text-body tw:font-normal">{{ t('确认替换本地数据') }}</h3>
      <p class="import-file-name tw:[overflow-wrap:anywhere] tw:text-muted tw:[font:var(--type-label)_var(--font-data)]">{{ pendingImport.name }}</p>
      <p>{{ t('{0} 条任务 · {1} 个检查项 · {2} 条历史', pendingImport.summary.tasks, pendingImport.summary.checklistItems, pendingImport.summary.history) }}</p>
      <p class="field-help tw:text-dim tw:text-label tw:leading-[1.5]">{{ t('{0} 个分类 · {1} 个标签。确认后会保留当前数据库副本，替换本机数据并暂停同步。', pendingImport.summary.categories, pendingImport.summary.tags) }}</p>
      <div class="reminder-actions tw:flex tw:flex-wrap tw:gap-xs tw:justify-end tw:le-820:justify-start">
        <button class="button button-quiet touch-target tw:min-h-[44px] tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:text-text tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:[&:hover:not(:active):not(:disabled)]:opacity-[.78] tw:active:opacity-100 tw:disabled:cursor-wait tw:disabled:opacity-50 tw:border tw:border-solid tw:border-control-border tw:bg-transparent tw:[&:hover:not(:active)]:border-text tw:[&:hover]:text-text-display tw:active:border-text-display tw:active:text-text-display" type="button" :disabled="importBusy" @click="recovery.cancelImport()">{{ t('取消导入') }}</button>
        <button class="button button-primary touch-target tw:min-h-[44px] tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:active:opacity-100 tw:disabled:cursor-wait tw:disabled:opacity-50 tw:border-0 tw:bg-text-display tw:text-bg tw:[&:hover]:opacity-[.86] tw:active:bg-text tw:[&:active:hover]:opacity-[.86] tw:[&:disabled:hover]:opacity-[.86]" type="button" :disabled="importBusy || !isDatabaseReady" @click="recovery.confirmImport()">{{ importBusy ? t('正在导入…') : t('确认替换并导入') }}</button>
      </div>
    </section>
    <details class="advanced-fields tw:mt-lg tw:mx-0 tw:mb-0 tw:p-0" @toggle="findCopies">
      <summary class="advanced-summary tw:flex tw:items-center tw:gap-[12px] tw:min-h-[44px] tw:text-text tw:cursor-pointer tw:list-none tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:color_var(--motion-fast)_var(--ease-out)] tw:[.advanced-fields[open]_&]:mb-md">{{ t('恢复本地数据库副本') }}</summary>
      <fieldset class="recovery-controls tw:grid tw:gap-sm tw:min-w-0 tw:m-0 tw:p-0 tw:border-0" :disabled="importBusy || isSaving">
      <legend class="sr-only">{{ t('恢复本地数据库副本') }}</legend>
        <LocalRecoveryCopies :copies="copies" :selected-copy="selectedCopy"
          @select-copy="recovery.selectCopy($event)" @recover-copy="recovery.recoverCopy()" />
      </fieldset>
    </details>
  </section>
</template>
