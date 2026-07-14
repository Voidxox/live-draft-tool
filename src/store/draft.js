import { reactive, computed, watch } from 'vue'
import { generatePickOrder } from '../composables/useDraftEngine.js'
import { LocalAdapter, RemoteAdapter } from './syncAdapter.js'

// ---- 唯一 ID ----
let _seq = 1
const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}_${(_seq++).toString(36)}`

// ---- 默认配置 ----
export const MAX_TEAMS = 24
export const MIN_TEAMS = 2

const DEFAULT_CONFIG = {
  teamCount: 2,
  orderMode: 'snake', // sequential | snake | randomFirst
  pickTimer: 30, // 每手秒数, 0 = 关闭
  cardsPerRow: 4,
  notice: '', // 现场说明 (管理员编辑, 观众可见, 纳入同步快照)
}

const PRESET_COLORS = [
  '#2f81f7', '#f85149', '#3fb950', '#f0b429',
  '#a371f7', '#db61a2', '#39c5cf', '#ff7b72',
]

function makeTeam(index) {
  return {
    id: uid('team'),
    name: `战队 ${index + 1}`,
    captain: '',
    color: PRESET_COLORS[index % PRESET_COLORS.length],
    members: [], // player ids
  }
}

// ---- 核心响应式状态 ----
const state = reactive({
  config: { ...DEFAULT_CONFIG },
  teams: [makeTeam(0), makeTeam(1)],
  pool: [], // { id, name, note, tags:[] }
  // 选人流程
  phase: 'setup', // setup | drafting | done
  pickOrder: [], // team id 序列
  currentStep: 0, // 指向 pickOrder 的下标
  history: [], // { playerId, teamId, step } 用于撤销
  timerRemaining: 0,
  timerRunning: false,
})

let _timerHandle = null
const adapter = new LocalAdapter('live-draft:v1')

// ---- 联网实时同步状态 ----
const net = reactive({
  enabled: false, // 是否已接入实时同步
  connected: false, // socket 是否在线
  role: 'viewer', // admin | viewer
  room: '', // 房间号
  clients: 0, // 房间在线人数
  rev: 0, // 已应用的服务端版本号
})

let _remote = null // RemoteAdapter 实例
let _applyingRemote = false // 回声防护: 正在应用远端快照时, 不再向外推送
let _stopWatch = null // 停止 watch 的句柄
let _pushHandle = null // 推送 debounce 句柄

// ---- 计算属性 ----
const assignedPlayerIds = computed(() => {
  const s = new Set()
  state.teams.forEach((t) => t.members.forEach((id) => s.add(id)))
  return s
})

const availablePlayers = computed(() =>
  state.pool.filter((p) => !assignedPlayerIds.value.has(p.id)),
)

const currentTeamId = computed(() => state.pickOrder[state.currentStep] ?? null)
const currentTeam = computed(
  () => state.teams.find((t) => t.id === currentTeamId.value) ?? null,
)

const totalPicks = computed(() => state.pickOrder.length)
const isDraftComplete = computed(
  () => state.phase === 'drafting' && state.currentStep >= state.pickOrder.length,
)

function playerById(id) {
  return state.pool.find((p) => p.id === id) ?? null
}

// ---- 队伍管理 ----
function setTeamCount(n) {
  const target = Math.max(MIN_TEAMS, Math.min(MAX_TEAMS, Number(n) || MIN_TEAMS))
  state.config.teamCount = target
  while (state.teams.length < target) state.teams.push(makeTeam(state.teams.length))
  if (state.teams.length > target) {
    // 收缩时把被裁掉队伍的成员放回候选池(通过清空 members 即可,pool 保持不变)
    state.teams.splice(target)
  }
}

function updateTeam(id, patch) {
  const t = state.teams.find((x) => x.id === id)
  if (t) Object.assign(t, patch)
}

// ---- 候选池管理 ----
function addPlayer(name, note = '') {
  const clean = String(name || '').trim()
  if (!clean) return null
  const player = { id: uid('p'), name: clean, note: String(note || '').trim(), tags: [] }
  state.pool.push(player)
  return player
}

function addPlayersBulk(text) {
  const names = String(text || '')
    .split(/[\n,，、；;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const added = []
  for (const n of names) {
    const p = addPlayer(n)
    if (p) added.push(p)
  }
  return added
}

function updatePlayer(id, patch) {
  const p = state.pool.find((x) => x.id === id)
  if (p) Object.assign(p, patch)
}

function removePlayer(id) {
  const i = state.pool.findIndex((x) => x.id === id)
  if (i >= 0) state.pool.splice(i, 1)
  state.teams.forEach((t) => {
    const mi = t.members.indexOf(id)
    if (mi >= 0) t.members.splice(mi, 1)
  })
}

// ---- 管理员拖动分配 ----
// 找到玩家当前所在队伍 (未分配返回 null)
function teamOfPlayer(playerId) {
  return state.teams.find((t) => t.members.includes(playerId)) ?? null
}

// 把玩家从任意来源(候选席或其它队伍)分配到目标队伍的指定位置。
// index 省略则追加到末尾。管理员操作, 不受 phase 限制。
function assignPlayer(playerId, toTeamId, index = -1) {
  const target = state.teams.find((t) => t.id === toTeamId)
  if (!target) return false
  const player = playerById(playerId)
  if (!player) return false

  const from = teamOfPlayer(playerId)
  // 同队内重排
  if (from && from.id === toTeamId) {
    const cur = target.members.indexOf(playerId)
    if (cur < 0) return false
    target.members.splice(cur, 1)
    let pos = index < 0 || index > target.members.length ? target.members.length : index
    // 若原位置在插入点之前, 删除后目标下标已左移一位
    if (cur < pos) pos -= 1
    target.members.splice(pos, 0, playerId)
    _touchDrag({ playerId, fromTeamId: from.id, toTeamId, prevIndex: cur })
    return true
  }

  // 从其它队伍或候选席移入
  if (from) {
    const fi = from.members.indexOf(playerId)
    if (fi >= 0) from.members.splice(fi, 1)
  }
  const pos = index < 0 || index > target.members.length ? target.members.length : index
  target.members.splice(pos, 0, playerId)
  _touchDrag({ playerId, fromTeamId: from ? from.id : null, toTeamId, prevIndex: -1 })
  return true
}

// 把玩家放回候选席(从所在队伍移除)
function unassignPlayer(playerId) {
  const from = teamOfPlayer(playerId)
  if (!from) return false
  const fi = from.members.indexOf(playerId)
  if (fi >= 0) from.members.splice(fi, 1)
  _touchDrag({ playerId, fromTeamId: from.id, toTeamId: null, prevIndex: fi })
  return true
}

// 拖动操作记入历史, 支持 Ctrl+Z 撤销
function _touchDrag(entry) {
  state.history.push({ type: 'drag', ...entry })
}

// ---- 选人流程 ----
function startDraft() {
  if (state.pool.length === 0) return { ok: false, msg: '候选池为空,先添加玩家' }
  // 清空既有分配
  state.teams.forEach((t) => (t.members = []))
  state.pickOrder = generatePickOrder(
    state.teams.map((t) => t.id),
    availablePlayers.value.length,
    state.config.orderMode,
  )
  state.currentStep = 0
  state.history = []
  state.phase = 'drafting'
  resetTimer()
  if (state.config.pickTimer > 0) startTimer()
  return { ok: true }
}

function pickPlayer(playerId) {
  if (state.phase !== 'drafting') return
  const teamId = currentTeamId.value
  if (!teamId) return
  if (assignedPlayerIds.value.has(playerId)) return
  const team = state.teams.find((t) => t.id === teamId)
  if (!team) return
  team.members.push(playerId)
  state.history.push({ playerId, teamId, step: state.currentStep })
  advanceStep()
}

function advanceStep() {
  state.currentStep += 1
  if (state.currentStep >= state.pickOrder.length || availablePlayers.value.length === 0) {
    finishDraft()
  } else {
    resetTimer()
    if (state.config.pickTimer > 0) startTimer()
  }
}

function undoLastPick() {
  const last = state.history.pop()
  if (!last) return

  // 拖动操作: 还原到原来的队伍/候选席
  if (last.type === 'drag') {
    // 先把它从当前所在队伍移除
    const cur = teamOfPlayer(last.playerId)
    if (cur) {
      const ci = cur.members.indexOf(last.playerId)
      if (ci >= 0) cur.members.splice(ci, 1)
    }
    // 放回原队伍原位置; fromTeamId 为 null 表示原本在候选席, 无需回填
    if (last.fromTeamId) {
      const from = state.teams.find((t) => t.id === last.fromTeamId)
      if (from) {
        const pos = last.prevIndex >= 0 && last.prevIndex <= from.members.length
          ? last.prevIndex
          : from.members.length
        from.members.splice(pos, 0, last.playerId)
      }
    }
    return
  }

  // 轮选操作
  const team = state.teams.find((t) => t.id === last.teamId)
  if (team) {
    const mi = team.members.indexOf(last.playerId)
    if (mi >= 0) team.members.splice(mi, 1)
  }
  state.currentStep = last.step
  if (state.phase === 'done') state.phase = 'drafting'
  resetTimer()
  if (state.config.pickTimer > 0) startTimer()
}

function finishDraft() {
  state.phase = 'done'
  stopTimer()
}

function resetDraft() {
  state.teams.forEach((t) => (t.members = []))
  state.phase = 'setup'
  state.pickOrder = []
  state.currentStep = 0
  state.history = []
  resetTimer()
}

// 全随机分组(不走轮选流程,直接均分)
function randomAssignAll() {
  const players = [...availablePlayers.value]
  // Fisher–Yates
  for (let i = players.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[players[i], players[j]] = [players[j], players[i]]
  }
  players.forEach((p, i) => {
    state.teams[i % state.teams.length].members.push(p.id)
  })
  state.phase = 'done'
  stopTimer()
}

// ---- 计时器 ----
function startTimer() {
  stopTimer()
  if (state.config.pickTimer <= 0) return
  state.timerRemaining = state.config.pickTimer
  state.timerRunning = true
  _timerHandle = setInterval(() => {
    state.timerRemaining -= 1
    if (state.timerRemaining <= 0) {
      state.timerRemaining = 0
      stopTimer()
      // 超时不自动选人, 仅提示; 交由队长手动或跳过
    }
  }, 1000)
}

function stopTimer() {
  if (_timerHandle) clearInterval(_timerHandle)
  _timerHandle = null
  state.timerRunning = false
}

function resetTimer() {
  stopTimer()
  state.timerRemaining = state.config.pickTimer
}

// ---- 持久化 ----
function snapshot() {
  return {
    config: state.config,
    teams: state.teams,
    pool: state.pool,
    phase: state.phase,
    pickOrder: state.pickOrder,
    currentStep: state.currentStep,
    history: state.history,
  }
}

function restore(data) {
  if (!data || typeof data !== 'object') return false
  if (data.config) Object.assign(state.config, data.config)
  if (Array.isArray(data.teams)) state.teams = data.teams
  if (Array.isArray(data.pool)) state.pool = data.pool
  if (data.phase) state.phase = data.phase
  if (Array.isArray(data.pickOrder)) state.pickOrder = data.pickOrder
  if (typeof data.currentStep === 'number') state.currentStep = data.currentStep
  if (Array.isArray(data.history)) state.history = data.history
  return true
}

function saveLocal() {
  return adapter.save(snapshot())
}

function loadLocal() {
  const data = adapter.load()
  return data ? restore(data) : false
}

function exportJSON() {
  return JSON.stringify(snapshot(), null, 2)
}

function importJSON(text) {
  try {
    return restore(JSON.parse(text))
  } catch {
    return false
  }
}

// ---- 备份 (带时间戳, 独立于当前存档) ----
function createBackup() {
  return adapter.backup(snapshot())
}

function listBackups() {
  return adapter.listBackups()
}

// 恢复最新一份备份; 无备份返回 false
function restoreLatestBackup() {
  const list = adapter.listBackups()
  if (!list.length) return false
  const data = adapter.loadBackup(list[0].key)
  return data ? restore(data) : false
}

// ---- 实时同步 (WebSocket) ----
// 管理员 (role=admin) 的任何状态改动 → debounce 后推送快照;
// 观众 (viewer) 只接收远端快照并 restore, 只读实时观看。
// 回声防护: 应用远端快照时置 _applyingRemote, 阻止 watch 再次外推;
// 服务端广播带 originId, isEcho=true 的自身回声直接忽略。

function _applyRemoteSnapshot(payload) {
  _applyingRemote = true
  try {
    restore(payload)
  } finally {
    // 等本轮响应式副作用跑完再解锁, 避免 watch 把刚应用的快照又推出去
    Promise.resolve().then(() => {
      _applyingRemote = false
    })
  }
}

function _onRemoteEvent(evt) {
  if (evt.kind === 'snapshot') {
    net.rev = evt.rev ?? net.rev
    if (evt.isEcho) return // 自己发出的回声, 忽略
    if (evt.payload) _applyRemoteSnapshot(evt.payload)
  } else if (evt.kind === 'presence') {
    net.clients = evt.clients
  } else if (evt.kind === 'status') {
    net.connected = evt.online
  }
}

// 管理员: 监听状态变化, debounce 推送 (timer 字段不参与同步, 各端本地计时)
function _startAdminPush() {
  if (_stopWatch) return
  _stopWatch = watch(
    () => [state.config, state.teams, state.pool, state.phase, state.pickOrder, state.currentStep],
    () => {
      if (_applyingRemote) return // 正在应用远端, 不回推
      if (!_remote) return
      clearTimeout(_pushHandle)
      _pushHandle = setTimeout(() => {
        _remote.save(snapshot())
      }, 180)
    },
    { deep: true },
  )
}

// 接入实时同步。role='admin' 可编辑并推送; 'viewer' 只读接收。
// url 省略时默认连当前站点的 /ws (由 Vite / 部署反代转发)。
function connectRealtime({ role = 'viewer', room = 'default', url } = {}) {
  disconnectRealtime()
  const wsUrl =
    url ||
    (typeof location !== 'undefined'
      ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
      : 'ws://localhost:8787/ws')

  net.enabled = true
  net.role = role === 'admin' ? 'admin' : 'viewer'
  net.room = room

  _remote = new RemoteAdapter(wsUrl, { role: net.role, room })
  _remote.subscribe(_onRemoteEvent)

  if (net.role === 'admin') {
    _startAdminPush()
    // 管理员进入即把当前本地状态作为房间初始快照推上去
    _remote.save(snapshot())
  }
  return net
}

function disconnectRealtime() {
  if (_stopWatch) {
    _stopWatch()
    _stopWatch = null
  }
  clearTimeout(_pushHandle)
  if (_remote) {
    _remote.close()
    _remote = null
  }
  net.enabled = false
  net.connected = false
  net.clients = 0
}

export function useDraftStore() {
  return {
    state,
    // computed
    availablePlayers,
    currentTeamId,
    currentTeam,
    totalPicks,
    isDraftComplete,
    playerById,
    // teams
    setTeamCount,
    updateTeam,
    // pool
    addPlayer,
    addPlayersBulk,
    updatePlayer,
    removePlayer,
    // 管理员拖动分配
    teamOfPlayer,
    assignPlayer,
    unassignPlayer,
    // flow
    startDraft,
    pickPlayer,
    undoLastPick,
    finishDraft,
    resetDraft,
    randomAssignAll,
    // timer
    startTimer,
    stopTimer,
    resetTimer,
    // persistence
    saveLocal,
    loadLocal,
    exportJSON,
    importJSON,
    snapshot,
    restore,
    // 备份
    createBackup,
    listBackups,
    restoreLatestBackup,
    // 实时同步
    net,
    connectRealtime,
    disconnectRealtime,
  }
}
