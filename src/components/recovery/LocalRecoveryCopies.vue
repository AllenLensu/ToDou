<script setup lang="ts">
import { t } from '../../i18n'
// 共用的本地副本列表与确认区域；选择只通知上层更新副本名，另行确认才请求恢复。
// 列表中的时间和大小不是可恢复性证明；实际内容校验、保留旧库及替换由上层恢复流程执行。
import { getLocale } from '../../i18n'
import type { LocalRecoveryCopy } from '../../storage/recovery'
import { recoveryCopyTime } from '../../domain/recoveryCopyTime'

defineProps<{ copies: readonly LocalRecoveryCopy[]; selectedCopy: string | null }>()
const emit = defineEmits<{ selectCopy: [name: string | null]; recoverCopy: [] }>()
</script>

<template>
  <ul v-if="copies.length" class="recovery-copies tw:grid tw:gap-[12px] tw:m-0 tw:p-0 tw:list-none" :aria-label="t('可选本地副本')">
    <li v-for="copy in copies" :key="copy.name" class="tw:flex tw:flex-wrap tw:gap-[12px] tw:items-center tw:justify-between tw:py-[12px] tw:border-0 tw:border-b tw:border-solid tw:border-line">
      <div class="tw:min-w-0">
        <span>{{ recoveryCopyTime(copy.name)?.toLocaleString(getLocale()) ?? t('本地保留副本') }} · {{ Math.max(1, Math.ceil(copy.byteLength / 1024)) }} KB</span>
        <small class="tw:block tw:[overflow-wrap:anywhere] tw:text-muted tw:[font:var(--type-label)_var(--font-data)]">{{ copy.name }}</small>
      </div>
      <button class="button button-quiet touch-target tw:min-h-[44px] tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:text-text tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:[&:hover:not(:active):not(:disabled)]:opacity-[.78] tw:active:opacity-100 tw:disabled:cursor-wait tw:disabled:opacity-50 tw:border tw:border-solid tw:border-control-border tw:bg-transparent tw:[&:hover:not(:active)]:border-text tw:[&:hover]:text-text-display tw:active:border-text-display tw:active:text-text-display" type="button" :aria-label="t('选择副本 {0}', copy.name)" :aria-pressed="selectedCopy === copy.name" @click="emit('selectCopy', copy.name)">{{ t('选择此副本') }}</button>
    </li>
  </ul>
  <p v-else class="field-help tw:text-dim tw:text-label tw:leading-[1.5]">{{ t('尚未找到本地副本。可以选择之前导出的 .todou.json 文件。') }}</p>
  <div v-if="selectedCopy" class="import-review tw:grid tw:gap-[12px] tw:mt-md tw:py-[20px] tw:px-0 tw:border-0 tw:border-y tw:border-solid tw:border-line" role="region" :aria-label="t('确认恢复本地副本')">
    <h3 class="tw:text-text-display tw:text-body tw:font-normal">{{ t('确认恢复此副本') }}</h3>
    <p class="import-file-name tw:[overflow-wrap:anywhere] tw:text-muted tw:[font:var(--type-label)_var(--font-data)]">{{ selectedCopy }}</p>
    <p class="field-help tw:text-dim tw:text-label tw:leading-[1.5]">{{ t('恢复时会先检查副本，保留当前数据库，再用所选副本替换本机数据，并暂停同步。') }}</p>
    <div class="reminder-actions tw:flex tw:flex-wrap tw:gap-xs tw:justify-end tw:le-820:justify-start">
      <button class="button button-quiet touch-target tw:min-h-[44px] tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:text-text tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:[&:hover:not(:active):not(:disabled)]:opacity-[.78] tw:active:opacity-100 tw:disabled:cursor-wait tw:disabled:opacity-50 tw:border tw:border-solid tw:border-control-border tw:bg-transparent tw:[&:hover:not(:active)]:border-text tw:[&:hover]:text-text-display tw:active:border-text-display tw:active:text-text-display" type="button" @click="emit('selectCopy', null)">{{ t('取消恢复') }}</button>
      <button class="button button-primary touch-target tw:min-h-[44px] tw:rounded-[999px] tw:py-[10px] tw:px-[18px] tw:font-data tw:text-label tw:font-bold tw:leading-[normal] tw:tracking-[.06em] tw:uppercase tw:[transition:opacity_var(--motion-fast)_var(--ease-out),border-color_var(--motion-fast)_var(--ease-out),color_var(--motion-fast)_var(--ease-out),background-color_var(--motion-fast)_var(--ease-out)] tw:active:opacity-100 tw:disabled:cursor-wait tw:disabled:opacity-50 tw:border-0 tw:bg-text-display tw:text-bg tw:[&:hover]:opacity-[.86] tw:active:bg-text tw:[&:active:hover]:opacity-[.86] tw:[&:disabled:hover]:opacity-[.86]" type="button" @click="emit('recoverCopy')">{{ t('保留当前文件并恢复副本') }}</button>
    </div>
  </div>
</template>
