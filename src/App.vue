<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { useDraftStore } from './store/draft.js'
import SetupPanel from './components/SetupPanel.vue'
import PlayerPool from './components/PlayerPool.vue'
import TeamBoard from './components/TeamBoard.vue'
import PickTimer from './components/PickTimer.vue'

const store = useDraftStore()
const state = store.state

// ---- 移动端标签切换 (≤640px 左右分栏改为标签页) ----
const isMobile = ref(false)
const mobileTab = ref('pool') // pool | teams
let _mqHandler = null
function syncMobile() {
  isMobile.value = typeof window !== 'undefined' && window.innerWidth <= 640
}

const toast = ref('')
let toastHandle = null
function notify(msg) {
  toast.value = msg
  clearTimeout(toastHandle)
  toastHandle = setTimeout(() => (toast.value = ''), 2600)
}

// ---- 顶栏数据菜单 ----
const dataMenuOpen = ref(false)
function toggleDataMenu() {
  dataMenuOpen.value = !dataMenuOpen.value
}
function closeMenus(e) {
  // 点击菜单外部时关闭下拉 / 同步弹层
  if (e.target.closest && e.target.closest('.data-menu, .sync-box')) return
  dataMenuOpen.value = false
  syncOpen.value = false
}

// ---- 实时同步 ----
const net = store.net
const syncOpen = ref(false)
const roomInput = ref('')
// 观众 = 已联网且角色为 viewer, 全程只读
const isReadonly = computed(() => net.enabled && net.role === 'viewer')

function randomRoom() {
  return Math.random().toString(36).slice(2, 7).toUpperCase()
}

function connectAs(role) {
  const room = (roomInput.value || '').trim() || randomRoom()
  roomInput.value = room
  store.connectRealtime({ role, room })
  notify(role === 'admin' ? `已作为管理员开播 · 房间 ${room}` : `已作为观众加入 · 房间 ${room}`)
  syncOpen.value = false
}

function leaveSync() {
  store.disconnectRealtime()
  notify('已断开实时同步')
}

const shareLink = computed(() => {
  if (!net.enabled || typeof location === 'undefined') return ''
  return `${location.origin}${location.pathname}?room=${encodeURIComponent(net.room)}&role=viewer`
})

async function copyShare() {
  if (!shareLink.value) return
  try {
    await navigator.clipboard.writeText(shareLink.value)
    notify('观众链接已复制')
  } catch {
    notify('复制失败, 请手动复制')
  }
}

// ---- 派生视图数据 ----
const isDrafting = computed(() => state.phase === 'drafting')
const isDone = computed(() => state.phase === 'done')
const teamsEditable = computed(() => state.phase === 'setup')

// 视图密度: 按队伍数自动切换 (8 队及以上转紧凑)
const teamCompact = computed(() => state.teams.length >= 8)
const teamMinWidth = computed(() => {
  const n = state.teams.length
  if (n >= 16) return '150px'
  if (n >= 10) return '180px'
  if (n >= 6) return '210px'
  if (n >= 3) return '240px'
  return '100%'
})
const dragHint = computed(() => {
  if (teamsEditable.value) return '可编辑队名 · 可拖动马匹分组'
  return '拖动马匹换队 / 拖回候选席'
})

// ---- 现场说明 (纳入同步快照; 管理员可编辑, 观众只读) ----
const noticeOpen = ref(false)
const noticeText = computed({
  get: () => state.config.notice || '',
  set: (v) => { state.config.notice = v },
})
// 观众只读; 管理员或未联网(单机)可编辑
const canEditNotice = computed(() => !isReadonly.value)

function membersOf(team) {
  return team.members.map((id) => store.playerById(id)).filter(Boolean)
}

const progressText = computed(() => {
  const total = store.totalPicks.value
  if (total === 0) return ''
  const done = Math.min(state.currentStep, total)
  return `${done} / ${total}`
})
const progressPct = computed(() => {
  const total = store.totalPicks.value
  if (total === 0) return 0
  return Math.min(100, (state.currentStep / total) * 100)
})

// ---- 工具栏动作 ----
function onSave() {
  dataMenuOpen.value = false
  notify(store.saveLocal() ? '已保存到本地' : '保存失败')
}
function onLoad() {
  dataMenuOpen.value = false
  notify(store.loadLocal() ? '已读取本地存档' : '没有可读取的存档')
}
function onExport() {
  dataMenuOpen.value = false
  const blob = new Blob([store.exportJSON()], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `选人存档_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
  a.click()
  URL.revokeObjectURL(url)
  notify('已导出到文件')
}
const fileInput = ref(null)
function triggerImport() {
  dataMenuOpen.value = false
  fileInput.value?.click()
}
function onImportFile(e) {
  const file = e.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    notify(store.importJSON(String(reader.result)) ? '已导入存档' : '文件格式无法识别')
  }
  reader.readAsText(file)
  e.target.value = ''
}
function onBackup() {
  dataMenuOpen.value = false
  const stamp = store.createBackup()
  notify(stamp ? '已创建备份' : '备份失败')
}
function onRestoreBackup() {
  dataMenuOpen.value = false
  notify(store.restoreLatestBackup() ? '已恢复最新备份' : '没有可恢复的备份')
}

// ---- 自动保存 + 快捷键 ----
let autosaveHandle = null
function onKeydown(e) {
  // 观众只读, 不响应撤销
  if (isReadonly.value) return
  if (e.key === 'z' && (e.ctrlKey || e.metaKey) && isDrafting.value) {
    e.preventDefault()
    store.undoLastPick()
  }
}

// 从 URL 读取 ?room=xxx&role=viewer|admin, 自动加入同步房间
function autoJoinFromURL() {
  if (typeof location === 'undefined') return false
  const params = new URLSearchParams(location.search)
  const room = params.get('room')
  if (!room) return false
  const role = params.get('role') === 'admin' ? 'admin' : 'viewer'
  roomInput.value = room
  store.connectRealtime({ role, room })
  notify(role === 'admin' ? `已作为管理员加入房间 ${room}` : `已作为观众加入房间 ${room}`)
  return true
}

onMounted(() => {
  const joined = autoJoinFromURL()
  // 未联网观看时才用本地存档兜底; 观众加入后由远端快照驱动, 不读本地
  if (!joined && store.loadLocal()) notify('已恢复上次进度')
  // 观众不写本地 (避免用远端只读态覆盖自己曾经的存档)
  autosaveHandle = setInterval(() => {
    if (!isReadonly.value) store.saveLocal()
  }, 5000)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('click', closeMenus)
  syncMobile()
  _mqHandler = () => syncMobile()
  window.addEventListener('resize', _mqHandler)
})
onBeforeUnmount(() => {
  clearInterval(autosaveHandle)
  clearTimeout(toastHandle)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('click', closeMenus)
  if (_mqHandler) window.removeEventListener('resize', _mqHandler)
  store.disconnectRealtime()
  store.stopTimer()
})
</script>

<template>
  <div class="app-shell">
    <!-- 顶栏 -->
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="m12 3 7 4v5c0 4.4-3 8.3-7 9-4-.7-7-4.6-7-9V7z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
        </span>
        <div class="brand-text">
          <h1>选人台</h1>
          <p>队长轮流选人 · Ban / Pick</p>
        </div>
      </div>

      <div class="toolbar" role="toolbar" aria-label="工具栏">
        <!-- 数据下拉菜单 -->
        <div class="data-menu">
          <button
            type="button"
            class="btn ghost sm"
            aria-haspopup="menu"
            :aria-expanded="dataMenuOpen"
            @click.stop="toggleDataMenu"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M3 5v6c0 1.66 4 3 9 3s9-1.34 9-3V5" />
              <path d="M3 11v6c0 1.66 4 3 9 3s9-1.34 9-3v-6" />
            </svg>
            数据
            <svg class="caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <div v-if="dataMenuOpen" class="data-pop card" role="menu">
            <button type="button" class="data-item" role="menuitem" @click="onSave">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>
              保存到本地
            </button>
            <button type="button" class="data-item" role="menuitem" @click="onLoad">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7"/><path d="M12 3v13M7 11l5 5 5-5"/></svg>
              读取本地
            </button>
            <div class="data-sep" role="separator"></div>
            <button type="button" class="data-item" role="menuitem" @click="onExport">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v13M7 8l5-5 5 5"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7"/></svg>
              导出 JSON 文件
            </button>
            <button type="button" class="data-item" role="menuitem" @click="triggerImport">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V3M7 11l5 5 5-5"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7"/></svg>
              从文件导入
            </button>
            <div class="data-sep" role="separator"></div>
            <button type="button" class="data-item" role="menuitem" @click="onBackup">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5l3 2"/><path d="M21 3v6h-6"/></svg>
              创建备份
            </button>
            <button type="button" class="data-item" role="menuitem" @click="onRestoreBackup">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9"/><path d="M3 3v6h6"/><path d="M12 7v5l3 2"/></svg>
              恢复最新备份
            </button>
          </div>
        </div>
        <input ref="fileInput" type="file" accept="application/json,.json" class="visually-hidden"
          @change="onImportFile" />

        <!-- 实时同步入口 -->
        <div class="sync-box">
          <button
            v-if="!net.enabled"
            type="button"
            class="btn subtle sm"
            @click="syncOpen = !syncOpen"
          >
            实时同步
          </button>
          <template v-else>
            <span class="sync-status" :class="{ online: net.connected }">
              <span class="dot" aria-hidden="true"></span>
              {{ net.role === 'admin' ? '管理员' : '观众' }} · {{ net.room }}
              <span class="sync-clients tnum" :title="`在线 ${net.clients} 人`">{{ net.clients }}人</span>
            </span>
            <button
              v-if="net.role === 'admin'"
              type="button"
              class="btn ghost sm"
              @click="copyShare"
            >
              复制观众链接
            </button>
            <button type="button" class="btn ghost sm" @click="leaveSync">断开</button>
          </template>

          <!-- 连接弹层 -->
          <div v-if="syncOpen && !net.enabled" class="sync-pop card">
            <h3>实时同步</h3>
            <p class="sync-tip">
              管理员开播后,改动会实时同步给所有观众。观众端只读观看。
            </p>
            <label class="field">
              <span class="field-label">房间号(留空自动生成)</span>
              <input
                v-model="roomInput"
                class="sync-input"
                type="text"
                placeholder="例如 A123"
                maxlength="16"
              />
            </label>
            <div class="sync-actions">
              <button type="button" class="btn primary sm" @click="connectAs('admin')">
                作为管理员开播
              </button>
              <button type="button" class="btn subtle sm" @click="connectAs('viewer')">
                作为观众加入
              </button>
            </div>
            <button type="button" class="sync-close" aria-label="关闭" @click="syncOpen = false">✕</button>
          </div>
        </div>
      </div>
    </header>

    <!-- 选人进度条 -->
    <div v-if="isDrafting || isDone" class="progress-bar" aria-hidden="true">
      <div class="progress-fill" :style="{ width: progressPct + '%' }"></div>
    </div>

    <!-- 当前轮次横幅 -->
    <section v-if="isDrafting && store.currentTeam.value" class="turn-banner"
      :style="{ '--team-color': store.currentTeam.value.color }" aria-live="polite">
      <div class="turn-left">
        <span class="turn-eyebrow">当前轮到</span>
        <div class="turn-team">
          <span class="turn-swatch" aria-hidden="true"></span>
          <span class="turn-name">{{ store.currentTeam.value.name }}</span>
          <span v-if="store.currentTeam.value.captain" class="turn-captain">
            · {{ store.currentTeam.value.captain }}
          </span>
        </div>
        <span class="turn-progress tnum">进度 {{ progressText }}</span>
      </div>
      <div class="turn-right">
        <PickTimer v-if="state.config.pickTimer > 0" :remaining="state.timerRemaining" :total="state.config.pickTimer"
          :running="state.timerRunning" />
        <button type="button" class="btn subtle sm" @click="store.undoLastPick()">
          撤销上一手
        </button>
      </div>
    </section>

    <section v-else-if="isDone" class="done-banner" aria-live="polite">
      <span class="done-icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <span>选人完成，共分配 {{ store.totalPicks.value }} 人</span>
      <button type="button" class="btn ghost sm" @click="store.undoLastPick()">撤销上一手</button>
      <button type="button" class="btn ghost sm" @click="store.resetDraft()">重新开始</button>
    </section>

    <!-- 现场说明 (纳入同步; 管理员可编辑, 观众只读) -->
    <section
      v-if="canEditNotice || noticeText"
      class="notice-panel"
      :class="{ open: noticeOpen }"
    >
      <button
        type="button"
        class="notice-head"
        :aria-expanded="noticeOpen"
        @click="noticeOpen = !noticeOpen"
      >
        <span class="notice-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
          现场说明
        </span>
        <span class="notice-preview" v-if="!noticeOpen && noticeText">{{ noticeText }}</span>
        <svg class="notice-caret" :class="{ open: noticeOpen }" width="14" height="14" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
          aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div v-if="noticeOpen" class="notice-body">
        <textarea
          v-if="canEditNotice"
          v-model="noticeText"
          class="notice-input"
          rows="3"
          maxlength="500"
          placeholder="给观众的规则说明 / 赛制 / 注意事项，会实时同步给所有人。"
          aria-label="现场说明"
        ></textarea>
        <p v-else-if="noticeText" class="notice-text">{{ noticeText }}</p>
        <p v-else class="notice-empty">暂无说明。</p>
      </div>
    </section>

    <!-- 移动端标签切换 -->
    <div v-if="isMobile" class="mobile-tabs" role="tablist" aria-label="视图切换">
      <button
        type="button"
        role="tab"
        class="mobile-tab"
        :class="{ active: mobileTab === 'pool' }"
        :aria-selected="mobileTab === 'pool'"
        @click="mobileTab = 'pool'"
      >
        候选席
        <span class="mobile-tab-count tnum">{{ store.availablePlayers.value.length }}</span>
      </button>
      <button
        type="button"
        role="tab"
        class="mobile-tab"
        :class="{ active: mobileTab === 'teams' }"
        :aria-selected="mobileTab === 'teams'"
        @click="mobileTab = 'teams'"
      >
        战队面板
        <span class="mobile-tab-count tnum">{{ state.teams.length }}</span>
      </button>
    </div>

    <!-- 主体：左配置+候选，右队伍 -->
    <div class="layout" :class="{ readonly: isReadonly, mobile: isMobile }">
      <div class="col-left" :class="{ 'mobile-hidden': isMobile && mobileTab !== 'pool' }">
        <SetupPanel :store="store" />
        <PlayerPool :store="store" />
      </div>

      <div class="col-right" :class="{ 'mobile-hidden': isMobile && mobileTab !== 'teams' }">
        <div class="teams-head">
          <h2>战队面板 <span class="team-total tnum">{{ state.teams.length }}</span></h2>
          <div class="teams-head-right">
            <span class="hint">{{ dragHint }}</span>
          </div>
        </div>
        <div class="teams-scroll">
        <div class="teams-grid" :class="{ dense: teamCompact }" :style="{ '--team-min': teamMinWidth }">
          <TeamBoard v-for="(t, i) in state.teams" :key="t.id" :team="t" :members="membersOf(t)" :index="i"
            :is-active="isDrafting && store.currentTeamId.value === t.id" :editable="teamsEditable"
            :compact="teamCompact" :all-teams="state.teams" @update="(patch) => store.updateTeam(t.id, patch)"
            @remove-member="(pid) => store.unassignPlayer(pid)"
            @assign="(payload) => store.assignPlayer(payload.playerId, payload.toTeamId, payload.index)"
            @move-member="(payload) => store.assignPlayer(payload.playerId, payload.toTeamId)"
            @unassign-member="(pid) => store.unassignPlayer(pid)" />
        </div>
        </div>
      </div>
    </div>

    <!-- toast -->
    <transition name="toast">
      <div v-if="toast" class="toast" role="status" aria-live="polite">{{ toast }}</div>
    </transition>
  </div>
</template>

<style scoped>
.app-shell {
  width: min(100% - 40px, 1760px);
  margin: 0 auto;
  padding: 20px 0 72px;
}

/* 顶栏 */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: var(--accent-soft);
  color: var(--accent);
}

.brand-text h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 0.01em;
}

.brand-text p {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--text-muted);
}

.toolbar {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

/* 进度条 */
.progress-bar {
  height: 4px;
  border-radius: 999px;
  background: var(--surface-3);
  overflow: hidden;
  margin-bottom: 14px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), var(--gold));
  transition: width 0.3s ease-out;
}

/* 当前轮次横幅 */
.turn-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 14px 18px;
  margin-bottom: 18px;
  border-radius: 14px;
  border: 1px solid var(--gold-border);
  background:
    linear-gradient(180deg, var(--gold-soft), transparent),
    var(--surface-1);
  box-shadow: 0 0 26px -10px var(--gold-glow);
}

.turn-left {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.turn-eyebrow {
  font-size: 12px;
  font-weight: 700;
  color: var(--gold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.turn-team {
  display: flex;
  align-items: center;
  gap: 8px;
}

.turn-swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background: var(--team-color, var(--accent));
}

.turn-name {
  font-size: 18px;
  font-weight: 800;
  color: var(--text);
}

.turn-captain {
  font-size: 14px;
  color: var(--text-muted);
}

.turn-progress {
  font-size: 13px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.turn-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* 完成横幅 */
.done-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 18px;
  margin-bottom: 18px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--success) 40%, transparent);
  background: color-mix(in srgb, var(--success) 12%, var(--surface-1));
  font-weight: 600;
}

.done-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: var(--success);
  color: #04140a;
}

/* 布局 */
.layout {
  display: grid;
  grid-template-columns: minmax(0, 380px) minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}

.col-left,
.col-right {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.teams-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.teams-head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}

.teams-head .hint {
  font-size: 12px;
  color: var(--text-muted);
}

.team-total {
  display: inline-grid;
  place-items: center;
  min-width: 24px;
  height: 22px;
  padding: 0 7px;
  margin-left: 6px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  vertical-align: middle;
}

/* 自适应列: 队伍多时自动换行, 每列不低于 --team-min */
.teams-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--team-min, 240px), 1fr));
  gap: 14px;
}

.teams-grid.dense {
  gap: 10px;
}

/* toast */
.toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 1200;
  padding: 10px 18px;
  border-radius: 10px;
  background: var(--surface-3);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
  box-shadow: 0 12px 40px -12px rgba(0, 0, 0, 0.6);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease-out, transform 0.2s ease-out;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* ---- 移动端标签栏 (默认隐藏, ≤640px 显示) ---- */
.mobile-tabs {
  display: none;
  gap: 6px;
  margin-bottom: 14px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-1);
}
.mobile-tab {
  flex: 1 1 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 44px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.16s ease-out, color 0.16s ease-out;
}
.mobile-tab.active {
  background: var(--accent-soft);
  color: var(--accent);
}
.mobile-tab .tab-badge {
  min-width: 20px;
  height: 18px;
  padding: 0 6px;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  background: var(--surface-3);
  color: var(--text);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 900px) {
  .layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .mobile-tabs {
    display: flex;
  }
  /* 标签模式下, 未选中的列隐藏 */
  .layout.mobile .col-left.mobile-hidden,
  .layout.mobile .col-right.mobile-hidden {
    display: none;
  }
  /* 移动端取消战队区独立滚动, 跟随页面滚动 */
  .teams-scroll {
    max-height: none;
    overflow: visible;
  }
}

@media (prefers-reduced-motion: reduce) {

  .progress-fill,
  .toast-enter-active,
  .toast-leave-active {
    transition: none;
  }
}

/* ---- 实时同步 UI ---- */
.sync-box {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
}

.sync-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 600;
}
.sync-status .dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--text-faint);
  transition: background 0.2s ease-out;
}
.sync-status.online {
  color: var(--text);
  border-color: color-mix(in srgb, var(--success) 45%, var(--border));
}
.sync-status.online .dot {
  background: var(--success);
  box-shadow: 0 0 8px -1px var(--success);
}
.sync-clients {
  color: var(--text-muted);
  font-size: 12px;
  padding-left: 6px;
  border-left: 1px solid var(--border);
}

.sync-pop {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 1100;
  width: min(92vw, 320px);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px;
  animation: sync-pop-in 0.18s ease-out;
}
@keyframes sync-pop-in {
  from { opacity: 0; transform: translateY(-6px) scale(0.98); }
}
.sync-pop h3 {
  margin: 0;
  font-size: 15px;
}
.sync-tip {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-muted);
}
.sync-pop .field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sync-pop .field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}
.sync-input {
  height: 40px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font-size: 14px;
}
.sync-input:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
}
.sync-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sync-close {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 13px;
}
.sync-close:hover {
  background: var(--surface-3);
  color: var(--text);
}

/* 观众只读: 屏蔽一切编辑交互, 仅保留查看与滚动 */
.layout.readonly {
  position: relative;
}
.layout.readonly :is(button, input, textarea, .player-card, .segment, .ghost-btn),
.layout.readonly [draggable='true'] {
  pointer-events: none !important;
}
.layout.readonly [draggable='true'] {
  -webkit-user-drag: none;
}

/* 观众只读: 顶部标识条 */
.readonly-ribbon {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 16px;
  margin-bottom: 14px;
  border-radius: 10px;
  border: 1px solid var(--gold-border);
  background: var(--gold-soft);
  color: var(--gold);
  font-size: 13px;
  font-weight: 600;
}

/* ---- 现场说明面板 ---- */
.notice-panel {
  margin-bottom: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-1);
  overflow: hidden;
}
.notice-head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  border: 0;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  text-align: left;
}
.notice-head:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--accent-ring);
}
.notice-title {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 700;
  color: var(--accent);
}
.notice-preview {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.notice-caret {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--text-muted);
  transition: transform 0.2s ease-out;
}
.notice-caret.open {
  transform: rotate(180deg);
}
.notice-body {
  padding: 0 14px 14px;
}
.notice-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text);
  font: inherit;
  font-size: 14px;
  line-height: 1.6;
  resize: vertical;
}
.notice-input:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
}
.notice-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text);
  white-space: pre-wrap;
}
.notice-empty {
  margin: 0;
  font-size: 13px;
  color: var(--text-faint);
}

@media (prefers-reduced-motion: reduce) {
  .sync-pop {
    animation: none;
  }
  .notice-caret {
    transition: none;
  }
}
</style>
