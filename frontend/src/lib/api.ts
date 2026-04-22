export type CurrentUser = {
  username: string;
};

export type TranslationThread = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  lastPreview: string;
  messageCount: number;
};

export type TranslationMessage = {
  id: string;
  threadId: string;
  model: string;
  sourceLanguage: string;
  targetLanguage: string;
  translationStyle: string;
  sourceText: string;
  translatedText: string;
  createdAt: string;
};

export type GlossaryTerm = {
  id: string;
  sourceTerm: string;
  targetTerm: string;
  languagePair: string;
  note: string;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

async function parseError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { error?: string; detail?: string };
    if (typeof data.error === "string" && data.error.trim()) return data.error;
    if (typeof data.detail === "string" && data.detail.trim()) return data.detail;
    return fallback;
  } catch {
    const text = await response.text().catch(() => "");
    return text.trim() || fallback;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  fallback = "请求失败。",
): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(await parseError(response, fallback));
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function requestCurrentUser() {
  const response = await fetch("/api/auth/me", {
    credentials: "include",
    cache: "no-store",
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(await parseError(response, "获取登录状态失败。"));
  return (await response.json()) as CurrentUser;
}

export function login(payload: { username: string; password: string }) {
  return request<void>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  }, "登录失败。");
}

export function register(payload: {
  username: string;
  password: string;
  inviteCode: string;
}) {
  return request<void>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  }, "注册失败。");
}

export function logout() {
  return request<void>("/api/auth/logout", { method: "POST" }, "退出失败。");
}

export function requestTranslationThreads() {
  return request<TranslationThread[]>("/api/translations/threads", {}, "加载历史失败。");
}

export function requestTranslationMessages(threadId: string) {
  return request<TranslationMessage[]>(
    `/api/translations/threads/${threadId}/messages`,
    {},
    "加载会话失败。",
  );
}

export function renameTranslationThread(threadId: string, title: string) {
  return request<TranslationThread>(
    `/api/translations/threads/${threadId}`,
    { method: "PATCH", body: JSON.stringify({ title }) },
    "重命名失败。",
  );
}

export function deleteTranslationThread(threadId: string) {
  return request<void>(
    `/api/translations/threads/${threadId}`,
    { method: "DELETE" },
    "删除失败。",
  );
}

export function requestGlossary() {
  return request<GlossaryTerm[]>("/api/glossary", {}, "加载术语本失败。");
}

export function createGlossaryTerm(payload: {
  sourceTerm: string;
  targetTerm: string;
  languagePair?: string;
  note?: string;
}) {
  return request<GlossaryTerm>(
    "/api/glossary",
    { method: "POST", body: JSON.stringify(payload) },
    "新增术语失败。",
  );
}

export function updateGlossaryTerm(
  id: string,
  payload: Partial<{
    sourceTerm: string;
    targetTerm: string;
    languagePair: string;
    note: string;
  }>,
) {
  return request<GlossaryTerm>(
    `/api/glossary/${id}`,
    { method: "PATCH", body: JSON.stringify(payload) },
    "更新术语失败。",
  );
}

export function deleteGlossaryTerm(id: string) {
  return request<void>(`/api/glossary/${id}`, { method: "DELETE" }, "删除术语失败。");
}

export async function translateStream(
  payload: {
    model: string;
    taskMode: string;
    sourceLanguage: string;
    targetLanguage: string;
    translationStyle: string;
    sourceText: string;
    threadId?: string | null;
    contextDepth?: number;
  },
  signal?: AbortSignal,
) {
  const response = await fetch("/api/translate", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    throw new Error(await parseError(response, "处理失败，请稍后再试。"));
  }

  return {
    response,
    threadId: response.headers.get("X-Thread-Id"),
  };
}
