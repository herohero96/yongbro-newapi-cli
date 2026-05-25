# @herohero96/newapi-cli

> 从终端查 NewAPI 中转站的余额、用量、模型。给开发者和 Claude Code / Cursor / Codex 用。

[![npm version](https://img.shields.io/npm/v/@herohero96/newapi-cli.svg)](https://www.npmjs.com/package/@herohero96/newapi-cli)
[![license](https://img.shields.io/npm/l/@herohero96/newapi-cli.svg)](./LICENSE)

## 这是什么

一个轻量 CLI，让你在终端里一键查 [NewAPI](https://github.com/QuantumNous/new-api) 中转站的 key 状态。不用打开管理后台、不用写 curl，直接：

```bash
$ ynapi balance

中转站   https://ai.ltcraft.cn
Key 名   pc电脑
额度     ∞ 无限额度（已用 1698.6456 美元等值）
过期     永不过期
```

## 快速开始

### 1. 一次性使用（不安装）

```bash
npx @herohero96/newapi-cli --site https://your-newapi.com --key sk-xxx balance
```

### 2. 全局安装

```bash
npm install -g @herohero96/newapi-cli
ynapi setup        # 交互式配置中转站 URL + key
ynapi balance      # 查余额
```

## 命令

| 命令 | 作用 |
|---|---|
| `ynapi setup` | 交互式写入 `~/.ynapi/config.json`（中转站 URL + API key） |
| `ynapi setup --advanced` | 额外配置 cookie + user_id，解锁 `usage` / `tokens` / `logs` 命令 |
| `ynapi snapshot` | **AI 友好**：一站式拉账号 + key + 健康检查；`--json` 输出稳定 schema |
| `ynapi account` | 查账号总余额 / 累计花费 / 总请求数（"还剩多少钱"），需 cookie |
| `ynapi balance` | 查当前 sk- 令牌的额度（cookie 在时也会显示账号行） |
| `ynapi models [-q kw]` | 列出中转站可用的模型，`-q` 关键字过滤 |
| `ynapi usage [--days N] [--by-model]` | 按天（或按模型）查看用量明细，需 cookie |
| `ynapi tokens [-a]` | 列出账号下的所有令牌，`-a` 包含禁用/过期/耗尽的，需 cookie |
| `ynapi token create <name> [...]` | 新建令牌，需 cookie |
| `ynapi token update <id\|name> [...]` | 修改令牌（按 id 或 name 定位），需 cookie |
| `ynapi token enable\|disable <id\|name>` | 启用 / 禁用令牌 |
| `ynapi token delete <id\|name>` | 删除令牌（默认 y/n 确认，`-y` 跳过） |
| `ynapi logs [-n N] [-d N] [-m X] [-t X]` | 看每次具体调用的流水明细，可按模型/令牌/天数过滤，需 cookie |
| `ynapi config show` | 打印当前生效的配置（API key / cookie 自动 mask） |
| `ynapi status` (`doctor`) | 健康检查：配置文件 / API key / cookie 是否都正常 |
| `ynapi --help` | 显示帮助 |

### 全局选项

| Flag | 作用 |
|---|---|
| `--site <url>` | 中转站地址（覆盖配置文件） |
| `--key <sk-...>` | API key（覆盖配置文件） |
| `--json` / `--compact` | 纯 JSON 输出（适合管道给 jq） |
| `-v, --version` | 打印版本号 |

### 环境变量

| 变量 | 作用 |
|---|---|
| `YNAPI_SITE` | 中转站 URL |
| `YNAPI_KEY` | API key |
| `YNAPI_COOKIE` | 浏览器 cookie（`usage` 命令用） |
| `YNAPI_USER_ID` | `new-api-user` 头里的数字 ID（`usage` 命令用） |

优先级：命令行 flag > 环境变量 > 配置文件。

## 关于 `usage` 命令

`balance` 和 `models` 用 API key 就够了，但**按天用量、token 列表、调用流水**这种数据 NewAPI 后台只对登陆 session 开放。所以 `usage` / `tokens` / `logs` 需要你额外提供浏览器 cookie：

```bash
ynapi setup --advanced
```

按提示从浏览器 DevTools 抓一次 cookie 和 `new-api-user` 值粘进去就行。cookie 一般能用几天到几周，过期了重抓即可（命令会提示"Cookie 已过期或失效，重跑 `ynapi setup --advanced`"）。

```bash
$ ynapi usage --days 7

中转站   https://ai.ltcraft.cn
用户     you@example.com (id=446)
总额度   825.0579 美元等值（剩余）
累计用   18474.5550 美元等值
总请求   77829 次

最近 7 天用量
────────────────────────────────────────────────────────────────
日期        请求数   tokens     金额($)   主力模型
2026-05-23      67    4087827    5.5559   gpt-5.5
2026-05-24     273     567772   51.2757   claude-opus-4-7
────────────────────────────────────────────────────────────────
合计           340    4655599   56.8316
```

加 `--by-model` 切换成按模型分组（同样的数据，换个聚合维度）：

```bash
$ ynapi usage --days 7 --by-model
```

## `logs` 命令：看每次具体调用

`usage` 是日总和，`logs` 是流水明细 — 用来回答「我刚那次调用花了多少」「哪个 token 在偷偷烧钱」这种问题：

```bash
$ ynapi logs --limit 5 --days 1

共 506 条调用（显示 5 条）@ https://ai.ltcraft.cn 最近 1 天
─────────────────────────────────────────────────────────────────────
时间            模型                     tokens(in/out)   花费($)   Token名
05-25 11:02:26  claude-opus-4-7          0 / 105          0.0813    pc电脑
05-25 11:02:14  claude-opus-4-7          0 / 83           0.0826    pc电脑
...
```

支持服务端过滤：`--model claude` 只看 Claude 调用、`--token pc电脑` 只看某个令牌发的。配 `--json` 管道给 jq 可以做更复杂的分析。

## `status` 命令：一键诊断

命令开始失败时第一件事跑这个：

```bash
$ ynapi status

ynapi status @ https://ai.ltcraft.cn

  ✓  config     C:\Users\you\.ynapi\config.json
  ✓  api-key    sk-qAM***hL7m — 余额 ∞ (805ms)
  ✗  cookie     Cookie 已过期或失效（HTTP 401）。重跑 `ynapi setup --advanced` 粘贴新的 Cookie。

1 项失败
```

退出码：全过返回 0，有失败返回 1，方便脚本检测。`--json` 输出包含每项的 latency 和 status code，适合监控用。

## `token` 命令：增删改令牌

`tokens` 是只读列表，`token` 是写操作（按 id 或 name 定位都行）：

```bash
# 新建（额度按 NewAPI 内部 quota 单位，1 美元 ≈ 500000）
ynapi token create "测试令牌" -q 500000
ynapi token create "无限 token" --unlimited --expires 2026-12-31

# 改（按 name 或 id 定位都行）
ynapi token update "测试令牌" -q 1000000        # 改额度
ynapi token update 1234 --name "新名字"           # 改名
ynapi token update "测试令牌" --limited           # 取消无限额度

# 启用 / 禁用
ynapi token disable "测试令牌"
ynapi token enable "测试令牌"

# 删（默认要 y/n 确认）
ynapi token delete "测试令牌"
ynapi token rm 1234 -y                           # 跳过确认
```

⚠️ **完整 sk- 密钥仅能在中转站后台复制** — NewAPI 服务端不通过 API 返回明文，CLI 只能拿到 mask 过的（`DNl9**********seer`）。新建后请到后台复制完整 key。

## 配合 Claude Code / Cursor / Codex 使用

`ynapi` 的设计目标之一就是给 AI 助手用 — 装上之后让 AI 主动帮你管账户。

### 推荐 prompt 模板

把下面这段粘到 Claude Code / Cursor / Codex 的系统 prompt（或 CLAUDE.md / .cursorrules）：

```
This project uses NewAPI relay via @herohero96/newapi-cli. To check the user's
account state, use these commands (always pass --json for stable parsing):

  - "余额 / 还剩多少钱"     → `npx @herohero96/newapi-cli@latest snapshot --json`
  - "今天花了多少 / 流水"    → `... logs --limit 50 --days 1 --json`
  - "用量趋势 / 这周花费"    → `... usage --days 7 --json`
  - "出错了 / 能用吗"        → `... status --json`
  - 不确定要哪个？先 snapshot，里面什么都有

Exit codes signal what to do next:
  0=ok, 2=run setup, 3=key invalid, 4=run setup --advanced, 5=cookie expired,
  6=network, 7=usage error, 8=resource not found

Always reply in Chinese.
```

### 一站式入口：`snapshot`

```bash
$ ynapi snapshot --json | jq
{
  "ok": true,
  "site": "https://ai.ltcraft.cn",
  "key": {
    "name": "pc电脑",
    "remaining_usd": "infinite",
    "used_usd": 1753.7247,
    "unlimited": true
  },
  "account": {
    "username": "you@example.com",
    "id": 446,
    "remaining_usd": 794.6847,
    "used_usd": 18504.93,
    "requests": 78088
  },
  "health": { "config": "ok", "api_key": "ok", "cookie": "ok" }
}
```

JSON schema 字段是稳定契约（`remaining_usd` / `used_usd` 等命名将在所有命令保持一致），AI 直接读字段就行，不用解析表格。

### 退出码

所有命令失败时按下面的码退出，AI 可以据此判断下一步：

| 码 | 含义 | AI 该做什么 |
|---|---|---|
| 0 | 成功 | — |
| 2 | 配置文件不存在 | 让用户跑 `ynapi setup` |
| 3 | API key 无效 | 让用户跑 `ynapi setup` 或换 `--key` |
| 4 | cookie 缺失 | 让用户跑 `ynapi setup --advanced` |
| 5 | cookie 过期 | 让用户重粘 cookie（同上） |
| 6 | 网络错误 | 检查 `--site` / 网络 |
| 7 | 参数用法错误 | 看 stderr 提示修正 |
| 8 | 目标资源不存在 | 比如令牌名找错 |

`--json` 模式下，错误也会打印到 stderr 的 JSON：`{"ok":false,"error":"...","exit_code":3}`。

## 配置文件

`~/.ynapi/config.json`（Windows 是 `C:\Users\<你>\.ynapi\config.json`）：

```json
{
  "site": "https://ai.ltcraft.cn",
  "api_key": "sk-xxx"
}
```

文件权限会被设为 `0600`（仅当前用户可读写）。

## 鸣谢

- [QuantumNous/new-api](https://github.com/QuantumNous/new-api) — 强大的开源 AI 中转网关
- [Calcium-Ion/new-api-key-tool](https://github.com/Calcium-Ion/new-api-key-tool) — 灵感参考

## License

MIT © herohero96
