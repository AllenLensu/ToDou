<script setup lang="ts">
import { t } from '../../i18n'

/**
 * 当前任务的详情壳层：empty 不渲染，create 只展示表单，edit 且非回收站才展示检查项和历史。
 * 窄屏由父层展开状态配合列表组件隐藏列表；共享 ID 供焦点编排使用，本组件不自行移动焦点。
 * 返回只发出 close，由工作区先提交已有任务草稿；新任务有未保存修改或保存失败时保留草稿并等待离开确认。
 */
import { DETAIL_HEADING_ID, WORKSPACE_DETAIL_ID, focusVisible } from '../../composables/useWorkspaceFocus'

const checklistTitleId = 'todou-checklist-title'
function focusChecklist() {
  focusVisible(document.getElementById(checklistTitleId))
}

function prepareLeave(panel: Element) {
  panel.setAttribute('inert', '')
  // 淡出期间保留详情位置，让焦点先回到列表。
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    panel.classList.add('task-detail-exiting')
  }
}

defineProps<{
  mode: 'empty' | 'create' | 'edit'
  inTrash: boolean
}>()

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <Transition name="task-detail" @before-leave="prepareLeave">
    <section v-if="mode !== 'empty'" :id="WORKSPACE_DETAIL_ID" class="editor-column task-detail tw:pt-lg tw:le-820:pt-sm tw:le-820:pb-md tw:le-820:px-0" :aria-labelledby="DETAIL_HEADING_ID">
      <div class="section-heading editor-heading tw:flex tw:justify-between tw:items-baseline tw:gap-md tw:mb-lg">
        <div>
          <span class="section-kicker tw:font-data tw:tracking-[.08em] tw:uppercase tw:text-muted tw:text-label tw:mt-0 tw:mx-0 tw:mb-sm">{{ t('TASK NOTE') }}</span>
          <h2 :id="DETAIL_HEADING_ID" class="tw:text-text-display tw:text-body tw:font-normal tw:tracking-[-.02em] tw:leading-[1.2]" tabindex="-1">{{ mode === 'edit' ? t('编辑任务') : t('新任务') }}</h2>
        </div>
        <div class="tw:flex tw:items-center tw:gap-xs">
          <button v-if="mode === 'edit' && !inTrash" type="button" :aria-controls="checklistTitleId"
            class="touch-target tw:min-h-[44px] tw:px-xs tw:border-0 tw:bg-transparent tw:text-muted tw:text-label tw:underline tw:whitespace-nowrap tw:hover:text-text-display"
            @click="focusChecklist">{{ t('添加检查项') }}</button>
          <button class="button button-quiet touch-target" type="button" :aria-label="t('关闭任务详情，返回列表')" :title="t('返回列表（Esc）')" @click="emit('close')">{{ t('返回') }}</button>
        </div>
      </div>
      <slot />
      <slot v-if="mode === 'edit' && !inTrash" name="extras" />
    </section>
  </Transition>
</template>
