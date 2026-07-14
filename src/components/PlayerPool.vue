<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import PlayerCard from './PlayerCard.vue'
import { dragState, setDropTarget, clearDropTarget, endDrag } from '../composables/useDragDrop.js'

const props = defineProps({
  store: { type: Object, required: true },
})

const state = props.store.state
const draftInProgress = computed(() => state.phase === 'drafting')

const quickName = ref('')
const bulkOpen = ref(false)
const bulkText = ref('')

// 候选席作为放置区: 从队伍拖回卡片 = 放回候选席
const poolDropActive = computed(
  () => dragState.active && dragState.fromTeamId !== null && dragState.overTeamId === '__pool__',
)

function onPoolDragOver(e) {
  if (!dragState.active) return
  // 只有来自队伍的卡片才允许放回候选席
  if (dragState.fromTeamId === null) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  setDropTarget('__pool__', -1)
}

function onPoolDragLeave(e) {
  // 离开容器边界才清除, 避免子元素间移动误触发
  if (e.currentTarget.contains(e.relatedTarget)) return
  if (dragState.overTeamId === '__pool__') clearDropTarget()
}

function onPoolDrop() {
  if (!dragState.active || dragState.fromTeamId === null) return
  props.store.unassignPlayer(dragState.playerId)
  endDrag()
}

// 键盘可用的"分配到队伍"菜单 (拖拽的无障碍替代)
const assignMenuFor = ref(null) // 当前打开分配菜单的 playerId
function toggleAssignMenu(id) {
  assignMenuFor.value = assignMenuFor.value === id ? null : id
}
function assignTo(playerId, teamId) {
  props.store.assignPlayer(playerId, teamId)
  assignMenuFor.value = null
}
// 点击菜单外部 / 按 Esc 关闭分配菜单
function closeAssign(e) {
  if (e.type === 'keydown' && e.key !== 'Escape') return
  if (e.type === 'click' && e.target.closest && e.target.closest('.row-actions')) return
  assignMenuFor.value = null
}
onMounted(() => {
  window.addEventListener('click', closeAssign)
  window.addEventListener('keydown', closeAssign)
})
onBeforeUnmount(() => {
  window.removeEventListener('click', closeAssign)
  window.removeEventListener('keydown', closeAssign)
})

// 编辑弹窗
const editing = ref(null) // player object copy { id, name, note }

function addQuick() {
  const p = props.store.addPlayer(quickName.value)
  if (p) quickName.value = ''
}

function applyBulk() {
  const added = props.store.addPlayersBulk(bulkText.value)
  if (added.length) {
    bulkText.value = ''
    bulkOpen.value = false
  }
}

function openEdit(player) {
  editing.value = { id: player.id, name: player.name, note: player.note || '' }
}

function saveEdit() {
  if (!editing.value) return
  const name = editing.value.name.trim()
  if (!name) return
  props.store.updatePlayer(editing.value.id, { name, note: editing.value.note.trim() })
  editing.value = null
}

function confirmRemove(player) {
  if (window.confirm(`确认移除「${player.name}」？`)) {
    props.store.removePlayer(player.id)
  }
}
</script>

<template>
  <section
    class="pool card"
    :class="{ 'drop-active': poolDropActive }"
    aria-labelledby="pool-title"
    @dragover="onPoolDragOver"
    @dragleave="onPoolDragLeave"
    @drop.prevent="onPoolDrop"
  >
    <header class="card-head">
      <h2 id="pool-title">
        候选席
        <span class="count tnum">{{ store.availablePlayers.value.length }}</span>
      </h2>
      <button type="button" class="btn ghost sm" @click="bulkOpen = !bulkOpen">
        {{ bulkOpen ? '收起' : '批量添加' }}
      </button>
    </header>

    <form class="quick-add" @submit.prevent="addQuick">
      <input
        v-model="quickName"
        class="text-input"
        type="text"
        placeholder="输入玩家昵称，回车添加"
        aria-label="玩家昵称"
        maxlength="24"
      />
      <button type="submit" class="btn primary sm" :disabled="!quickName.trim()">添加</button>
    </form>

    <div v-if="bulkOpen" class="bulk">
      <textarea
        v-model="bulkText"
        class="text-input area"
        rows="4"
        placeholder="每行一个昵称，或用逗号 / 顿号分隔，一次性粘贴导入"
        aria-label="批量玩家昵称"
      ></textarea>
      <button type="button" class="btn subtle sm" :disabled="!bulkText.trim()" @click="applyBulk">
        导入这批玩家
      </button>
    </div>

    <TransitionGroup
      v-if="store.availablePlayers.value.length"
      tag="div"
      name="pool"
      class="pool-grid"
      :style="{ '--cols': state.config.cardsPerRow }"
    >
      <div
        v-for="(p, i) in store.availablePlayers.value"
        :key="p.id"
        class="pool-item"
        :style="{ '--stagger': `${Math.min(i, 12) * 30}ms` }"
      >
        <PlayerCard
          :name="p.name"
          :note="p.note"
          :index="i"
          :pickable="draftInProgress"
          :draggable="true"
          :player-id="p.id"
          :from-team-id="null"
          @pick="store.pickPlayer(p.id)"
        />
        <div class="row-actions">
          <button
            type="button"
            class="icon-btn"
            :aria-label="`把 ${p.name} 分配到队伍`"
            :aria-expanded="assignMenuFor === p.id"
            aria-haspopup="menu"
            title="分配到队伍"
            @click.stop="toggleAssignMenu(p.id)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5v14"/></svg>
          </button>
          <div v-if="assignMenuFor === p.id" class="assign-menu card" role="menu">
            <span class="assign-menu-label">分配到</span>
            <button
              v-for="t in state.teams"
              :key="t.id"
              type="button"
              class="assign-menu-item"
              role="menuitem"
              @click.stop="assignTo(p.id, t.id)"
            >
              <span class="assign-swatch" :style="{ background: t.color }" aria-hidden="true"></span>
              {{ t.name }}
            </button>
          </div>
          <button
            type="button"
            class="icon-btn"
            :aria-label="`编辑 ${p.name}`"
            title="编辑"
            @click="openEdit(p)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button
            type="button"
            class="icon-btn danger"
            :aria-label="`移除 ${p.name}`"
            title="移除"
            @click="confirmRemove(p)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      </div>
    </TransitionGroup>

    <p v-else class="empty">
      候选席还没有玩家。在上方输入昵称添加，或用「批量添加」一次导入名单。
    </p>

    <!-- 编辑弹窗 -->
    <div v-if="editing" class="modal-scrim" @click.self="editing = null">
      <div class="modal card" role="dialog" aria-modal="true" aria-labelledby="edit-title">
        <h3 id="edit-title">编辑玩家</h3>
        <label class="field">
          <span class="field-label">昵称</span>
          <input v-model="editing.name" class="text-input" type="text" maxlength="24" />
        </label>
        <label class="field">
          <span class="field-label">备注（战力 / 位置等）</span>
          <input v-model="editing.note" class="text-input" type="text" maxlength="40" />
        </label>
        <div class="modal-actions">
          <button type="button" class="btn ghost" @click="editing = null">取消</button>
          <button type="button" class="btn primary" :disabled="!editing.name.trim()" @click="saveEdit">
            保存
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.pool {
  display: flex;
  flex-direction: column;
  gap: 14px;
  transition: border-color 0.16s ease-out, background 0.16s ease-out;
}
.pool.drop-active {
  border-color: var(--accent);
  background: linear-gradient(0deg, var(--accent-soft), var(--surface-1));
  box-shadow: 0 0 0 1px var(--accent), 0 0 24px -8px var(--accent-ring);
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
  display: flex;
  align-items: center;
  gap: 8px;
}
.count {
  font-size: 13px;
  font-weight: 700;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 999px;
  padding: 2px 9px;
}

.quick-add {
  display: flex;
  gap: 8px;
}
.quick-add .text-input {
  flex: 1 1 auto;
}

.text-input {
  height: 42px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font-size: 14px;
  width: 100%;
}
.text-input.area {
  height: auto;
  padding: 10px 12px;
  line-height: 1.6;
  resize: vertical;
}
.text-input:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
}

.bulk {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pool-grid {
  display: grid;
  grid-template-columns: repeat(var(--cols, 4), minmax(0, 1fr));
  gap: 10px;
}
.pool-item {
  position: relative;
}
.row-actions {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.16s ease-out;
}
.pool-item:hover .row-actions,
.pool-item:focus-within .row-actions {
  opacity: 1;
}
.icon-btn {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface-1);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.16s ease-out;
}
.icon-btn:hover {
  color: var(--text);
  border-color: var(--accent);
}
.icon-btn.danger:hover {
  color: var(--danger);
  border-color: var(--danger);
}

.empty {
  margin: 0;
  padding: 24px 16px;
  text-align: center;
  color: var(--text-muted);
  font-size: 14px;
  line-height: 1.7;
  border: 1px dashed var(--border);
  border-radius: 10px;
}

/* modal */
.modal-scrim {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(1, 4, 9, 0.62);
  display: grid;
  place-items: center;
  padding: 16px;
  animation: fade 0.16s ease-out;
}
.modal {
  width: min(100%, 380px);
  display: flex;
  flex-direction: column;
  gap: 14px;
  animation: pop 0.18s ease-out;
}
.modal h3 {
  margin: 0;
  font-size: 16px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
}
.modal-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

@keyframes fade {
  from { opacity: 0; }
}
@keyframes pop {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
}

@media (prefers-reduced-motion: reduce) {
  .modal-scrim, .modal { animation: none; }
}
</style>
