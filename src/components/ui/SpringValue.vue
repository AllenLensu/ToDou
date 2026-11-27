<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import { createUnderdampedSpring } from '../../domain/underdampedSpring'

const props = defineProps<{ value: string | number }>()
const element = useTemplateRef<HTMLElement>('value')
const duration = 400
const stepSpring = createUnderdampedSpring(400, 24)
const sampleIntervals = 24
const keyframes = Array.from({ length: sampleIntervals + 1 }, (_, frame) => {
  const seconds = (frame / sampleIntervals) * (duration / 1000)
  const y = frame === sampleIntervals ? 0 : stepSpring(0, -80, 0, seconds).position
  return { transform: `translateY(${y}px) scale(${1 - y * 0.04})` }
})
let preference: MediaQueryList | undefined
let animation: Animation | undefined

function stop() {
  animation?.cancel()
  animation = undefined
}

function onPreferenceChange() {
  if (preference?.matches) stop()
}

onMounted(() => {
  if (typeof window === 'undefined') return
  preference = window.matchMedia('(prefers-reduced-motion: reduce)')
  preference.addEventListener('change', onPreferenceChange)
})

watch(() => props.value, () => {
  if (!element.value || preference?.matches !== false) return
  stop()
  animation = element.value.animate(keyframes, duration)
}, { flush: 'post' })

onBeforeUnmount(() => {
  stop()
  preference?.removeEventListener('change', onPreferenceChange)
})
</script>

<template>
  <span ref="value" class="spring-value"><slot>{{ value }}</slot></span>
</template>

<style scoped>
.spring-value { display: inline-block; max-inline-size: 100%; transform-origin: left center; }
</style>
