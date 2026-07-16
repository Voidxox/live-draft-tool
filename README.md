# 直播选人台 · Ban / Pick

直播场景的「队长轮流选人 / Ban Pick」工具。深色电竞主题、直播友好、高对比。支持管理员拖动分组，以及基于 WebSocket 的多人实时同步（管理员改动，观众实时观看）。

## 功能

- **对战设置**：队伍数量（2–24）、每排卡片数、选人顺序（顺序 / 蛇形 / 首轮随机）、每手计时
- **候选席**：快速添加、批量粘贴导入、编辑、移除
- **队长轮流选人**：点候选卡即选入当前队伍并自动进入下一手；顶部横幅金色高亮当前轮到的队长
- **管理员拖动**：马匹卡片可从候选席拖入队伍、队伍间互拖、拖回候选席，带插入位置指示
- **计时器**：环形倒计时，≤5 秒转红脉冲
- **撤销 / 重开 / 全随机分组**；`Ctrl/⌘+Z` 撤销上一手
- **持久化**：本地保存/读取、JSON 导入/导出、自动保存、启动自动恢复、带时间戳备份
- **实时同步**：管理员开播后改动实时同步给所有观众，观众端只读观看
- **Steam / V 社游戏数据**：给选手绑定 Steam 链接/ID，拉取 Dota2 段位·胜率·常用英雄（OpenDota）、CS2 段位·ELO（Faceit）、头像·游戏时长（Steam 官方）；卡片上直接展示，随快照同步给观众

## 技术栈

- 前端：Vue 3（`<script setup>`）+ Vite
- 实时同步：`ws`（WebSocket）服务端 + 房间制权威快照广播

## 开发

```bash
npm install
npm run dev      # 并行启动 WebSocket 服务端(:8787) + 前端(:5173)
```

浏览器打开 http://localhost:5173/ 。

## 构建

```bash
npm run build    # 产出到 dist/
npm run preview  # 预览生产构建
```

## 实时同步用法

1. 管理员在顶栏点「实时同步」→「作为管理员开播」，得到房间号
2. 点「复制观众链接」，把链接发给观众
3. 观众打开链接即以只读模式实时观看管理员的选人过程

## Steam / V 社游戏数据

给选手绑定 Steam 账号后，可拉取并在卡片上展示竞技数据。数据由**后端代理拉取**（API key 只在服务端，不进前端），结果随快照同步给观众——观众端零 API 调用即可看到。

### 配置 API Key

复制 `.env.example` 为 `.env` 并填入 key（`.env` 已被 git 忽略）：

```bash
cp .env.example .env
```

| 变量 | 用途 | 必需 |
| --- | --- | --- |
| `STEAM_API_KEY` | 头像 / 昵称 / 游戏时长 + 解析 vanity 链接。[申请地址](https://steamcommunity.com/dev/apikey) | 可选 |
| `FACEIT_API_KEY` | CS2 段位 / ELO / 战绩。[申请地址](https://developers.faceit.com/) | 可选 |
| （无需 key） | Dota2 段位 / 胜率 / 常用英雄，走 OpenDota 免费接口 | — |

三个源相互独立：不配 key 时对应数据静默跳过，Dota2 始终可用。

### 用法

1. 候选席里点选手的「编辑」，在「Steam 链接 / ID」处粘贴主页链接、SteamID64 或昵称，点「拉取」
2. 卡片上即显示头像与段位；点「刷新 Steam」可一键更新全部已绑定选手
3. 数据存进本地存档并同步给观众

> 注意：Dota2 需玩家在客户端开启「公开比赛数据」；CS2 数据依赖玩家在 Faceit 打过——查不到时优雅降级为空，不阻塞选人。

## 目录结构

```
server/
  index.js                 # WebSocket 同步服务端 + Steam 数据 HTTP 代理
  steam.js                 # Steam / OpenDota / Faceit 数据源封装
src/
  App.vue                  # 主界面
  store/
    draft.js               # 核心状态 + 选人流程 + 实时同步 + Steam 绑定
    syncAdapter.js         # LocalAdapter(本地) / RemoteAdapter(WebSocket)
    steamClient.js         # 前端 Steam 查询客户端 (只调后端代理)
  composables/
    useDraftEngine.js      # 选人顺序生成
    useDragDrop.js         # 拖拽状态
  components/              # SetupPanel / PlayerPool / TeamBoard / PlayerCard / PickTimer
  styles/main.css          # 设计系统
```
