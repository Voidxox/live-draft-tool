<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import PlayerCard from './PlayerCard.vue'
import { dragState, setDropTarget, clearDropTarget, endDrag } from '../composables/useDragDrop.js'

const props = defineProps({
  team: { type: Object, required: true },
  members: { type: Array, default: () => [] }, // 已解析的 player 对象数组
  index: { type: Number, default: 0 },
  isActive: { type: Boolean, default: false },
  editable: { type: Boolean, default: false },
  compact: { type: Boolean, default: false }, // 10+ 队伍时的紧凑显示
  allTeams: { type: Array, default: () => [] }, // 全部队伍, 供键盘"移动"菜单选目标
})
const emit = defineEmits(['update', 'remove-member', 'assign', 'move-member', 'unassign-member'])

// ---- 队伍战力 (基于成员 Dota2 段位平均) ----
// rankTier 两位数: 十位 = 段位(1-8), 个位 = 星级(0-5)。
// 线性分值 = (段位-1)*5 + 星级, 便于求平均; 再映射回段位名展示。
const DOTA_MEDALS = ['先锋', '卫士', '中军', '统帅', '传奇', '万古流芳', '超凡入圣', '冠绝一世']
function tierToScore(rankTier) {
  if (!rankTier) return null
  const medal = Math.floor(rankTier / 10)
  const stars = rankTier % 10
  if (medal < 1) return null
  return (medal - 1) * 5 + stars
}
function scoreToRankName(score) {
  if (score == null) return '—'
  const medal = Math.min(8, Math.floor(score / 5) + 1)
  const stars = Math.round(score % 5)
  const name = DOTA_MEDALS[medal - 1] || '—'
  if (medal >= 8) return name // 冠绝一世无星级
  return stars ? `${name} ${stars} 星` : name
}

// 本队战力: 有 Dota2 段位的成员的平均分。无任何数据 → null (显示 —)
const teamPower = computed(() => {
  const scores = props.members
    .map((m) => tierToScore(m.steam?.dota2?.rankTier))
    .filter((s) => s != null)
  if (!scores.length) return null
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length
  return {
    score: avg,
    rankName: scoreToRankName(avg),
    covered: scores.length, // 有段位数据的人数
    total: props.members.length,
  }
})
// 战力条百分比: 满分 = 冠绝一世 (score 35 = (8-1)*5)
const powerPct = computed(() => {
  if (!teamPower.value) return 0
  return Math.min(100, Math.round((teamPower.value.score / 35) * 100))
})

// 键盘可用的成员"移动"菜单 (拖拽的无障碍替代)
const moveMenuFor = ref(null) // 当前打开菜单的 playerId
function toggleMoveMenu(id) {
  moveMenuFor.value = moveMenuFor.value === id ? null : id
}
function moveTo(playerId, teamId) {
  emit('move-member', { playerId, toTeamId: teamId })
  moveMenuFor.value = null
}
function backToPool(playerId) {
  emit('unassign-member', playerId)
  moveMenuFor.value = null
}
function closeMoveMenu(e) {
  if (e.type === 'keydown' && e.key !== 'Escape') return
  if (e.type === 'click' && e.target.closest && e.target.closest('.member-actions')) return
  moveMenuFor.value = null
}
onMounted(() => {
  window.addEventListener('click', closeMoveMenu)
  window.addEventListener('keydown', closeMoveMenu)
})
onBeforeUnmount(() => {
  window.removeEventListener('click', closeMoveMenu)
  window.removeEventListener('keydown', closeMoveMenu)
})

// 是否正在把某张卡拖到本队上方
const isDropTarget = computed(
  () => dragState.active && dragState.overTeamId === props.team.id,
)
// 拖动来源不是本队 (跨队 / 从候选席) 才算有效放置
const canAcceptDrag = computed(
  () => dragState.active && dragState.fromTeamId !== props.team.id,
)

function onDragOver(e) {
  if (!dragState.active) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  setDropTarget(props.team.id, -1)
}

function onDragLeave(e) {
  if (e.currentTarget.contains(e.relatedTarget)) return
  if (dragState.overTeamId === props.team.id) clearDropTarget()
}

function onDrop() {
  if (!dragState.active) return
  emit('assign', { playerId: dragState.playerId, toTeamId: props.team.id, index: dragState.overIndex })
  endDrag()
}

// 悬停在某个成员行上方时, 记录插入位置
function onMemberDragOver(e, i) {
  if (!dragState.active) return
  e.preventDefault()
  e.stopPropagation()
  // 以行的垂直中线判断插入在该成员之前还是之后
  const rect = e.currentTarget.getBoundingClientRect()
  const before = e.clientY < rect.top + rect.height / 2
  setDropTarget(props.team.id, before ? i : i + 1)
}
</script>

<template>
  <section
    class="team-board"
    :class="{ active: isActive, compact, 'drop-target': isDropTarget && canAcceptDrag }"
    :style="{ '--team-color': team.color }"
    :aria-current="isActive ? 'true' : undefined"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <header class="team-head">
      <span class="team-swatch" aria-hidden="true"></span>
      <div class="team-titles">
        <template v-if="editable">
          <input
            class="team-name-input"
            :value="team.name"
            :aria-label="`战队 ${index + 1} 名称`"
            @input="$emit('update', { name: $event.target.value })"
          />
          <input
            v-if="!compact"
            class="team-captain-input"
            :value="team.captain"
            placeholder="队长名"
            :aria-label="`战队 ${index + 1} 队长`"
            @input="$emit('update', { captain: $event.target.value })"
          />
        </template>
        <template v-else>
          <h3 class="team-name">{{ team.name }}</h3>
          <p v-if="!compact || team.captain" class="team-captain">
            <span class="cap-label">队长</span>
            <span class="cap-name">{{ team.captain || '未设置' }}</span>
          </p>
        </template>
      </div>
      <span class="team-count" aria-label="已选人数">{{ members.length }}</span>
      <span v-if="isActive" class="turn-badge">选人中</span>
    </header>

    <!-- 队伍战力 (基于成员 Dota2 段位均值; 有数据才显示) -->
    <div v-if="teamPower" class="team-power" :title="`${teamPower.covered}/${teamPower.total} 名成员有 Dota2 段位数据`">
      <div class="power-top">
        <span class="power-label">平均段位</span>
        <span class="power-rank">{{ teamPower.rankName }}</span>
        <span class="power-cover tnum">{{ teamPower.covered }}/{{ teamPower.total }}</span>
      </div>
      <div class="power-track" aria-hidden="true">
        <div class="power-fill" :style="{ width: powerPct + '%' }"></div>
      </div>
    </div>

    <div v-if="members.length === 0" class="member-list empty">
      <div class="member-empty" :class="{ 'drop-hint': isDropTarget && canAcceptDrag }">
        {{ isDropTarget && canAcceptDrag ? '放到这里' : '拖动马匹到此' }}
      </div>
    </div>
    <TransitionGroup v-else tag="ul" name="member" class="member-list">
      <li
        v-for="(p, i) in members"
        :key="p.id"
        class="member-row"
        :class="{
          'insert-before': isDropTarget && canAcceptDrag && dragState.overIndex === i,
          'insert-after': isDropTarget && canAcceptDrag && dragState.overIndex === i + 1 && i === members.length - 1,
        }"
        @dragover="onMemberDragOver($event, i)"
      >
        <span class="member-index" aria-hidden="true">{{ i + 1 }}</span>
        <PlayerCard
          :name="p.name"
          :note="p.note"
          :index="i"
          :draggable="true"
          :player-id="p.id"
          :from-team-id="team.id"
          :steam="p.steam || null"
        />
        <div v-if="editable" class="member-move">
          <button
            type="button"
            class="member-remove"
            :aria-label="`移动 ${p.name}`"
            :aria-expanded="moveMenuFor === p.id"
            aria-haspopup="menu"
            title="移动 / 移出"
            @click.stop="toggleMoveMenu(p.id)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>
          </button>
          <div v-if="moveMenuFor === p.id" class="move-menu card" role="menu">
            <span class="move-menu-label">移动到</span>
            <button
              v-for="t in allTeams"
              :key="t.id"
              v-show="t.id !== team.id"
              type="button"
              class="move-menu-item"
              role="menuitem"
              @click.stop="moveTo(p.id, t.id)"
            >
              <span class="move-swatch" :style="{ background: t.color }" aria-hidden="true"></span>
              {{ t.name }}
            </button>
            <div class="move-sep" role="separator"></div>
            <button type="button" class="move-menu-item pool" role="menuitem" @click.stop="backToPool(p.id)">
              放回候选席
            </button>
          </div>
        </div>
      </li>
    </TransitionGroup>
  </section>
</template>

<style scoped>
.team-board {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-1);
  overflow: hidden;
  transition:
    border-color 0.2s ease-out,
    box-shadow 0.2s ease-out,
    transform 0.2s ease-out;
}

.team-board.active {
  border-color: var(--gold);
  box-shadow:
    0 0 0 1px var(--gold),
    0 0 28px -6px var(--gold-glow);
  animation: team-breathe 2.4s ease-in-out infinite;
}

@keyframes team-breathe {
  0%,
  100% {
    box-shadow:
      0 0 0 1px var(--gold),
      0 0 22px -8px var(--gold-glow);
  }
  50% {
    box-shadow:
      0 0 0 1px var(--gold),
      0 0 34px -2px var(--gold-glow);
  }
}

@media (prefers-reduced-motion: reduce) {
  .team-board.active {
    animation: none;
  }
}

.team-head {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px 12px 16px;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--team-color) 16%, transparent),
    transparent
  );
}
/* 左侧整条队伍色脊: 身份标识, 与候选席铭牌竖脊呼应 */
.team-head::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 4px;
  background: var(--team-color);
}

.team-swatch {
  flex: 0 0 auto;
  width: 8px;
  height: 26px;
  border-radius: 3px;
  background: var(--team-color);
  box-shadow: 0 0 10px -2px var(--team-color);
}

.team-titles {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.team-name {
  margin: 0;
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.team-captain {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.cap-label {
  color: var(--text-muted);
}

.cap-name {
  color: var(--text);
  font-weight: 600;
}

.team-name-input,
.team-captain-input {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface-2);
  color: var(--text);
  font: inherit;
  font-size: 13px;
}

.team-name-input {
  font-weight: 700;
}

.team-name-input:focus,
.team-captain-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
}

.team-count {
  flex: 0 0 auto;
  min-width: 26px;
  height: 26px;
  padding: 0 8px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.turn-badge {
  flex: 0 0 auto;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--gold);
  color: #1a1206;
  font-size: 12px;
  font-weight: 700;
}

.member-list {
  list-style: none;
  margin: 0;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1 1 auto;
}

.member-list.empty {
  padding: 22px 10px;
}

.member-empty {
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.member-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.member-index {
  flex: 0 0 auto;
  width: 20px;
  text-align: center;
  color: var(--text-faint);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.member-row :deep(.player-card) {
  flex: 1 1 auto;
  min-width: 0;
}

.member-remove {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  transition:
    color 0.16s ease-out,
    border-color 0.16s ease-out,
    background 0.16s ease-out;
}

.member-remove:hover,
.member-remove:focus-visible {
  color: var(--danger);
  border-color: var(--danger);
  background: var(--danger-soft);
  outline: none;
}

/* ---- 拖放高亮 ---- */
.team-board.drop-target {
  border-color: var(--accent);
  box-shadow:
    0 0 0 1px var(--accent),
    0 0 24px -8px var(--accent-ring);
}
.team-board.drop-target .team-head {
  background: linear-gradient(
    180deg,
    var(--accent-soft),
    transparent
  );
}

.member-empty.drop-hint {
  color: var(--accent);
  font-weight: 600;
  border: 1px dashed var(--accent);
  border-radius: 8px;
  padding: 10px;
}

/* 插入位置指示线 */
.member-row {
  position: relative;
}
.member-row.insert-before::before,
.member-row.insert-after::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  border-radius: 2px;
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent);
}
.member-row.insert-before::before {
  top: -5px;
}
.member-row.insert-after::after {
  bottom: -5px;
}

/* ---- 紧凑模式 (10+ 队伍) ---- */
.team-board.compact {
  border-radius: 10px;
}
.team-board.compact .team-head {
  padding: 8px 10px;
  gap: 8px;
}
.team-board.compact .team-swatch {
  width: 6px;
  height: 20px;
}
.team-board.compact .team-name {
  font-size: 13px;
}
.team-board.compact .team-name-input {
  font-size: 12px;
  padding: 3px 6px;
}
.team-board.compact .member-list {
  padding: 6px;
  gap: 5px;
}
.team-board.compact .member-list.empty {
  padding: 14px 6px;
}
.team-board.compact .member-index {
  width: 16px;
  font-size: 11px;
}
.team-board.compact :deep(.player-card) {
  padding: 6px 8px;
  gap: 7px;
}
.team-board.compact :deep(.avatar) {
  width: 26px;
  height: 26px;
  font-size: 13px;
}

/* ---- 成员飞入过渡 (选人 / 拖入) ---- */
.mrow-enter-active {
  transition:
    transform 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.28s ease-out;
}
.mrow-leave-active {
  transition:
    transform 0.18s ease-in,
    opacity 0.18s ease-in;
  position: absolute;
  width: calc(100% - 20px);
}
.mrow-enter-from {
  opacity: 0;
  transform: translateX(18px) scale(0.96);
}
.mrow-leave-to {
  opacity: 0;
  transform: translateX(14px) scale(0.96);
}
/* FLIP: 已选成员在插入 / 重排时平滑移动 */
.mrow-move {
  transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

@media (prefers-reduced-motion: reduce) {
  .mrow-enter-active,
  .mrow-leave-active,
  .mrow-move {
    transition: none;
  }
}

/* ---- 键盘可用的成员移动菜单 ---- */
.member-move {
  position: relative;
  flex: 0 0 auto;
}
.move-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: var(--z-sticky, 20);
  min-width: 130px;
  max-height: 220px;
  overflow-y: auto;
  padding: 5px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  box-shadow: var(--shadow-pop);
}
.move-menu-label {
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.move-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 0 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.14s ease-out;
}
.move-menu-item:hover,
.move-menu-item:focus-visible {
  background: var(--surface-3);
  outline: none;
}
.move-menu-item.pool {
  color: var(--text-muted);
}
.move-swatch {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex: 0 0 auto;
}
.move-sep {
  height: 1px;
  margin: 4px 2px;
  background: var(--border);
}

/* ---- 队伍战力 (平均段位) ---- */
.team-power {
  padding: 8px 14px 10px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--team-color) 6%, transparent);
}
.power-top {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}
.power-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.power-rank {
  flex: 1 1 auto;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.power-cover {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.power-track {
  height: 5px;
  border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
}
.power-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--team-color), var(--gold));
  transition: width 0.3s ease-out;
}

/* 紧凑模式下战力条更薄 */
.team-board.compact .team-power {
  padding: 6px 10px 8px;
}
.team-board.compact .power-top {
  margin-bottom: 4px;
}

@media (prefers-reduced-motion: reduce) {
  .power-fill {
    transition: none;
  }
}
</style>
