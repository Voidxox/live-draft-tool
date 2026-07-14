// 选人顺序生成器
// teamIds: 队伍 id 数组
// picks: 需要生成的总手数(通常等于可选玩家数)
// mode: sequential | snake | randomFirst
//
// sequential : 1 2 3 | 1 2 3 | ...
// snake      : 1 2 3 | 3 2 1 | 1 2 3 | ...  (蛇形, 公平补偿先后手)
// randomFirst: 首轮随机一个顺序, 之后按 snake 走

export function generatePickOrder(teamIds, picks, mode = 'snake') {
  if (!teamIds || teamIds.length === 0 || picks <= 0) return []

  const n = teamIds.length
  const order = []

  let baseRound = [...teamIds]

  if (mode === 'randomFirst') {
    baseRound = shuffle([...teamIds])
  }

  let round = 0
  while (order.length < picks) {
    let seq
    if (mode === 'sequential') {
      seq = baseRound
    } else {
      // snake / randomFirst: 偶数轮正序, 奇数轮逆序
      seq = round % 2 === 0 ? baseRound : [...baseRound].reverse()
    }
    for (const id of seq) {
      if (order.length >= picks) break
      order.push(id)
    }
    round += 1
  }

  return order
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
