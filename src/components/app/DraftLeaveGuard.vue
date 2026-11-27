<script setup lang="ts">
import { useTemplateRef, watch } from 'vue'
import { t } from '../../i18n'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  continueEditing: []
  discard: []
}>()

const continueButton = useTemplateRef<HTMLButtonElement>('continueButton')
watch(() => props.open, (isOpen) => {
  if (isOpen) continueButton.value?.focus()
}, { flush: 'post' })
</script>

<template>
  <div v-if="open" class="draft-leave-guard tw:flex tw:flex-wrap tw:items-center tw:gap-[12px] tw:py-sm tw:px-0 tw:[&_p]:basis-full tw:[&_p]:text-text" role="region" :aria-label="t('未保存修改')">
    <p role="alert">{{ t('草稿尚未保存。继续编辑，或放弃未保存修改后离开。') }}</p>
    <button ref="continueButton" class="button button-primary touch-target" type="button" @click="emit('continueEditing')">{{ t('继续编辑') }}</button>
    <button class="button button-danger touch-target" type="button" @click="emit('discard')">{{ t('放弃未保存修改') }}</button>
  </div>
</template>
