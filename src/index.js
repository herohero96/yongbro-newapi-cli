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
  listProfiles,
  useProfile,
  renameProfile,
  removeProfile,
  validateProfileName,
  DEFAULT_SITE,
} from "./config.js";
import {
  getTokenUsage,
  listModels,
  getUserSelf,
  getUsageData,
  listTokens,
  getSelfLogs,
  getToken,
  createToken,
  updateToken,
  deleteToken,
  ApiError,
} from "./api.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const QUOTA_PER_DOLLAR = 500000;
function fmtQuota(n) {
  if (typeof n !== "number") return String(n);
  return (n / QUOTA_PER_DOLLAR).toFixed(4);
}
function quotaToUsd(n) {
  if (typeof n !== "number") return null;
  return Number((n / QUOTA_PER_DOLLAR).toFixed(4));
}

const EXIT = {
  OK: 0,
  GENERIC: 1,
  CONFIG_MISSING: 2,
  KEY_INVALID: 3,
  COOKIE_MISSING: 4,
  COOKIE_EXPIRED: 5,
  NETWORK: 6,
  USAGE: 7,
  NOT_FOUND: 8,
};

function activeProfile() {
  return program.opts().profile;
}
async function readActiveConfig() {
  return readConfig(activeProfile());
}

function classifyError(err) {
  const msg = err?.message ?? "";
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) {
      if (msg.includes("API key")) return EXIT.KEY_INVALID;
      if (msg.includes("Cookie")) return EXIT.COOKIE_EXPIRED;
    }
    if (msg.includes("网络错误") || msg.includes("超时")) return EXIT.NETWORK;
  }
  if (msg.includes("缺少 cookie") || msg.includes("缺少 user_id")) return EXIT.COOKIE_MISSING;
  if (msg.includes("未配置 API key") || msg.includes("api_key")) return EXIT.KEY_INVALID;
  if (msg.includes("找不到")) return EXIT.NOT_FOUND;
  if (msg.includes("必须") || msg.includes("不能")) return EXIT.USAGE;
  return EXIT.GENERIC;
}

const program = new Command();

program
  .name("ynapi")
  .description(
    `从终端查 NewAPI 中转站的余额、用量、模型 — 给开发者和 AI 助手用。

何时用哪个命令（AI 速查）:
  账号总余额 / 充值剩多少     → usage         （账号级，需 cookie）
  当前 sk- 令牌的额度          → balance       （单令牌级，需 key）
  账号是否可用 / 配置是否对    → status
  花了多少钱（聚合 / 趋势）    → usage [--by-model | --days N]
  每次调用花了多少（流水）    → logs --limit N --days N [--model X]
  有哪些模型可用              → models [-q kw]
  列出我账号下所有 sk- 令牌    → tokens         （只读复数）
  新建 / 改 / 删 sk- 令牌      → token <子命令> （CRUD 单数）
  多个中转站切换              → profile use <name>  或  --profile <name>

鉴权速查:
  [需 key]    balance / models                  — API key（Bearer）
  [需 cookie] usage / tokens / token / logs      — 浏览器 cookie + user_id
  [无需鉴权]  setup / status / config show`
  )
  .version(pkg.version, "-v, --version", "打印版本号")
  .option("-p, --profile <name>", "使用指定 profile（覆盖默认；YNAPI_PROFILE 也可）")
  .option("--site <url>", "中转站地址（覆盖配置）")
  .option("--key <sk-...>", "API key（覆盖配置）")
  .option("--json", "纯 JSON 输出（适合管道给 jq / AI 处理）")
  .option("--compact", "--json 的别名（与 job-pro 风格一致）");

program
  .command("setup")
  .description("[初始化] 交互式写入配置（中转站 URL + API key）")
  .option("--advanced", "高级模式：额外配置 cookie + user_id（解锁 usage / tokens / token / logs）")
  .option("-p, --profile <name>", "指定要配置的 profile 名（不指定就用全局 --profile 或当前默认）")
  .action(runSetup);

program
  .command("balance")
  .description("[需 key] 查当前 sk- 令牌的额度（不是账号总余额，账号余额用 `usage`）")
  .action(runBalance);

program
  .command("account")
  .description(
    "[需 cookie] 查账号总余额 / 累计花费 / 总请求数（用户问\"账号还剩多少钱\"就跑这个）"
  )
  .action(runAccount);

program
  .command("snapshot")
  .description(
    "[AI 友好] 一站式拉账号余额 + 当前 key + 健康检查；--json 输出稳定 schema，AI 解析最方便"
  )
  .action(runSnapshot);

program
  .command("models")
  .description("[需 key] 列出中转站可用的模型（OpenAI 兼容的 /v1/models）")
  .option("-q, --query <kw>", "按模型名筛选（区分大小写）")
  .action(runModels);

program
  .command("usage")
  .description(
    "[需 cookie] 查账号总余额 + 按天/按模型的用量聚合（这是查\"账号还剩多少钱\"的命令）"
  )
  .option("-d, --days <n>", "查询最近 N 天（默认 7）", "7")
  .option("-m, --by-model", "按模型分组（替代默认的按天分组）")
  .action(runUsage);

program
  .command("tokens")
  .description("[需 cookie] 列出账号下的所有 sk- 令牌（只读；要增删改用 `token` 单数）")
  .option("-a, --all", "也显示已禁用 / 已过期 / 已耗尽的令牌")
  .action(runTokens);

program
  .command("logs")
  .description(
    "[需 cookie] 查每次具体调用的流水明细（usage 是日聚合 / logs 是单次流水，用于排查异常）"
  )
  .option("-n, --limit <n>", "显示最近 N 条（默认 50）", "50")
  .option("-d, --days <n>", "只看最近 N 天（默认 7）", "7")
  .option("-m, --model <name>", "按模型名过滤（前缀匹配，服务端过滤）")
  .option("-t, --token <name>", "按 token 名过滤（服务端过滤）")
  .action(runLogs);

const configCmd = program
  .command("config")
  .description("[本地] 查看或管理本地配置文件（不发请求）");

configCmd
  .command("show")
  .description("打印当前生效的配置，自动 mask key / cookie，并标注每个值来自 flag/env/file")
  .action(runConfigShow);

const tokenCmd = program
  .command("token")
  .description("[需 cookie] 管理账号下的 sk- 令牌（增删改）— 单数子命令组，复数 `tokens` 是只读");

tokenCmd
  .command("create <name>")
  .description("新建一个 sk- 令牌（注意：sk- 完整明文只能在中转站后台复制，API 不返回）")
  .option("-q, --quota <n>", "额度（NewAPI 内部 quota 单位，1美元≈500000）", "0")
  .option("-u, --unlimited", "无限额度")
  .option("-e, --expires <date>", "过期时间（ISO 日期 yyyy-mm-dd 或 unix 秒；默认永不过期）")
  .option("-g, --group <name>", "分组")
  .option("--allow-ips <list>", "IP 白名单（逗号分隔）")
  .option("--model-limits <list>", "限制可调用模型（逗号分隔；留空=不限制）")
  .action(runTokenCreate);

tokenCmd
  .command("update <idOrName>")
  .description("修改令牌字段（按 id 数字或 name 字符串定位；--status 必须单独使用）")
  .option("--name <new>", "改名字")
  .option("-q, --quota <n>", "改额度")
  .option("-u, --unlimited", "改成无限额度")
  .option("--limited", "改成有限额度（取消无限）")
  .option("-e, --expires <date>", "改过期时间（ISO 日期 / unix 秒 / 'never' 表示永不过期）")
  .option("-g, --group <name>", "改分组")
  .option("--allow-ips <list>", "改 IP 白名单")
  .option("--model-limits <list>", "改可调用模型限制")
  .option("--status <n>", "改状态（1=正常 2=禁用 3=过期 4=耗尽，必须单独用）")
  .action(runTokenUpdate);

tokenCmd
  .command("delete <idOrName>")
  .alias("rm")
  .description("删除令牌（默认 y/N 确认，AI / 脚本可加 -y 跳过）")
  .option("-y, --yes", "跳过确认直接删")
  .action(runTokenDelete);

tokenCmd
  .command("enable <idOrName>")
  .description("启用令牌（status=1；等同 `update --status 1`，但更直观）")
  .action((idOrName) => runTokenSetStatus(idOrName, 1));

tokenCmd
  .command("disable <idOrName>")
  .description("禁用令牌（status=2；等同 `update --status 2`，但更直观）")
  .action((idOrName) => runTokenSetStatus(idOrName, 2));

program
  .command("status")
  .alias("doctor")
  .description(
    "[无需鉴权] 健康检查：config / api-key / cookie 三项；失败时退出码 1（脚本/AI 可检测）"
  )
  .action(runStatus);

const profileCmd = program
  .command("profile")
  .description("[本地] 管理多个中转站 profile（list / use / rename / remove）");

profileCmd
  .command("list")
  .alias("ls")
  .description("列出所有 profile，标记当前默认")
  .action(runProfileList);

profileCmd
  .command("use <name>")
  .description("切换默认 profile（影响后续命令）")
  .action(runProfileUse);

profileCmd
  .command("rename <oldName> <newName>")
  .description("重命名 profile")
  .action(runProfileRename);

profileCmd
  .command("remove <name>")
  .alias("rm")
  .description("删除 profile（默认 y/n 确认；不能删除当前默认）")
  .option("-y, --yes", "跳过确认")
  .action(runProfileRemove);

program.addHelpText(
  "after",
  `
示例:
  $ ynapi setup                                  # 首次配置
  $ ynapi setup --profile testapi                # 新建第二个 profile
  $ ynapi profile list                           # 看所有 profile
  $ ynapi profile use testapi                    # 切默认 profile
  $ ynapi --profile testapi balance              # 临时用某个 profile
  $ ynapi setup --advanced                       # 额外配置 cookie（解锁 usage / token 等）
  $ ynapi snapshot --json                        # ★ AI 一站式入口：账号 + key + 健康一次拉
  $ ynapi account                                # 账号总余额（"还剩多少钱"）
  $ ynapi balance                                # 当前 sk- 令牌的额度
  $ ynapi usage --days 30                        # 最近 30 天用量
  $ ynapi usage --by-model                       # 按模型聚合
  $ ynapi logs --limit 200 --days 1              # 今天最近 200 条调用流水
  $ ynapi logs --model claude --json | jq        # 服务端过滤 + 管道
  $ ynapi tokens                                 # 列所有 sk- 令牌（只读）
  $ ynapi token create "测试令牌" -q 500000      # 新建（quota = 1美元）
  $ ynapi token disable "测试令牌"                # 禁用 / enable 启用
  $ ynapi token rm 1234 -y                       # 删，跳过确认
  $ ynapi config show                            # 看当前配置（自动 mask）
  $ ynapi status                                 # 健康检查（配置/key/cookie）
  $ ynapi --site https://other.com --key sk-xxx balance

环境变量:
  YNAPI_PROFILE    当前 profile 名（覆盖配置文件里的 current）
  YNAPI_SITE       中转站 URL（覆盖配置文件）
  YNAPI_KEY        API key（覆盖配置文件）
  YNAPI_COOKIE     浏览器 cookie（cookie-class 命令用）
  YNAPI_USER_ID    new-api-user 头（cookie-class 命令用）

退出码（AI / 脚本可据此判断下一步）:
  0  成功
  1  通用错误
  2  配置文件不存在     → 跑 \`ynapi setup\`
  3  API key 无效        → 跑 \`ynapi setup\` 或更换 --key
  4  cookie 缺失         → 跑 \`ynapi setup --advanced\`
  5  cookie 过期         → 跑 \`ynapi setup --advanced\` 重粘 cookie
  6  网络错误            → 检查 --site 或网络
  7  参数错误（用法）
  8  目标资源不存在（如令牌名找不到）

For AI assistants:
  - 用户问"账号余额 / 还剩多少 / 这个月花了多少" → \`account\` 或 \`usage\`
  - 用户问"当前 key 还能用多少"                  → \`balance\`
  - 用户问"今天调用情况 / 哪次最贵"              → \`logs --limit N --days N\`
  - 用户问"健康 / 能用吗 / 出了什么错"           → \`status\`
  - 不确定要哪个？先跑 \`snapshot --json\`，里面什么都有
  - 任何命令都支持 \`--json\` / \`--compact\`，schema 稳定
  - 失败时看 stderr JSON 的 \`exit_code\` 字段，按上面的码决定下一步动作

配置文件:
  ${configPath()}
`
);

program.parseAsync(process.argv).catch((err) => {
  const opts = program.opts();
  const code = classifyError(err);
  if (opts.json || opts.compact) {
    process.stderr.write(
      JSON.stringify({ ok: false, error: err.message, exit_code: code }) + "\n"
    );
  } else {
    process.stderr.write(`✗ ${err.message}\n`);
  }
  process.exit(code);
});

async function runSetup(cmdOpts) {
  const rl = createInterface({ input, output });
  const targetProfile = cmdOpts.profile || activeProfile();
  if (targetProfile) validateProfileName(targetProfile);
  const existing = (await readConfig(targetProfile)) ?? {};
  try {
    if (targetProfile) {
      output.write(`配置 profile: ${targetProfile}${existing.site ? "（已存在，将更新）" : "（新建）"}\n`);
    }
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

    await writeConfig(next, targetProfile);
    output.write(`✓ 已写入 ${configPath()}${targetProfile ? `（profile: ${targetProfile}）` : ""}\n`);
  } finally {
    rl.close();
  }
}

async function runBalance() {
  const opts = program.opts();
  const cfg = await readActiveConfig();
  const { site, key } = resolveCreds({
    siteFlag: opts.site,
    keyFlag: opts.key,
    config: cfg,
  });
  if (!key) {
    throw new Error("未配置 API key。先跑 `ynapi setup`，或用 --key / YNAPI_KEY 提供。");
  }

  const { cookie, userId } = resolveAuth({ siteFlag: opts.site, config: cfg });
  const cookieAvailable = !!(cookie && userId);

  const tokenJson = await getTokenUsage(site, key);
  const data = tokenJson?.data ?? {};

  let accountData = null;
  let accountError = null;
  if (cookieAvailable) {
    try {
      const userJson = await getUserSelf(site, { cookie, userId });
      accountData = userJson?.data ?? null;
    } catch (err) {
      accountError = err.message;
    }
  }

  const stableKey = {
    name: data.name ?? null,
    unlimited: !!data.unlimited_quota,
    used_usd: quotaToUsd(data.total_used),
    granted_usd: quotaToUsd(data.total_granted),
    remaining_usd: data.unlimited_quota ? "infinite" : quotaToUsd(data.total_available),
    expires_at: data.expires_at && data.expires_at !== 0 ? data.expires_at : null,
  };
  const stableAccount = accountData
    ? {
        username: accountData.username ?? null,
        id: accountData.id ?? null,
        remaining_usd: quotaToUsd(accountData.quota),
        used_usd: quotaToUsd(accountData.used_quota),
        requests: accountData.request_count ?? null,
      }
    : null;

  if (opts.json || opts.compact) {
    output.write(
      JSON.stringify({
        ok: true,
        site,
        key: stableKey,
        account: stableAccount,
        account_error: accountError,
        raw: tokenJson,
      }) + "\n"
    );
    return;
  }

  const lines = [];
  lines.push(`中转站   ${site}`);
  if (stableAccount) {
    lines.push(`账号余额 ${stableAccount.remaining_usd} 美元等值（剩余）— 累计用 ${stableAccount.used_usd}`);
  } else if (cookieAvailable && accountError) {
    lines.push(`账号余额 (查询失败：${accountError})`);
  } else {
    lines.push(`账号余额 (未配置 cookie，跑 \`ynapi setup --advanced\` 解锁)`);
  }
  lines.push(`Key 名   ${data.name ?? "(未命名)"}`);
  if (data.unlimited_quota) {
    lines.push(`Key 额度 ∞ 无限额度（已用 ${fmtQuota(data.total_used)} 美元等值）`);
  } else {
    lines.push(`Key 总额 ${fmtQuota(data.total_granted)} 美元等值`);
    lines.push(`Key 已用 ${fmtQuota(data.total_used)} 美元等值`);
    lines.push(`Key 剩余 ${fmtQuota(data.total_available)} 美元等值`);
  }
  if (data.expires_at && data.expires_at !== 0) {
    lines.push(`过期     ${new Date(data.expires_at * 1000).toLocaleString()}`);
  } else {
    lines.push(`过期     永不过期`);
  }
  output.write(lines.join("\n") + "\n");
}

async function runAccount() {
  const opts = program.opts();
  const cfg = await readActiveConfig();
  const { site, cookie, userId } = resolveAuth({ siteFlag: opts.site, config: cfg });

  const userJson = await getUserSelf(site, { cookie, userId });
  const u = userJson?.data ?? {};

  const stable = {
    site,
    username: u.username ?? null,
    id: u.id ?? null,
    remaining_usd: quotaToUsd(u.quota),
    used_usd: quotaToUsd(u.used_quota),
    requests: u.request_count ?? null,
    group: u.group ?? null,
  };

  if (opts.json || opts.compact) {
    output.write(JSON.stringify({ ok: true, account: stable, raw: u }) + "\n");
    return;
  }

  output.write(`中转站     ${site}\n`);
  output.write(`用户       ${stable.username ?? "(未知)"} (id=${stable.id ?? "?"})\n`);
  output.write(`账号剩余   ${stable.remaining_usd} 美元等值\n`);
  output.write(`累计已用   ${stable.used_usd} 美元等值\n`);
  output.write(`总请求数   ${stable.requests ?? 0}\n`);
  if (stable.group) output.write(`分组       ${stable.group}\n`);
}

async function runSnapshot() {
  const opts = program.opts();
  const cfg = await readActiveConfig();
  const { site, key } = resolveCreds({
    siteFlag: opts.site,
    keyFlag: opts.key,
    config: cfg,
  });
  const { cookie, userId } = resolveAuth({ siteFlag: opts.site, config: cfg });

  const result = {
    ok: true,
    site,
    config: { path: configPath(), exists: !!cfg },
    key: null,
    account: null,
    health: { config: cfg ? "ok" : "missing", api_key: null, cookie: null },
    errors: {},
  };

  // key 状态
  if (key) {
    try {
      const tokenJson = await getTokenUsage(site, key);
      const d = tokenJson?.data ?? {};
      result.key = {
        masked: maskKey(key),
        name: d.name ?? null,
        unlimited: !!d.unlimited_quota,
        used_usd: quotaToUsd(d.total_used),
        granted_usd: quotaToUsd(d.total_granted),
        remaining_usd: d.unlimited_quota ? "infinite" : quotaToUsd(d.total_available),
        expires_at: d.expires_at && d.expires_at !== 0 ? d.expires_at : null,
      };
      result.health.api_key = "ok";
    } catch (err) {
      result.health.api_key = "fail";
      result.errors.api_key = err.message;
    }
  } else {
    result.health.api_key = "missing";
    result.errors.api_key = "未配置 API key";
  }

  // 账号 + cookie 状态
  if (cookie && userId) {
    try {
      const userJson = await getUserSelf(site, { cookie, userId });
      const u = userJson?.data ?? {};
      result.account = {
        username: u.username ?? null,
        id: u.id ?? null,
        remaining_usd: quotaToUsd(u.quota),
        used_usd: quotaToUsd(u.used_quota),
        requests: u.request_count ?? null,
        group: u.group ?? null,
      };
      result.health.cookie = "ok";
    } catch (err) {
      result.health.cookie = "fail";
      result.errors.cookie = err.message;
    }
  } else {
    result.health.cookie = "missing";
    result.errors.cookie = "未配置 cookie / user_id";
  }

  // 整体 ok
  result.ok = result.health.api_key === "ok" || result.health.cookie === "ok";

  if (opts.json || opts.compact) {
    output.write(JSON.stringify(result) + "\n");
    return;
  }

  output.write(`ynapi snapshot @ ${site}\n\n`);

  output.write(`账号\n`);
  if (result.account) {
    output.write(`  用户         ${result.account.username} (id=${result.account.id})\n`);
    output.write(`  剩余         ${result.account.remaining_usd} 美元等值\n`);
    output.write(`  累计已用     ${result.account.used_usd}\n`);
    output.write(`  总请求       ${result.account.requests}\n`);
  } else {
    output.write(`  ✗ ${result.errors.cookie}\n`);
  }

  output.write(`\n当前 Key\n`);
  if (result.key) {
    output.write(`  名称         ${result.key.name}\n`);
    output.write(`  剩余         ${result.key.remaining_usd}\n`);
    output.write(`  已用         ${result.key.used_usd}\n`);
  } else {
    output.write(`  ✗ ${result.errors.api_key}\n`);
  }

  output.write(`\n健康\n`);
  for (const [k, v] of Object.entries(result.health)) {
    const mark = v === "ok" ? "✓" : v === "missing" ? "○" : "✗";
    output.write(`  ${mark}  ${k.padEnd(10)} ${v}\n`);
  }
}async function runModels(cmdOpts) {
  const opts = program.opts();
  const cfg = await readActiveConfig();
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
  const cfg = await readActiveConfig();
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

  output.write(`中转站   ${site}\n`);
  output.write(`用户     ${user.username ?? "(未知)"} (id=${user.id ?? "?"})\n`);
  output.write(`总额度   ${fmtQuota(user.quota)} 美元等值（剩余）\n`);
  output.write(`累计用   ${fmtQuota(user.used_quota)} 美元等值\n`);
  output.write(`总请求   ${user.request_count ?? 0} 次\n`);

  if (buckets.length === 0) {
    output.write(`\n最近 ${days} 天用量\n`);
    output.write("─".repeat(64) + "\n");
    output.write("（无记录）\n");
    return;
  }

  if (cmdOpts.byModel) {
    const byModel = new Map();
    for (const b of buckets) {
      const mname = b.model_name || "(unknown)";
      if (!byModel.has(mname)) {
        byModel.set(mname, { quota: 0, count: 0, tokens: 0 });
      }
      const m = byModel.get(mname);
      m.quota += b.quota || 0;
      m.count += b.count || 0;
      m.tokens += b.token_used || 0;
    }
    const rows = [...byModel.entries()].sort((a, b) => b[1].quota - a[1].quota);
    output.write(`\n最近 ${days} 天用量（按模型）\n`);
    output.write("─".repeat(70) + "\n");
    output.write(
      padEndWide("模型", 36) +
        "请求数   tokens     金额($)\n"
    );
    for (const [name, m] of rows) {
      output.write(
        padEndWide(name, 36) +
          `${String(m.count).padStart(6)}  ${String(m.tokens).padStart(9)}  ${fmtQuota(m.quota).padStart(8)}\n`
      );
    }
    const total = rows.reduce(
      (acc, [, m]) => {
        acc.count += m.count;
        acc.tokens += m.tokens;
        acc.quota += m.quota;
        return acc;
      },
      { count: 0, tokens: 0, quota: 0 }
    );
    output.write("─".repeat(70) + "\n");
    output.write(
      padEndWide("合计", 36) +
        `${String(total.count).padStart(6)}  ${String(total.tokens).padStart(9)}  ${fmtQuota(total.quota).padStart(8)}\n`
    );
    return;
  }

  output.write(`\n最近 ${days} 天用量\n`);
  output.write("─".repeat(64) + "\n");

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
      `${day}  ${String(d.count).padStart(6)}  ${String(d.tokens).padStart(9)}  ${fmtQuota(d.quota).padStart(8)}   ${topName}\n`
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
    `合计        ${String(total.count).padStart(6)}  ${String(total.tokens).padStart(9)}  ${fmtQuota(total.quota).padStart(8)}\n`
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
  const cfg = await readActiveConfig();
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
    const used = padEndWide(fmtQuota(t.used_quota), 12);
    const remain = padEndWide(t.unlimited_quota ? "∞" : fmtQuota(t.remain_quota), 14);
    const expire = padEndWide(fmtExpire(t.expired_time), 14);
    const accessed = fmtTime(t.accessed_time);
    output.write(`${name}${status}${group}${used}${remain}${expire}${accessed}\n`);
  }
}

function maskKey(k) {
  if (!k) return "";
  if (k.length <= 12) return k.slice(0, 2) + "***" + k.slice(-2);
  return k.slice(0, 6) + "***" + k.slice(-4);
}

async function runStatus() {
  const opts = program.opts();
  const cfg = await readActiveConfig();
  const { site, key } = resolveCreds({
    siteFlag: opts.site,
    keyFlag: opts.key,
    config: cfg,
  });
  const { cookie, userId } = resolveAuth({ siteFlag: opts.site, config: cfg });
  const asJson = opts.json || opts.compact;
  const checks = [];

  // 1. config
  if (cfg) {
    checks.push({
      name: "config",
      ok: true,
      detail: configPath(),
    });
  } else {
    checks.push({
      name: "config",
      ok: false,
      detail: `未找到 ${configPath()}，跑 \`ynapi setup\` 初始化`,
    });
  }

  // 2. api-key
  if (!key) {
    checks.push({
      name: "api-key",
      ok: false,
      detail: "未配置 API key（设置 YNAPI_KEY 或跑 `ynapi setup`）",
    });
  } else {
    const t0 = Date.now();
    try {
      const json = await getTokenUsage(site, key);
      const data = json?.data ?? {};
      const balance = data.unlimited_quota
        ? "∞"
        : (typeof data.total_available === "number"
            ? fmtQuota(data.total_available)
            : "?");
      checks.push({
        name: "api-key",
        ok: true,
        detail: `${maskKey(key)} — 余额 ${balance} (${Date.now() - t0}ms)`,
        meta: { masked_key: maskKey(key), balance, latency_ms: Date.now() - t0 },
      });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : undefined;
      checks.push({
        name: "api-key",
        ok: false,
        detail: err.message,
        meta: { status },
      });
    }
  }

  // 3. cookie
  if (!cookie || !userId) {
    const missing = [];
    if (!cookie) missing.push("cookie");
    if (!userId) missing.push("user_id");
    checks.push({
      name: "cookie",
      ok: false,
      detail: `未配置 ${missing.join(" + ")}（跑 \`ynapi setup --advanced\` 解锁 usage/tokens）`,
    });
  } else {
    const t0 = Date.now();
    try {
      const json = await getUserSelf(site, { cookie, userId });
      const user = json?.data ?? {};
      checks.push({
        name: "cookie",
        ok: true,
        detail: `${user.username ?? "?"} (id=${user.id ?? userId}) (${Date.now() - t0}ms)`,
        meta: { username: user.username, user_id: user.id ?? userId, latency_ms: Date.now() - t0 },
      });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : undefined;
      checks.push({
        name: "cookie",
        ok: false,
        detail: err.message,
        meta: { status },
      });
    }
  }

  const failed = checks.filter((c) => !c.ok);
  const ok = failed.length === 0;

  if (asJson) {
    output.write(
      JSON.stringify({
        ok,
        site,
        checks,
        summary: { total: checks.length, failed: failed.length },
      }) + "\n"
    );
  } else {
    output.write(`ynapi status @ ${site}\n\n`);
    const labelWidth = 10;
    for (const c of checks) {
      const mark = c.ok ? "✓" : "✗";
      output.write(`  ${mark}  ${c.name.padEnd(labelWidth)} ${c.detail}\n`);
    }
    output.write("\n");
    output.write(ok ? "全部通过\n" : `${failed.length} 项失败\n`);
  }

  if (!ok) process.exitCode = 1;
}

function maskCookie(c) {
  if (!c) return "";
  const tail = c.length > 12 ? c.slice(-8) : "";
  return `***${tail} (${c.length} 字符)`;
}

async function runConfigShow() {
  const opts = program.opts();
  const cfg = (await readActiveConfig()) ?? {};
  const { current, names } = await listProfiles();
  const activeName = activeProfile() || process.env.YNAPI_PROFILE || current;
  const { site, key } = resolveCreds({
    siteFlag: opts.site,
    keyFlag: opts.key,
    config: cfg,
  });
  const { cookie, userId } = resolveAuth({ siteFlag: opts.site, config: cfg });

  if (opts.json || opts.compact) {
    output.write(
      JSON.stringify({
        path: configPath(),
        profile: { active: activeName, current, all: names },
        effective: {
          site,
          api_key: key ? maskKey(key) : null,
          cookie: cookie ? maskCookie(cookie) : null,
          user_id: userId ?? null,
        },
        sources: {
          site: opts.site
            ? "flag"
            : process.env.YNAPI_SITE
              ? "env"
              : cfg.site
                ? "file"
                : "default",
          api_key: opts.key
            ? "flag"
            : process.env.YNAPI_KEY
              ? "env"
              : cfg.api_key
                ? "file"
                : "missing",
          cookie: process.env.YNAPI_COOKIE
            ? "env"
            : cfg.cookie
              ? "file"
              : "missing",
          user_id: process.env.YNAPI_USER_ID
            ? "env"
            : cfg.user_id
              ? "file"
              : "missing",
        },
      }) + "\n"
    );
    return;
  }

  const src = (envName, cfgValue, flag) =>
    flag ? "(flag)" : process.env[envName] ? "(env)" : cfgValue ? "(file)" : "(缺失)";

  output.write(`配置文件   ${configPath()}\n`);
  output.write(`profile    ${activeName ?? "(未设置)"}（默认：${current ?? "—"}）\n`);
  if (names.length > 1) {
    const others = names.filter((n) => n !== activeName);
    output.write(`其他       ${others.join(", ")}\n`);
  }
  output.write("\n");
  output.write(`site       ${site} ${src("YNAPI_SITE", cfg.site, opts.site)}\n`);
  output.write(
    `api_key    ${key ? maskKey(key) : "(未设置)"} ${src("YNAPI_KEY", cfg.api_key, opts.key)}\n`
  );
  output.write(
    `cookie     ${cookie ? maskCookie(cookie) : "(未设置)"} ${src("YNAPI_COOKIE", cfg.cookie)}\n`
  );
  output.write(
    `user_id    ${userId ?? "(未设置)"} ${src("YNAPI_USER_ID", cfg.user_id)}\n`
  );
  output.write(`\n优先级：命令行 flag > 环境变量 > 配置文件 > 默认值\n`);
}

async function runLogs(cmdOpts) {
  const opts = program.opts();
  const cfg = await readActiveConfig();
  const { site, cookie, userId } = resolveAuth({
    siteFlag: opts.site,
    config: cfg,
  });

  const limit = Number.parseInt(cmdOpts.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error("--limit 必须是正整数");
  }
  const days = Number.parseInt(cmdOpts.days, 10);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error("--days 必须是正整数");
  }

  const endTs = Math.floor(Date.now() / 1000);
  const startTs = endTs - days * 86400;

  const json = await getSelfLogs(
    site,
    { cookie, userId },
    {
      page: 0,
      pageSize: limit,
      modelName: cmdOpts.model,
      tokenName: cmdOpts.token,
      startTs,
      endTs,
    }
  );
  const items = Array.isArray(json?.data?.items) ? json.data.items : [];
  const total = json?.data?.total ?? items.length;

  if (opts.json || opts.compact) {
    output.write(
      JSON.stringify({
        range: { start: startTs, end: endTs, days },
        filters: { model: cmdOpts.model ?? null, token: cmdOpts.token ?? null },
        total,
        count: items.length,
        items,
      }) + "\n"
    );
    return;
  }

  if (items.length === 0) {
    output.write(`（无记录）@ ${site} 最近 ${days} 天\n`);
    return;
  }

  const fmtTs = (ts) => {
    const d = new Date(ts * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  output.write(
    `共 ${total} 条调用（显示 ${items.length} 条）@ ${site} 最近 ${days} 天\n`
  );
  output.write("─".repeat(96) + "\n");
  output.write(
    padEndWide("时间", 16) +
      padEndWide("模型", 32) +
      padEndWide("tokens(in/out)", 18) +
      padEndWide("花费($)", 10) +
      "Token名\n"
  );
  for (const it of items) {
    const time = padEndWide(fmtTs(it.created_at), 16);
    const model = padEndWide(it.model_name ?? "", 32);
    const toks = padEndWide(`${it.prompt_tokens ?? 0} / ${it.completion_tokens ?? 0}`, 18);
    const cost = padEndWide(fmtQuota(it.quota), 10);
    const tok = it.token_name ?? "";
    output.write(`${time}${model}${toks}${cost}${tok}\n`);
  }

  const sum = items.reduce(
    (acc, it) => {
      acc.in += it.prompt_tokens ?? 0;
      acc.out += it.completion_tokens ?? 0;
      acc.quota += it.quota ?? 0;
      return acc;
    },
    { in: 0, out: 0, quota: 0 }
  );
  output.write("─".repeat(96) + "\n");
  output.write(
    padEndWide("合计", 16) +
      padEndWide("", 32) +
      padEndWide(`${sum.in} / ${sum.out}`, 18) +
      padEndWide(fmtQuota(sum.quota), 10) +
      "\n"
  );
}

function parseExpires(input) {
  if (input === undefined || input === null || input === "") return undefined;
  if (input === "never" || input === "-1") return -1;
  if (/^\d+$/.test(input)) return Number(input);
  const ts = Date.parse(input);
  if (Number.isNaN(ts)) {
    throw new Error(`无法解析过期时间："${input}"。用 ISO 日期 (2026-12-31)、unix 秒数、或 'never'`);
  }
  return Math.floor(ts / 1000);
}

function parseQuota(input) {
  if (input === undefined || input === null || input === "") return undefined;
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`额度必须是非负数字，收到 "${input}"`);
  }
  return Math.floor(n);
}

async function findTokenByIdOrName(site, auth, idOrName) {
  if (/^\d+$/.test(idOrName)) {
    const json = await getToken(site, auth, idOrName);
    if (!json?.data) {
      throw new Error(`找不到 id=${idOrName} 的令牌`);
    }
    return json.data;
  }
  const listJson = await listTokens(site, auth, { page: 0, size: 100 });
  const items = Array.isArray(listJson?.data?.items) ? listJson.data.items : [];
  const matches = items.filter((t) => t.name === idOrName);
  if (matches.length === 0) {
    throw new Error(`找不到名为 "${idOrName}" 的令牌（可用 id 数字定位）`);
  }
  if (matches.length > 1) {
    const ids = matches.map((t) => t.id).join(", ");
    throw new Error(
      `名为 "${idOrName}" 的令牌有 ${matches.length} 个（id=${ids}）。请改用 id 数字定位。`
    );
  }
  return matches[0];
}

async function runTokenCreate(name, cmdOpts) {
  const opts = program.opts();
  const cfg = await readActiveConfig();
  const { site, cookie, userId } = resolveAuth({ siteFlag: opts.site, config: cfg });

  if (!name || !name.trim()) {
    throw new Error("令牌名字不能为空");
  }

  const fields = {
    name: name.trim(),
    remain_quota: parseQuota(cmdOpts.quota) ?? 0,
    expired_time: parseExpires(cmdOpts.expires) ?? -1,
    unlimited_quota: !!cmdOpts.unlimited,
    group: cmdOpts.group ?? "",
    allow_ips: cmdOpts.allowIps ?? "",
    model_limits: cmdOpts.modelLimits ?? "",
    model_limits_enabled: !!(cmdOpts.modelLimits && cmdOpts.modelLimits.length > 0),
  };

  await createToken(site, { cookie, userId }, fields);

  // 创建接口不返回 id，需要列一次找回来
  const listJson = await listTokens(site, { cookie, userId }, { page: 0, size: 20 });
  const items = Array.isArray(listJson?.data?.items) ? listJson.data.items : [];
  const created = items
    .filter((t) => t.name === fields.name)
    .sort((a, b) => (b.created_time ?? 0) - (a.created_time ?? 0))[0];

  if (opts.json || opts.compact) {
    output.write(JSON.stringify({ created: created ?? { name: fields.name } }) + "\n");
    return;
  }

  output.write(`✓ 已创建令牌 "${fields.name}"\n`);
  if (created) {
    output.write(`  id           ${created.id}\n`);
    output.write(`  状态         ${TOKEN_STATUS[created.status] ?? created.status}\n`);
    output.write(
      `  额度         ${created.unlimited_quota ? "∞ 无限" : fmtQuota(created.remain_quota)}\n`
    );
    output.write(
      `  过期         ${created.expired_time === -1 ? "永不过期" : new Date(created.expired_time * 1000).toISOString().slice(0, 10)}\n`
    );
    if (created.group) output.write(`  分组         ${created.group}\n`);
  }
  output.write(`\n注：sk- 完整密钥请到中转站后台复制（NewAPI 服务端不通过 API 返回明文）。\n`);
}

async function runTokenUpdate(idOrName, cmdOpts) {
  const opts = program.opts();
  const cfg = await readActiveConfig();
  const { site, cookie, userId } = resolveAuth({ siteFlag: opts.site, config: cfg });
  const auth = { cookie, userId };

  const current = await findTokenByIdOrName(site, auth, idOrName);

  const next = { ...current };
  if (cmdOpts.name !== undefined) next.name = cmdOpts.name;
  const q = parseQuota(cmdOpts.quota);
  if (q !== undefined) next.remain_quota = q;
  if (cmdOpts.unlimited) next.unlimited_quota = true;
  if (cmdOpts.limited) next.unlimited_quota = false;
  const exp = parseExpires(cmdOpts.expires);
  if (exp !== undefined) next.expired_time = exp;
  if (cmdOpts.group !== undefined) next.group = cmdOpts.group;
  if (cmdOpts.allowIps !== undefined) next.allow_ips = cmdOpts.allowIps;
  if (cmdOpts.modelLimits !== undefined) {
    next.model_limits = cmdOpts.modelLimits;
    next.model_limits_enabled = cmdOpts.modelLimits.length > 0;
  }
  if (cmdOpts.status !== undefined) {
    const s = Number(cmdOpts.status);
    if (![1, 2, 3, 4].includes(s)) {
      throw new Error("--status 必须是 1/2/3/4");
    }
    const otherChanged =
      cmdOpts.name !== undefined ||
      cmdOpts.quota !== undefined ||
      cmdOpts.unlimited ||
      cmdOpts.limited ||
      cmdOpts.expires !== undefined ||
      cmdOpts.group !== undefined ||
      cmdOpts.allowIps !== undefined ||
      cmdOpts.modelLimits !== undefined;
    if (otherChanged) {
      throw new Error(
        "--status 必须单独使用（NewAPI 服务端约束）。请分两次：先改 status，再改其他字段。"
      );
    }
    next.status = s;
  }

  if (JSON.stringify(next) === JSON.stringify(current)) {
    output.write("（无字段变化，未发送请求）\n");
    return;
  }

  const statusOnly = cmdOpts.status !== undefined;
  const json = await updateToken(site, auth, next, { statusOnly });
  const updated = json?.data ?? next;

  if (opts.json || opts.compact) {
    output.write(JSON.stringify({ updated }) + "\n");
    return;
  }

  output.write(`✓ 已更新令牌 id=${updated.id} name="${updated.name}"\n`);
  const changes = [];
  for (const k of [
    "name",
    "remain_quota",
    "unlimited_quota",
    "expired_time",
    "group",
    "allow_ips",
    "model_limits",
    "status",
  ]) {
    if (current[k] !== updated[k]) {
      changes.push(`  ${k}: ${JSON.stringify(current[k])} → ${JSON.stringify(updated[k])}`);
    }
  }
  if (changes.length > 0) output.write(changes.join("\n") + "\n");
}

async function runTokenSetStatus(idOrName, status) {
  const opts = program.opts();
  const cfg = await readActiveConfig();
  const { site, cookie, userId } = resolveAuth({ siteFlag: opts.site, config: cfg });
  const auth = { cookie, userId };
  const current = await findTokenByIdOrName(site, auth, idOrName);
  if (current.status === status) {
    output.write(`（令牌 "${current.name}" 已经是 ${TOKEN_STATUS[status]} 状态，未发送请求）\n`);
    return;
  }
  const json = await updateToken(site, auth, { ...current, status }, { statusOnly: true });
  const updated = json?.data ?? { ...current, status };
  if (opts.json || opts.compact) {
    output.write(JSON.stringify({ updated }) + "\n");
    return;
  }
  output.write(
    `✓ 令牌 "${updated.name}" (id=${updated.id}) 状态：${TOKEN_STATUS[current.status]} → ${TOKEN_STATUS[updated.status]}\n`
  );
}

async function confirmYesNo(prompt) {
  const rl = createInterface({ input, output });
  try {
    const ans = (await rl.question(prompt)).trim().toLowerCase();
    return ans === "y" || ans === "yes";
  } finally {
    rl.close();
  }
}

async function runTokenDelete(idOrName, cmdOpts) {
  const opts = program.opts();
  const cfg = await readActiveConfig();
  const { site, cookie, userId } = resolveAuth({ siteFlag: opts.site, config: cfg });
  const auth = { cookie, userId };

  const current = await findTokenByIdOrName(site, auth, idOrName);

  if (!cmdOpts.yes) {
    const ok = await confirmYesNo(
      `确认删除令牌 "${current.name}" (id=${current.id})？此操作不可恢复 [y/N]: `
    );
    if (!ok) {
      output.write("已取消\n");
      return;
    }
  }

  await deleteToken(site, auth, current.id);

  if (opts.json || opts.compact) {
    output.write(JSON.stringify({ deleted: { id: current.id, name: current.name } }) + "\n");
    return;
  }
  output.write(`✓ 已删除令牌 "${current.name}" (id=${current.id})\n`);
}

async function runProfileList() {
  const opts = program.opts();
  const { current, names } = await listProfiles();
  const active = activeProfile() || process.env.YNAPI_PROFILE || current;

  if (opts.json || opts.compact) {
    output.write(
      JSON.stringify({ ok: true, current, active, profiles: names }) + "\n"
    );
    return;
  }

  if (names.length === 0) {
    output.write("还没有 profile。先跑 `ynapi setup` 创建第一个。\n");
    return;
  }
  output.write(`配置文件   ${configPath()}\n\n`);
  for (const n of names) {
    let mark = "  ";
    if (n === active) mark = "★ ";
    else if (n === current) mark = "· ";
    output.write(`${mark}${n}${n === current ? "  (默认)" : ""}${n === active && n !== current ? "  (本次)" : ""}\n`);
  }
  output.write(`\n切换默认：ynapi profile use <name>\n临时使用：ynapi --profile <name> <command>\n`);
}

async function runProfileUse(name) {
  const opts = program.opts();
  await useProfile(name);
  if (opts.json || opts.compact) {
    output.write(JSON.stringify({ ok: true, current: name }) + "\n");
    return;
  }
  output.write(`✓ 默认 profile 已切到 "${name}"\n`);
}

async function runProfileRename(oldName, newName) {
  const opts = program.opts();
  await renameProfile(oldName, newName);
  if (opts.json || opts.compact) {
    output.write(JSON.stringify({ ok: true, renamed: { from: oldName, to: newName } }) + "\n");
    return;
  }
  output.write(`✓ profile "${oldName}" → "${newName}"\n`);
}

async function runProfileRemove(name, cmdOpts) {
  const opts = program.opts();
  if (!cmdOpts.yes) {
    const ok = await confirmYesNo(`确认删除 profile "${name}"？此操作不可恢复 [y/N]: `);
    if (!ok) {
      output.write("已取消\n");
      return;
    }
  }
  await removeProfile(name);
  if (opts.json || opts.compact) {
    output.write(JSON.stringify({ ok: true, removed: name }) + "\n");
    return;
  }
  output.write(`✓ 已删除 profile "${name}"\n`);
}
