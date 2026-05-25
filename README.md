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
| `ynapi balance` | 查询当前 key 的余额与用量 |
| `ynapi models [-q kw]` | 列出中转站可用的模型，`-q` 关键字过滤 |
| `ynapi usage [--days N] [--by-model]` | 按天（或按模型）查看用量明细，需 cookie |
| `ynapi tokens [-a]` | 列出账号下的所有令牌，`-a` 包含禁用/过期/耗尽的，需 cookie |
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

## 配合 Claude Code / Cursor / Codex 使用

把下面这段提示词复制到 Claude Code、Cursor 或 Codex 的对话框：

```
Run `npx @herohero96/newapi-cli@latest --help` to discover the CLI, then use it
to check my NewAPI relay balance, usage, and available models.
Always reply in Chinese.
```

之后就可以直接对 AI 说"看一下我的余额"或"列一下能用的 claude 模型"——AI 会自己跑 CLI 查询。

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
