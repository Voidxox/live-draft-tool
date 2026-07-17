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
  // 擂台肖像卡模式: 候选席用, 肖像铺满上部 + 斜切铭牌承载名字; 突出马匹主角感。
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

// 名字首字母 (肖像回退)
const initial = computed(() => props.name.slice(0, 1).toUpperCase())

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
    badge.textContent = initial.value
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
  <!-- ============ 擂台肖像卡 (候选席) ============ -->
  <div
    v-if="showcase"
    class="fighter-card"
    :class="{ pickable, disabled, draggable, dragging, absent: showPresence && !present }"
    :role="pickable ? 'button' : undefined"
    :tabindex="pickable ? 0 : undefined"
    :aria-label="pickable ? `选入 ${name}` : name"
    :draggable="draggable && !(showPresence && !present)"
    @click="pickable && $emit('pick')"
    @keydown.enter.prevent="pickable && $emit('pick')"
    @keydown.space.prevent="pickable && $emit('pick')"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
  >
    <!-- 肖像区 -->
    <div class="fighter-portrait">
      <!-- 到场开关 (setup, 左上) -->
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

      <!-- 段位浮标 (右上) -->
      <span v-if="primaryRank" class="rank-flag" :class="`tone-${primaryRank.tone}`">
        <span class="rank-flag-game">{{ primaryRank.game }}</span>
        <span class="rank-flag-label">{{ primaryRank.label }}</span>
      </span>

      <!-- 头像 / 字母 / 加载 -->
      <span v-if="loading" class="portrait-spin" aria-hidden="true"></span>
      <img
        v-else-if="showImg"
        class="portrait-img"
        :class="{ loaded: imgLoaded }"
        :src="steamAvatar"
        :alt="`${name} 头像`"
        loading="lazy"
        @load="onImgLoad"
        @error="onImgError"
      />
      <span v-else class="portrait-initial" aria-hidden="true">{{ initial }}</span>

      <!-- 未到场遮罩 -->
      <span v-if="showPresence && !present" class="absent-veil" aria-hidden="true">未到场</span>

      <!-- 选入提示 (可选时底边滑出) -->
      <span v-else-if="pickable" class="pick-cta" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
        选入
      </span>
    </div>

    <!-- 斜切铭牌 -->
    <div class="fighter-plate">
      <span class="fighter-name">{{ name }}</span>
      <div v-if="note || steamBadges.length" class="fighter-meta">
        <span v-if="note" class="fighter-note">{{ note }}</span>
        <span
          v-for="b in steamBadges"
          :key="b.key"
          class="meta-stat"
        >{{ b.label }}</span>
      </div>
    </div>
  </div>

  <!-- ============ 横向行模式 (队伍成员) ============ -->
  <div
    v-else
    class="player-card"
    :class="{ pickable, disabled, draggable, dragging, absent: showPresence && !present }"
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
    <span v-else-if="draggable" class="drag-handle" aria-hidden="true">
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
      <template v-else>{{ initial }}</template>
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
    <span v-else-if="pickable" class="pick-hint" aria-hidden="true">选入</span>
  </div>
</template>

<style scoped>
/* =========================================================
   擂台肖像卡 (showcase) — 候选席主角卡
   肖像铺满上部 (4:3), 斜切铭牌承载名字, 段位作浮标。
   灵感取自格斗游戏 Character Select 的选手立绘卡。
   ========================================================= */
.fighter-card {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  overflow: hidden;
  user-select: none;
  transition:
    transform 0.18s cubic-bezier(0.22, 1, 0.36, 1),
    border-color 0.16s ease-out,
    box-shadow 0.18s ease-out,
    opacity 0.16s ease-out;
}
.fighter-card.pickable { cursor: pointer; }
.fighter-card.draggable { cursor: grab; }
.fighter-card.draggable:active { cursor: grabbing; }

.fighter-card.pickable:hover,
.fighter-card.pickable:focus-visible,
.fighter-card.draggable:hover {
  transform: translateY(-5px);
  border-color: var(--accent);
  box-shadow: 0 16px 34px -16px rgba(0, 0, 0, 0.8), 0 0 0 1px var(--accent);
  outline: none;
}
.fighter-card.pickable:focus-visible {
  box-shadow: 0 16px 34px -16px rgba(0, 0, 0, 0.8), 0 0 0 3px var(--accent-ring);
}
.fighter-card.pickable:active { transform: translateY(-2px) scale(0.985); }

.fighter-card.dragging {
  opacity: 0.4;
  transform: scale(0.97);
  border-color: var(--accent);
}
.fighter-card.disabled { opacity: 0.4; filter: grayscale(0.4); }
.fighter-card.absent { opacity: 0.6; }
.fighter-card.absent .fighter-portrait { filter: grayscale(0.7); }

/* --- 肖像区 --- */
.fighter-portrait {
  position: relative;
  aspect-ratio: 4 / 3;
  display: grid;
  place-items: center;
  overflow: hidden;
  /* HUD: 纯色底 + 极淡斜向网格纹, 无彩色辉光 */
  background:
    repeating-linear-gradient(-45deg, transparent 0 9px, rgba(255,255,255,0.02) 9px 10px),
    var(--surface-3);
}
.portrait-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.28s ease-out, transform 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}
.portrait-img.loaded { opacity: 1; }
.fighter-card.pickable:hover .portrait-img.loaded,
.fighter-card.draggable:hover .portrait-img.loaded { transform: scale(1.05); }

/* 字母肖像: Rajdhani 大写巨字 */
.portrait-initial {
  font-family: var(--font-display);
  font-size: 64px;
  font-weight: 700;
  line-height: 1;
  color: color-mix(in srgb, var(--accent) 55%, var(--text-faint));
}
.portrait-spin {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  animation: fc-spin 0.7s linear infinite;
}
@keyframes fc-spin { to { transform: rotate(360deg); } }

/* 段位浮标 (右上) */
.rank-flag {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.4;
  white-space: nowrap;
  backdrop-filter: blur(4px);
  border: 1px solid transparent;
}
.rank-flag-game {
  font-family: var(--font-display);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  opacity: 0.8;
}
.rank-flag.tone-dota {
  color: var(--gold);
  border-color: var(--gold-border);
  background: color-mix(in srgb, #1a1206 78%, transparent);
}
.rank-flag.tone-cs {
  color: #ff9b6b;
  border-color: color-mix(in srgb, #ff7b3d 55%, transparent);
  background: color-mix(in srgb, #1a0f06 78%, transparent);
}

/* 到场开关 (左上) */
.presence-toggle {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  padding: 0;
  border-radius: 6px;
  border: 1.5px solid var(--border);
  background: color-mix(in srgb, var(--surface-1) 80%, transparent);
  backdrop-filter: blur(4px);
  color: transparent;
  cursor: pointer;
  transition: all 0.16s ease-out;
}
.presence-toggle:hover { border-color: var(--accent); }
.presence-toggle.on {
  background: var(--success);
  border-color: var(--success);
  color: #04140a;
}
.presence-toggle:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-ring);
}

/* 未到场遮罩 */
.absent-veil {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--bg) 55%, transparent);
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--text-faint);
}

/* 选入提示 (底边滑出) */
.pick-cta {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  transform: translateY(100%);
  opacity: 0;
  transition: transform 0.18s ease-out, opacity 0.18s ease-out;
}
.fighter-card.pickable:hover .pick-cta,
.fighter-card.pickable:focus-visible .pick-cta {
  transform: translateY(0);
  opacity: 1;
}

/* --- 斜切铭牌 --- */
.fighter-plate {
  position: relative;
  padding: 9px 12px 10px;
  background: var(--surface-1);
  /* 顶边斜切, 呼应立绘铭牌 */
  clip-path: polygon(0 7px, 100% 0, 100% 100%, 0 100%);
  margin-top: -1px;
}
/* 左侧一道强调竖脊: 纯实色, 不渐变 */
.fighter-plate::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 3px;
  background: var(--accent);
}
.fighter-name {
  display: block;
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-left: 8px;
}
.fighter-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  margin-top: 3px;
  padding-left: 8px;
}
.fighter-note {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.meta-stat {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}

/* =========================================================
   横向行模式 — 队伍成员 (窄列不撑爆)
   ========================================================= */
.player-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  transition:
    transform 0.16s ease-out,
    border-color 0.16s ease-out,
    background 0.16s ease-out,
    opacity 0.16s ease-out,
    box-shadow 0.16s ease-out;
  user-select: none;
}
.player-card.pickable { cursor: pointer; }
.player-card.draggable { cursor: grab; }
.player-card.draggable:active { cursor: grabbing; }

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
.player-card.draggable:hover .drag-handle { color: var(--text-muted); }

.player-card.pickable:hover,
.player-card.pickable:focus-visible {
  border-color: var(--accent);
  background: var(--surface-3);
  outline: none;
}
.player-card.pickable:active { transform: scale(0.97); }
.player-card.pickable:focus-visible { box-shadow: 0 0 0 3px var(--accent-ring); }

.player-card.disabled { opacity: 0.4; filter: grayscale(0.4); }

.player-card.absent {
  opacity: 0.5;
  filter: grayscale(0.6);
  border-style: dashed;
}
.player-card.absent .avatar {
  background: var(--surface-3);
  color: var(--text-faint);
}

/* 行模式到场开关 */
.player-card .presence-toggle {
  position: static;
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  border: 1.5px solid var(--border);
  background: var(--surface-1);
  backdrop-filter: none;
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
.avatar.has-img { background: var(--surface-3); }
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  opacity: 0;
  transition: opacity 0.24s ease-out;
}
.avatar.loaded img { opacity: 1; }
.avatar-spin {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  animation: fc-spin 0.7s linear infinite;
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
  transition: opacity 0.16s ease-out, transform 0.16s ease-out;
}
.player-card.pickable:hover .pick-hint,
.player-card.pickable:focus-visible .pick-hint {
  opacity: 1;
  transform: translateX(0);
}

/* 行模式 Steam 标签 */
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
.steam-badge.tone-muted { color: var(--text-muted); }

@media (prefers-reduced-motion: reduce) {
  .fighter-card,
  .portrait-img,
  .pick-cta,
  .avatar img { transition: none; }
  .portrait-spin,
  .avatar-spin { animation-duration: 1.4s; }
  .fighter-card.pickable:hover,
  .fighter-card.draggable:hover { transform: none; }
  .fighter-card.pickable:hover .portrait-img.loaded,
  .fighter-card.draggable:hover .portrait-img.loaded { transform: none; }
}
</style>
