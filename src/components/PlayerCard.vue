<script setup>
import { ref } from 'vue'
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
})
defineEmits(['pick', 'edit', 'remove'])

const dragging = ref(false)

let _ghost = null

function onDragStart(e) {
  if (!props.draggable || !props.playerId) return
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
    :class="{ pickable, disabled, draggable, dragging }"
    :role="pickable ? 'button' : undefined"
    :tabindex="pickable ? 0 : undefined"
    :aria-label="pickable ? `选择 ${name}` : name"
    :draggable="draggable"
    @click="pickable && $emit('pick')"
    @keydown.enter.prevent="pickable && $emit('pick')"
    @keydown.space.prevent="pickable && $emit('pick')"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
  >
    <span v-if="draggable" class="drag-handle" aria-hidden="true">
      <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
        <circle cx="3" cy="3" r="1.4" /><circle cx="9" cy="3" r="1.4" />
        <circle cx="3" cy="8" r="1.4" /><circle cx="9" cy="8" r="1.4" />
        <circle cx="3" cy="13" r="1.4" /><circle cx="9" cy="13" r="1.4" />
      </svg>
    </span>
    <span class="avatar" aria-hidden="true">{{ name.slice(0, 1) }}</span>
    <span class="body">
      <span class="name">{{ name }}</span>
      <span v-if="note" class="note">{{ note }}</span>
    </span>
    <span v-if="pickable" class="pick-hint" aria-hidden="true">选入</span>
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
</style>
