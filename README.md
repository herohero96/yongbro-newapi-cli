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
| `ynapi balance` | 查询当前 key 的余额与用量 |
| `ynapi models [-q kw]` | 列出中转站可用的模型，`-q` 关键字过滤 |
| `ynapi --help` | 显示帮助 |

### 全局选项

| Flag | 作用 |
|---|---|
| `--site <url>` | 中转站地址（覆盖配置文件） |
| `--key <sk-...>` | API key（覆盖配置文件） |
| `--json` | 纯 JSON 输出（适合管道给 jq） |
| `-v, --version` | 打印版本号 |

### 环境变量

| 变量 | 作用 |
|---|---|
| `YNAPI_SITE` | 中转站 URL |
| `YNAPI_KEY` | API key |

优先级：命令行 flag > 环境变量 > 配置文件。

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
