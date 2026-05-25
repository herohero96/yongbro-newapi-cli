import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";

const CONFIG_DIR = join(homedir(), ".ynapi");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export const DEFAULT_SITE = "https://ai.ltcraft.cn";
export const DEFAULT_PROFILE = "default";
const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

export function configPath() {
  return CONFIG_FILE;
}

export function validateProfileName(name) {
  if (!name || !PROFILE_NAME_RE.test(name)) {
    throw new Error(
      `profile 名 "${name}" 不合法。只能用小写字母 / 数字 / _ / -，且必须以字母或数字开头。`
    );
  }
}

function isLegacyShape(obj) {
  return obj && typeof obj === "object" && !obj.profiles && !obj.current;
}

function migrate(raw) {
  if (!raw || typeof raw !== "object") return { current: DEFAULT_PROFILE, profiles: {} };
  if (raw.profiles && typeof raw.profiles === "object") {
    return { current: raw.current || DEFAULT_PROFILE, profiles: raw.profiles };
  }
  // 旧 schema：{ site, api_key, cookie?, user_id? }
  return {
    current: DEFAULT_PROFILE,
    profiles: { [DEFAULT_PROFILE]: raw },
  };
}

async function readRaw() {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    const text = await readFile(CONFIG_FILE, "utf8");
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`无法读取配置文件 ${CONFIG_FILE}: ${err.message}`);
  }
}

async function writeRaw(store) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(store, null, 2), "utf8");
  try {
    await chmod(CONFIG_FILE, 0o600);
  } catch {
    // Windows no-op
  }
}

export async function readStore() {
  const raw = await readRaw();
  if (!raw) return null;
  const wasLegacy = isLegacyShape(raw);
  const store = migrate(raw);
  if (wasLegacy) {
    // 自动迁移落盘，下次读就是新 schema
    await writeRaw(store);
  }
  return store;
}

export async function readConfig(profile) {
  const store = await readStore();
  if (!store) return null;
  const explicit = profile || process.env.YNAPI_PROFILE;
  const name = explicit || store.current || DEFAULT_PROFILE;
  const cfg = store.profiles[name];
  if (!cfg && explicit) {
    const all = Object.keys(store.profiles).join(", ") || "(无)";
    throw new Error(`profile "${name}" 不存在。已有：${all}`);
  }
  return cfg ?? null;
}

export async function writeConfig(cfg, profile) {
  const existing = (await readStore()) ?? { current: DEFAULT_PROFILE, profiles: {} };
  const name = profile || existing.current || DEFAULT_PROFILE;
  validateProfileName(name);
  existing.profiles[name] = cfg;
  if (!existing.current || !existing.profiles[existing.current]) {
    existing.current = name;
  }
  await writeRaw(existing);
}

export async function listProfiles() {
  const store = await readStore();
  if (!store) return { current: null, names: [] };
  return { current: store.current, names: Object.keys(store.profiles) };
}

export async function useProfile(name) {
  validateProfileName(name);
  const store = await readStore();
  if (!store) throw new Error("还没有配置文件，先跑 `ynapi setup`");
  if (!store.profiles[name]) {
    throw new Error(`profile "${name}" 不存在。已有：${Object.keys(store.profiles).join(", ") || "(无)"}`);
  }
  store.current = name;
  await writeRaw(store);
}

export async function renameProfile(oldName, newName) {
  validateProfileName(newName);
  const store = await readStore();
  if (!store) throw new Error("还没有配置文件，先跑 `ynapi setup`");
  if (!store.profiles[oldName]) {
    throw new Error(`profile "${oldName}" 不存在`);
  }
  if (store.profiles[newName]) {
    throw new Error(`profile "${newName}" 已存在`);
  }
  store.profiles[newName] = store.profiles[oldName];
  delete store.profiles[oldName];
  if (store.current === oldName) store.current = newName;
  await writeRaw(store);
}

export async function removeProfile(name) {
  const store = await readStore();
  if (!store) throw new Error("还没有配置文件");
  if (!store.profiles[name]) {
    throw new Error(`profile "${name}" 不存在`);
  }
  if (store.current === name) {
    throw new Error(
      `不能删除当前 profile "${name}"。先跑 \`ynapi profile use <其他>\` 切走再删。`
    );
  }
  delete store.profiles[name];
  await writeRaw(store);
}

function pickProfileName({ profileFlag } = {}) {
  return profileFlag || process.env.YNAPI_PROFILE || null;
}

export function resolveCreds({ siteFlag, keyFlag, config, profileFlag } = {}) {
  const _ = pickProfileName({ profileFlag }); // hint: profile is resolved at readConfig() time
  const site =
    siteFlag ||
    process.env.YNAPI_SITE ||
    config?.site ||
    DEFAULT_SITE;
  const key = keyFlag || process.env.YNAPI_KEY || config?.api_key;
  return { site: site.replace(/\/+$/, ""), key };
}

export function resolveAuth({ siteFlag, config, profileFlag } = {}) {
  const _ = pickProfileName({ profileFlag });
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
