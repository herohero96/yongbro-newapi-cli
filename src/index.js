#!/usr/bin/env node

import { Command } from "commander";
import { createRequire } from "node:module";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import {
  readConfig,
  writeConfig,
  configPath,
  resolveCreds,
  DEFAULT_SITE,
} from "./config.js";
import { getTokenUsage } from "./api.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const program = new Command();

program
  .name("ynapi")
  .description("从终端查 NewAPI 中转站的余额、用量、模型。")
  .version(pkg.version, "-v, --version", "打印版本号")
  .option("--site <url>", "中转站地址（覆盖配置）")
  .option("--key <sk-...>", "API key（覆盖配置）")
  .option("--json", "纯 JSON 输出（适合管道）");

program
  .command("setup")
  .description("交互式写入配置（中转站 URL + API key）")
  .action(runSetup);

program
  .command("balance")
  .description("查询当前 key 的余额与用量")
  .action(runBalance);

program.addHelpText(
  "after",
  `
示例:
  $ ynapi setup                                  # 首次配置
  $ ynapi balance                                # 查余额
  $ ynapi balance --json | jq                    # 管道用
  $ ynapi --site https://other.com --key sk-xxx balance

环境变量:
  YNAPI_SITE     中转站 URL（覆盖配置文件）
  YNAPI_KEY      API key（覆盖配置文件）

配置文件:
  ${configPath()}
`
);

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`✗ ${err.message}\n`);
  process.exit(1);
});

async function runSetup() {
  const rl = createInterface({ input, output });
  const existing = (await readConfig()) ?? {};
  try {
    const siteAns = await rl.question(
      `中转站 URL [${existing.site || DEFAULT_SITE}]: `
    );
    const keyAns = await rl.question(
      `API key${existing.api_key ? "（回车保留现有）" : ""}: `
    );
    const next = {
      site: (siteAns.trim() || existing.site || DEFAULT_SITE).replace(/\/+$/, ""),
      api_key: keyAns.trim() || existing.api_key || "",
    };
    if (!next.api_key) {
      throw new Error("api_key 不能为空");
    }
    await writeConfig(next);
    output.write(`✓ 已写入 ${configPath()}\n`);
  } finally {
    rl.close();
  }
}

async function runBalance() {
  const opts = program.opts();
  const cfg = await readConfig();
  const { site, key } = resolveCreds({
    siteFlag: opts.site,
    keyFlag: opts.key,
    config: cfg,
  });
  if (!key) {
    throw new Error("未配置 API key。先跑 `ynapi setup`，或用 --key / YNAPI_KEY 提供。");
  }

  const json = await getTokenUsage(site, key);
  const data = json?.data ?? {};

  if (opts.json) {
    output.write(JSON.stringify(json) + "\n");
    return;
  }

  const fmt = (n) => {
    if (typeof n !== "number") return String(n);
    return (n / 500000).toFixed(4);
  };

  const lines = [];
  lines.push(`中转站   ${site}`);
  lines.push(`Key 名   ${data.name ?? "(未命名)"}`);
  if (data.unlimited_quota) {
    lines.push(`额度     ∞ 无限额度（已用 ${fmt(data.total_used)} 美元等值）`);
  } else {
    lines.push(`总额度   ${fmt(data.total_granted)} 美元等值`);
    lines.push(`已用     ${fmt(data.total_used)} 美元等值`);
    lines.push(`剩余     ${fmt(data.total_available)} 美元等值`);
  }
  if (data.expires_at && data.expires_at !== 0) {
    lines.push(`过期     ${new Date(data.expires_at * 1000).toLocaleString()}`);
  } else {
    lines.push(`过期     永不过期`);
  }
  output.write(lines.join("\n") + "\n");
}
