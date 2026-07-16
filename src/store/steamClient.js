// 前端 Steam 数据客户端
// ---------------------------------------------------------------
// 只负责向后端代理 (server/index.js) 发查询请求, 不持任何 API key。
// 后端返回的精简 payload 直接挂到 player.steam 上, 随 WebSocket 快照
// 同步给观众 —— 观众端零 API 调用, 只读拿到数据。
//
// 开发环境: Vite 代理把 /api 转发到 :8787 (见 vite.config.js)。
// 部署环境: 前端与后端同源, /api 直连。
// ---------------------------------------------------------------

const API_BASE = '/api/steam'

// 查询单个选手的 Steam / V 社游戏数据
// input: Steam 链接 / SteamID64 / STEAM_0:X:Y / vanity 名
// 返回 { steamId64, profile, dota2, cs2, fetchedAt, errors } 或抛错
export async function lookupSteam(input) {
  const res = await fetch(`${API_BASE}/lookup?input=${encodeURIComponent(input)}`)
  let body = null
  try {
    body = await res.json()
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok) {
    throw new Error((body && body.error) || `查询失败 (HTTP ${res.status})`)
  }
  return body
}

// 查询后端数据源配置状态 { steam, faceit, opendota }
// 用于在 UI 上提示管理员哪些源尚未配置 key。查询失败返回全 false。
export async function fetchSteamConfig() {
  try {
    const res = await fetch(`${API_BASE}/config`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch {
    return { steam: false, faceit: false, opendota: false }
  }
}
