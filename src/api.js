export class ApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request(site, path, key, { method = "GET", timeoutMs = 15000 } = {}) {
  const url = `${site}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      throw new ApiError(`请求超时（${timeoutMs}ms）：${url}`);
    }
    throw new ApiError(`网络错误：${err.message}`);
  }
  clearTimeout(timer);

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

  return json;
}

export async function getTokenUsage(site, key) {
  return request(site, "/api/usage/token/", key);
}

export async function listModels(site, key) {
  return request(site, "/v1/models", key);
}
