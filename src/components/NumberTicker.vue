<script setup>
// 数字滚动 (Number Ticker) — 借鉴 Inspira UI, 零依赖手写。
// 数值变化时从旧值平滑过渡到新值, 强化转播计分板的跳动感。
// 用在选人进度 (已选手数) 上。尊重 prefers-reduced-motion: 直接跳到终值。
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  // 目标数值
  value: { type: Number, default: 0 },
  // 过渡时长 (ms)
  duration: { type: Number, default: 500 },
})

const display = ref(props.value)
let _raf = null
let _from = props.value
let _start = 0

const prefersReduced =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

function animate(to) {
  if (prefersReduced || props.duration <= 0) {
    display.value = to
    return
  }
  cancelAnimationFrame(_raf)
  _from = display.value
  _start = performance.now()
  const delta = to - _from
  const dur = props.duration

  const step = (now) => {
    const t = Math.min(1, (now - _start) / dur)
    // ease-out cubic: 快进慢出, 像计分板落定
    const eased = 1 - Math.pow(1 - t, 3)
    display.value = Math.round(_from + delta * eased)
    if (t < 1) {
      _raf = requestAnimationFrame(step)
    } else {
      display.value = to
    }
  }
  _raf = requestAnimationFrame(step)
}

watch(() => props.value, (to) => animate(to))

onMounted(() => {
  display.value = props.value
})
onBeforeUnmount(() => {
  cancelAnimationFrame(_raf)
})
</script>

<template>
  <span class="tnum">{{ display }}</span>
</template>
