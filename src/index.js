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
  resolveAuth,
  DEFAULT_SITE,
} from "./config.js";
import {
  getTokenUsage,
  listModels,
  getUserSelf,
  getUsageData,
  listTokens,
} from "./api.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const program = new Command();

program
  .name("ynapi")
  .description("从终端查 NewAPI 中转站的余额、用量、模型。")
  .version(pkg.version, "-v, --version", "打印版本号")
  .option("--site <url>", "中转站地址（覆盖配置）")
  .option("--key <sk-...>", "API key（覆盖配置）")
  .option("--json", "纯 JSON 输出（适合管道给 jq）")
  .option("--compact", "--json 的别名（与 job-pro 风格一致）");

program
  .command("setup")
  .description("交互式写入配置（中转站 URL + API key）")
  .option("--advanced", "高级模式：额外配置 cookie + user_id（用于 usage 命令）")
  .action(runSetup);

program
  .command("balance")
  .description("查询当前 key 的余额与用量")
  .action(runBalance);

program
  .command("models")
  .description("列出中转站可用的模型")
  .option("-q, --query <kw>", "按模型名筛选（区分大小写）")
  .action(runModels);

program
  .command("usage")
  .description("按天查看用量明细（需要 cookie 鉴权，先跑 `ynapi setup --advanced`）")
  .option("-d, --days <n>", "查询最近 N 天（默认 7）", "7")
  .action(runUsage);

program
  .command("tokens")
  .description("列出账号下的所有令牌（需要 cookie 鉴权）")
  .option("-a, --all", "也显示已禁用 / 已过期 / 已耗尽的令牌")
  .action(runTokens);

program.addHelpText(
  "after",
  `
示例:
  $ ynapi setup                                  # 首次配置
  $ ynapi setup --advanced                       # 额外配置 cookie（解锁 usage）
  $ ynapi balance                                # 查余额
  $ ynapi balance --json | jq                    # 管道用
  $ ynapi tokens --compact                       # 同 --json，与 job-pro 一致
  $ ynapi models                                 # 列所有模型
  $ ynapi models -q claude                       # 只看含 claude 的
  $ ynapi usage                                  # 最近 7 天用量
  $ ynapi usage --days 30                        # 最近 30 天
  $ ynapi tokens                                 # 列出所有令牌
  $ ynapi tokens -a                              # 包含禁用/过期/耗尽的
  $ ynapi --site https://other.com --key sk-xxx balance

环境变量:
  YNAPI_SITE       中转站 URL（覆盖配置文件）
  YNAPI_KEY        API key（覆盖配置文件）
  YNAPI_COOKIE     浏览器 cookie（usage 命令用）
  YNAPI_USER_ID    new-api-user 头（usage 命令用）

配置文件:
  ${configPath()}
`
);

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`✗ ${err.message}\n`);
  process.exit(1);
});

async function runSetup(cmdOpts) {
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
      ...existing,
      site: (siteAns.trim() || existing.site || DEFAULT_SITE).replace(/\/+$/, ""),
      api_key: keyAns.trim() || existing.api_key || "",
    };
    if (!next.api_key) {
      throw new Error("api_key 不能为空");
    }

    if (cmdOpts.advanced) {
      output.write("\n--- 高级配置（usage 命令需要）---\n");
      output.write("打开中转站后台 → F12 → Network → 刷新页面 → 找任意 /api/ 请求\n");
      output.write("在 Headers 里复制 Cookie 整段，以及 new-api-user 的值\n\n");
      const cookieAns = await rl.question(
        `Cookie${existing.cookie ? "（回车保留现有）" : ""}: `
      );
      const userIdAns = await rl.question(
        `new-api-user (数字)${existing.user_id ? `（回车保留 ${existing.user_id}）` : ""}: `
      );
      next.cookie = cookieAns.trim() || existing.cookie || "";
      const uid = userIdAns.trim() || (existing.user_id ? String(existing.user_id) : "");
      if (uid && !/^\d+$/.test(uid)) {
        throw new Error("user_id 必须是数字");
      }
      next.user_id = uid ? Number(uid) : undefined;
      if (!next.cookie) throw new Error("cookie 不能为空");
      if (!next.user_id) throw new Error("user_id 不能为空");
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

  if (opts.json || opts.compact) {
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

async function runModels(cmdOpts) {
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

  const json = await listModels(site, key);
  let models = Array.isArray(json?.data) ? json.data : [];

  if (cmdOpts.query) {
    const q = cmdOpts.query.toLowerCase();
    models = models.filter((m) => (m.id ?? "").toLowerCase().includes(q));
  }

  if (opts.json || opts.compact) {
    output.write(JSON.stringify({ count: models.length, data: models }) + "\n");
    return;
  }

  if (models.length === 0) {
    output.write("（无匹配模型）\n");
    return;
  }

  const idWidth = Math.min(
    50,
    models.reduce((max, m) => Math.max(max, (m.id ?? "").length), 8)
  );
  output.write(`共 ${models.length} 个模型 @ ${site}\n`);
  output.write("─".repeat(idWidth + 24) + "\n");
  for (const m of models) {
    const id = (m.id ?? "").padEnd(idWidth);
    const owner = m.owned_by ?? "";
    output.write(`${id}  ${owner}\n`);
  }
}

async function runUsage(cmdOpts) {
  const opts = program.opts();
  const cfg = await readConfig();
  const { site, cookie, userId } = resolveAuth({
    siteFlag: opts.site,
    config: cfg,
  });

  const days = Number.parseInt(cmdOpts.days, 10);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error("--days 必须是正整数");
  }

  const endTs = Math.floor(Date.now() / 1000);
  const startTs = endTs - days * 86400;

  const [userJson, usageJson] = await Promise.all([
    getUserSelf(site, { cookie, userId }),
    getUsageData(site, { cookie, userId }, { startTs, endTs }),
  ]);

  const user = userJson?.data ?? {};
  const buckets = Array.isArray(usageJson?.data) ? usageJson.data : [];

  if (opts.json || opts.compact) {
    output.write(
      JSON.stringify({
        range: { start: startTs, end: endTs, days },
        user,
        buckets,
      }) + "\n"
    );
    return;
  }

  const fmt = (n) => {
    if (typeof n !== "number") return String(n);
    return (n / 500000).toFixed(4);
  };

  output.write(`中转站   ${site}\n`);
  output.write(`用户     ${user.username ?? "(未知)"} (id=${user.id ?? "?"})\n`);
  output.write(`总额度   ${fmt(user.quota)} 美元等值（剩余）\n`);
  output.write(`累计用   ${fmt(user.used_quota)} 美元等值\n`);
  output.write(`总请求   ${user.request_count ?? 0} 次\n`);
  output.write(`\n最近 ${days} 天用量\n`);
  output.write("─".repeat(64) + "\n");

  if (buckets.length === 0) {
    output.write("（无记录）\n");
    return;
  }

  const byDay = new Map();
  for (const b of buckets) {
    const day = new Date(b.created_at * 1000).toISOString().slice(0, 10);
    if (!byDay.has(day)) {
      byDay.set(day, { quota: 0, count: 0, tokens: 0, models: new Map() });
    }
    const d = byDay.get(day);
    d.quota += b.quota || 0;
    d.count += b.count || 0;
    d.tokens += b.token_used || 0;
    const mname = b.model_name || "(unknown)";
    d.models.set(mname, (d.models.get(mname) || 0) + (b.quota || 0));
  }

  const sortedDays = [...byDay.keys()].sort();
  output.write("日期        请求数   tokens     金额($)   主力模型\n");
  for (const day of sortedDays) {
    const d = byDay.get(day);
    const topModel = [...d.models.entries()].sort((a, b) => b[1] - a[1])[0];
    const topName = topModel ? topModel[0] : "";
    output.write(
      `${day}  ${String(d.count).padStart(6)}  ${String(d.tokens).padStart(9)}  ${fmt(d.quota).padStart(8)}   ${topName}\n`
    );
  }

  const total = sortedDays.reduce(
    (acc, day) => {
      const d = byDay.get(day);
      acc.count += d.count;
      acc.tokens += d.tokens;
      acc.quota += d.quota;
      return acc;
    },
    { count: 0, tokens: 0, quota: 0 }
  );
  output.write("─".repeat(64) + "\n");
  output.write(
    `合计        ${String(total.count).padStart(6)}  ${String(total.tokens).padStart(9)}  ${fmt(total.quota).padStart(8)}\n`
  );
}

const TOKEN_STATUS = {
  1: "正常",
  2: "禁用",
  3: "过期",
  4: "耗尽",
};

function strWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    w += cp > 0x2e80 && cp < 0xfb00 ? 2 : 1;
  }
  return w;
}

function padEndWide(s, width) {
  const diff = width - strWidth(s);
  return diff > 0 ? String(s) + " ".repeat(diff) : String(s);
}

async function runTokens(cmdOpts) {
  const opts = program.opts();
  const cfg = await readConfig();
  const { site, cookie, userId } = resolveAuth({
    siteFlag: opts.site,
    config: cfg,
  });

  const json = await listTokens(site, { cookie, userId }, { page: 0, size: 100 });
  const items = Array.isArray(json?.data?.items) ? json.data.items : [];
  const total = json?.data?.total ?? items.length;

  let visible = items;
  if (!cmdOpts.all) {
    visible = items.filter((t) => t.status === 1);
  }

  if (opts.json || opts.compact) {
    output.write(JSON.stringify({ total, count: visible.length, items: visible }) + "\n");
    return;
  }

  const fmt = (n) => {
    if (typeof n !== "number") return String(n);
    return (n / 500000).toFixed(4);
  };
  const fmtTime = (ts) => {
    if (!ts || ts <= 0) return "—";
    const d = new Date(ts * 1000);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return "今天";
    return d.toISOString().slice(0, 10);
  };
  const fmtExpire = (ts) => (!ts || ts === -1 ? "永不过期" : new Date(ts * 1000).toISOString().slice(0, 10));

  if (visible.length === 0) {
    output.write(cmdOpts.all ? "（无令牌）\n" : "（无可用令牌，加 -a 看全部）\n");
    return;
  }

  output.write(`共 ${total} 个令牌（显示 ${visible.length} 个）@ ${site}\n`);
  output.write("─".repeat(86) + "\n");
  output.write(
    padEndWide("名称", 28) +
      padEndWide("状态", 6) +
      padEndWide("组", 10) +
      padEndWide("已用($)", 12) +
      padEndWide("剩余", 14) +
      padEndWide("过期", 14) +
      "最近使用\n"
  );
  for (const t of visible) {
    const name = padEndWide(t.name ?? "", 28);
    const status = padEndWide(TOKEN_STATUS[t.status] ?? `?(${t.status})`, 6);
    const group = padEndWide(t.group ?? "", 10);
    const used = padEndWide(fmt(t.used_quota), 12);
    const remain = padEndWide(t.unlimited_quota ? "∞" : fmt(t.remain_quota), 14);
    const expire = padEndWide(fmtExpire(t.expired_time), 14);
    const accessed = fmtTime(t.accessed_time);
    output.write(`${name}${status}${group}${used}${remain}${expire}${accessed}\n`);
  }
}
