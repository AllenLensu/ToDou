<script setup lang="ts">
import { computed } from 'vue'
import { getLocale, t } from '../../i18n'
import SpringValue from '../ui/SpringValue.vue'

const props = defineProps<{
  counts: { open: number; overdue: number; today: number }
  nextReminder: number | null
  now: Date
  reminding: boolean
}>()
const nextDate = computed(() => props.nextReminder === null ? null : new Date(props.nextReminder))
const nextLabel = computed(() => {
  const date = nextDate.value
  if (!date) return ''
  const time = date.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return date.toDateString() === props.now.toDateString() ? time : date.toLocaleDateString(getLocale(), { month: 'numeric', day: 'numeric' }) + ' ' + time
})

// 大字号待处理计数按两位数定宽以贴合标题宽度，小字号统计保留五位槽位稳定列宽。
const openCountColumns = 2
const remindingOpenColumns = 4
const statCountColumns = 5

function fitCount(count: number, columns = statCountColumns) {
  return { '--topbar-count-scale': Math.min(1, columns / String(count).length) }
}
</script>

<template>
  <header class="topbar" :class="{ 'has-reminder': reminding }" :style="{ '--topbar-open-columns': openCountColumns, '--topbar-count-columns': statCountColumns }">
    <div class="topbar-brand">
      <h1 class="topbar-title">TODOU</h1>
      <p class="lede">From To-Do to Ta-Da.</p>
    </div>
    <div class="topbar-meta">
      <span class="meta-label">{{ t('OPEN ITEMS') }}</span>
      <strong class="topbar-count"><SpringValue :value="counts.open" class="topbar-number" :style="fitCount(counts.open, reminding ? remindingOpenColumns : openCountColumns)" /></strong>
    </div>
    <dl class="topbar-stats" :aria-label="t('清单统计')">
      <div class="topbar-stat-item">
        <dt>{{ t('逾期') }}</dt>
        <dd class="topbar-stat-value" :class="{ 'is-overdue': counts.overdue }">
          <SpringValue :value="counts.overdue" class="topbar-number" :style="fitCount(counts.overdue)" />
        </dd>
      </div>
      <div class="topbar-stat-item" :title="t('按「今天」视图统计，含逾期未结束的任务')">
        <dt>{{ t('今天') }}</dt>
        <dd class="topbar-stat-value"><SpringValue :value="counts.today" class="topbar-number" :style="fitCount(counts.today)" /></dd>
      </div>
      <div class="topbar-stat-item">
        <dt>{{ t('下一提醒') }}</dt>
        <dd class="topbar-stat-value topbar-reminder-value">
          <SpringValue :value="nextLabel || '—'">
            <time v-if="nextDate" :datetime="nextDate.toISOString()" :title="nextDate.toLocaleString(getLocale())">{{ nextLabel }}</time>
            <span v-else :aria-label="t('暂无提醒')">—</span>
          </SpringValue>
        </dd>
      </div>
    </dl>
  </header>
</template>

<style scoped>
.topbar {
  display: grid;
  grid-template-columns: minmax(8rem, 1fr) auto auto;
  align-items: center;
  gap: var(--space-md);
  padding-bottom: var(--space-sm);
}
.topbar-title {
  color: var(--text-display);
  font: 500 2rem / 1 var(--font-ui);
  letter-spacing: -.055em;
}
.lede { margin-top: var(--space-2xs); font-size: var(--type-label); color: var(--muted); }
.topbar-meta { min-width: 0; }
.meta-label, .topbar-stats { font: var(--type-label) / 1.5 var(--font-data); color: var(--muted); }
.meta-label { letter-spacing: .08em; }
.topbar-count, .topbar-stat-value {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.topbar-stat-value { inline-size: calc(1ch * var(--topbar-count-columns)); }
.topbar-number { font-size: calc(var(--topbar-value-size, 1em) * var(--topbar-count-scale)); }
.topbar-count {
  display: block;
  inline-size: calc(1ch * var(--topbar-open-columns));
  color: var(--text-display);
  font: normal clamp(2.5rem, 4vw, 3.5rem) / 1 var(--font-display);
  letter-spacing: -.06em;
  font-variation-settings: 'ROND' 100, 'wght' 500;
}
.has-reminder .topbar-count .topbar-number {
  --topbar-value-size: var(--type-body);
  font-family: var(--font-data);
  line-height: 1.5;
  letter-spacing: 0;
}
.topbar-stats {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-xs) var(--space-md);
  margin: 0;
  padding-inline-start: var(--space-md);
  border-inline-start: 1px solid var(--line-visible);
}
.topbar-stat-value { margin: 2px 0 0; color: var(--text); }
/* 中英文最长的短日期和时间是 12/31 23:59。 */
.topbar-reminder-value { inline-size: 11ch; }
.topbar-stats .is-overdue { color: var(--accent-text); }
.has-reminder .topbar-stats .is-overdue { color: var(--muted); }
@media (max-width: 820px) {
  .topbar { grid-template-columns: auto minmax(0, 1fr); gap: var(--space-xs); }
  .lede { display: none; }
  .topbar-title { font-size: 1.5rem; }
  .topbar-count { flex: none; font-size: 2.25rem; text-align: end; }
  .topbar-meta { display: flex; justify-content: end; align-items: baseline; gap: var(--space-xs); }
  .meta-label { letter-spacing: .02em; }
  .topbar-stats { grid-column: 1 / -1; gap: 2px var(--space-sm); border: 0; padding: 0; }
  .topbar-stat-item { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2xs); }
  .topbar-stat-value { flex: none; margin: 0; }
}
</style>
