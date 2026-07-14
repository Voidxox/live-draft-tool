// 全局拖拽状态单例 (HTML5 原生拖放)
// 管理员把马匹卡片从候选席 / 队伍之间拖动分配。
// 组件通过 dragState 读取当前拖动对象, 用高亮反馈放置目标。
//
// 约定:
//   fromTeamId === null  表示卡片来自候选席
//   overTeamId === '__pool__' 表示悬停在候选席放置区
//   overIndex 为队伍内插入位置 (-1 = 追加到末尾)

import { reactive } from 'vue'

export const dragState = reactive({
  active: false,
  playerId: null,
  fromTeamId: null, // null = 来自候选席
  overTeamId: null, // 当前悬停的放置区: teamId 或 '__pool__'
  overIndex: -1,
})

// 开始拖动某张卡片。dataTransfer 由调用方 (PlayerCard) 自行设置。
export function startDrag(playerId, fromTeamId = null) {
  dragState.active = true
  dragState.playerId = playerId
  dragState.fromTeamId = fromTeamId ?? null
  dragState.overTeamId = null
  dragState.overIndex = -1
}

// 记录当前悬停的放置目标及插入位置
export function setDropTarget(teamId, index = -1) {
  dragState.overTeamId = teamId
  dragState.overIndex = index
}

// 离开放置区时清除高亮
export function clearDropTarget() {
  dragState.overTeamId = null
  dragState.overIndex = -1
}

// 结束拖动, 复位全部状态
export function endDrag() {
  dragState.active = false
  dragState.playerId = null
  dragState.fromTeamId = null
  dragState.overTeamId = null
  dragState.overIndex = -1
}
