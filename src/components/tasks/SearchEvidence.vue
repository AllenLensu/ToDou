<script setup lang="ts">
import { t } from '../../i18n'

// 命中线索始终通过文本插值渲染，原文中的 HTML 不作为标记执行。
import { computed } from 'vue'
import { searchEvidence, type SearchDocument } from '../../domain/taskSearch'
const props = defineProps<{ document?: SearchDocument; tokens: readonly string[] }>()
// 领域层负责截取上下文与命中分段；这里只按 match 包裹 mark，标签和片段正文均保持文本插值。
const evidence = computed(() => props.document ? searchEvidence(props.document, props.tokens) : [])
</script>

<template>
  <div v-if="evidence.length" class="search-evidence tw:mt-xs tw:text-muted tw:text-label tw:leading-[1.6] tw:[overflow-wrap:anywhere]" :aria-label="t('命中线索')">
    <p v-for="(item, index) in evidence" :key="index" class="tw:mt-2xs tw:mx-0 tw:mb-0">
      <span class="search-source tw:text-text">{{ t('{0}：', item.label) }}</span>
      <template v-for="(part, partIndex) in item.parts" :key="partIndex"><mark v-if="part.match" class="tw:text-text-display tw:bg-surface-raised tw:underline tw:underline-offset-[3px]">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template>
    </p>
  </div>
</template>
