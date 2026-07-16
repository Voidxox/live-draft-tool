<script setup>
import { ref, computed } from 'vue'
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
})
defineEmits(['pick', 'edit', 'remove', 'toggle-presence'])

// Steam 头像 (资料公开时才有), 无则回退到字母头像
const steamAvatar = computed(() => props.steam?.profile?.avatar || '')

// 卡片上展示的紧凑数据标签: 优先段位, 其次核心水平指标。
// 各源查不到时静默跳过, 不占位。
const steamBadges = computed(() => {
  const s = props.steam
  if (!s) return []
  const out = []
  const d = s.dota2
  if (d && d.rankName && d.rankName !== '未定级') {
    out.push({ key: 'dota-rank', game: 'DOTA2', label: d.rankName, tone: 'dota' })
  }
  if (d && d.winRate != null) {
    out.push({ key: 'dota-wr', game: '', label: `胜率 ${d.winRate}%`, tone: 'muted' })
  }
  const c = s.cs2
  if (c && c.skillLevel != null) {
    out.push({ key: 'cs-lvl', game: 'CS2', label: `Lv.${c.skillLevel}`, tone: 'cs' })
  }
  if (c && c.elo != null) {
    out.push({ key: 'cs-elo', game: '', label: `${c.elo} ELO`, tone: 'muted' })
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
    <span class="avatar" :class="{ 'has-img': steamAvatar }" aria-hidden="true">
      <img v-if="steamAvatar" :src="steamAvatar" :alt="`${name} 头像`" loading="lazy" />
      <template v-else>{{ name.slice(0, 1) }}</template>
    </span>
    <span class="body">
      <span class="name">{{ name }}</span>
      <span v-if="note" class="note">{{ note }}</span>
      <span v-if="steamBadges.length" class="steam-badges">
        <span
          v-for="b in steamBadges"
          :key="b.key"
          class="steam-badge"
          :class="`tone-${b.tone}`"
        >
          <span v-if="b.game" class="steam-badge-game">{{ b.game }}</span>
          {{ b.label }}
        </span>
      </span>
    </span>
    <span v-if="showPresence && !present" class="absent-tag" aria-hidden="true">未到</span>
    <span v-else-if="pickable" class="pick-hint" aria-hidden="true">选入</span>
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
</style>
