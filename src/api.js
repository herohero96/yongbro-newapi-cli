export class ApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function doFetch(url, headers, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: controller.signal,
    });
    return res;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new ApiError(`请求超时（${timeoutMs}ms）：${url}`);
    }
    throw new ApiError(`网络错误：${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

async function parseResponse(res) {
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  if (!res.ok) {
    throw new ApiError(
      `HTTP ${res.status}：${json?.message || text.slice(0, 200)}`,
      { status: res.status, body: json ?? text }
    );
  }
  if (json && json.success === false) {
    throw new ApiError(`接口失败：${json.message || "(无 message)"}`, {
      status: res.status,
      body: json,
    });
  }
  return json;
}

async function request(site, path, key, { timeoutMs = 15000 } = {}) {
  const res = await doFetch(
    `${site}${path}`,
    {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
    timeoutMs
  );
  return parseResponse(res);
}

async function requestAuthed(site, path, { cookie, userId, timeoutMs = 15000 } = {}) {
  if (!cookie) {
    throw new ApiError(
      "缺少 cookie。先跑 `ynapi setup --advanced`，或通过 YNAPI_COOKIE 提供。"
    );
  }
  if (!userId) {
    throw new ApiError(
      "缺少 user_id。先跑 `ynapi setup --advanced`，或通过 YNAPI_USER_ID 提供。"
    );
  }
  const res = await doFetch(
    `${site}${path}`,
    {
      Accept: "application/json",
      Cookie: cookie,
      "new-api-user": String(userId),
    },
    timeoutMs
  );
  return parseResponse(res);
}

export async function getTokenUsage(site, key) {
  return request(site, "/api/usage/token/", key);
}

export async function listModels(site, key) {
  return request(site, "/v1/models", key);
}

export async function getUserSelf(site, auth) {
  return requestAuthed(site, "/api/user/self", auth);
}

export async function getUsageData(site, auth, { startTs, endTs }) {
  const qs = new URLSearchParams({
    start_timestamp: String(startTs),
    end_timestamp: String(endTs),
    default_time: "day",
  }).toString();
  return requestAuthed(site, `/api/data/self/?${qs}`, auth);
}
