<script setup lang="ts">
import { computed } from 'vue'
import { getLocale, t } from '../../i18n'
import { syncFeedbackText } from '../../sync/connectionFeedback'
import type { SharedRestoreControls } from '../../composables/useSharedRestore'
import { useOptionalCloudSync } from '../../composables/workspaceContexts'

const props = defineProps<{ restore?: SharedRestoreControls; paused?: boolean; accepted?: string }>()
const cloud = useOptionalCloudSync()
const restore = computed(() => {
  const resolved = props.restore ?? cloud?.sharedRestore
  if (!resolved) throw new Error('SharedRestorePanel requires restore controls or CloudSyncContext')
  return resolved
})
const paused = computed(() => props.paused ?? cloud?.sync.status?.paused === true)
const accepted = computed(() => props.accepted ?? cloud?.sync.status?.restoreId)
</script>

<template>
  <details class="shared-restore">
    <summary class="disclosure-summary">{{ t('跨设备整体恢复') }}</summary>
    <fieldset class="restore-stack" :disabled="restore.busy">
      <legend class="sr-only">{{ t('跨设备整体恢复') }}</legend>
      <p class="restore-note">{{ t('每台设备确认后会保留本机副本，再以所选快照替换当前清单。旧版应用继续在旧清单同步。') }}</p>
      <div class="actions">
        <button class="action-button" type="button" @click="restore.inspect()">{{ t('查看网盘中的恢复版本') }}</button>
        <button v-if="paused" class="action-button" type="button" @click="restore.propose()">{{ t('预览发布本机恢复结果') }}</button>
      </div>
      <div v-for="id in restore.heads" :key="id" class="actions">
        <span>{{ t('版本 {0} · {1}', Number(id.slice(0,10)), id.slice(11,19)) }}</span>
        <button v-if="id !== accepted || restore.heads.length > 1" class="action-button" type="button" @click="restore.preview(id)">{{ t('预览此版本') }}</button>
        <span v-else>{{ t('本机已接受') }}</span>
      </div>
      <section v-if="restore.summary" class="restore-stack" :aria-label="t('整体恢复确认')">
        <p class="restore-note">{{ t('快照时间 {0}。包含 {1} 条任务、{2} 个检查项、{3} 条历史、{4} 个分类和 {5} 个标签。', new Date(restore.summary.at).toLocaleString(getLocale()), restore.summary.tasks, restore.summary.checklistItems, restore.summary.history, restore.summary.categories, restore.summary.tags) }}</p>
        <ul v-if="restore.summary.titles.length" class="restore-titles" :aria-label="t('快照中的前五条任务')">
          <li v-for="(title, index) in restore.summary.titles" :key="index">{{ title }}</li>
        </ul>
        <p v-if="restore.summary.mode === 'receive'" class="restore-note">{{ t('确认后替换本机清单，晚于快照的本机内容可从保护副本找回。同步将暂停。') }}</p>
        <p v-else class="restore-note">{{ t('确认后此快照将成为当前网盘目录的共享恢复版本。各设备原有修改保留在旧版本，均须单独确认才会转入新版本。') }}</p>
        <div class="actions">
          <button class="action-button" type="button" @click="restore.cancel()">{{ t('取消') }}</button>
          <button class="action-button is-danger" type="button" @click="restore.confirm()">{{ restore.summary.mode === 'receive' ? t('保留本机副本并替换') : t('确认发布此快照') }}</button>
        </div>
      </section>
    </fieldset>
    <p v-if="restore.message || restore.busy" class="restore-note" role="status">{{ restore.busy ? t('正在处理共享恢复…') : syncFeedbackText(restore.message) }}</p>
  </details>
</template>

<style scoped>
.shared-restore { border-top: 1px solid var(--line); margin-block: 12px; }
.restore-stack { display: grid; gap: 12px; min-width: 0; margin: 0; padding: 0; border: 0; }
.restore-note { color: var(--muted); overflow-wrap: anywhere; }
.restore-titles { margin: 0; padding-inline-start: 1.4em; overflow-wrap: anywhere; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
</style>
