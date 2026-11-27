<script setup lang="ts">
import { computed } from 'vue'
import { getLocale, t } from '../../i18n'
import type { AgendaDay } from '../../domain/taskAgenda'

defineProps<{ days: readonly AgendaDay[] }>()
const emit = defineEmits<{ jump: [day: AgendaDay] }>()
const shortDate = computed(() => new Intl.DateTimeFormat(getLocale(), { month: 'numeric', day: 'numeric' }))
const fullDate = computed(() => new Intl.DateTimeFormat(getLocale(), { dateStyle: 'full' }))
</script>

<template>
  <div class="agenda-week" role="group" :aria-label="t('未来七天')">
    <button v-for="day in days" :key="day.date.getTime()" type="button" :disabled="!day.count"
      :aria-label="t('{0}，共 {1} 项', fullDate.format(day.date), day.count)" @click="emit('jump', day)">
      <span>{{ shortDate.format(day.date) }}</span>
      <strong>{{ day.count }}</strong>
    </button>
  </div>
</template>

<style scoped>
.agenda-week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; margin-bottom: var(--space-sm); }
.agenda-week button { display: grid; place-content: center; gap: 2px; min-height: 50px; min-width: 0; padding: 4px 0; border: 0; border-radius: 0; border-bottom: 1px solid var(--control-border); color: var(--text); background: var(--surface); font-family: var(--font-data); }
.agenda-week button:enabled:hover, .agenda-week button:focus-visible { background: var(--surface-raised); border-bottom-color: var(--text); }
.agenda-week span { color: var(--muted); font-size: var(--type-label); }
.agenda-week strong { font-size: var(--type-body); font-variant-numeric: tabular-nums; }
.agenda-week button:disabled { color: var(--muted); background: transparent; }
@media (max-width: 360px) {
  .agenda-week { grid-template-columns: repeat(7, minmax(44px, 1fr)); overflow-x: auto; }
}
</style>
