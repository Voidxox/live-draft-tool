<script setup>
import { computed, ref } from 'vue'
import { MAX_TEAMS, MIN_TEAMS } from '../store/draft.js'

const props = defineProps({
  store: { type: Object, required: true },
})

const state = props.store.state

const orderModes = [
  { value: 'sequential', label: '顺序', hint: '1·2·3 | 1·2·3' },
  { value: 'snake', label: '蛇形', hint: '1·2·3 | 3·2·1' },
  { value: 'randomFirst', label: '首轮随机', hint: '随机首轮后蛇形' },
]

const timerPresets = [0, 15, 30, 45, 60]

const canStart = computed(() => props.store.availablePlayers.value.length > 0)

function onTeamCount(e) {
  props.store.setTeamCount(e.target.value)
}

// 验证选人顺序 / 分组结果: 检查各队人数是否均衡、是否有未分配
const validateResult = ref(null) // { ok, level, msg }
function validateOrder() {
  const teams = state.teams
  const counts = teams.map((t) => t.members.length)
  const assigned = counts.reduce((a, b) => a + b, 0)
  const remaining = props.store.availablePlayers.value.length
  const max = Math.max(...counts)
  const min = Math.min(...counts)
  const diff = max - min

  if (assigned === 0) {
    validateResult.value = { level: 'warn', msg: '还没有分配任何马匹,先开始选人或全随机分组。' }
    return
  }
  const parts = []
  parts.push(`已分配 ${assigned} 人`)
  if (remaining > 0) parts.push(`候选席还剩 ${remaining} 人未分配`)
  parts.push(`各队 ${min}~${max} 人`)

  if (remaining > 0) {
    validateResult.value = { level: 'warn', msg: parts.join(' · ') + '。仍有马匹未进队。' }
  } else if (diff >= 2) {
    validateResult.value = { level: 'warn', msg: parts.join(' · ') + `。人数差 ${diff},建议调整。` }
  } else {
    validateResult.value = { level: 'ok', msg: parts.join(' · ') + '。分组均衡 ✓' }
  }
}
</script>

<template>
  <section class="setup card" aria-labelledby="setup-title">
    <header class="card-head">
      <h2 id="setup-title">对战设置</h2>
      <span class="phase-pill" :data-phase="state.phase">
        {{ state.phase === 'setup' ? '待开始' : state.phase === 'drafting' ? '选人中' : '已完成' }}
      </span>
    </header>

    <div class="grid">
      <label class="field">
        <span class="field-label">队伍数量</span>
        <div class="stepper">
          <button
            type="button"
            class="ghost-btn"
            :disabled="state.config.teamCount <= MIN_TEAMS"
            aria-label="减少队伍"
            @click="store.setTeamCount(state.config.teamCount - 1)"
          >
            −
          </button>
          <input
            class="stepper-input tnum"
            type="number"
            :min="MIN_TEAMS"
            :max="MAX_TEAMS"
            :value="state.config.teamCount"
            aria-label="队伍数量"
            @change="onTeamCount"
          />
          <button
            type="button"
            class="ghost-btn"
            :disabled="state.config.teamCount >= MAX_TEAMS"
            aria-label="增加队伍"
            @click="store.setTeamCount(state.config.teamCount + 1)"
          >
            +
          </button>
        </div>
      </label>

      <label class="field">
        <span class="field-label">每排卡片</span>
        <div class="stepper">
          <button
            type="button"
            class="ghost-btn"
            :disabled="state.config.cardsPerRow <= 2"
            aria-label="减少每排卡片"
            @click="state.config.cardsPerRow = Math.max(2, state.config.cardsPerRow - 1)"
          >
            −
          </button>
          <input
            class="stepper-input tnum"
            type="number"
            min="2"
            max="8"
            v-model.number="state.config.cardsPerRow"
            aria-label="每排卡片数"
          />
          <button
            type="button"
            class="ghost-btn"
            :disabled="state.config.cardsPerRow >= 8"
            aria-label="增加每排卡片"
            @click="state.config.cardsPerRow = Math.min(8, state.config.cardsPerRow + 1)"
          >
            +
          </button>
        </div>
      </label>
    </div>

    <div class="field">
      <span class="field-label">选人顺序</span>
      <div class="segmented" role="radiogroup" aria-label="选人顺序模式">
        <button
          v-for="m in orderModes"
          :key="m.value"
          type="button"
          role="radio"
          :aria-checked="state.config.orderMode === m.value"
          class="segment"
          :class="{ active: state.config.orderMode === m.value }"
          @click="state.config.orderMode = m.value"
        >
          <span class="segment-label">{{ m.label }}</span>
          <span class="segment-hint tnum">{{ m.hint }}</span>
        </button>
      </div>
    </div>

    <div class="field">
      <span class="field-label">每手计时（秒）</span>
      <div class="segmented" role="radiogroup" aria-label="每手计时">
        <button
          v-for="t in timerPresets"
          :key="t"
          type="button"
          role="radio"
          :aria-checked="state.config.pickTimer === t"
          class="segment compact"
          :class="{ active: state.config.pickTimer === t }"
          @click="state.config.pickTimer = t"
        >
          {{ t === 0 ? '关闭' : t }}
        </button>
      </div>
    </div>

    <div class="actions">
      <button
        type="button"
        class="btn primary"
        :disabled="!canStart"
        @click="store.startDraft()"
      >
        {{ state.phase === 'setup' ? '开始选人' : '重新开始' }}
      </button>
      <button
        type="button"
        class="btn subtle"
        :disabled="!canStart"
        @click="store.randomAssignAll()"
      >
        全随机分组
      </button>
      <button
        v-if="state.phase !== 'setup'"
        type="button"
        class="btn ghost"
        @click="store.resetDraft()"
      >
        清除分组
      </button>
      <button
        type="button"
        class="btn ghost"
        :disabled="!canStart && !state.teams.some((t) => t.members.length)"
        @click="validateOrder"
      >
        验证选人顺序
      </button>
    </div>

    <p
      v-if="validateResult"
      class="validate-result"
      :class="validateResult.level"
      role="status"
      aria-live="polite"
    >
      {{ validateResult.msg }}
    </p>
  </section>
</template>

<style scoped>
.setup {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.card-head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}

.phase-pill {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--text-muted);
  border: 1px solid var(--border);
}
.phase-pill[data-phase='drafting'] {
  color: var(--gold);
  border-color: var(--gold-border);
  background: var(--gold-soft);
}
.phase-pill[data-phase='done'] {
  color: var(--success);
  border-color: color-mix(in srgb, var(--success) 40%, transparent);
  background: color-mix(in srgb, var(--success) 14%, transparent);
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
}

.stepper {
  display: flex;
  align-items: center;
  gap: 6px;
}

.stepper-input {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  text-align: center;
  height: 40px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font-size: 15px;
  font-weight: 600;
}
.stepper-input:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
}

.ghost-btn {
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.16s ease-out, border-color 0.16s ease-out;
}
.ghost-btn:hover:not(:disabled) {
  background: var(--surface-3);
  border-color: var(--accent);
}
.ghost-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.segmented {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.segment {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 10px;
  min-height: 44px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.16s ease-out;
}
.segment.compact {
  flex-direction: row;
  justify-content: center;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.segment:hover {
  border-color: var(--accent);
  color: var(--text);
}
.segment.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}
.segment-label {
  font-size: 14px;
  font-weight: 600;
}
.segment-hint {
  font-size: 11px;
  opacity: 0.75;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.actions .btn {
  flex: 1 1 auto;
}

.validate-result {
  margin-top: 4px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
  font-weight: 600;
  line-height: 1.5;
  border: 1px solid var(--border);
}
.validate-result.ok {
  color: var(--success);
  border-color: color-mix(in srgb, var(--success) 40%, transparent);
  background: color-mix(in srgb, var(--success) 12%, transparent);
}
.validate-result.warn {
  color: var(--gold);
  border-color: var(--gold-border);
  background: var(--gold-soft);
}

@media (max-width: 520px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
