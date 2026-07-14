// 数据源适配器
// 统一接口: load() / save(data) / subscribe(cb) / close()
// 现用 LocalAdapter(localStorage), 预留 RemoteAdapter(WebSocket) 供后续联网。
// store 只依赖这个接口, 换数据源时无需改动业务逻辑。

export class LocalAdapter {
  constructor(key = 'live-draft:v1') {
    this.key = key
    this._subs = new Set()
    // 跨标签页同步: 另一个标签写入时收到 storage 事件
    this._onStorage = (e) => {
      if (e.key === this.key && e.newValue) {
        try {
          const data = JSON.parse(e.newValue)
          this._subs.forEach((cb) => cb(data))
        } catch {
          /* ignore malformed */
        }
      }
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', this._onStorage)
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(this.key)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  save(data) {
    try {
      localStorage.setItem(this.key, JSON.stringify(data))
      return true
    } catch {
      return false
    }
  }

  // 本地备份: 带时间戳单独存一份
  backup(data) {
    try {
      const stamp = new Date().toISOString()
      localStorage.setItem(`${this.key}:backup:${stamp}`, JSON.stringify(data))
      return stamp
    } catch {
      return null
    }
  }

  listBackups() {
    const out = []
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(`${this.key}:backup:`)) {
          out.push({ key: k, stamp: k.slice(`${this.key}:backup:`.length) })
        }
      }
    } catch {
      /* ignore */
    }
    return out.sort((a, b) => (a.stamp < b.stamp ? 1 : -1))
  }

  loadBackup(key) {
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  subscribe(cb) {
    this._subs.add(cb)
    return () => this._subs.delete(cb)
  }

  close() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', this._onStorage)
    }
    this._subs.clear()
  }
}

// 联网适配器: 通过 WebSocket 与 server/index.js 实时同步。
// 协议 (与服务端约定一致):
//   上行: { type:'snapshot', payload }  (仅 admin 有效)
//         { type:'ping', t }
//         { type:'request-sync' }
//   下行: { type:'init', role, rev, payload, clients }
//         { type:'snapshot', rev, originId, payload }
//         { type:'presence', clients }
//         { type:'pong', t }
//
// 回声防护: 服务端广播管理员改动时带 originId; 本客户端用自己的 clientId
// 比对, 忽略自己发出的快照回声, 避免自我覆盖。
//
// 事件回调 (subscribe(cb)) 收到规整后的对象:
//   { kind:'snapshot', payload, rev, isEcho }
//   { kind:'presence', clients }
//   { kind:'status', online }
export class RemoteAdapter {
  constructor(url, { role = 'viewer', room = 'default', clientId } = {}) {
    this.role = role === 'admin' ? 'admin' : 'viewer'
    this.room = room
    this.clientId = clientId || `c_${Math.random().toString(36).slice(2, 10)}`
    this._baseUrl = url
    this._subs = new Set()
    this._ws = null
    this._queue = [] // 未连接时缓存的上行快照 (仅保留最新一条)
    this._closedByUser = false
    this._reconnectDelay = 1000
    this._heartbeat = null
    this._connect()
  }

  _fullUrl() {
    const sep = this._baseUrl.includes('?') ? '&' : '?'
    const q = `room=${encodeURIComponent(this.room)}&role=${this.role}&id=${encodeURIComponent(this.clientId)}`
    return `${this._baseUrl}${sep}${q}`
  }

  _emit(evt) {
    this._subs.forEach((cb) => cb(evt))
  }

  _connect() {
    if (typeof WebSocket === 'undefined') return
    let ws
    try {
      ws = new WebSocket(this._fullUrl())
    } catch {
      this._scheduleReconnect()
      return
    }
    this._ws = ws

    ws.onopen = () => {
      this._reconnectDelay = 1000
      this._emit({ kind: 'status', online: true })
      // flush 最新一条待发快照
      if (this._queue.length) {
        const last = this._queue[this._queue.length - 1]
        this._queue = []
        this._rawSend(last)
      } else {
        // 重连后主动对齐一次
        this._rawSend({ type: 'request-sync' })
      }
      this._startHeartbeat()
    }

    ws.onmessage = (ev) => {
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if (msg.type === 'init') {
        if (msg.payload) this._emit({ kind: 'snapshot', payload: msg.payload, rev: msg.rev, isEcho: false })
        if (typeof msg.clients === 'number') this._emit({ kind: 'presence', clients: msg.clients })
      } else if (msg.type === 'snapshot') {
        this._emit({
          kind: 'snapshot',
          payload: msg.payload,
          rev: msg.rev,
          isEcho: msg.originId === this.clientId,
        })
      } else if (msg.type === 'presence') {
        this._emit({ kind: 'presence', clients: msg.clients })
      }
    }

    ws.onclose = () => {
      this._stopHeartbeat()
      this._emit({ kind: 'status', online: false })
      if (!this._closedByUser) this._scheduleReconnect()
    }

    ws.onerror = () => {
      // 交给 onclose 统一处理重连
      try { ws.close() } catch { /* ignore */ }
    }
  }

  _scheduleReconnect() {
    if (this._closedByUser) return
    setTimeout(() => this._connect(), this._reconnectDelay)
    // 指数退避, 上限 8s
    this._reconnectDelay = Math.min(this._reconnectDelay * 2, 8000)
  }

  _startHeartbeat() {
    this._stopHeartbeat()
    this._heartbeat = setInterval(() => {
      this._rawSend({ type: 'ping', t: Date.now() })
    }, 25000)
  }

  _stopHeartbeat() {
    if (this._heartbeat) clearInterval(this._heartbeat)
    this._heartbeat = null
  }

  _rawSend(obj) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(obj))
      return true
    }
    return false
  }

  // 接口对齐 LocalAdapter: load 无同步返回, 首帧由 init 推送
  load() {
    return null
  }

  // 仅管理员推送有效 (服务端也会二次校验)
  save(data) {
    const msg = { type: 'snapshot', payload: data }
    if (!this._rawSend(msg)) {
      // 未连接: 只保留最新一条, 连接后 flush
      this._queue = [msg]
    }
    return true
  }

  subscribe(cb) {
    this._subs.add(cb)
    return () => this._subs.delete(cb)
  }

  close() {
    this._closedByUser = true
    this._stopHeartbeat()
    if (this._ws) {
      try { this._ws.close() } catch { /* ignore */ }
    }
    this._subs.clear()
  }
}
