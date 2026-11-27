<script setup lang="ts">
// 空态线条插图：遵循 Nothing 单色几何与点阵语义，纯装饰（aria-hidden），随主题自动适配明暗色。
defineProps<{
  kind: 'all' | 'today' | 'upcoming' | 'done' | 'search' | 'trash'
}>()
</script>

<template>
  <svg
    class="empty-state-artwork"
    width="72"
    height="56"
    viewBox="0 0 72 56"
    fill="none"
    aria-hidden="true"
    focusable="false"
    :data-empty-artwork="kind"
  >
    <!-- 全部任务为空：极简架构框线 + 三条索引横线 + 点阵标尺 -->
    <template v-if="kind === 'all'">
      <rect x="10" y="8" width="52" height="40" rx="4" stroke="var(--line-visible)" stroke-width="1.5" />
      <circle cx="20" cy="19" r="3" stroke="currentColor" stroke-width="1.5" />
      <line x1="28" y1="19" x2="52" y2="19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      <circle cx="20" cy="29" r="1.25" fill="currentColor" opacity="0.55" />
      <line x1="28" y1="29" x2="46" y2="29" stroke="var(--line-visible)" stroke-width="1.5" stroke-linecap="round" />
      <circle cx="20" cy="39" r="1.25" fill="currentColor" opacity="0.4" />
      <line x1="28" y1="39" x2="40" y2="39" stroke="var(--line-visible)" stroke-width="1.5" stroke-linecap="round" />
      <circle cx="52" cy="39" r="1.25" fill="currentColor" opacity="0.45" />
      <circle cx="56" cy="39" r="1.25" fill="currentColor" opacity="0.25" />
    </template>

    <!-- 今日为空：地平线 + 子午弧线 + 刻度点阵 -->
    <template v-else-if="kind === 'today'">
      <line x1="8" y1="38" x2="64" y2="38" stroke="var(--line-visible)" stroke-width="1.5" stroke-linecap="round" />
      <path d="M 18 38 A 18 18 0 0 1 54 38" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      <line x1="36" y1="12" x2="36" y2="16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      <line x1="19" y1="19" x2="22" y2="22" stroke="var(--line-visible)" stroke-width="1.5" stroke-linecap="round" />
      <line x1="53" y1="19" x2="50" y2="22" stroke="var(--line-visible)" stroke-width="1.5" stroke-linecap="round" />
      <circle cx="36" cy="38" r="2.25" fill="currentColor" />
      <circle cx="24" cy="45" r="1.25" fill="currentColor" opacity="0.35" />
      <circle cx="36" cy="45" r="1.25" fill="currentColor" opacity="0.55" />
      <circle cx="48" cy="45" r="1.25" fill="currentColor" opacity="0.35" />
    </template>

    <!-- 即将到来为空：七日时间刻度标尺 -->
    <template v-else-if="kind === 'upcoming'">
      <line x1="10" y1="28" x2="62" y2="28" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      <line x1="12" y1="19" x2="12" y2="33" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      <line x1="20" y1="23" x2="20" y2="28" stroke="var(--line-visible)" stroke-width="1.5" stroke-linecap="round" />
      <line x1="28" y1="23" x2="28" y2="28" stroke="var(--line-visible)" stroke-width="1.5" stroke-linecap="round" />
      <line x1="36" y1="19" x2="36" y2="33" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      <line x1="44" y1="23" x2="44" y2="28" stroke="var(--line-visible)" stroke-width="1.5" stroke-linecap="round" />
      <line x1="52" y1="23" x2="52" y2="28" stroke="var(--line-visible)" stroke-width="1.5" stroke-linecap="round" />
      <line x1="60" y1="19" x2="60" y2="33" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      <circle cx="20" cy="39" r="1.25" fill="currentColor" opacity="0.45" />
      <circle cx="28" cy="39" r="1.25" fill="currentColor" opacity="0.45" />
      <circle cx="44" cy="39" r="1.25" fill="currentColor" opacity="0.45" />
      <circle cx="52" cy="39" r="1.25" fill="currentColor" opacity="0.45" />
    </template>

    <!-- 已结束为空：双环刻度与单线完成折线 -->
    <template v-else-if="kind === 'done'">
      <circle cx="36" cy="28" r="18" stroke="var(--line-visible)" stroke-width="1.5" stroke-dasharray="3 4" />
      <circle cx="36" cy="28" r="11" stroke="currentColor" stroke-width="1.5" />
      <polyline points="31,28 34.5,31.5 41.5,24.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="12" cy="28" r="1.25" fill="currentColor" opacity="0.4" />
      <circle cx="60" cy="28" r="1.25" fill="currentColor" opacity="0.4" />
    </template>

    <!-- 搜索无结果：几何十字标尺与扫描镜框 -->
    <template v-else-if="kind === 'search'">
      <circle cx="33" cy="25" r="13" stroke="currentColor" stroke-width="1.5" />
      <line x1="42.5" y1="34.5" x2="52" y2="44" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      <line x1="29" y1="25" x2="37" y2="25" stroke="var(--line-visible)" stroke-width="1.5" stroke-linecap="round" />
      <line x1="33" y1="21" x2="33" y2="29" stroke="var(--line-visible)" stroke-width="1.5" stroke-linecap="round" />
      <circle cx="14" cy="14" r="1.25" fill="currentColor" opacity="0.35" />
      <circle cx="56" cy="14" r="1.25" fill="currentColor" opacity="0.35" />
      <circle cx="14" cy="42" r="1.25" fill="currentColor" opacity="0.35" />
    </template>

    <!-- 回收站为空：开放式极简托盘与虚线顶盖 -->
    <template v-else>
      <line x1="16" y1="14" x2="56" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="4 4" />
      <line x1="30" y1="10" x2="42" y2="10" stroke="var(--line-visible)" stroke-width="1.5" stroke-linecap="round" />
      <path d="M 21 19 L 24 46 L 48 46 L 51 19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      <line x1="31" y1="25" x2="31" y2="39" stroke="var(--line-visible)" stroke-width="1.5" stroke-linecap="round" />
      <line x1="41" y1="25" x2="41" y2="39" stroke="var(--line-visible)" stroke-width="1.5" stroke-linecap="round" />
      <circle cx="36" cy="32" r="1.25" fill="currentColor" opacity="0.45" />
    </template>
  </svg>
</template>

<style scoped>
.empty-state-artwork {
  display: block;
  margin-bottom: var(--space-sm);
  color: var(--muted);
}
</style>
