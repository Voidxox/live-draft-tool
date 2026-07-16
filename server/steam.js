// 直播选人台 · Steam / V 社游戏数据源
// ---------------------------------------------------------------
// 职责: 把管理员填的 "Steam 链接 / ID / 昵称" 解析成 SteamID64,
//       再从三个数据源拉取展示所需的精简数据:
//         - Steam 官方 Web API : 头像 / 昵称 / 游戏时长      (需 STEAM_API_KEY)
//         - OpenDota           : Dota2 段位 / 胜率 / 常用英雄 (免费, 无需 key)
//         - Faceit             : CS2 段位 / ELO / K-D        (需 FACEIT_API_KEY)
//
// 设计原则: 每个源独立 try/catch, 任一源失败只把该源置 null 并记 errors,
//           绝不因为某个源查不到就整体失败 —— 直播时"查不到"要优雅降级,
//           不能阻塞选人。CS2 尤其常见 (玩家没在 Faceit 打过 = 无数据)。
// ---------------------------------------------------------------

const STEAM_API_KEY = process.env.STEAM_API_KEY || ''
const FACEIT_API_KEY = process.env.FACEIT_API_KEY || ''

const APP_DOTA2 = '570'
const APP_CS2 = '730'

// SteamID64 基准值: 32 位 account id + 此常量 = 64 位
const STEAMID64_BASE = 76561197960265728n

// ---- 通用 fetch (带超时, 统一 JSON 解析) ----
async function getJSON(url, { headers, timeout = 8000 } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal })
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`)
      err.status = res.status
      throw err
    }
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

// ---- 通用 fetch (带超时, 返回纯文本; 供 Community XML 用) ----
async function getText(url, { timeout = 8000 } = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`)
      err.status = res.status
      throw err
    }
    return await res.text()
  } finally {
    clearTimeout(t)
  }
}

// ---- Steam Community XML (免 key 回退) ----
// steamcommunity.com/profiles/<id>?xml=1 与 /id/<vanity>?xml=1 都返回一份
// 公开资料 XML, 无需 API key。能拿到: 头像 / 昵称 / vanity 解析 / 公开状态。
// 拿不到: 游戏时长 (该端点已被 Steam 要求登录, 故不在此获取)。
//
// 极小正则解析器: 只取我们要的几个字段, 不引 XML 库。字段值多为
// <![CDATA[...]]> 包裹, 统一剥掉。
function _xmlField(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))
  if (!m) return ''
  let v = m[1].trim()
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/)
  if (cdata) v = cdata[1]
  return v.trim()
}

// 拉取并解析 Community XML。by='profiles' 用 SteamID64, by='id' 用 vanity。
async function fetchCommunityXML(idOrVanity, by = 'profiles') {
  const seg = by === 'id' ? 'id' : 'profiles'
  const xml = await getText(
    `https://steamcommunity.com/${seg}/${encodeURIComponent(idOrVanity)}?xml=1`,
  )
  // 私密 / 不存在的资料没有 steamID64 字段
  const steamId64 = _xmlField(xml, 'steamID64')
  if (!steamId64) return null
  return {
    steamId64,
    name: _xmlField(xml, 'steamID'),
    avatar: _xmlField(xml, 'avatarFull') || _xmlField(xml, 'avatarMedium') || _xmlField(xml, 'avatarIcon'),
    customURL: _xmlField(xml, 'customURL'),
    // visibilityState: 3 = 公开
    public: _xmlField(xml, 'visibilityState') === '3',
  }
}

// ---- 输入解析: 各种格式统一成 SteamID64 ----
// 支持: 纯 SteamID64 / profiles 链接 / id vanity 链接 / STEAM_0:X:Y / 裸 vanity 名
export async function resolveSteamId(input) {
  const raw = String(input || '').trim()
  if (!raw) throw new Error('输入为空')

  // 1) 直接是 17 位 SteamID64
  if (/^\d{17}$/.test(raw)) return raw

  // 2) profiles 链接: .../profiles/7656119XXXXXXXXXX
  const profMatch = raw.match(/profiles\/(\d{17})/)
  if (profMatch) return profMatch[1]

  // 3) STEAM_0:Y:Z 传统格式 → 64 位
  const legacy = raw.match(/^STEAM_[0-5]:([0-1]):(\d+)$/i)
  if (legacy) {
    const y = BigInt(legacy[1])
    const z = BigInt(legacy[2])
    return (z * 2n + y + STEAMID64_BASE).toString()
  }

  // 4) [U:1:XXXX] steam3 格式
  const steam3 = raw.match(/^\[U:1:(\d+)\]$/)
  if (steam3) return (BigInt(steam3[1]) + STEAMID64_BASE).toString()

  // 5) vanity: 从 /id/xxx 链接里取, 或直接当作 vanity 名
  let vanity = raw
  const idMatch = raw.match(/\/id\/([^/?#]+)/)
  if (idMatch) vanity = idMatch[1]

  // 有 key: 走官方 ResolveVanityURL
  if (STEAM_API_KEY) {
    const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${STEAM_API_KEY}&vanityurl=${encodeURIComponent(vanity)}`
    const data = await getJSON(url)
    if (data?.response?.success === 1 && data.response.steamid) {
      return data.response.steamid
    }
    throw new Error('无法解析该 Steam 链接 / 昵称')
  }

  // 无 key: 回退到 Community XML (/id/<vanity>?xml=1 也返回 steamID64)
  try {
    const info = await fetchCommunityXML(vanity, 'id')
    if (info?.steamId64) return info.steamId64
  } catch {
    /* 落到下面统一报错 */
  }
  throw new Error('无法解析该 Steam 链接 / 昵称 (资料可能非公开)')
}

// 64 位 → 32 位 account id (OpenDota 用)
function toAccountId(steamId64) {
  return (BigInt(steamId64) - STEAMID64_BASE).toString()
}

// ---- Steam 官方: 头像 / 昵称 / 游戏时长 ----
async function fetchSteamProfile(steamId64) {
  // 无 key: 回退到 Community XML, 仍能拿到头像/昵称/公开状态 (游戏时长已被 Steam 墙, 拿不到)
  if (!STEAM_API_KEY) {
    try {
      const info = await fetchCommunityXML(steamId64, 'profiles')
      if (!info) return { data: null, error: '资料非公开或不存在' }
      return {
        data: {
          name: info.name || '',
          avatar: info.avatar || '',
          profileUrl: info.customURL
            ? `https://steamcommunity.com/id/${info.customURL}`
            : `https://steamcommunity.com/profiles/${steamId64}`,
          public: info.public,
          dotaHours: null, // 免 key 拿不到时长
          cs2Hours: null,
        },
        error: null,
      }
    } catch (e) {
      return { data: null, error: e.message || '拉取失败' }
    }
  }
  try {
    const sumUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steamId64}`
    const sum = await getJSON(sumUrl)
    const p = sum?.response?.players?.[0]
    if (!p) return { data: null, error: '资料不存在' }

    const profile = {
      name: p.personaname || '',
      avatar: p.avatarfull || p.avatarmedium || p.avatar || '',
      profileUrl: p.profileurl || '',
      // communityvisibilitystate: 3 = 公开
      public: p.communityvisibilitystate === 3,
      dotaHours: null,
      cs2Hours: null,
    }

    // 游戏时长 (仅资料公开且允许查看游戏时才有)
    try {
      const gamesUrl = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${STEAM_API_KEY}&steamid=${steamId64}&include_appinfo=0&include_played_free_games=1`
      const games = await getJSON(gamesUrl)
      const list = games?.response?.games || []
      for (const g of list) {
        if (String(g.appid) === APP_DOTA2) profile.dotaHours = Math.round((g.playtime_forever || 0) / 60)
        if (String(g.appid) === APP_CS2) profile.cs2Hours = Math.round((g.playtime_forever || 0) / 60)
      }
    } catch {
      /* 游戏时长不可见, 保持 null */
    }

    return { data: profile, error: null }
  } catch (e) {
    return { data: null, error: e.message || '拉取失败' }
  }
}

// ---- Dota2 段位映射 ----
// rank_tier 两位数: 十位 = 段位, 个位 = 星级
const DOTA_MEDALS = ['', '先锋', '卫士', '中军', '统帅', '传奇', '万古流芳', '超凡入圣', '冠绝一世']
function dotaRankName(rankTier) {
  if (!rankTier) return '未定级'
  const medal = Math.floor(rankTier / 10)
  const stars = rankTier % 10
  const name = DOTA_MEDALS[medal] || '未知'
  if (medal >= 8) return name // 冠绝一世(超凡) 无星级
  return stars ? `${name} ${stars} 星` : name
}

// ---- OpenDota: 段位 / 胜率 / 常用英雄 ----
let _heroMapCache = null
let _heroMapAt = 0
async function getHeroMap() {
  // 英雄 id → 名称, 缓存 24h
  if (_heroMapCache && Date.now() - _heroMapAt < 86400000) return _heroMapCache
  try {
    const heroes = await getJSON('https://api.opendota.com/api/heroes')
    const map = {}
    for (const h of heroes) map[h.id] = h.localized_name
    _heroMapCache = map
    _heroMapAt = Date.now()
    return map
  } catch {
    return _heroMapCache || {}
  }
}

async function fetchDota2(steamId64) {
  try {
    const accountId = toAccountId(steamId64)
    const base = `https://api.opendota.com/api/players/${accountId}`
    const [player, wl, heroes, heroMap] = await Promise.all([
      getJSON(base),
      getJSON(`${base}/wl`),
      getJSON(`${base}/heroes`).catch(() => []),
      getHeroMap(),
    ])

    // profile 为 null 通常意味着未公开比赛数据
    if (!player || (!player.profile && !player.rank_tier)) {
      return { data: null, error: '未公开 Dota2 比赛数据' }
    }

    const wins = wl?.win ?? 0
    const losses = wl?.lose ?? 0
    const total = wins + losses
    const winRate = total ? Math.round((wins / total) * 1000) / 10 : null

    // 常用英雄 Top3 (heroes 已按场次降序)
    const topHeroes = (heroes || []).slice(0, 3).map((h) => {
      const g = h.games || 0
      return {
        name: heroMap[h.hero_id] || `#${h.hero_id}`,
        games: g,
        winRate: g ? Math.round((h.win / g) * 1000) / 10 : 0,
      }
    })

    return {
      data: {
        rankTier: player.rank_tier || null,
        rankName: dotaRankName(player.rank_tier),
        leaderboardRank: player.leaderboard_rank || null,
        wins,
        losses,
        winRate,
        topHeroes,
      },
      error: null,
    }
  } catch (e) {
    if (e.status === 404) return { data: null, error: '未找到 Dota2 玩家' }
    return { data: null, error: e.message || '拉取失败' }
  }
}

// ---- Faceit: CS2 段位 / ELO / 战绩 ----
async function fetchCS2(steamId64) {
  if (!FACEIT_API_KEY) return { data: null, error: '未配置 FACEIT_API_KEY' }
  const headers = { Authorization: `Bearer ${FACEIT_API_KEY}` }
  try {
    // 按 SteamID64 查 Faceit 账号
    const player = await getJSON(
      `https://open.faceit.com/data/v4/players?game=cs2&game_player_id=${steamId64}`,
      { headers },
    )
    const cs2 = player?.games?.cs2
    if (!cs2) return { data: null, error: '该玩家未注册 Faceit CS2' }

    const result = {
      nickname: player.nickname || '',
      skillLevel: cs2.skill_level || null,
      elo: cs2.faceit_elo || null,
      region: cs2.region || '',
      kd: null,
      winRate: null,
      matches: null,
    }

    // 生涯统计 (可能不存在)
    try {
      const stats = await getJSON(
        `https://open.faceit.com/data/v4/players/${player.player_id}/stats/cs2`,
        { headers },
      )
      const life = stats?.lifetime || {}
      result.kd = life['Average K/D Ratio'] ? Number(life['Average K/D Ratio']) : null
      result.winRate = life['Win Rate %'] ? Number(life['Win Rate %']) : null
      result.matches = life['Matches'] ? Number(life['Matches']) : null
    } catch {
      /* 统计不可用, 保留段位/ELO */
    }

    return { data: result, error: null }
  } catch (e) {
    if (e.status === 404) return { data: null, error: '该玩家未注册 Faceit CS2' }
    return { data: null, error: e.message || '拉取失败' }
  }
}

// ---- 对外主入口: 解析 + 三源并行拉取 → 精简 payload ----
// 返回结构直接挂到 player.steam 上, 随快照同步给观众。
export async function fetchPlayerData(input) {
  const steamId64 = await resolveSteamId(input)

  const [profileRes, dotaRes, cs2Res] = await Promise.all([
    fetchSteamProfile(steamId64),
    fetchDota2(steamId64),
    fetchCS2(steamId64),
  ])

  const errors = {}
  if (profileRes.error) errors.profile = profileRes.error
  if (dotaRes.error) errors.dota2 = dotaRes.error
  if (cs2Res.error) errors.cs2 = cs2Res.error

  return {
    steamId64,
    profile: profileRes.data,
    dota2: dotaRes.data,
    cs2: cs2Res.data,
    fetchedAt: Date.now(),
    errors: Object.keys(errors).length ? errors : null,
  }
}

// 供 server 判断配置状态 (前端可据此提示未配置的源)
export function steamConfigStatus() {
  return {
    steam: !!STEAM_API_KEY, // 官方 key: 精确头像/昵称/游戏时长, 有则用官方源
    faceit: !!FACEIT_API_KEY, // CS2 段位/ELO, 无好的免 key 源
    opendota: true, // Dota2 段位/胜率/英雄, 免费恒可用
    avatar: true, // 头像/昵称/vanity 解析: 免 key 也能经 Community XML 拿到
  }
}
