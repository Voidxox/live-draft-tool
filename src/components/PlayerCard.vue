<script setup>
import { ref, computed, watch } from 'vue'
import { startDrag, endDrag } from '../composables/useDragDrop.js'

const props = defineProps({
  name: { type: String, required: true },
  note: { type: String, default: '' },
  index: { type: Number, default: 0 },
  disabled: { type: Boolean, default: false },
  pickable: { type: Boolean, default: false },
  // 拖拽相关
  draggable: { type: Boolean, default: false },
  playerId: { type: String, default: '' },
  fromTeamId: { type: String, default: null },
  // 到场状态: showPresence 为真时在卡片上显示到场开关; present=false 时灰显"未到"
  showPresence: { type: Boolean, default: false },
  present: { type: Boolean, default: true },
  // Steam / V 社游戏数据 (来自 player.steam), 有则在卡片上展示头像与段位
  steam: { type: Object, default: null },
  // 正在拉取 Steam 数据: 卡片显示加载态 (转圈), 头像位占位
  loading: { type: Boolean, default: false },
  // 卡牌展示模式: 候选席用纵向大卡牌 (头像居上/名字居中/段位横幅), 突出马匹主角感;
  // 不传则为默认横向行模式 (队伍成员用, 窄列不撑爆)。
  showcase: { type: Boolean, default: false },
})
defineEmits(['pick', 'edit', 'remove', 'toggle-presence'])

// Steam 头像 (资料公开时才有), 无则回退到字母头像
const steamAvatar = computed(() => props.steam?.profile?.avatar || '')
// 头像外链加载失败 / 加载完成状态: 失败回退字母头像, 完成后淡入
const imgFailed = ref(false)
const imgLoaded = ref(false)
function onImgError() { imgFailed.value = true }
function onImgLoad() { imgLoaded.value = true }
// 头像 URL 变化时重置加载状态 (刷新换头像的场景)
watch(steamAvatar, () => { imgFailed.value = false; imgLoaded.value = false })
// 实际用图: 有 URL 且未失败
const showImg = computed(() => steamAvatar.value && !imgFailed.value)

// 段位主徽章: 竞技水平的核心信息, 单独抽出更突出显示 (Dota2 优先, 其次 CS2)。
const primaryRank = computed(() => {
  const s = props.steam
  if (!s) return null
  const d = s.dota2
  if (d && d.rankName && d.rankName !== '未定级') {
    return { game: 'DOTA2', label: d.rankName, tone: 'dota' }
  }
  const c = s.cs2
  if (c && c.skillLevel != null) {
    return { game: 'CS2', label: `Lv.${c.skillLevel}`, tone: 'cs' }
  }
  return null
})

// 次级数据标签: 胜率 / ELO 等辅助指标, 视觉上弱于主段位。
const steamBadges = computed(() => {
  const s = props.steam
  if (!s) return []
  const out = []
  const d = s.dota2
  if (d && d.winRate != null) {
    out.push({ key: 'dota-wr', label: `胜率 ${d.winRate}%`, tone: 'muted' })
  }
  const c = s.cs2
  if (c && c.elo != null) {
    out.push({ key: 'cs-elo', label: `${c.elo} ELO`, tone: 'muted' })
  }
  return out
})

const dragging = ref(false)

let _ghost = null

function onDragStart(e) {
  if (!props.draggable || !props.playerId) return
  // 未到场的玩家不参与选马, 禁止拖动
  if (props.showPresence && !props.present) {
    e.preventDefault()
    return
  }
  dragging.value = true
  startDrag(props.playerId, props.fromTeamId)
  e.dataTransfer.effectAllowed = 'move'
  // Firefox 需要 setData 才会触发拖拽
  try {
    e.dataTransfer.setData('text/plain', props.playerId)
  } catch {
    /* ignore */
  }
  // 自定义拖影: 带头像 + 名字的浮层, 替代浏览器默认的整卡虚影
  try {
    _ghost = document.createElement('div')
    _ghost.className = 'pc-drag-ghost'
    _ghost.textContent = props.name
    const badge = document.createElement('span')
    badge.className = 'pc-drag-ghost__avatar'
    badge.textContent = props.name.slice(0, 1)
    _ghost.prepend(badge)
    document.body.appendChild(_ghost)
    e.dataTransfer.setDragImage(_ghost, 20, 18)
  } catch {
    /* setDragImage 不支持时降级为默认虚影 */
  }
}

function onDragEnd() {
  dragging.value = false
  endDrag()
  if (_ghost) {
    _ghost.remove()
    _ghost = null
  }
}
</script>

<template>
  <div
    class="player-card"
    :class="{ pickable, disabled, draggable, dragging, showcase, absent: showPresence && !present }"
    :role="pickable ? 'button' : undefined"
    :tabindex="pickable ? 0 : undefined"
    :aria-label="pickable ? `选择 ${name}` : name"
    :draggable="draggable && !(showPresence && !present)"
    @click="pickable && $emit('pick')"
    @keydown.enter.prevent="pickable && $emit('pick')"
    @keydown.space.prevent="pickable && $emit('pick')"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
  >
    <button
      v-if="showPresence"
      type="button"
      class="presence-toggle"
      :class="{ on: present }"
      role="switch"
      :aria-checked="present"
      :aria-label="present ? `${name} 已到场，点击标记未到` : `${name} 未到场，点击标记到场`"
      :title="present ? '已到场' : '未到场'"
      @click.stop="$emit('toggle-presence')"
    >
      <svg v-if="present" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
    </button>
    <span v-else-if="draggable && !showcase" class="drag-handle" aria-hidden="true">
      <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
        <circle cx="3" cy="3" r="1.4" /><circle cx="9" cy="3" r="1.4" />
        <circle cx="3" cy="8" r="1.4" /><circle cx="9" cy="8" r="1.4" />
        <circle cx="3" cy="13" r="1.4" /><circle cx="9" cy="13" r="1.4" />
      </svg>
    </span>
    <span class="avatar" :class="{ 'has-img': showImg, loaded: imgLoaded }" aria-hidden="true">
      <span v-if="loading" class="avatar-spin" aria-hidden="true"></span>
      <img
        v-else-if="showImg"
        :src="steamAvatar"
        :alt="`${name} 头像`"
        loading="lazy"
        @load="onImgLoad"
        @error="onImgError"
      />
      <template v-else>{{ name.slice(0, 1) }}</template>
    </span>
    <span class="body">
      <span class="name">{{ name }}</span>
      <span v-if="note" class="note">{{ note }}</span>
      <span v-if="primaryRank || steamBadges.length" class="steam-badges">
        <span v-if="primaryRank" class="steam-badge rank" :class="`tone-${primaryRank.tone}`">
          <span class="steam-badge-game">{{ primaryRank.game }}</span>
          {{ primaryRank.label }}
        </span>
        <span
          v-for="b in steamBadges"
          :key="b.key"
          class="steam-badge"
          :class="`tone-${b.tone}`"
        >
          {{ b.label }}
        </span>
      </span>
    </span>
    <span v-if="showPresence && !present" class="absent-tag" aria-hidden="true">未到</span>
    <span v-else-if="pickable && !showcase" class="pick-hint" aria-hidden="true">选入</span>
  </div>
</template>

<style scoped>
.player-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
  transition:
    transform 0.16s ease-out,
    border-color 0.16s ease-out,
    background 0.16s ease-out,
    opacity 0.16s ease-out,
    box-shadow 0.16s ease-out;
  user-select: none;
}

.player-card.pickable {
  cursor: pointer;
}

.player-card.draggable {
  cursor: grab;
}

.player-card.draggable:active {
  cursor: grabbing;
}

/* 正在被拖动的卡片: 降透明并轻微缩放, 给出"已拎起"反馈 */
.player-card.dragging {
  opacity: 0.4;
  transform: scale(0.98);
  border-color: var(--accent);
}

.drag-handle {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 16px;
  color: var(--text-faint);
  transition: color 0.16s ease-out;
}

.player-card.draggable:hover .drag-handle {
  color: var(--text-muted);
}

.player-card.pickable:hover,
.player-card.pickable:focus-visible {
  border-color: var(--accent);
  background: var(--surface-3);
  outline: none;
}

.player-card.pickable:active {
  transform: scale(0.97);
}

.player-card.pickable:focus-visible {
  box-shadow: 0 0 0 3px var(--accent-ring);
}

.player-card.disabled {
  opacity: 0.4;
  filter: grayscale(0.4);
}

/* 未到场: 灰显, 但保留到场开关可点 */
.player-card.absent {
  opacity: 0.5;
  filter: grayscale(0.6);
  border-style: dashed;
}
.player-card.absent .avatar {
  background: var(--surface-3);
  color: var(--text-faint);
}

/* 到场开关 (占据 drag-handle 的位置) */
.presence-toggle {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  padding: 0;
  border-radius: 6px;
  border: 1.5px solid var(--border);
  background: var(--surface-1);
  color: transparent;
  cursor: pointer;
  transition: all 0.16s ease-out;
}
.presence-toggle:hover {
  border-color: var(--accent);
}
.presence-toggle.on {
  background: var(--success);
  border-color: var(--success);
  color: #04140a;
}
.presence-toggle:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-ring);
}

.absent-tag {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-faint);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px 8px;
}

.avatar {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 700;
  font-size: 15px;
  overflow: hidden;
}
.avatar.has-img {
  background: var(--surface-3);
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  /* 外链头像加载完成后淡入, 避免闪现 */
  opacity: 0;
  transition: opacity 0.24s ease-out;
}
.avatar.loaded img {
  opacity: 1;
}
/* 头像位加载态: 拉取 Steam 数据时的转圈 */
.avatar-spin {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  animation: avatar-spin 0.7s linear infinite;
}
@keyframes avatar-spin {
  to { transform: rotate(360deg); }
}

.body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1 1 auto;
}

.name {
  font-weight: 600;
  font-size: 14px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.note {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pick-hint {
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  opacity: 0;
  transform: translateX(4px);
  transition:
    opacity 0.16s ease-out,
    transform 0.16s ease-out;
}

.player-card.pickable:hover .pick-hint,
.player-card.pickable:focus-visible .pick-hint {
  opacity: 1;
  transform: translateX(0);
}

/* ---- Steam / V 社数据标签 ---- */
.steam-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.steam-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.5;
  white-space: nowrap;
  border: 1px solid var(--border);
  background: var(--surface-1);
  color: var(--text-muted);
}
.steam-badge-game {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.03em;
  opacity: 0.75;
}
/* 段位主徽章: 竞技水平核心, 视觉上强于次级指标 (更大字号/更实底色) */
.steam-badge.rank {
  font-size: 12px;
  font-weight: 700;
  padding: 2px 9px;
}
.steam-badge.tone-dota {
  border-color: color-mix(in srgb, #f0b429 45%, transparent);
  background: color-mix(in srgb, #f0b429 14%, var(--surface-1));
  color: #f0b429;
}
.steam-badge.tone-cs {
  border-color: color-mix(in srgb, #ff7b3d 45%, transparent);
  background: color-mix(in srgb, #ff7b3d 14%, var(--surface-1));
  color: #ff9b6b;
}
.steam-badge.tone-muted {
  color: var(--text-muted);
}

/* =========================================================
   卡牌展示模式 (showcase): 候选席主角卡, 纵向布局
   - 头像放大居上, 名字/段位居中
   - 悬停抬升 + 边框点亮 + 高光扫过, 强化"可选/主角"感
   - 保留原横向模式给队伍成员用, 互不影响
   ========================================================= */
.player-card.showcase {
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 12px 14px;
  border-radius: 14px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--accent) 5%, var(--surface-2)), var(--surface-2));
  text-align: center;
  position: relative;
  overflow: hidden;
}
/* 顶部一条细色带, 呼应卡牌质感 */
.player-card.showcase::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  background: linear-gradient(90deg, var(--accent), var(--gold));
  opacity: 0.5;
  transition: opacity 0.16s ease-out;
}
/* 悬停高光扫过 (仅可选卡) */
.player-card.showcase.pickable::after {
  content: '';
  position: absolute;
  top: 0;
  left: -60%;
  width: 40%;
  height: 100%;
  background: linear-gradient(
    100deg,
    transparent,
    color-mix(in srgb, var(--accent) 22%, transparent),
    transparent
  );
  transform: skewX(-18deg);
  opacity: 0;
  pointer-events: none;
}
.player-card.showcase.pickable:hover::after {
  animation: showcase-sheen 0.6s ease-out;
}
@keyframes showcase-sheen {
  from { left: -60%; opacity: 0.9; }
  to { left: 120%; opacity: 0; }
}

.player-card.showcase:hover,
.player-card.showcase.pickable:hover,
.player-card.showcase.pickable:focus-visible {
  transform: translateY(-4px);
  border-color: var(--accent);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--accent) 12%, var(--surface-2)), var(--surface-2));
  box-shadow: 0 14px 34px -14px rgba(0, 0, 0, 0.75), 0 0 0 1px var(--accent);
}
.player-card.showcase:hover::before,
.player-card.showcase.pickable:hover::before {
  opacity: 1;
}

/* 卡牌大头像 */
.player-card.showcase .avatar {
  width: 72px;
  height: 72px;
  border-radius: 14px;
  font-size: 30px;
}
/* 卡牌加载转圈放大 */
.player-card.showcase .avatar-spin {
  width: 28px;
  height: 28px;
}

/* 卡牌正文居中 */
.player-card.showcase .body {
  align-items: center;
  width: 100%;
}
.player-card.showcase .name {
  font-size: 15px;
  font-weight: 700;
  max-width: 100%;
}
.player-card.showcase .note {
  font-size: 12px;
  max-width: 100%;
}
.player-card.showcase .steam-badges {
  justify-content: center;
  margin-top: 6px;
}
/* 卡牌里段位横幅化, 单独占一行更醒目 */
.player-card.showcase .steam-badge.rank {
  font-size: 12px;
  padding: 3px 12px;
}

/* 到场开关移到卡牌右上角 */
.player-card.showcase .presence-toggle {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
}
/* 未到场标签在卡牌里放到底部居中 */
.player-card.showcase .absent-tag {
  margin-top: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .avatar-spin { animation-duration: 1.4s; }
  .avatar img { transition: none; }
  .player-card.showcase.pickable:hover::after { animation: none; }
  .player-card.showcase:hover { transform: none; }
}
</style>
