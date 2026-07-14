// 直播选人台 · WebSocket 实时同步服务端
// ---------------------------------------------------------------
// 职责:
//   - 按 room 维护"最新快照"(权威状态), 内存存储
//   - 新连接进来: 立即下发该房间当前快照 (init)
//   - 管理员 (role=admin) 推送 snapshot: 更新权威状态并广播给房间内其他人
//   - 观众 (默认): 只读, 忽略其上行的 snapshot
//   - 广播时带 originId, 客户端据此忽略自己的回声
//
// 连接地址:  ws://<host>/ws?room=<房间号>&role=<admin|viewer>&id=<客户端ID>
//
// 说明: 这是最小可用实现, 快照为"整份状态覆盖"。选人操作频率不高,
//       整份快照 (通常几 KB) 足够, 无需做增量协议。
// ---------------------------------------------------------------

import { WebSocketServer } from 'ws'
import { createServer } from 'node:http'

const PORT = process.env.DRAFT_WS_PORT ? Number(process.env.DRAFT_WS_PORT) : 8787

// room -> { snapshot, rev, clients:Set<ws> }
const rooms = new Map()

function getRoom(name) {
  let r = rooms.get(name)
  if (!r) {
    r = { snapshot: null, rev: 0, clients: new Set() }
    rooms.set(name, r)
  }
  return r
}

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj))
  }
}

// 广播给房间内除 exceptWs 外的所有连接
function broadcast(room, obj, exceptWs = null) {
  for (const client of room.clients) {
    if (client !== exceptWs) send(client, obj)
  }
}

function parseQuery(url) {
  const q = {}
  const idx = url.indexOf('?')
  if (idx === -1) return q
  for (const pair of url.slice(idx + 1).split('&')) {
    const [k, v] = pair.split('=')
    if (k) q[decodeURIComponent(k)] = decodeURIComponent(v || '')
  }
  return q
}

const httpServer = createServer((req, res) => {
  // 健康检查
  if (req.url === '/health' || req.url === '/ws/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }))
    return
  }
  res.writeHead(426, { 'content-type': 'text/plain' })
  res.end('Upgrade Required: this endpoint speaks WebSocket')
})

// path 只接受 /ws (与 Vite 代理约定一致)
const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

wss.on('connection', (ws, req) => {
  const q = parseQuery(req.url || '')
  const roomName = q.room || 'default'
  const role = q.role === 'admin' ? 'admin' : 'viewer'
  const clientId = q.id || `c_${Math.random().toString(36).slice(2, 10)}`

  const room = getRoom(roomName)
  room.clients.add(ws)
  ws.meta = { roomName, role, clientId }

  // 下发当前快照 (可能为 null, 客户端据此决定是否首推)
  send(ws, {
    type: 'init',
    role,
    rev: room.rev,
    payload: room.snapshot,
    clients: room.clients.size,
  })
  // 通知房间人数变化
  broadcast(room, { type: 'presence', clients: room.clients.size }, ws)

  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    if (msg.type === 'snapshot') {
      // 只有管理员能改动权威状态
      if (ws.meta.role !== 'admin') return
      room.snapshot = msg.payload
      room.rev += 1
      broadcast(
        room,
        { type: 'snapshot', rev: room.rev, originId: ws.meta.clientId, payload: msg.payload },
        ws,
      )
    } else if (msg.type === 'ping') {
      send(ws, { type: 'pong', t: msg.t })
    } else if (msg.type === 'request-sync') {
      // 客户端主动请求最新快照 (重连后对齐)
      send(ws, { type: 'init', role: ws.meta.role, rev: room.rev, payload: room.snapshot })
    }
  })

  ws.on('close', () => {
    room.clients.delete(ws)
    if (room.clients.size === 0) {
      // 房间空了保留快照一段时间, 便于管理员刷新后仍在; 这里简单保留至进程结束
      broadcast(room, { type: 'presence', clients: 0 })
    } else {
      broadcast(room, { type: 'presence', clients: room.clients.size })
    }
  })

  ws.on('error', () => {
    room.clients.delete(ws)
  })
})

httpServer.listen(PORT, () => {
  console.log(`[draft-ws] WebSocket 同步服务已启动: ws://localhost:${PORT}/ws`)
  console.log(`[draft-ws] 健康检查: http://localhost:${PORT}/health`)
})
