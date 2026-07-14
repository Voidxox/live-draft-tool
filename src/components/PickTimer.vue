<script setup>
import { computed } from 'vue'

const props = defineProps({
  remaining: { type: Number, default: 0 },
  total: { type: Number, default: 30 },
  running: { type: Boolean, default: false },
})

const pct = computed(() => {
  if (props.total <= 0) return 0
  return Math.max(0, Math.min(100, (props.remaining / props.total) * 100))
})

const urgent = computed(() => props.running && props.remaining <= 5 && props.remaining > 0)
const expired = computed(() => props.total > 0 && props.remaining <= 0)

const label = computed(() => {
  const s = Math.max(0, props.remaining)
  return `0:${String(s).padStart(2, '0')}`
})
</script>

<template>
  <div class="timer" :class="{ urgent, expired }" role="timer" :aria-label="`剩余 ${remaining} 秒`">
    <svg class="ring" viewBox="0 0 44 44" aria-hidden="true">
      <circle class="track" cx="22" cy="22" r="19" />
      <circle
        class="fill"
        cx="22"
        cy="22"
        r="19"
        :stroke-dasharray="119.4"
        :stroke-dashoffset="119.4 * (1 - pct / 100)"
      />
    </svg>
    <span class="value">{{ label }}</span>
  </div>
</template>

<style scoped>
.timer {
  position: relative;
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}

.ring {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.track {
  fill: none;
  stroke: var(--border);
  stroke-width: 4;
}

.fill {
  fill: none;
  stroke: var(--accent);
  stroke-width: 4;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.98s linear, stroke 0.2s ease-out;
}

.value {
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text);
  z-index: 1;
}

.timer.urgent .fill {
  stroke: var(--danger);
}

.timer.urgent .value {
  color: var(--danger);
  animation: pulse 1s ease-in-out infinite;
}

.timer.expired .fill {
  stroke: var(--danger);
}

.timer.expired .value {
  color: var(--danger);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

@media (prefers-reduced-motion: reduce) {
  .fill { transition: none; }
  .timer.urgent .value { animation: none; }
}
</style>
