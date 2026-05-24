import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";

const CONFIG_DIR = join(homedir(), ".ynapi");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export const DEFAULT_SITE = "https://ai.ltcraft.cn";

export async function readConfig() {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    const raw = await readFile(CONFIG_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`无法读取配置文件 ${CONFIG_FILE}: ${err.message}`);
  }
}

export async function writeConfig(cfg) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
  try {
    await chmod(CONFIG_FILE, 0o600);
  } catch {
    // Windows 上 chmod 是 no-op，忽略
  }
}

export function configPath() {
  return CONFIG_FILE;
}

export function resolveCreds({ siteFlag, keyFlag, config }) {
  const site =
    siteFlag ||
    process.env.YNAPI_SITE ||
    config?.site ||
    DEFAULT_SITE;
  const key = keyFlag || process.env.YNAPI_KEY || config?.api_key;
  return { site: site.replace(/\/+$/, ""), key };
}

export function resolveAuth({ siteFlag, config }) {
  const site = (
    siteFlag ||
    process.env.YNAPI_SITE ||
    config?.site ||
    DEFAULT_SITE
  ).replace(/\/+$/, "");
  const cookie = process.env.YNAPI_COOKIE || config?.cookie;
  const userId = process.env.YNAPI_USER_ID || config?.user_id;
  return { site, cookie, userId };
}
