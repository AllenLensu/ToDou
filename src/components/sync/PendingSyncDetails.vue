<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import type { DeviceSyncControls } from '../../composables/useDeviceSync'
import type { PendingDetail } from '../../storage/pendingSyncDetails'
import { getLocale, t } from '../../i18n'

const props = defineProps<{ sync: DeviceSyncControls }>()
const groups = computed(() => {
  const result = new Map<string, { label: string; fields: number; entries: PendingDetail[] }>()
  for (const row of props.sync.details.page?.entries ?? []) {
    const key = JSON.stringify([row.groupKind, row.groupId])
    let group = result.get(key)
    if (!group) {
      group = { label: label(row.groupKind, row.groupTitle, row.groupId), fields: row.groupFields, entries: [] }
      result.set(key, group)
    }
    group.entries.push(row)
  }
  return result
})

const kinds = computed(() => ({
  tasks: t('任务'), checklistItems: t('检查项'), tags: t('标签'), categories: t('分类'),
  relations: t('关联'), history: t('历史'), settings: t('设置'),
}))
function label(kind: PendingDetail['kind'], title: string | null, id: string) {
  if (title) return kind === 'tasks' ? title : kinds.value[kind] + ' · ' + title
  if (id === 'default_completion_strategy') return t('默认父任务完成策略')
  if (id === 'default_follow_up_minutes') return t('全局追提醒间隔（分钟）')
  if (!id) return kinds.value[kind]
  const name = kind === 'tasks' ? t('已删除任务') : kind === 'checklistItems' ? t('已删除检查项') : kinds.value[kind]
  return name + ' · ' + id.slice(0, 8)
}
function memberLabel(row: PendingDetail) {
  return row.groupKind === row.kind && row.groupId === row.id ? kinds.value[row.kind] : label(row.kind, row.title, row.id)
}
onBeforeUnmount(() => props.sync.details.setExpanded(false))
</script>

<template>
  <div v-if="sync.status" class="pending-summary">
    <span>{{ t('上次成功 {0} · 待上传 {1} 项字段改动', sync.status.lastSuccess ? new Date(sync.status.lastSuccess).toLocaleString(getLocale()) : t('尚无记录'), sync.status.pending) }}</span>
    <button type="button" class="action-button is-quiet" :aria-expanded="sync.details.expanded" :aria-controls="sync.details.expanded ? 'pending-upload-details' : undefined"
      @click="sync.details.setExpanded(!sync.details.expanded)">
      {{ sync.details.expanded ? t('收起待上传明细') : t('查看待上传明细') }}
    </button>
  </div>
  <section v-if="sync.details.expanded && sync.status" id="pending-upload-details" :aria-label="t('待上传明细')" class="pending-details">
    <template v-if="sync.details.page">
      <p role="status">{{ t('{0} 项字段改动 · 涉及 {1} 个任务', sync.details.page.pending, sync.details.page.taskCount) }}</p>
      <details v-for="[key, group] of groups" :key="key" class="pending-group">
        <summary class="disclosure-summary">{{ group.label }} · {{ t('{0} 项字段改动', group.fields) }}</summary>
        <ul>
          <li v-for="entry in group.entries" :key="JSON.stringify([entry.kind, entry.id])">
            {{ memberLabel(entry) }} · {{ t('{0} 项字段改动', entry.fields) }}
          </li>
        </ul>
      </details>
      <p class="pending-note">{{ t('上传完成表示网盘已收到该版本。其他设备会在各自同步时接收。') }}</p>
    </template>
    <p v-if="sync.details.loading" role="status">{{ t('正在读取待上传明细…') }}</p>
    <p v-if="sync.details.failed" role="alert">{{ t('无法读取待上传明细。') }} <button type="button" class="action-button is-quiet" @click="sync.details.retry">{{ t('重试') }}</button></p>
    <button v-else-if="sync.details.page?.nextOffset != null" type="button" class="action-button is-quiet" :disabled="sync.details.loading" @click="sync.details.loadMore">{{ t('加载更多明细') }}</button>
  </section>
</template>

<style scoped>
.pending-summary, .pending-details { font-size: var(--type-label); overflow-wrap: anywhere; }
.pending-summary { display: flex; flex-wrap: wrap; gap: 0 var(--space-sm); align-items: center; color: var(--dim); margin-top: var(--space-sm); }
.pending-details { margin-bottom: var(--space-md); }
.pending-group { border-top: 1px solid var(--line); }
.pending-group ul { margin: 0 0 .75rem; padding-inline-start: 1.5rem; }
.pending-note { color: var(--dim); }
</style>
