<script setup lang="ts">
import { feedbackText, t } from '../../i18n'
// 本地库未就绪或无法继续保存时的恢复入口；选择文件只请求预览，必须另行确认替换。
// 保留当前文件、暂停同步与恢复后的草稿处理由工作区协调。
import { computed, useTemplateRef } from 'vue'
import type { LocalRecoveryControls } from '../../composables/useLocalRecovery'
import LocalRecoveryCopies from './LocalRecoveryCopies.vue'

const props = defineProps<{ recovery: LocalRecoveryControls; saving: boolean }>()
const copies = computed(() => props.recovery.copies.value)
const selectedCopy = computed(() => props.recovery.selectedCopy.value)
const pendingImport = computed(() => props.recovery.pendingImport.value)
const busy = computed(() => props.recovery.busy.value || props.recovery.importBusy.value || props.saving)
const error = computed(() => props.recovery.error.value || props.recovery.importError.value)
const input = useTemplateRef<HTMLInputElement>('input')

function chooseFile(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (file) void props.recovery.previewImport(file)
}
</script>

<template>
  <section class="local-recovery tw:grid tw:gap-sm tw:max-w-[760px] tw:mt-md tw:mb-[40px] tw:leading-[1.6]" aria-labelledby="recovery-title">
    <span class="section-kicker tw:font-data tw:tracking-[.08em] tw:uppercase tw:text-muted tw:text-label tw:mt-0 tw:mx-0 tw:mb-sm">{{ t('DATA RECOVERY') }}</span>
    <h2 id="recovery-title" class="tw:text-text-display tw:text-body tw:font-normal">{{ t('恢复本地数据') }}</h2>
    <p>{{ t('当前数据暂时无法继续保存。可以先重试打开，或使用已有导出和本地副本恢复。恢复前会保留当前文件；无法保留时会停止恢复。') }}</p>
    <p class="field-help tw:text-dim tw:text-label tw:leading-[1.5]">{{ t('未保存的任务内容会留在草稿中，恢复后请检查并手动保存。') }}</p>
    <p v-if="error" class="inline-status error tw:min-h-[24px] tw:font-data tw:text-label tw:font-normal tw:leading-[normal] tw:tracking-[.03em] tw:text-accent-text" role="alert">{{ feedbackText(error) }}</p>
    <fieldset class="recovery-controls tw:grid tw:gap-sm tw:min-w-0 tw:m-0 tw:p-0 tw:border-0" :disabled="busy">
      <legend class="sr-only">{{ t('恢复本地数据') }}</legend>
      <div class="reminder-actions tw:flex tw:flex-wrap tw:gap-xs tw:justify-end tw:le-820:justify-start">
        <button class="button button-secondary touch-target tw:min-h-[44px] tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:text-text tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:[&:hover:not(:active):not(:disabled)]:opacity-[.78] tw:active:opacity-100 tw:disabled:cursor-wait tw:disabled:opacity-50 tw:border tw:border-solid tw:border-control-border tw:bg-surface-raised tw:active:border-text-display tw:active:text-text-display" type="button" @click="input?.click()">{{ t('选择导出文件恢复') }}</button>
        <button class="button button-quiet touch-target tw:min-h-[44px] tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:text-text tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:[&:hover:not(:active):not(:disabled)]:opacity-[.78] tw:active:opacity-100 tw:disabled:cursor-wait tw:disabled:opacity-50 tw:border tw:border-solid tw:border-control-border tw:bg-transparent tw:[&:hover:not(:active)]:border-text tw:[&:hover]:text-text-display tw:active:border-text-display tw:active:text-text-display" type="button" @click="recovery.loadCopies()">{{ t('重新查找本地副本') }}</button>
        <input id="todou-recovery-import" ref="input" hidden type="file" accept=".todou.json,application/json" :aria-label="t('选择恢复用的导出文件')" @change="chooseFile" />
      </div>
      <div v-if="pendingImport" class="import-review tw:grid tw:gap-[12px] tw:mt-md tw:py-[20px] tw:px-0 tw:border-0 tw:border-y tw:border-solid tw:border-line" role="region" :aria-label="t('确认使用导出文件恢复')">
        <h3 class="tw:text-text-display tw:text-body tw:font-normal">{{ t('使用导出文件恢复') }}</h3>
        <p class="import-file-name tw:[overflow-wrap:anywhere] tw:text-muted tw:[font:var(--type-label)_var(--font-data)]">{{ pendingImport.name }}</p>
        <p>{{ t('{0} 条任务 · {1} 个检查项 · {2} 条历史', pendingImport.summary.tasks, pendingImport.summary.checklistItems, pendingImport.summary.history) }}</p>
        <div class="reminder-actions tw:flex tw:flex-wrap tw:gap-xs tw:justify-end tw:le-820:justify-start">
          <button class="button button-quiet touch-target tw:min-h-[44px] tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:text-text tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:[&:hover:not(:active):not(:disabled)]:opacity-[.78] tw:active:opacity-100 tw:disabled:cursor-wait tw:disabled:opacity-50 tw:border tw:border-solid tw:border-control-border tw:bg-transparent tw:[&:hover:not(:active)]:border-text tw:[&:hover]:text-text-display tw:active:border-text-display tw:active:text-text-display" type="button" @click="recovery.cancelImport()">{{ t('取消恢复') }}</button>
          <button class="button button-primary touch-target tw:min-h-[44px] tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:active:opacity-100 tw:disabled:cursor-wait tw:disabled:opacity-50 tw:border-0 tw:bg-text-display tw:text-bg tw:[&:hover]:opacity-[.86] tw:active:bg-text tw:[&:active:hover]:opacity-[.86] tw:[&:disabled:hover]:opacity-[.86]" type="button" @click="recovery.confirmImport()">{{ t('保留当前文件并恢复') }}</button>
        </div>
      </div>
      <LocalRecoveryCopies :copies="copies" :selected-copy="selectedCopy"
        @select-copy="recovery.selectCopy($event)" @recover-copy="recovery.recoverCopy()" />
      <p v-if="busy" role="status">{{ t('正在检查并恢复，请保持窗口打开。') }}</p>
    </fieldset>
  </section>
</template>
